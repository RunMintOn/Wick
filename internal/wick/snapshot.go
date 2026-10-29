package wick

import (
	"fmt"
	"net/url"
	"strings"
)

type Snapshot struct {
	Home       string   `json:"home"`
	Background string   `json:"background"`
	Token      string   `json:"token,omitempty"`
	Services   []object `json:"services"`
	Error      string   `json:"error,omitempty"`
}

func processStatus(p object) string {
	status := text(p["status"])
	switch status {
	case "Not applied", "Restarting":
		return status
	}
	if flag(p["is_running"]) {
		if flag(p["hasProbe"]) && p["is_ready"] == "Not Ready" {
			return "Unhealthy"
		}
		if flag(p["hasProbe"]) && p["is_ready"] != "Ready" {
			return "Starting"
		}
		return "Running"
	}
	switch status {
	case "Launching", "Pending", "Terminating":
		return status
	case "Error":
		return "Failed"
	case "Completed":
		code := number(p["exit_code"])
		if code != 0 && code != -1 && code != 143 {
			return "Failed"
		}
	}
	return "Stopped"
}

func aggregate(components []object) string {
	allRunning, allStopped, anyRunning, notApplied, failed := true, true, false, false, false
	for _, p := range components {
		s := processStatus(p)
		allRunning = allRunning && s == "Running"
		allStopped = allStopped && s == "Stopped"
		anyRunning = anyRunning || flag(p["is_running"])
		notApplied = notApplied || s == "Not applied"
		failed = failed || s == "Failed" || s == "Unhealthy"
	}
	switch {
	case allRunning:
		return "Running"
	case allStopped:
		return "Stopped"
	case notApplied:
		return "Not applied"
	case anyRunning:
		return "Partially running"
	case failed:
		return "Failed"
	default:
		return "Starting"
	}
}

func (m *Manager) Snapshot() Snapshot {
	snapshot := Snapshot{Home: m.Home, Background: "unavailable", Services: []object{}}
	states, err := m.states()
	if err != nil {
		snapshot.Error = "Background unavailable.\n" + err.Error()
		return snapshot
	}
	snapshot.Background = "connected"
	c, err := m.readConfig()
	if err != nil {
		snapshot.Error = "Configuration unavailable.\n" + err.Error()
		return snapshot
	}
	processes := map[string]object{}
	for _, name := range c.names {
		p := mapping(c.processes[name])
		meta := mapping(p["x-wick"])
		title := text(meta["title"])
		if title == "" {
			title = name
		}
		deps := []string{}
		for _, dep := range c.names {
			if mapping(p["depends_on"])[dep] != nil {
				deps = append(deps, dep)
			}
		}
		state := object{"name": name, "title": title, "url": text(meta["url"]), "autostart": p["disabled"] != true,
			"retryLimit": integer(mapping(p["availability"])["max_restarts"], 3), "dependencies": deps,
			"hasProbe": p["readiness_probe"] != nil, "status": "Not applied"}
		for _, s := range states {
			if s["name"] == name {
				for k, v := range s {
					state[k] = v
				}
				break
			}
		}
		state["displayStatus"] = processStatus(state)
		processes[name] = state
	}
	for _, s := range c.services {
		if !s.grouped {
			snapshot.Services = append(snapshot.Services, processes[s.name])
			continue
		}
		components := []object{}
		running := false
		for _, name := range s.members {
			p := processes[name]
			blocked := []string{}
			if !flag(p["is_running"]) {
				for _, dep := range p["dependencies"].([]string) {
					if processStatus(processes[dep]) != "Running" {
						blocked = append(blocked, dep)
					}
				}
			}
			p["blockedBy"] = blocked
			running = running || flag(p["is_running"])
			components = append(components, p)
		}
		title := s.title
		if title == "" {
			title = s.name
		}
		snapshot.Services = append(snapshot.Services, object{"name": s.name, "title": title, "url": s.url,
			"autostart": !s.disabled, "components": components, "status": aggregate(components), "is_running": running})
	}
	snapshot.Token = token(c.text)
	return snapshot
}

func (m *Manager) Logs(name string) (string, error) {
	c, err := m.readConfig()
	if err != nil {
		return "", err
	}
	if c.processes[name] == nil {
		return "", fmt.Errorf("service is not registered")
	}
	var result struct {
		Logs []string `json:"logs"`
	}
	if err := m.request("/process/logs/"+url.PathEscape(name)+"/0/200", "GET", &result); err != nil {
		return "", err
	}
	logs := strings.Join(result.Logs, "\n")
	if len(logs) > 128*1024 {
		logs = logs[len(logs)-128*1024:]
	}
	return logs, nil
}

func (m *Manager) ServiceURL(name string) (string, error) {
	c, err := m.readConfig()
	if err != nil {
		return "", err
	}
	s, err := c.find(name)
	if err != nil {
		return "", err
	}
	return webURL(s.url)
}
