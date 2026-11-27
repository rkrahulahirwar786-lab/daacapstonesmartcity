# Smart City Route Optimization System

Locations are vertices and roads are weighted directed edges. Shortest paths are
computed in Python with Dijkstra and Bellman-Ford, shown in a web interface.

## Run
Needs Python 3.8 or newer. No packages to install.

    python app.py

The browser opens http://127.0.0.1:8000 (use `--port 8080` if 8000 is busy).
Run tests with `python -m unittest`.

## Structure
| File | Purpose |
|---|---|
| core/graph.py | Road and Graph classes, edge weight formulas |
| core/algorithms.py | Dijkstra, Bellman-Ford, path reconstruction |
| core/city.py | Random city generator |
| core/benchmark.py | Performance measurement |
| app.py | Web server and JSON API |
| static/ | HTML, CSS and JavaScript interface |
| tests/ | Unit tests |

## Edge weights (t = traffic level, c = road congestion, both 0 to 1)
- Distance: km
- Time (min): km / speed x 60 x (1 + 2.5ct)
- Fuel (Rs): km x rate x (1 + 0.9ct)

Speed / rate: highway 60 km/h, 8.5; arterial 40 km/h, 7.0; street 25 km/h, 7.8.
These values and the city data are simulated, not real map data.

## Features
- Shortest, fastest and cheapest routes, with up to 6 ordered stops
- Animated view of how each algorithm explores the map
- Close roads, add locations and roads, export and import cities
- Benchmark across graph sizes with chart, table and CSV download
- Negative-weight and negative-cycle demonstration

## Notes on the comparison
- Planner: Dijkstra may stop at the destination; Bellman-Ford always solves all vertices.
- Lab: both solve the full single-source problem, so the comparison is like for like.
- Early exit makes Bellman-Ford far faster than its O(V*E) worst case; the
  "classic" series shows all V-1 passes.
- Stops are visited in the order given (the order is not optimised).
