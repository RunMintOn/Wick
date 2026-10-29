package wick

import (
	"encoding/xml"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type LoginOptions struct {
	Label, AgentPath, Executable string
}

func quote(value string) string { return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'" }
func escapeXML(value string) string {
	var out strings.Builder
	xml.EscapeText(&out, []byte(value))
	return out.String()
}

func (m *Manager) InstallLogin(options LoginOptions) error {
	label := options.Label
	if label == "" {
		label = "dev.wick.manager"
	}
	agentPath := options.AgentPath
	if agentPath == "" {
		home, _ := os.UserHomeDir()
		agentPath = filepath.Join(home, "Library", "LaunchAgents", label+".plist")
	}
	executable := options.Executable
	if executable == "" {
		var err error
		executable, err = os.Executable()
		if err != nil {
			return err
		}
	}
	if err := m.Init(); err != nil {
		return err
	}
	bootstrap := filepath.Join(m.Home, "bootstrap.sh")
	body := fmt.Sprintf(`#!/bin/sh
export WICK_HOME=%s
export PROC_COMP_CONFIG=%s
export WICK_PC=%s
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
: > %s
%s --boot >> %s 2>&1
result=$?
# A detached manager may already own this socket during the current session.
[ "$result" = 10 ] && exit 0
[ "$result" = 0 ] || exit "$result"
exec %s -U -u %s -L /dev/null up -f %s -t=false --keep-project --disable-dotenv 2>> %s
`, quote(m.Home), quote(m.Home), quote(m.Binary), quote(filepath.Join(m.Home, "startup.log")),
		quote(executable), quote(filepath.Join(m.Home, "startup.log")), quote(m.Binary), quote(m.Socket),
		quote(m.Runtime), quote(filepath.Join(m.Home, "startup.log")))
	// Keep the same plist and bootstrap location as Electron installations.
	// Updating the App changes next login's bootstrap without restarting services.
	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>%s</string>
<key>ProgramArguments</key><array><string>/bin/sh</string><string>%s</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>/dev/null</string>
<key>StandardErrorPath</key><string>/dev/null</string>
</dict></plist>
`, escapeXML(label), escapeXML(bootstrap))
	if err := os.MkdirAll(filepath.Dir(agentPath), 0755); err != nil {
		return err
	}
	existing, err := os.ReadFile(agentPath)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.WriteFile(bootstrap, []byte(body), 0700); err != nil {
		return err
	}
	changed := string(existing) != plist
	if changed {
		if err := os.WriteFile(agentPath, []byte(plist), 0600); err != nil {
			return err
		}
	}
	domain := fmt.Sprintf("gui/%d", os.Getuid())
	loaded := exec.Command("/bin/launchctl", "print", domain+"/"+label).Run() == nil
	if loaded && changed {
		return fmt.Errorf("login background definition changed; log out and back in to load it; current services were not stopped")
	}
	if !loaded {
		out, err := exec.Command("/bin/launchctl", "bootstrap", domain, agentPath).CombinedOutput()
		if err != nil {
			return fmt.Errorf("launchctl bootstrap: %w: %s", err, out)
		}
	} else if !m.Connected() {
		out, err := exec.Command("/bin/launchctl", "kickstart", domain+"/"+label).CombinedOutput()
		if err != nil {
			return fmt.Errorf("launchctl kickstart: %w: %s", err, out)
		}
	}
	return nil
}

func InstallSkill(project string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	source := filepath.Join(project, "skills", "wick")
	target := filepath.Join(home, ".agents", "skills", "wick")
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return err
	}
	if _, err := os.Lstat(target); err == nil {
		existing, err := filepath.EvalSymlinks(target)
		actual, sourceErr := filepath.EvalSymlinks(source)
		if err == nil && sourceErr == nil && existing == actual {
			fmt.Println("Wick Skill is already installed:", target)
			return nil
		}
		return fmt.Errorf("existing Skill is preserved; choose how to handle %s before installing", target)
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.Symlink(source, target); err != nil {
		return err
	}
	fmt.Println("Installed Wick Skill:", target)
	return nil
}
