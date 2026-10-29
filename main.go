package main

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/RunMintOn/Wick/internal/wick"
	"github.com/egoist/mygo"
)

//go:embed src/index.html src/style.css src/renderer.js src/bridge.js
var frontend embed.FS

var version = "0.2.0"

func main() {
	if len(os.Args) > 1 {
		os.Exit(runCLI(os.Args[1:]))
	}
	if err := runConsole(); err != nil {
		log.Fatal(err)
	}
}

func runCLI(args []string) int {
	if err := command(args); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return 0
}

func command(args []string) error {
	m := wick.New("")
	switch args[0] {
	case "--help", "help":
		fmt.Println("Usage: wick list | start|stop|restart <service> [process] [--confirm-impact] | validate | apply | recover <service> | skill:install")
		return nil
	case "--boot":
		exists, err := m.Boot()
		if err == nil && exists {
			os.Exit(10)
		}
		return err
	case "validate", "apply", "skill:install":
		if len(args) != 1 {
			return fmt.Errorf("%s does not accept arguments", args[0])
		}
		switch args[0] {
		case "validate":
			if err := m.Validate(); err != nil {
				return err
			}
			fmt.Println("Configuration is valid.")
		case "apply":
			if err := m.Apply(); err != nil {
				return err
			}
			fmt.Println("Configuration applied. Unchanged services were preserved.")
		case "skill:install":
			return wick.InstallSkill(projectDir())
		}
		return nil
	case "recover":
		if len(args) != 2 {
			return fmt.Errorf("usage: wick recover <service>")
		}
		if err := m.Action("start", args[1], wick.ActionOptions{}); err != nil {
			return err
		}
		fmt.Println("Service started with an available retry budget.")
		return nil
	case "list", "start", "stop", "restart":
		options := wick.ActionOptions{}
		positional := []string{}
		for _, arg := range args[1:] {
			if arg == "--confirm-impact" {
				options.ConfirmImpact = true
			} else if strings.HasPrefix(arg, "--") {
				return fmt.Errorf("unknown option: %s", arg)
			} else {
				positional = append(positional, arg)
			}
		}
		if args[0] == "list" {
			if len(positional) > 0 {
				return fmt.Errorf("list does not accept arguments")
			}
		} else {
			if len(positional) < 1 || len(positional) > 2 {
				return fmt.Errorf("usage: wick %s <service> [process] [--confirm-impact]", args[0])
			}
			if len(positional) == 2 {
				options.Component = positional[1]
			}
			if err := m.Action(args[0], positional[0], options); err != nil {
				return err
			}
		}
		snapshot := m.Snapshot()
		if snapshot.Error != "" {
			return errors.New(snapshot.Error)
		}
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		if err := encoder.Encode(snapshot); err != nil {
			return err
		}
		if args[0] == "start" || args[0] == "restart" {
			for _, s := range snapshot.Services {
				if s["name"] == positional[0] && (s["status"] == "Error" || s["status"] == "Completed" && s["exit_code"] != float64(0)) {
					return fmt.Errorf("%s: process failed; check its status and logs", positional[0])
				}
			}
		}
		return nil
	}
	return fmt.Errorf("unknown command: %s", args[0])
}

func projectDir() string {
	executable, _ := os.Executable()
	if filepath.Base(filepath.Dir(executable)) == "MacOS" {
		return filepath.Join(wick.Resources(), "app")
	}
	directory, _ := os.Getwd()
	return directory
}

// Console exposes only the operations the page needs, not Manager's internals.
type Console struct {
	manager      *wick.Manager
	mu           sync.Mutex
	connectError error
}

func (c *Console) connect() {
	if os.Getenv("WICK_HOME") != "" {
		c.connectError = c.manager.Ensure()
	} else {
		c.connectError = c.manager.InstallLogin(wick.LoginOptions{})
		if c.connectError == nil {
			c.connectError = c.manager.WaitConnected()
		}
	}
}

func (c *Console) Snapshot(reconnect bool) wick.Snapshot {
	c.mu.Lock()
	defer c.mu.Unlock()
	if reconnect {
		c.connect()
	}
	snapshot := c.manager.Snapshot()
	if c.connectError != nil && snapshot.Background == "unavailable" {
		snapshot.Error += "\n" + c.connectError.Error()
	}
	return snapshot
}

func result(err error) map[string]any {
	if err == nil {
		return map[string]any{}
	}
	r := map[string]any{"error": err.Error()}
	var impact *wick.ImpactError
	if errors.As(err, &impact) {
		r["requiresConfirmation"], r["affected"] = true, impact.Affected
	}
	return r
}

func (c *Console) Action(action, name string, options wick.ActionOptions) map[string]any {
	return result(c.manager.Action(action, name, options))
}

func (c *Console) Autostart(name string, value bool, token string) map[string]any {
	return result(c.manager.SetAutostart(name, value, token))
}

func (c *Console) Logs(name string) (map[string]string, error) {
	text, err := c.manager.Logs(name)
	return map[string]string{"text": text}, err
}

func (c *Console) Open(name string) map[string]any {
	address, err := c.manager.ServiceURL(name)
	if err == nil {
		err = mygo.Shell.OpenExternal(address)
	}
	return result(err)
}

func runConsole() error {
	manager := wick.New("")
	mygo.App.SetName("Wick")
	mygo.App.SetVersion(version)
	if os.Getenv("WICK_HEADLESS") == "1" {
		mygo.App.SetActivationPolicy(mygo.ActivationPolicyProhibited)
	}
	mygo.App.SetPath(mygo.PathUserData, filepath.Join(manager.Home, "console"))
	if !mygo.App.RequestSingleInstanceLock() {
		return nil
	}
	web, err := fs.Sub(frontend, "src")
	if err != nil {
		return err
	}
	mygo.SetFrontend(web)
	console := &Console{manager: manager}
	mygo.Bind(console)
	var window *mygo.Window
	mygo.App.OnSecondInstance(func(_ []string, _ string) {
		if window != nil {
			window.Restore()
			window.Show()
			window.Focus()
		}
	})
	mygo.App.OnWindowAllClosed(mygo.App.Quit)
	mygo.App.WhenReady(func() {
		window = mygo.NewWindow(mygo.WindowOptions{
			Title: "Wick", URL: "/", Width: 960, Height: 680, MinWidth: 720, MinHeight: 500,
			TitleBarStyle: mygo.TitleBarHiddenInset, BackgroundColor: "#1b1b1d", Hidden: os.Getenv("WICK_HEADLESS") == "1",
		})
		window.Page().OnWillNavigate(func(event *mygo.NavigateEvent) { event.PreventDefault() })
		window.Page().SetWindowOpenHandler(func(mygo.WindowOpenRequest) *mygo.WindowOptions { return nil })
		console.mu.Lock()
		go func() {
			defer console.mu.Unlock()
			console.connect()
		}()
	})
	return mygo.App.Run()
}
