package wick

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type Manager struct {
	Home, Config, Socket, Runtime, Binary string
	client                                *http.Client
}

func Resources() string {
	executable, _ := os.Executable()
	return filepath.Join(filepath.Dir(filepath.Dir(executable)), "Resources")
}

func New(home string) *Manager {
	if home == "" {
		home = os.Getenv("WICK_HOME")
	}
	if home == "" {
		userHome, _ := os.UserHomeDir()
		home = filepath.Join(userHome, "Library", "Application Support", "Wick")
	}
	binary := os.Getenv("WICK_PC")
	if binary == "" {
		binary = filepath.Join(Resources(), "bin", "process-compose")
		if _, err := os.Stat(binary); os.IsNotExist(err) {
			binary = "/opt/homebrew/bin/process-compose"
		}
	}
	m := &Manager{Home: home, Config: filepath.Join(home, "services.yaml"), Socket: filepath.Join(home, "control.sock"),
		Runtime: filepath.Join(home, "runtime.yaml"), Binary: binary}
	m.client = &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", m.Socket)
		},
	}}
	return m
}

func (m *Manager) Init() error {
	if err := os.MkdirAll(m.Home, 0700); err != nil {
		return err
	}
	f, err := os.OpenFile(m.Config, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if os.IsExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.WriteString("version: \"0.5\"\nlog_level: info\nlog_length: 500\nprocesses: {}\n")
	return err
}

func (m *Manager) withLock(operation func() error) error {
	if err := m.Init(); err != nil {
		return err
	}
	lock := filepath.Join(m.Home, "operation.lock")
	var handle *os.File
	for range 100 {
		var err error
		handle, err = os.OpenFile(lock, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err == nil {
			break
		}
		if !os.IsExist(err) {
			return err
		}
		time.Sleep(100 * time.Millisecond)
	}
	if handle == nil {
		return fmt.Errorf("another Wick operation is busy; if no operation is running, remove the stale operation.lock and retry")
	}
	defer os.Remove(lock)
	defer handle.Close()
	if _, err := fmt.Fprint(handle, os.Getpid()); err != nil {
		return err
	}
	return operation()
}

func (m *Manager) cli(args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, m.Binary, append([]string{"-U", "-u", m.Socket, "-L", "/dev/null"}, args...)...)
	command.Dir = m.Home
	command.Env = append(os.Environ(), "PROC_COMP_CONFIG="+m.Home)
	var stderr strings.Builder
	command.Stderr = &stderr
	out, err := command.Output()
	if err != nil {
		return "", fmt.Errorf("Process Compose %s failed (%w):\n%s", strings.Join(args, " "), err, stderr.String())
	}
	return string(out), nil
}

func (m *Manager) request(route, method string, result any) error {
	req, err := http.NewRequest(method, "http://localhost"+route, nil)
	if err != nil {
		return err
	}
	res, err := m.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 && res.StatusCode != 207 {
		body, _ := io.ReadAll(res.Body)
		return fmt.Errorf("background request failed (%d): %s", res.StatusCode, body)
	}
	return json.NewDecoder(res.Body).Decode(result)
}

func (m *Manager) Connected() bool {
	var result object
	return m.request("/processes", "GET", &result) == nil
}

func (m *Manager) states() ([]object, error) {
	var result struct {
		Data []object `json:"data"`
	}
	err := m.request("/processes", "GET", &result)
	return result.Data, err
}

func (m *Manager) reload() error {
	var result object
	if err := m.request("/project/configuration", "POST", &result); err != nil {
		return err
	}
	for _, value := range result {
		if value == "error" {
			return fmt.Errorf("some services could not be updated; check the affected service logs")
		}
	}
	return nil
}

// Boot prepares login policy only when no background is already running.
// Exit code 10 tells bootstrap.sh not to start a second manager.
func (m *Manager) Boot() (bool, error) {
	exists := false
	err := m.withLock(func() error {
		exists = m.Connected()
		if exists {
			return nil
		}
		staged, err := m.prepare(false)
		if err != nil {
			return err
		}
		return os.Rename(staged, m.Runtime)
	})
	return exists, err
}

func (m *Manager) Ensure() error {
	return m.withLock(func() error {
		if m.Connected() {
			return nil
		}
		staged, err := m.prepare(false)
		if err != nil {
			return err
		}
		if err := os.Rename(staged, m.Runtime); err != nil {
			return err
		}
		if _, err := m.cli("up", "-f", m.Runtime, "-D", "--keep-project", "--disable-dotenv"); err != nil {
			return err
		}
		return m.WaitConnected()
	})
}

func (m *Manager) WaitConnected() error {
	for range 50 {
		if m.Connected() {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("background manager did not start; check configuration and startup.log")
}

func (m *Manager) Validate() error {
	return m.withLock(func() error { _, err := m.prepare(true); return err })
}

func (m *Manager) Apply() error {
	return m.withLock(func() error {
		staged, err := m.prepare(true)
		if err != nil {
			return err
		}
		old, err := os.ReadFile(m.Runtime)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if err := os.Rename(staged, m.Runtime); err != nil {
			return err
		}
		if m.Connected() {
			// Reload through PC's loader: its CLI update retypes numbers and
			// restarts unchanged processes in the pinned release.
			if err := m.reload(); err != nil {
				if old != nil {
					if restore := os.WriteFile(m.Runtime, old, 0600); restore != nil {
						return fmt.Errorf("%w; restoring runtime: %v", err, restore)
					}
				}
				return err
			}
		}
		return nil
	})
}

func (m *Manager) Down() error { _, err := m.cli("down"); return err }
