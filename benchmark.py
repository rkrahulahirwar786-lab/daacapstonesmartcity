"""Timing helpers and the performance comparison experiment."""

import gc
import statistics
import time

from .algorithms import INF, bellman_ford, dijkstra
from .city import generate_city
from .graph import Graph

CLASSIC_LIMIT = 800   # classic Bellman-Ford is O(V*E); keep the web app responsive


def timed(fn, repeats=5):
    """Median wall-clock time of fn() in milliseconds."""
    samples = []
    enabled = gc.isenabled()
    gc.disable()
    try:
        for _ in range(repeats):
            start = time.perf_counter()
            fn()
            samples.append((time.perf_counter() - start) * 1000.0)
    finally:
        if enabled:
            gc.enable()
    return statistics.median(samples)


def benchmark_size(n, density=0.55, trials=3, classic=True, seed=100):
    """Run all algorithms on `trials` random cities with n locations."""
    runs = {"dijkstra": [], "bellman": []}
    if classic and n <= CLASSIC_LIMIT:
        runs["classic"] = []
    edges, agree = [], True

    for t in range(trials):
        _, roads = generate_city(n, density, seed + t)
        g = Graph.from_roads(n, roads, "time")
        edges.append(len(g.edges))
        source = (t * 7919) % n
        algos = {
            "dijkstra": lambda: dijkstra(g, source),
            "bellman": lambda: bellman_ford(g, source),
            "classic": lambda: bellman_ford(g, source, early_exit=False),
        }
        reference = None
        for key in runs:
            result = algos[key]()
            repeats = 1 if key == "classic" else 3
            runs[key].append((timed(algos[key], repeats), result.stats))
            if reference is None:
                reference = result.dist
            else:
                agree &= all(a == b == INF or abs(a - b) < 1e-6
                             for a, b in zip(reference, result.dist))

    out = {"n": n, "edges": round(statistics.mean(edges)), "agree": agree, "algorithms": {}}
    for key, data in runs.items():
        out["algorithms"][key] = {
            "ms": statistics.mean(ms for ms, _ in data),
            "edge_checks": round(statistics.mean(s["edge_checks"] for _, s in data)),
            "passes": round(statistics.mean(s.get("passes", 0) for _, s in data)),
        }
    return out
