package wick

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"

	"go.yaml.in/yaml/v3"
)

type object = map[string]any

func mapping(v any) object { m, _ := v.(map[string]any); return m }
func text(v any) string    { s, _ := v.(string); return s }
func flag(v any) bool      { b, _ := v.(bool); return b }
func number(v any) float64 {
	switch n := v.(type) {
	case int:
		return float64(n)
	case float64:
		return n
	}
	return 0
}
func integer(v any, fallback int) int {
	if v == nil {
		return fallback
	}
	return int(number(v))
}

type config struct {
	text      []byte
	doc       yaml.Node
	data      object
	processes object
	services  []*service
	names     []string
}

type service struct {
	name, title, url  string
	disabled, grouped bool
	members, order    []string
}

var identifier = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`)

func token(data []byte) string { return fmt.Sprintf("%x", sha256.Sum256(data)) }

func field(node *yaml.Node, key string) *yaml.Node {
	if node.Kind == yaml.DocumentNode {
		node = node.Content[0]
	}
	for i := 0; i < len(node.Content); i += 2 {
		if node.Content[i].Value == key {
			return node.Content[i+1]
		}
	}
	return nil
}

func names(node *yaml.Node) []string {
	result := []string{}
	if node != nil {
		for i := 0; i < len(node.Content); i += 2 {
			result = append(result, node.Content[i].Value)
		}
	}
	return result
}

func setField(node *yaml.Node, key string, value any) error {
	encoded := &yaml.Node{}
	if err := encoded.Encode(value); err != nil {
		return err
	}
	if old := field(node, key); old != nil {
		encoded.HeadComment, encoded.LineComment, encoded.FootComment = old.HeadComment, old.LineComment, old.FootComment
		*old = *encoded
	} else {
		node.Content = append(node.Content, &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: key}, encoded)
	}
	return nil
}

func encode(v any) ([]byte, error) {
	var buf bytes.Buffer
	encoder := yaml.NewEncoder(&buf)
	encoder.SetIndent(2)
	err := encoder.Encode(v)
	return buf.Bytes(), err
}

func writeYAML(path string, value any) error {
	data, err := encode(value)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

func (m *Manager) readConfig() (*config, error) {
	data, err := os.ReadFile(m.Config)
	if err != nil {
		return nil, err
	}
	c := &config{text: data}
	if err := yaml.Unmarshal(data, &c.doc); err != nil {
		return nil, err
	}
	if err := c.doc.Decode(&c.data); err != nil {
		return nil, err
	}
	c.processes = mapping(c.data["processes"])
	if c.processes == nil {
		return nil, fmt.Errorf("configuration must contain a processes mapping")
	}
	c.names = names(field(&c.doc, "processes"))
	if err := c.model(); err != nil {
		return nil, err
	}
	return c, nil
}

func display(meta any, name string) (object, error) {
	if meta == nil {
		return object{}, nil
	}
	m := mapping(meta)
	if m == nil {
		return nil, fmt.Errorf("%s: invalid display metadata", name)
	}
	if title, ok := m["title"]; ok {
		if _, ok := title.(string); !ok {
			return nil, fmt.Errorf("%s: title must be a string", name)
		}
	}
	if m["url"] != nil && m["url"] != "" {
		if _, err := webURL(text(m["url"])); err != nil {
			return nil, fmt.Errorf("%s: %w", name, err)
		}
	}
	return m, nil
}

func webURL(value string) (string, error) {
	u, err := url.Parse(value)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", fmt.Errorf("service address must use HTTP or HTTPS")
	}
	return u.String(), nil
}

func (c *config) model() error {
	for _, name := range c.names {
		if !identifier.MatchString(name) || mapping(c.processes[name]) == nil {
			return fmt.Errorf("invalid process definition: %s", name)
		}
	}
	definitions := mapping(c.data["x-wick"])["services"]
	if definitions != nil && mapping(definitions) == nil {
		return fmt.Errorf("x-wick.services must be a mapping")
	}
	owners := map[string]string{}
	var serviceNames []string
	if node := field(&c.doc, "x-wick"); node != nil {
		serviceNames = names(field(node, "services"))
	}
	for _, name := range serviceNames {
		if !identifier.MatchString(name) || c.processes[name] != nil {
			return fmt.Errorf("invalid or conflicting service identifier: %s", name)
		}
		d, err := display(mapping(definitions)[name], name)
		if err != nil {
			return err
		}
		disabled, ok := d["disabled"].(bool)
		if !ok {
			return fmt.Errorf("%s: disabled must be explicit", name)
		}
		members, ok := d["processes"].([]any)
		if !ok || len(members) == 0 {
			return fmt.Errorf("%s: processes must be a nonempty list", name)
		}
		s := &service{name: name, title: text(d["title"]), url: text(d["url"]), disabled: disabled, grouped: true}
		for _, member := range members {
			n, ok := member.(string)
			if !ok || c.processes[n] == nil {
				return fmt.Errorf("%s: unknown process %v", name, member)
			}
			if owners[n] != "" {
				return fmt.Errorf("%s: process belongs to more than one service", n)
			}
			if _, ok := mapping(c.processes[n])["disabled"]; ok {
				return fmt.Errorf("%s: set disabled on its service, not on a component", n)
			}
			owners[n] = name
			s.members = append(s.members, n)
		}
		c.services = append(c.services, s)
	}
	for _, name := range c.names {
		if owners[name] != "" {
			continue
		}
		p := mapping(c.processes[name])
		d, err := display(p["x-wick"], name)
		if err != nil {
			return err
		}
		c.services = append(c.services, &service{name: name, title: text(d["title"]), url: text(d["url"]),
			disabled: p["disabled"] != false, members: []string{name}})
		owners[name] = name
	}
	for _, s := range c.services {
		visiting, done := map[string]bool{}, map[string]bool{}
		var visit func(string) error
		visit = func(name string) error {
			if visiting[name] {
				return fmt.Errorf("%s: dependency cycle", name)
			}
			if done[name] {
				return nil
			}
			visiting[name] = true
			p := mapping(c.processes[name])
			if d := p["depends_on"]; d != nil && mapping(d) == nil {
				return fmt.Errorf("%s: depends_on must be a mapping", name)
			}
			// Source order makes independent branches and their errors deterministic.
			for _, dep := range c.names {
				rule, exists := mapping(p["depends_on"])[dep]
				if !exists {
					continue
				}
				if s.grouped {
					if owners[dep] != s.name {
						return fmt.Errorf("%s: dependencies must belong to the same service", name)
					}
					if text(mapping(rule)["condition"]) != "process_healthy" || mapping(c.processes[dep])["readiness_probe"] == nil {
						return fmt.Errorf("%s: dependencies require process_healthy and a readiness_probe on %s", name, dep)
					}
					if err := visit(dep); err != nil {
						return err
					}
				}
			}
			for dep := range mapping(p["depends_on"]) {
				if c.processes[dep] == nil {
					return fmt.Errorf("%s: unknown dependency %s", name, dep)
				}
			}
			visiting[name], done[name] = false, true
			s.order = append(s.order, name)
			return nil
		}
		for _, name := range s.members {
			if err := visit(name); err != nil {
				return err
			}
		}
	}
	return nil
}

func (c *config) find(name string) (*service, error) {
	for _, s := range c.services {
		if s.name == name {
			return s, nil
		}
	}
	return nil, fmt.Errorf("service is not registered: %s", name)
}

func positiveInt(v any) bool { n, ok := v.(int); return ok && n > 0 }

func (m *Manager) prepare(preserve bool) (string, error) {
	c, err := m.readConfig()
	if err != nil {
		return "", err
	}
	previous := object{}
	if preserve {
		data, err := os.ReadFile(m.Runtime)
		if err != nil && !os.IsNotExist(err) {
			return "", err
		}
		if err := yaml.Unmarshal(data, &previous); err != nil {
			return "", err
		}
	}
	processes := object{}
	for _, name := range c.names {
		source := mapping(c.processes[name])
		if disabled, ok := source["disabled"]; ok {
			if _, ok := disabled.(bool); !ok {
				return "", fmt.Errorf("%s: disabled must be true or false", name)
			}
		}
		if source["is_disabled"] != nil {
			return "", fmt.Errorf("%s: use disabled, not is_disabled, for login autostart", name)
		}
		for _, key := range []string{"working_dir", "log_location", "env_file"} {
			if value := source[key]; value != nil && !filepath.IsAbs(text(value)) {
				return "", fmt.Errorf("%s: %s must be an absolute path", name, key)
			}
		}
		for _, key := range []string{"is_foreground", "is_daemon", "is_interactive", "is_tty", "is_elevated", "schedule"} {
			if v := source[key]; v != nil && v != false && v != "" {
				return "", fmt.Errorf("%s: Wick supports one non-interactive foreground process per registration", name)
			}
		}
		if n := source["replicas"]; n != nil && number(n) != 1 {
			return "", fmt.Errorf("%s: replicas must be 1", name)
		}
		meta, err := display(source["x-wick"], name)
		if err != nil {
			return "", err
		}
		if n := meta["ready_timeout_seconds"]; n != nil && (!positiveInt(n) || number(n) > 300) {
			return "", fmt.Errorf("%s: ready_timeout_seconds must be an integer from 1 to 300", name)
		}
		p := object{}
		for k, v := range source {
			if k != "x-wick" {
				p[k] = v
			}
		}
		old := mapping(mapping(previous["processes"])[name])
		if disabled, ok := old["disabled"]; ok {
			p["disabled"] = disabled
		} else {
			p["disabled"] = false
			for _, s := range c.services {
				if slices.Contains(s.members, name) {
					if s.grouped {
						p["disabled"] = s.disabled
					} else if source["disabled"] != nil {
						p["disabled"] = source["disabled"]
					}
					break
				}
			}
		}
		if old["x-wick-recovery"] != nil {
			p["x-wick-recovery"] = old["x-wick-recovery"]
		}
		availability := object{"restart": "on_failure", "backoff_seconds": 2, "max_restarts": 3}
		for k, v := range mapping(p["availability"]) {
			availability[k] = v
		}
		if !positiveInt(availability["max_restarts"]) || !positiveInt(availability["backoff_seconds"]) ||
			!slices.Contains([]string{"on_failure", "no"}, text(availability["restart"])) ||
			flag(availability["exit_on_end"]) || flag(availability["exit_on_skipped"]) {
			return "", fmt.Errorf("%s: use a finite on_failure policy (or no), without project shutdown", name)
		}
		p["availability"] = availability
		if p["log_location"] == nil {
			p["log_location"] = filepath.Join(m.Home, "logs", name+".log")
		}
		if p["log_configuration"] == nil {
			p["log_configuration"] = object{"flush_each_line": true, "rotation": object{"max_size_mb": 1, "max_backups": 2, "max_age_days": 7}}
		}
		if err := logRotation(name, p); err != nil {
			return "", err
		}
		processes[name] = p
	}
	// PC's file logger shares this level; warn suppresses service stdout.
	c.data["processes"], c.data["log_level"], c.data["log_length"] = processes, "info", 500
	if c.data["log_location"] != nil {
		if !filepath.IsAbs(text(c.data["log_location"])) {
			return "", fmt.Errorf("global log_location must be an absolute path")
		}
		if c.data["log_configuration"] == nil {
			c.data["log_configuration"] = object{"rotation": object{"max_size_mb": 1, "max_backups": 2, "max_age_days": 7}}
		}
		if err := logRotation("global", c.data); err != nil {
			return "", err
		}
	}
	if err := os.MkdirAll(filepath.Join(m.Home, "logs"), 0700); err != nil {
		return "", err
	}
	staged := filepath.Join(m.Home, "runtime.pending.yaml")
	if err := writeYAML(staged, c.data); err != nil {
		return "", err
	}
	_, err = m.cli("up", "-f", staged, "--dry-run", "--disable-dotenv")
	return staged, err
}

func logRotation(name string, p object) error {
	rotation := mapping(mapping(p["log_configuration"])["rotation"])
	if !positiveInt(rotation["max_size_mb"]) || !positiveInt(rotation["max_backups"]) {
		return fmt.Errorf("%s: log rotation requires finite positive max_size_mb and max_backups", name)
	}
	return nil
}
