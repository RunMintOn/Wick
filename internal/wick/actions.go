package wick

import (
	"bytes"
	"crypto/rand"
	"fmt"
	"net/url"
	"os"
	"slices"
	"strings"
	"time"

	"go.yaml.in/yaml/v3"
)

type ActionOptions struct {
	Component     string `json:"component,omitempty"`
	ConfirmImpact bool   `json:"confirmImpact,omitempty"`
}

type ImpactError struct {
	Message  string
	Affected []string
}

func (e *ImpactError) Error() string { return e.Message }

func (m *Manager) Action(action, name string, options ActionOptions) error {
	return m.withLock(func() error {
		if !slices.Contains([]string{"start", "stop", "restart"}, action) {
			return fmt.Errorf("unsupported action: %s", action)
		}
		c, err := m.readConfig()
		if err != nil {
			return err
		}
		s, err := c.find(name)
		if err != nil {
			return err
		}
		if options.Component != "" {
			if !s.grouped || !slices.Contains(s.members, options.Component) {
				return fmt.Errorf("process does not belong to this service")
			}
			return m.componentAction(action, s, options, c)
		}
		if s.grouped {
			return m.groupAction(action, s.order, c)
		}
		return m.processAction(action, name, c)
	})
}

func dependencyClosure(name string, c *config, closure map[string]bool) {
	if closure[name] {
		return
	}
	closure[name] = true
	for dep := range mapping(mapping(c.processes[name])["depends_on"]) {
		dependencyClosure(dep, c, closure)
	}
}

func (m *Manager) componentAction(action string, s *service, options ActionOptions, c *config) error {
	name := options.Component
	if action == "start" {
		closure := map[string]bool{}
		dependencyClosure(name, c, closure)
		order := []string{}
		for _, member := range s.order {
			if closure[member] {
				order = append(order, member)
			}
		}
		return m.groupAction("start", order, c)
	}
	states, err := m.states()
	if err != nil {
		return err
	}
	affected := []string{}
	for _, member := range s.members {
		if member == name {
			continue
		}
		closure := map[string]bool{}
		dependencyClosure(member, c, closure)
		for _, state := range states {
			if state["name"] == member && closure[name] &&
				(flag(state["is_running"]) || slices.Contains([]string{"Restarting", "Launching", "Pending"}, text(state["status"]))) {
				affected = append(affected, member)
			}
		}
	}
	if len(affected) > 0 && !options.ConfirmImpact {
		return &ImpactError{Message: fmt.Sprintf("%s %s: running dependents (%s) may be interrupted. They will not be stopped or restarted. Confirm the impact before proceeding.", action, name, strings.Join(affected, ", ")), Affected: affected}
	}
	if action == "restart" {
		for dep := range mapping(mapping(c.processes[name])["depends_on"]) {
			ready := false
			for _, state := range states {
				if state["name"] == dep {
					ready = flag(state["is_running"]) && state["is_ready"] == "Ready"
				}
			}
			if !ready {
				return fmt.Errorf("%s: dependency %s is not ready; use Start to satisfy dependencies; Restart changes only its target", name, dep)
			}
		}
		if err := m.processAction("stop", name, c); err != nil {
			return err
		}
		if err := m.processAction("start", name, c); err != nil {
			return err
		}
		return m.ready(name, mapping(c.processes[name]))
	}
	return m.processAction("stop", name, c)
}

func (m *Manager) state(name string) (object, error) {
	var state object
	err := m.request("/process/"+url.PathEscape(name), "GET", &state)
	return state, err
}

