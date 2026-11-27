"""Random but realistic city generator (always strongly connected when open)."""

import math
import random

from .graph import Road

LANDMARKS = [
    "Central Station", "City Hospital", "Tech Park", "University", "Airport",
    "Old Market", "Stadium", "Museum", "Riverfront", "City Hall", "Bus Terminal",
    "Harbour", "Botanical Garden", "Mall Plaza", "Fire Station", "Police HQ",
    "Science Centre", "Lake View", "Industrial Area", "Central Library",
]
AREAS = ["Ashok", "Nehru", "Gandhi", "Lotus", "Maple", "Cedar", "Sunrise", "Hill",
         "Green", "Silver", "Royal", "Temple", "Garden", "Metro", "Park", "Canal"]
SUFFIXES = ["Chowk", "Nagar", "Square", "Junction", "Circle", "Colony", "Cross", "Gate"]


def generate_city(n=80, density=0.55, seed=7):
    """Return (nodes, roads).  Coordinates are in kilometres."""
    rng = random.Random(seed)
    cols = max(2, math.ceil(math.sqrt(n * 1.6)))
    rows = max(2, math.ceil(n / cols))
    cell = 1.0

    nodes, at = [], {}
    for i in range(n):
        r, c = divmod(i, cols)
        at[(r, c)] = i
        nodes.append({
            "id": i,
            "x": round(c * cell + rng.uniform(-0.28, 0.28), 3),
            "y": round(r * cell + rng.uniform(-0.28, 0.28), 3),
            "name": f"{rng.choice(AREAS)} {rng.choice(SUFFIXES)} {i}",
            "landmark": False,
        })

    chosen = rng.sample(range(n), min(len(LANDMARKS), max(2, n // 6), n))
    for name, i in zip(LANDMARKS, chosen):
        nodes[i].update(name=name, landmark=True)

    candidates = []
    for (r, c), u in at.items():
        for dr, dc, diagonal in ((0, 1, False), (1, 0, False), (1, 1, True), (1, -1, True)):
            v = at.get((r + dr, c + dc))
            if v is not None:
                candidates.append((u, v, r, c, dr, dc, diagonal))
    rng.shuffle(candidates)

    parent = list(range(n))             # union-find for the spanning tree

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    # Straight roads first so the spanning tree looks like a street grid.
    candidates.sort(key=lambda e: e[6])
    roads, crossed = [], set()
    for u, v, r, c, dr, dc, diagonal in candidates:
        a, b = find(u), find(v)
        in_tree = a != b
        chance = density * (0.18 if diagonal else 1.0)
        if not in_tree and rng.random() > chance:
            continue
        if diagonal:                     # never let two diagonals cross
            key = (r, c if dc == 1 else c - 1)
            if key in crossed:
                continue
            crossed.add(key)
        if in_tree:
            parent[a] = b

        if (dr == 0 and r % 4 == 1) or (dc == 0 and c % 5 == 2):
            kind = "highway"
        elif (dr == 0 and r % 2 == 0) or diagonal:
            kind = "arterial"
        else:
            kind = "street"
        km = math.dist((nodes[u]["x"], nodes[u]["y"]), (nodes[v]["x"], nodes[v]["y"]))
        km *= rng.uniform(1.0, 1.15)     # real roads are not perfectly straight
        oneway = not in_tree and kind == "street" and rng.random() < 0.18
        if oneway and rng.random() < 0.5:
            u, v = v, u
        roads.append(Road(u, v, round(km, 3), kind,
                          round(rng.betavariate(1.4, 2.6), 3), oneway))
    return nodes, roads
