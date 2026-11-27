"""Graph model: locations are vertices, roads are weighted directed edges."""

from dataclasses import dataclass

# road type -> (speed in km/h, fuel cost in rupees per km)
ROAD_TYPES = {
    "highway": (60.0, 8.5),
    "arterial": (40.0, 7.0),
    "street": (25.0, 7.8),
}
METRICS = ("distance", "time", "fuel")


@dataclass(frozen=True)
class Road:
    u: int
    v: int
    km: float
    kind: str = "street"
    congestion: float = 0.0   # 0 (free) .. 1 (jammed) at full traffic
    oneway: bool = False
    closed: bool = False

    def cost(self, metric: str, traffic: float = 0.5) -> float:
        """Weight of this road for the chosen optimisation metric."""
        speed, rupees_per_km = ROAD_TYPES[self.kind]
        jam = self.congestion * traffic
        if metric == "distance":
            return self.km
        if metric == "time":                      # minutes
            return self.km / speed * 60.0 * (1.0 + 2.5 * jam)
        if metric == "fuel":                      # rupees
            return self.km * rupees_per_km * (1.0 + 0.9 * jam)
        raise ValueError(f"unknown metric: {metric}")


class Graph:
    """Weighted directed graph stored as an adjacency list."""

    def __init__(self, n: int):
        self.n = n
        self.adj = [[] for _ in range(n)]      # adj[u] = [(v, weight), ...]
        self.edges = []                        # [(u, v, weight), ...]

    def add_edge(self, u: int, v: int, w: float) -> None:
        self.adj[u].append((v, w))
        self.edges.append((u, v, w))

    @classmethod
    def from_roads(cls, n: int, roads, metric: str = "distance", traffic: float = 0.5):
        g = cls(n)
        for r in roads:
            if r.closed:
                continue
            w = r.cost(metric, traffic)
            g.add_edge(r.u, r.v, w)
            if not r.oneway:
                g.add_edge(r.v, r.u, w)
        return g
