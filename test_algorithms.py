import random
import unittest

from core.algorithms import INF, bellman_ford, build_path, dijkstra
from core.city import generate_city
from core.graph import Graph


class ShortestPathTests(unittest.TestCase):
    def test_algorithms_agree_on_random_cities(self):
        for seed in range(30):
            n = random.Random(seed).randint(6, 150)
            _, roads = generate_city(n, 0.5, seed)
            for metric in ("distance", "time", "fuel"):
                g = Graph.from_roads(n, roads, metric)
                a, b = dijkstra(g, 0), bellman_ford(g, 0)
                for x, y in zip(a.dist, b.dist):
                    self.assertAlmostEqual(x, y, places=7)

    def test_generated_city_is_strongly_connected(self):
        for seed in range(30):
            _, roads = generate_city(60, 0.2, seed)
            g = Graph.from_roads(60, roads)
            for source in (0, 31, 59):
                self.assertNotIn(INF, dijkstra(g, source).dist)

    def test_path_cost_matches_distance(self):
        _, roads = generate_city(50, 0.6, 3)
        g = Graph.from_roads(50, roads)
        res = dijkstra(g, 0, target=49)
        path = build_path(res.prev, 0, 49)
        total = sum(min(w for v, w in g.adj[a] if v == b) for a, b in zip(path, path[1:]))
        self.assertAlmostEqual(total, res.dist[49])

    def test_negative_edge(self):
        g = Graph(4)
        for e in [(0, 1, 2), (0, 2, 5), (2, 1, -4), (1, 3, 2)]:
            g.add_edge(*e)
        self.assertEqual(bellman_ford(g, 0).dist[3], 3)
        self.assertEqual(dijkstra(g, 0).dist[3], 4)    # documented limitation

    def test_negative_cycle_detected(self):
        g = Graph(3)
        for e in [(0, 1, 1), (1, 2, -2), (2, 1, 1)]:
            g.add_edge(*e)
        self.assertTrue(bellman_ford(g, 0).negative_cycle)

    def test_unreachable(self):
        g = Graph(2)
        res = dijkstra(g, 0)
        self.assertEqual(res.dist[1], INF)
        self.assertEqual(build_path(res.prev, 0, 1), [])


if __name__ == "__main__":
    unittest.main()
