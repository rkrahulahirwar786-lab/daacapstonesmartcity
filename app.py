"""Smart City Route Optimization System - web server (Python standard library only).

Run:  python app.py        then open  http://127.0.0.1:8000
"""

import argparse
import inspect
import json
import math
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from core.algorithms import INF, bellman_ford, build_path, dijkstra
from core.benchmark import benchmark_size, timed
from core.city import generate_city
from core.graph import METRICS, ROAD_TYPES, Graph, Road

STATIC = Path(__file__).parent / "static"
FILES = {
    "/": ("index.html", "text/html"),
    "/style.css": ("style.css", "text/css"),
    "/app.js": ("app.js", "text/javascript"),
}
MAX_NODES = 2000
BENCH_LOCK = threading.Lock()     # one benchmark at a time gives honest timings


def clamp(value, low, high):
    value = float(value)
    if not math.isfinite(value):
        raise ValueError("number must be finite")
    return max(low, min(high, value))


def parse_roads(raw, n):
    roads = []
    for r in raw:
        u, v = int(r["u"]), int(r["v"])
        if not (0 <= u < n and 0 <= v < n) or r["kind"] not in ROAD_TYPES:
            raise ValueError("invalid road")
        roads.append(Road(u, v, clamp(r["km"], 0.001, 1000), r["kind"],
                          clamp(r.get("congestion", 0), 0, 1),
                          bool(r.get("oneway")), bool(r.get("closed"))))
    return roads


# ---------------------------------------------------------------- API handlers
def api_city(body):
    n = int(clamp(body.get("n", 80), 6, 600))
    nodes, roads = generate_city(n, clamp(body.get("density", 0.55), 0, 1),
                                 int(body.get("seed", 7)))
    return {"nodes": nodes, "roads": [r.__dict__ for r in roads]}


def route_summary(path, roads, metric, traffic):
    """Distance, time and fuel totals for a path (cheapest road per hop)."""
    best = {}
    for r in roads:
        if r.closed:
            continue
        for key in [(r.u, r.v)] + ([] if r.oneway else [(r.v, r.u)]):
            if key not in best or r.cost(metric, traffic) < best[key].cost(metric, traffic):
                best[key] = r
    legs = [best[(a, b)] for a, b in zip(path, path[1:])]
    totals = {m: sum(r.cost(m, traffic) for r in legs) for m in METRICS}
    totals["steps"] = [{"from": a, "to": b, "kind": r.kind, "km": r.km,
                        "time": r.cost("time", traffic),
                        "jam": r.congestion * traffic}
                       for (a, b), r in zip(zip(path, path[1:]), legs)]
    return totals


def solve(graph, stops, algorithm, early_stop, trace=False):
    """Visit the stops in order; returns (path, cost, summed stats, traces)."""
    path, cost, stats, traces = [stops[0]], 0.0, {}, []
    for s, t in zip(stops, stops[1:]):
        if algorithm == "dijkstra":
            res = dijkstra(graph, s, t if early_stop else None, trace)
        else:
            res = bellman_ford(graph, s, trace=trace)
        for key, value in res.stats.items():
            stats[key] = stats.get(key, 0) + value
        traces.append(res.trace)
        leg = build_path(res.prev, s, t)
        if not leg or res.dist[t] == INF:
            return [], None, stats, traces
        path += leg[1:]
        cost += res.dist[t]
    return path, cost, stats, traces


