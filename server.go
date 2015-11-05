package webapp

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strconv"
	"time"

	"github.com/pipeviz/pipeviz/Godeps/_workspace/src/github.com/zenazn/goji/web"
	"github.com/pipeviz/pipeviz/broker"
	"github.com/pipeviz/pipeviz/log"
	"github.com/pipeviz/pipeviz/mlog"
	"github.com/pipeviz/pipeviz/represent"
	"github.com/pipeviz/pipeviz/represent/q"
	"github.com/pipeviz/pipeviz/types/system"
)

var (
	publicDir = filepath.Join(defaultBase("github.com/pipeviz/pipeviz/webapp/"), "public")
)

var (
	// Subscribe to the master broker and store latest locally as it comes
	brokerListen = broker.Get().Subscribe()
	// Initially set the latestGraph to a new, empty one to avoid nil pointer
	latestGraph = represent.NewGraph()
	// Count of active websocket clients (for expvars)
	clientCount int64
)

const (
	// Time allowed to write data to the client.
	writeWait = 10 * time.Second
	// Time allowed to read the next pong message from the client.
	pongWait = 60 * time.Second
	// Send pings to client with this period; less than pongWait.
	pingPeriod = (pongWait * 9) / 10
)

func init() {
	// Kick off goroutine to listen on the graph broker and keep our local pointer up to date
	go func() {
		for g := range brokerListen {
			latestGraph = g
		}
	}()
}

// Creates a Goji *web.Mux that can act as the http muxer for the frontend app.
func NewMux() *web.Mux {
	m := web.New()

	m.Use(log.NewHTTPLogger("webapp"))
	m.Get("/sock", openSocket)
	m.Get("/message/:mid", getMessage)
	m.Get("/*", http.StripPrefix("/", http.FileServer(http.Dir(publicDir))))

	return m
}

// RegisterToMux adds all necessary pieces to an injected mux.
func RegisterToMux(m *web.Mux) {
	m.Use(log.NewHTTPLogger("webapp"))
	m.Get("/sock", openSocket)
	m.Get("/message/:mid", getMessage)
	m.Get("/*", http.StripPrefix("/", http.FileServer(http.Dir(publicDir))))
}

func graphToJSON(g system.CoreGraph) ([]byte, error) {
	var vertices []interface{}
	for _, v := range g.VerticesWith(q.Qbv(system.VTypeNone)) {
		vertices = append(vertices, v.Flat())
	}

	// TODO use something that lets us write to a reusable byte buffer instead
	return json.Marshal(struct {
		Id       uint64        `json:"id"`
		Vertices []interface{} `json:"vertices"`
	}{
		Id:       g.MsgID(),
		Vertices: vertices,
	})
}

func getMessage(c web.C, w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseUint(c.URLParams["mid"], 10, 64)
	if err != nil {
		http.Error(w, http.StatusText(400), 400)
		return
	}

	var getter mlog.RecordGetter
	var ok bool
	if fun, exists := c.Env["mlogGet"]; !exists {
		http.Error(w, "Could not access mlog storage", 500)
		return
	} else if getter, ok = fun.(mlog.RecordGetter); !ok {
		http.Error(w, "Could not access mlog storage", 500)
		return
	}

	rec, err := getter(id)
	if err != nil {
		// TODO Might be something other than not found, but oh well for now
		http.Error(w, http.StatusText(404), 404)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(200)
	w.Write(rec.Message)
}
