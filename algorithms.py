"""Dijkstra and Bellman-Ford shortest path algorithms (written from scratch)."""

import heapq
from dataclasses import dataclass, field

INF = float("inf")


@dataclass
class Result:
    dist: list                      # dist[v] = best known cost from the source
    prev: list                      # prev[v] = previous vertex on that path
    stats: dict = field(default_factory=dict)
    trace: list = field(default_factory=list)   # used only for map animation
    negative_cycle: bool = False


def dijkstra(graph, source, target=None, trace=False):
    """Greedy search with a binary heap.  O((V + E) log V).

    Needs non-negative weights.  If `target` is given, stop as soon as it is settled.
    """
    dist = [INF] * graph.n
    prev = [-1] * graph.n
    done = [False] * graph.n
    dist[source] = 0.0
    heap = [(0.0, source)]
    order = []
    settled = checks = updates = 0
    pushes = 1

    while heap:
        d, u = heapq.heappop(heap)
        if done[u]:                 # stale heap entry
            continue
        done[u] = True
        settled += 1
        if trace:
            order.append(u)
        if u == target:
            break
        for v, w in graph.adj[u]:
            checks += 1
            if not done[v] and d + w < dist[v]:
                dist[v] = d + w
                prev[v] = u
                updates += 1
                pushes += 1
                heapq.heappush(heap, (dist[v], v))

    stats = {"settled": settled, "edge_checks": checks,
             "updates": updates, "heap_pushes": pushes}
    return Result(dist, prev, stats, order)


def bellman_ford(graph, source, early_exit=True, trace=False):
    """Relax every edge up to V-1 times.  O(V * E).

    Works with negative weights and detects reachable negative cycles.
    `early_exit` stops as soon as a full pass changes nothing.
    """
    dist = [INF] * graph.n
    prev = [-1] * graph.n
    dist[source] = 0.0
    waves = []
    passes = checks = updates = 0
    changed = False

    for _ in range(graph.n - 1):
        changed = False
        passes += 1
        wave = set()
        for u, v, w in graph.edges:
            checks += 1
            if dist[u] + w < dist[v] - 1e-12:
                dist[v] = dist[u] + w
                prev[v] = u
                changed = True
                updates += 1
                if trace:
                    wave.add(v)
        if trace and wave:
            waves.append(sorted(wave))
        if early_exit and not changed:
            break

    # One extra pass: any further improvement proves a negative cycle.
    negative = False
    for u, v, w in graph.edges:
        checks += 1
        if dist[u] + w < dist[v] - 1e-9:
            negative = True
            break

    stats = {"passes": passes, "edge_checks": checks, "updates": updates,
             "settled": sum(1 for d in dist if d < INF)}
    return Result(dist, prev, stats, waves, negative)


def build_path(prev, source, target):
    """Follow predecessor links back from target.  Returns [] if unreachable."""
    path, seen = [target], {target}
    while path[-1] != source:
        p = prev[path[-1]]
        if p == -1 or p in seen:
            return []
        path.append(p)
        seen.add(p)
    return path[::-1]
