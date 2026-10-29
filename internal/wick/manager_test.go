package wick

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"go.yaml.in/yaml/v3"
)

func TestMain(m *testing.M) {
	if os.Getenv("WICK_TEST_PROCESS") == "1" {
		home, name := os.Args[1], os.Args[2]
		if _, err := os.Stat(filepath.Join(home, name+".broken")); err == nil {
			fmt.Println("Broken configuration")
			os.Exit(7)
		}
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			panic(err)
		}
		port := strings.Split(listener.Addr().String(), ":")[1]
		if err := os.WriteFile(filepath.Join(home, name+".port"), []byte(port), 0600); err != nil {
			panic(err)
		}
		fmt.Println("ready", name)
		http.Serve(listener, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if _, err := os.Stat(filepath.Join(home, name+".unhealthy")); err == nil {
				w.WriteHeader(503)
			}
			fmt.Fprint(w, "wick-test-"+name)
		}))
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func fixture(t *testing.T) *Manager {
	t.Helper()
	// Short socket paths also work on macOS's 104-byte sockaddr_un.
	home, err := os.MkdirTemp("/tmp", "wick-test-")
	must(t, err)
	m := New(home)
	if os.Getenv("WICK_PC") == "" {
		m.Binary, err = filepath.Abs("../../build/Wick-darwin-arm64/Wick.app/Contents/Resources/bin/process-compose")
		must(t, err)
	}
	if _, err := os.Stat(m.Binary); err != nil {
		t.Fatalf("build Wick first with npm run build: %v", err)
	}
	must(t, m.Init())
	t.Cleanup(func() {
		m.Down()
		m.client.CloseIdleConnections()
		os.RemoveAll(home)
	})
	return m
}

func process(t *testing.T, m *Manager, name string) object {
	t.Helper()
	executable, err := os.Executable()
	must(t, err)
	return object{
		"command":     "exec " + quote(executable) + " " + quote(m.Home) + " " + quote(name),
		"environment": []string{"WICK_TEST_PROCESS=1"}, "working_dir": m.Home, "disabled": true,
	}
}

func configure(t *testing.T, m *Manager, processes object) object {
	t.Helper()
	c := object{"version": "0.5", "processes": processes}
	must(t, writeYAML(m.Config, c))
	return c
}