def api_route(body):
    n = int(body["n"])
    if not 2 <= n <= MAX_NODES:
        raise ValueError("unsupported graph size")
    roads = parse_roads(body["roads"], n)
    stops = [int(s) for s in body["stops"]]
    if not 2 <= len(stops) <= 8 or not all(0 <= s < n for s in stops):
        raise ValueError("choose between 2 and 8 valid locations")
    metric = body.get("metric", "time")
    if metric not in METRICS:
        raise ValueError("unknown metric")
    traffic = clamp(body.get("traffic", 0.5), 0, 1)
    early = bool(body.get("early_stop", True))
    graph = Graph.from_roads(n, roads, metric, traffic)

    results = {}
    for name in ("dijkstra", "bellman"):
        path, cost, stats, _ = solve(graph, stops, name, early)
        ms = timed(lambda: solve(graph, stops, name, early), 5)
        traces = solve(graph, stops, name, early, trace=True)[3]
        results[name] = {"path": path, "cost": cost, "stats": stats,
                         "ms": ms, "trace": traces}

    # Trade-off table: best route for every metric.
    options = {}
    for m in METRICS:
        path = solve(Graph.from_roads(n, roads, m, traffic), stops, "dijkstra", True)[0]
        if path:
            options[m] = {"path": path, **route_summary(path, roads, m, traffic)}

    d, b = results["dijkstra"]["cost"], results["bellman"]["cost"]
    return {"results": results, "options": options, "metric": metric,
            "vertices": n, "edges": len(graph.edges),
            "match": d == b or (d is not None and b is not None and abs(d - b) < 1e-6)}


def api_benchmark(body):
    n = int(clamp(body["n"], 10, MAX_NODES))
    with BENCH_LOCK:
        return benchmark_size(n, clamp(body.get("density", 0.55), 0, 1),
                              int(clamp(body.get("trials", 3), 1, 5)),
                              bool(body.get("classic", True)))


DEMOS = {
    "positive": [(0, 1, 2), (0, 2, 5), (2, 1, 1), (1, 3, 2), (3, 4, 3), (2, 4, 9)],
    "negative": [(0, 1, 2), (0, 2, 5), (2, 1, -4), (1, 3, 2), (3, 4, 3), (2, 4, 9)],
    "cycle": [(0, 1, 2), (0, 2, 5), (2, 1, -4), (1, 3, 2), (3, 2, -1), (3, 4, 3)],
}


def api_demo(body):
    kind = body.get("kind", "negative")
    g = Graph(5)
    for edge in DEMOS[kind]:
        g.add_edge(*edge)
    d, b = dijkstra(g, 0), bellman_ford(g, 0)
    clean = lambda r: [None if x == INF else x for x in r.dist]
    return {"edges": DEMOS[kind], "dijkstra": clean(d), "bellman": clean(b),
            "negative_cycle": b.negative_cycle}


def api_source(_body):
    return {"dijkstra": inspect.getsource(dijkstra),
            "bellman": inspect.getsource(bellman_ford)}


ROUTES = {"/api/city": api_city, "/api/route": api_route, "/api/benchmark": api_benchmark,
          "/api/demo": api_demo, "/api/source": api_source}


class Handler(BaseHTTPRequestHandler):
    def send(self, status, content, mime):
        self.send_response(status)
        self.send_header("Content-Type", f"{mime}; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    def send_json(self, status, data):
        self.send(status, json.dumps(data).encode(), "application/json")

    def do_GET(self):
        entry = FILES.get(self.path.split("?")[0])
        if not entry:
            return self.send(404, b"Not found", "text/plain")
        self.send(200, (STATIC / entry[0]).read_bytes(), entry[1])

    def do_POST(self):
        handler = ROUTES.get(self.path)
        if not handler:
            return self.send_json(404, {"error": "unknown endpoint"})
        # Requiring JSON blocks simple cross-site form posts.
        if not self.headers.get("Content-Type", "").startswith("application/json"):
            return self.send_json(415, {"error": "send application/json"})
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not 0 <= length <= 3_000_000:
                raise ValueError("request too large")
            body = json.loads(self.rfile.read(length) or b"{}")
            self.send_json(200, handler(body))
        except (ValueError, KeyError, TypeError, AttributeError, OverflowError) as exc:
            self.send_json(400, {"error": f"bad request: {exc}"})

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description="Smart City Route Optimization System")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}"
    print(f"Smart City Router running at {url}  (Ctrl+C to stop)")
    if not args.no_browser:
        threading.Timer(0.6, webbrowser.open, [url]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
