// A real HTTP service used by the installed-App tests; no system runtime needed.
package main

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
)

func main() {
	home, name := os.Args[1], os.Args[2]
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic(err)
	}
	if err := os.WriteFile(filepath.Join(home, name+".address"), []byte("http://"+listener.Addr().String()), 0600); err != nil {
		panic(err)
	}
	fmt.Println("ready", name)
	http.Serve(listener, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, "wick-installed-"+name)
	}))
}