func (m *Manager) waitProcess(name string, timeout time.Duration, predicate func(object) (bool, error)) error {
	until := time.Now().Add(timeout)
	for {
		state, err := m.state(name)
		if err != nil {
			return err
		}
		done, err := predicate(state)
		if err != nil || done {
			return err
		}
		if time.Now().After(until) {
			return fmt.Errorf("%s: timed out waiting for the process; check its status and logs", name)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func (m *Manager) ready(name string, p object) error {
	timeout := time.Duration(integer(mapping(p["x-wick"])["ready_timeout_seconds"], 30)) * time.Second
	return m.waitProcess(name, timeout, func(state object) (bool, error) {
		if state["status"] == "Error" || state["status"] == "Completed" {
			return false, fmt.Errorf("%s: exited before becoming ready; check logs", name)
		}
		return flag(state["is_running"]) && state["status"] != "Restarting" && (p["readiness_probe"] == nil || state["is_ready"] == "Ready"), nil
	})
}

func (m *Manager) groupAction(action string, order []string, c *config) error {
	errors := []string{}
	if action == "stop" || action == "restart" {
		for i := len(order) - 1; i >= 0; i-- {
			if err := m.processAction("stop", order[i], c); err != nil {
				errors = append(errors, fmt.Sprintf("%s: %v", order[i], err))
			}
		}
		// Do not launch a replacement after a stop failed.
		if action == "stop" || len(errors) > 0 {
			return joined(errors)
		}
	}
	failed := map[string]bool{}
	for _, name := range order {
		blocked := false
		for dep := range mapping(mapping(c.processes[name])["depends_on"]) {
			blocked = blocked || failed[dep]
		}
		if blocked {
			failed[name] = true
			errors = append(errors, name+": not started because a dependency failed")
			continue
		}
		err := m.processAction("start", name, c)
		if err == nil {
			err = m.ready(name, mapping(c.processes[name]))
		}
		if err != nil {
			failed[name] = true
			errors = append(errors, fmt.Sprintf("%s: %v", name, err))
		}
	}
	return joined(errors)
}

func joined(errors []string) error {
	if len(errors) == 0 {
		return nil
	}
	return fmt.Errorf("%s", strings.Join(errors, "\n"))
}

func active(state object) bool {
	return flag(state["is_running"]) || slices.Contains([]string{"Restarting", "Launching", "Pending", "Terminating"}, text(state["status"]))
}

func (m *Manager) processAction(action, name string, c *config) error {
	before, err := m.state(name)
	if err != nil {
		return err
	}
	if action == "start" && active(before) || action == "stop" && !active(before) {
		return nil
	}
	if action == "start" || action == "restart" {
		limit := integer(mapping(mapping(c.processes[name])["availability"])["max_restarts"], 3)
		if number(before["restarts"]) >= float64(limit) {
			// PC 1.122 retains exhausted retry counts on ordinary start/restart.
			// Change only this process's runtime revision before server-side reload.
			data, err := os.ReadFile(m.Runtime)
			if err != nil {
				return err
			}
			var doc yaml.Node
			if err := yaml.Unmarshal(data, &doc); err != nil {
				return err
			}
			if err := setField(field(field(&doc, "processes"), name), "x-wick-recovery", rand.Text()); err != nil {
				return err
			}
			pending := m.Runtime + ".recovery"
			if err := writeYAML(pending, &doc); err != nil {
				return err
			}
			if err := os.Rename(pending, m.Runtime); err != nil {
				return err
			}
			if err := m.reload(); err != nil {
				return err
			}
			state, err := m.state(name)
			if err != nil {
				return err
			}
			if !flag(state["is_running"]) {
				if _, err := m.cli("process", "start", name); err != nil {
					return err
				}
			}
			return m.waitProcess(name, 15*time.Second, func(s object) (bool, error) { return flag(s["is_running"]), nil })
		}
	}
	if _, err := m.cli("process", action, name); err != nil {
		return err
	}
	return m.waitProcess(name, 15*time.Second, func(s object) (bool, error) {
		if action == "stop" {
			return !active(s), nil
		}
		return flag(s["is_running"]) || slices.Contains([]string{"Restarting", "Error", "Completed"}, text(s["status"])), nil
	})
}

func (m *Manager) SetAutostart(name string, value bool, expectedToken string) error {
	return m.withLock(func() error {
		c, err := m.readConfig()
		if err != nil {
			return err
		}
		if token(c.text) != expectedToken {
			return fmt.Errorf("configuration changed; refresh and try again")
		}
		s, err := c.find(name)
		if err != nil {
			return err
		}
		var node *yaml.Node
		if s.grouped {
			node = field(field(field(&c.doc, "x-wick"), "services"), name)
		} else {
			node = field(field(&c.doc, "processes"), name)
		}
		if err := setField(node, "disabled", !value); err != nil {
			return err
		}
		pending := m.Config + ".pending"
		if err := writeYAML(pending, &c.doc); err != nil {
			return err
		}
		current, err := os.ReadFile(m.Config)
		if err != nil {
			return err
		}
		if !bytes.Equal(current, c.text) {
			return fmt.Errorf("configuration changed; refresh and try again")
		}
		return os.Rename(pending, m.Config)
	})
}