func wait(t *testing.T, timeout time.Duration, condition func() bool) {
	t.Helper()
	end := time.Now().Add(timeout)
	for time.Now().Before(end) {
		if condition() {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("timed out waiting for expected state")
}

func reachable(t *testing.T, m *Manager, name string) {
	t.Helper()
	client := &http.Client{Timeout: 500 * time.Millisecond}
	wait(t, 10*time.Second, func() bool {
		port, err := os.ReadFile(filepath.Join(m.Home, name+".port"))
		if err != nil {
			return false
		}
		res, err := client.Get("http://127.0.0.1:" + string(port))
		if err != nil {
			return false
		}
		res.Body.Close()
		return res.StatusCode == 200
	})
}

func get(t *testing.T, m *Manager, name string) object {
	t.Helper()
	s := m.Snapshot()
	if s.Error != "" {
		t.Fatal(s.Error)
	}
	for _, service := range s.Services {
		if service["name"] == name {
			return service
		}
	}
	t.Fatalf("missing service %s", name)
	return nil
}

func pid(t *testing.T, m *Manager, name string) int {
	t.Helper()
	return int(number(get(t, m, name)["pid"]))
}

func TestLifecycleApplyAndAutostart(t *testing.T) {
	m := fixture(t)
	c := configure(t, m, object{"web": process(t, m, "web")})
	must(t, m.Ensure())
	if flag(get(t, m, "web")["is_running"]) {
		t.Fatal("disabled service started on boot")
	}
	must(t, m.Action("start", "web", ActionOptions{}))
	reachable(t, m, "web")
	original := pid(t, m, "web")
	wait(t, 3*time.Second, func() bool { logs, _ := m.Logs("web"); return strings.Contains(logs, "ready web") })

	config := mapping(c["processes"])
	mapping(config["web"])["x-wick"] = object{"title": "My Notes", "url": "http://localhost:5231"}
	config["other"] = process(t, m, "other")
	must(t, writeYAML(m.Config, c))
	must(t, m.Apply())
	if pid(t, m, "web") != original || get(t, m, "web")["title"] != "My Notes" {
		t.Fatal("metadata/registration apply must preserve the running PID")
	}
	// Source comments and unknown PC options survive the GUI's policy edit.
	f, err := os.OpenFile(m.Config, os.O_APPEND|os.O_WRONLY, 0600)
	must(t, err)
	_, err = f.WriteString("\n# user comment\n")
	must(t, err)
	must(t, f.Close())
	snapshot := m.Snapshot()
	must(t, m.SetAutostart("web", true, snapshot.Token))
	must(t, m.Apply())
	if pid(t, m, "web") != original || get(t, m, "web")["autostart"] != true {
		t.Fatal("autostart edit changed current state")
	}
	content, err := os.ReadFile(m.Config)
	must(t, err)
	if !strings.Contains(string(content), "# user comment") || !strings.Contains(string(content), "working_dir:") {
		t.Fatal("configuration edit lost source content")
	}
	if err := m.SetAutostart("web", false, snapshot.Token); err == nil || !strings.Contains(err.Error(), "changed") {
		t.Fatal("stale configuration edit was not rejected")
	}
	must(t, m.Action("restart", "web", ActionOptions{}))
	reachable(t, m, "web")
	if pid(t, m, "web") == original {
		t.Fatal("restart left the same process")
	}
	must(t, m.Action("stop", "web", ActionOptions{}))
	time.Sleep(2500 * time.Millisecond)
	if flag(get(t, m, "web")["is_running"]) {
		t.Fatal("manual stop triggered recovery")
	}
	must(t, m.Down())
	must(t, m.Ensure())
	reachable(t, m, "web")
	if flag(get(t, m, "other")["is_running"]) {
		t.Fatal("disabled service started with the enabled one")
	}
	must(t, m.SetAutostart("web", false, m.Snapshot().Token))
	must(t, m.Down())
	must(t, m.Ensure())
	if flag(get(t, m, "web")["is_running"]) {
		t.Fatal("next boot ignored disabled policy")
	}
}

func TestInvalidConfigPreservesRunningServices(t *testing.T) {
	m := fixture(t)
	c := configure(t, m, object{"web": process(t, m, "web")})
	must(t, m.Ensure())
	must(t, m.Action("start", "web", ActionOptions{}))
	reachable(t, m, "web")
	original := pid(t, m, "web")
	runtime, err := os.ReadFile(m.Runtime)
	must(t, err)
	p := mapping(mapping(c["processes"])["web"])
	p["availability"] = object{"max_restarts": 0}
	must(t, writeYAML(m.Config, c))
	if err := m.Apply(); err == nil {
		t.Fatal("invalid recovery budget accepted")
	}
	current, err := os.ReadFile(m.Runtime)
	must(t, err)
	if string(current) != string(runtime) || pid(t, m, "web") != original {
		t.Fatal("invalid apply changed the runtime or running process")
	}
	must(t, os.WriteFile(m.Config, []byte("processes: [invalid YAML"), 0600))
	snapshot := m.Snapshot()
	if snapshot.Background != "connected" || !strings.Contains(snapshot.Error, "Configuration unavailable") {
		t.Fatalf("configuration error confused background connection: %+v", snapshot)
	}
	reachable(t, m, "web")
}

func TestGroupedAndComponentActions(t *testing.T) {
	m := fixture(t)
	collector := process(t, m, "collector")
	delete(collector, "disabled")
	// A real readiness check: the helper creates this only once HTTP listens.
	collector["readiness_probe"] = object{"exec": object{"command": "/bin/test -s " + quote(filepath.Join(m.Home, "collector.port"))}, "period_seconds": 1}
	page := process(t, m, "page")
	delete(page, "disabled")
	page["depends_on"] = object{"collector": object{"condition": "process_healthy"}}
	worker := process(t, m, "worker")
	delete(worker, "disabled")
	c := configure(t, m, object{"collector": collector, "page": page, "worker": worker, "other": process(t, m, "other")})
	c["x-wick"] = object{"services": object{"group": object{"disabled": true, "processes": []string{"collector", "page", "worker"}}}}
	must(t, writeYAML(m.Config, c))
	must(t, m.Ensure())
	must(t, m.Action("start", "other", ActionOptions{}))
	otherPID := pid(t, m, "other")
	must(t, m.Action("start", "group", ActionOptions{Component: "page"}))
	reachable(t, m, "page")
	group := get(t, m, "group")
	components := group["components"].([]object)
	if group["status"] != "Partially running" || flag(components[2]["is_running"]) {
		t.Fatal("component start launched an unrelated branch")
	}
	pagePID, collectorPID := components[1]["pid"], components[0]["pid"]
	err := m.Action("stop", "group", ActionOptions{Component: "collector"})
	var impact *ImpactError
	if !errors.As(err, &impact) || len(impact.Affected) != 1 || impact.Affected[0] != "page" {
		t.Fatalf("dependent impact was not reported: %v", err)
	}
	must(t, m.Action("restart", "group", ActionOptions{Component: "collector", ConfirmImpact: true}))
	components = get(t, m, "group")["components"].([]object)
	if components[0]["pid"] == collectorPID || components[1]["pid"] != pagePID {
		t.Fatal("component restart affected the wrong processes")
	}
	must(t, m.Action("stop", "group", ActionOptions{Component: "collector", ConfirmImpact: true}))
	if err := m.Action("restart", "group", ActionOptions{Component: "page"}); err == nil || !strings.Contains(err.Error(), "dependency") {
		t.Fatalf("restart should not satisfy missing dependencies: %v", err)
	}
	must(t, m.Action("start", "group", ActionOptions{}))
	if get(t, m, "group")["status"] != "Running" {
		t.Fatal("whole-group start did not fill missing processes")
	}
	must(t, m.SetAutostart("group", true, m.Snapshot().Token))
	must(t, m.Action("stop", "group", ActionOptions{}))
	if get(t, m, "group")["status"] != "Stopped" || pid(t, m, "other") != otherPID {
		t.Fatal("group stop affected unrelated service or left components running")
	}
	must(t, m.Down())
	must(t, m.Ensure())
	reachable(t, m, "page")
	reachable(t, m, "worker")
}

func TestRecoveryRefreshesOnlyExhaustedProcess(t *testing.T) {
	m := fixture(t)
	web := process(t, m, "web")
	web["availability"] = object{"max_restarts": 2, "backoff_seconds": 1}
	configure(t, m, object{"web": web, "other": process(t, m, "other")})
	must(t, m.Ensure())
	must(t, m.Action("start", "web", ActionOptions{}))
	must(t, m.Action("start", "other", ActionOptions{}))
	reachable(t, m, "web")
	otherPID, original := pid(t, m, "other"), pid(t, m, "web")
	must(t, syscall.Kill(original, syscall.SIGKILL))
	wait(t, 5*time.Second, func() bool { return flag(get(t, m, "web")["is_running"]) && pid(t, m, "web") != original })
	reachable(t, m, "web")
	must(t, os.WriteFile(filepath.Join(m.Home, "web.broken"), []byte("yes"), 0600))
	must(t, syscall.Kill(pid(t, m, "web"), syscall.SIGKILL))
	wait(t, 10*time.Second, func() bool {
		s := get(t, m, "web")
		return !flag(s["is_running"]) && s["status"] == "Completed" && number(s["restarts"]) == 2
	})
	if number(get(t, m, "web")["exit_code"]) != 7 {
		t.Fatal("lost the process exit code")
	}
	logs, err := m.Logs("web")
	must(t, err)
	if !strings.Contains(logs, "Broken configuration") {
		t.Fatal("missing failure logs")
	}
	source, err := os.ReadFile(m.Config)
	must(t, err)
	must(t, os.Rename(filepath.Join(m.Home, "web.broken"), filepath.Join(m.Home, "web.fixed")))
	must(t, m.Action("start", "web", ActionOptions{}))
	reachable(t, m, "web")
	if number(get(t, m, "web")["restarts"]) != 0 || pid(t, m, "other") != otherPID {
		t.Fatal("recovery did not refresh only the target retry budget")
	}
	must(t, m.Apply())
	if pid(t, m, "other") != otherPID {
		t.Fatal("apply after recovery restarted an unrelated process")
	}
	current, err := os.ReadFile(m.Config)
	must(t, err)
	if string(source) != string(current) {
		t.Fatal("recovery changed the source configuration")
	}
}

func TestLaunchdUsesGoBootstrap(t *testing.T) {
	m := fixture(t)
	executable, err := filepath.Abs("../../build/Wick-darwin-arm64/Wick.app/Contents/MacOS/Wick")
	must(t, err)
	label := fmt.Sprintf("dev.wick.test.%d", os.Getpid())
	domain := fmt.Sprintf("gui/%d/%s", os.Getuid(), label)
	t.Cleanup(func() { exec.Command("/bin/launchctl", "bootout", domain).Run() })
	web := process(t, m, "web")
	web["disabled"] = false
	configure(t, m, object{"web": web, "manual": process(t, m, "manual")})
	options := LoginOptions{Label: label, AgentPath: filepath.Join(m.Home, "agent.plist"), Executable: executable}
	must(t, m.InstallLogin(options))
	reachable(t, m, "web")
	if flag(get(t, m, "manual")["is_running"]) {
		t.Fatal("login started a manual-only service")
	}
	loaded, err := exec.Command("/bin/launchctl", "print", domain).CombinedOutput()
	must(t, err)
	if !strings.Contains(string(loaded), "state = running") {
		t.Fatal(string(loaded))
	}
	bootstrap, err := os.ReadFile(filepath.Join(m.Home, "bootstrap.sh"))
	must(t, err)
	if strings.Contains(string(bootstrap), "ELECTRON") || !strings.Contains(string(bootstrap), "--boot") {
		t.Fatal("bootstrap still requires Electron")
	}
	must(t, m.Action("stop", "web", ActionOptions{}))
	must(t, m.InstallLogin(options))
	if flag(get(t, m, "web")["is_running"]) {
		t.Fatal("reopening console changed the manual stop")
	}
}

func TestConfigRejectsInvalidGroups(t *testing.T) {
	for _, tc := range []struct {
		name       string
		definition object
		contains   string
	}{
		{"unknown", object{"disabled": true, "processes": []string{"missing"}}, "unknown process"},
		{"duplicate", object{"disabled": true, "processes": []string{"web", "web"}}, "more than one service"},
		{"implicit policy", object{"processes": []string{"web"}}, "disabled must be explicit"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			m := fixture(t)
			must(t, writeYAML(m.Config, object{"processes": object{"web": object{"command": "sleep 100"}},
				"x-wick": object{"services": object{"group": tc.definition}}}))
			err := m.Validate()
			if err == nil || !strings.Contains(err.Error(), tc.contains) {
				t.Fatalf("expected %q, got %v", tc.contains, err)
			}
		})
	}
}

func TestSnapshotHealthAndSignalExit(t *testing.T) {
	for _, tc := range []struct {
		state object
		want  string
	}{
		{object{"is_running": true, "hasProbe": true, "is_ready": "Not Ready"}, "Unhealthy"},
		{object{"is_running": true, "hasProbe": true, "is_ready": "Unknown"}, "Starting"},
		{object{"is_running": true, "hasProbe": false}, "Running"},
		{object{"status": "Completed", "exit_code": -1}, "Stopped"},
		{object{"status": "Completed", "exit_code": 7}, "Failed"},
	} {
		if got := processStatus(tc.state); got != tc.want {
			t.Errorf("%v: got %s, want %s", tc.state, got, tc.want)
		}
	}
}

func TestAutostartPreservesYAMLComments(t *testing.T) {
	m := fixture(t)
	source := "# source\nversion: '0.5'\nprocesses:\n  web:\n    command: 'sleep 100'\n    disabled: true # next login\n    shutdown:\n      timeout_seconds: 8\n"
	must(t, os.WriteFile(m.Config, []byte(source), 0600))
	must(t, m.SetAutostart("web", true, token([]byte(source))))
	current, err := os.ReadFile(m.Config)
	must(t, err)
	for _, expected := range []string{"# source", "# next login", "command: 'sleep 100'", "timeout_seconds: 8"} {
		if !strings.Contains(string(current), expected) {
			t.Errorf("missing %s", expected)
		}
	}
	var result object
	must(t, yaml.Unmarshal(current, &result))
	if mapping(mapping(result["processes"])["web"])["disabled"] != false {
		t.Fatal("policy not saved")
	}
}
