"use strict";
// Interface only: every route and benchmark is computed by the Python server.
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const S = {nodes: [], roads: [], from: 0, to: 1, vias: [], metric: "time", mode: "pick",
  result: null, shown: null, anim: null, roadStart: null, pickStart: true,
  view: {s: 60, x: 40, y: 40}, hover: null, bench: [], chartMetric: "ms", routeReq: 0};
const UNITS = {distance: v => `${v.toFixed(2)} km`, time: v => `${v.toFixed(1)} min`, fuel: v => `₹${v.toFixed(0)}`};

async function api(path, body = {}) {
  let res;
  try {
    res = await fetch(`/api/${path}`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
  } catch { toast("Cannot reach the Python server. Is app.py running?"); throw new Error("offline"); }
  const data = await res.json();
  if (!res.ok) { toast(data.error); throw new Error(data.error); }
  return data;
}
let toastTimer;
function toast(msg) {
  $("toast").textContent = msg; $("toast").hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $("toast").hidden = true, 3500);
}
function segment(id, fn) {
  $(id).addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    [...$(id).children].forEach(c => c.classList.toggle("active", c === b));
    fn(b.dataset.v);
  });
}

/* ---------- tabs ---------- */
document.querySelector("nav").addEventListener("click", e => {
  const t = e.target.dataset.tab; if (!t) return;
  document.querySelectorAll("nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === t));
  document.querySelectorAll(".tab").forEach(s => s.classList.toggle("active", s.id === t));
  if (t === "planner") resize();
});

/* ---------- city and form ---------- */
async function generate() {
  const city = await api("city", {n: +$("size").value, density: $("dens").value / 100, seed: Math.trunc(+$("seed").value || 0)});
  loadCity(city);
}
function loadCity(city) {
  S.nodes = city.nodes; S.roads = city.roads;
  const marks = S.nodes.filter(n => n.landmark);
  // default journey: the two landmarks farthest apart
  let best = [0, S.nodes.length - 1], far = -1;
  for (const a of marks) for (const b of marks) {
    const d = Math.hypot(a.x - b.x, a.y - b.y); if (d > far) { far = d; best = [a.id, b.id]; }
  }
  [S.from, S.to] = best; S.vias = []; S.roadStart = null; S.pickStart = true;
  refreshForm(); fit(); findRoute();
}
function options(selected) {
  const sorted = [...S.nodes].sort((a, b) => b.landmark - a.landmark || a.name.localeCompare(b.name));
  return sorted.map(n => `<option value="${n.id}" ${n.id === selected ? "selected" : ""}>${n.landmark ? "★ " : ""}${esc(n.name)}</option>`).join("");
}
function refreshForm() {
  $("from").innerHTML = options(S.from); $("to").innerHTML = options(S.to);
  $("vias").innerHTML = S.vias.map((v, i) => `<div class="via"><label>Stop ${i + 1}<select data-via="${i}">${options(v)}</select></label><button data-remove="${i}" aria-label="Remove stop">✕</button></div>`).join("");
  $("hV").textContent = S.nodes.length; $("hE").textContent = S.roads.filter(r => !r.closed).length;
}
function invalidate(recompute = true) {
  stopAnim(); S.result = S.shown = null; S.routeReq++;
  $("resultBody").className = "empty"; $("resultBody").textContent = "Press “Find best route” to calculate.";
  draw(); if (recompute) findRoute();
}
$("from").onchange = e => { S.from = +e.target.value; invalidate(); };
$("to").onchange = e => { S.to = +e.target.value; invalidate(); };
$("vias").onchange = e => { S.vias[e.target.dataset.via] = +e.target.value; invalidate(); };
$("vias").onclick = e => { const i = e.target.dataset.remove; if (i !== undefined) { S.vias.splice(+i, 1); refreshForm(); invalidate(); } };
$("addStop").onclick = () => {
  if (S.vias.length >= 6) return toast("A journey can have at most 6 stops.");
  const free = S.nodes.filter(n => n.landmark && ![S.from, S.to, ...S.vias].includes(n.id));
  S.vias.push(free.length ? free[Math.floor(Math.random() * free.length)].id : 0); refreshForm(); invalidate();
};
$("swap").onclick = () => { [S.from, S.to] = [S.to, S.from]; S.vias.reverse(); refreshForm(); invalidate(); };
segment("metric", v => { S.metric = v; invalidate(); });
function setTraffic(v) { $("traffic").value = v; $("trafficOut").textContent = `${v}%`; invalidate(); }
$("traffic").oninput = e => { $("trafficOut").textContent = `${e.target.value}%`; draw(); };
$("traffic").onchange = e => setTraffic(e.target.value);
document.querySelectorAll("[data-traffic]").forEach(b => b.onclick = () => setTraffic(b.dataset.traffic));
$("early").onchange = () => invalidate();
$("size").oninput = e => $("sizeOut").textContent = e.target.value;
$("dens").oninput = e => $("densOut").textContent = `${e.target.value}%`;
$("generate").onclick = generate;
$("find").onclick = findRoute;

function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], {type})); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("export").onclick = () => download("city.json", JSON.stringify({nodes: S.nodes, roads: S.roads}, null, 1), "application/json");
$("importBtn").onclick = () => $("importFile").click();
$("importFile").onchange = async e => {
  try {
    const c = JSON.parse(await e.target.files[0].text()), n = c.nodes.length;
    const ok = n >= 2 && n <= 2000 && c.nodes.every((p, i) => p.id === i && Number.isFinite(p.x) && Number.isFinite(p.y) && typeof p.name === "string")
      && c.roads.every(r => c.nodes[r.u] && c.nodes[r.v] && ["street", "arterial", "highway"].includes(r.kind) && r.km > 0);
    if (!ok) throw new Error();
    loadCity(c);
  } catch { toast("That file is not a valid city export."); }
  e.target.value = "";
};

/* ---------- routing ---------- */
async function findRoute() {
  stopAnim();
  const req = ++S.routeReq;
  const data = await api("route", {n: S.nodes.length, roads: S.roads, stops: [S.from, ...S.vias, S.to],
    metric: S.metric, traffic: $("traffic").value / 100, early_stop: $("early").checked});
  if (req !== S.routeReq) return;      // a newer request replaced this one
  S.result = data; S.shown = data.results.dijkstra.path; renderResults(); draw();
}
function renderResults() {
  const r = S.result, d = r.results.dijkstra, b = r.results.bellman, body = $("resultBody");
  body.className = "";
  if (d.cost === null) { body.innerHTML = `<span class="badge bad">No route</span><p>The destination cannot be reached. Reopen a closed road or add a new one.</p>`; return; }
  const best = r.options[r.metric], maxMs = Math.max(d.ms, b.ms);
  const card = (name, a) => `<div><span>${name}</span><strong>${a.ms.toFixed(3)} ms</strong><div class="bar" style="width:${a.ms / maxMs * 100}%"></div><dl>
    <dt>Route cost</dt><dd>${UNITS[r.metric](a.cost)}</dd><dt>Edge checks</dt><dd>${a.stats.edge_checks.toLocaleString()}</dd>
    <dt>Updates</dt><dd>${a.stats.updates.toLocaleString()}</dd>
    ${a.stats.passes ? `<dt>Passes</dt><dd>${a.stats.passes}</dd>` : `<dt>Settled</dt><dd>${a.stats.settled}</dd>`}</dl></div>`;
  const fast = d.ms <= b.ms ? "Dijkstra" : "Bellman-Ford", ratio = maxMs / Math.max(Math.min(d.ms, b.ms), 1e-6);
  const names = {distance: "Shortest", time: "Fastest", fuel: "Cheapest"};
  body.innerHTML = `<div class="hero">${names[r.metric]} route<strong>${UNITS[r.metric](d.cost)}</strong>
    <div class="trio"><span><b>${best.distance.toFixed(2)}</b> km</span><span><b>${best.time.toFixed(1)}</b> min</span><span><b>₹${best.fuel.toFixed(0)}</b> fuel</span><span><b>${d.path.length - 1}</b> roads</span></div></div>
    <span class="badge ${r.match ? "" : "bad"}">${r.match ? "✓ Both algorithms agree on the optimal cost" : "Algorithms disagree"}</span>
    <div class="duel">${card("Dijkstra", d)}${card("Bellman-Ford", b)}</div>
    <p style="font-size:12px;color:var(--muted);margin-top:8px">${fast} was ${ratio.toFixed(1)}× faster on this query (${r.vertices} vertices, ${r.edges} directed edges).</p>
    <h3>Route trade-offs (click to preview)</h3><div class="scroll"><table class="options"><tr><th>Goal</th><th>km</th><th>min</th><th>fuel</th></tr>
    ${Object.entries(r.options).map(([m, o]) => `<tr tabindex="0" data-m="${m}" class="${m === r.metric ? "active" : ""}"><td>${names[m]}</td><td class="num">${o.distance.toFixed(2)}</td><td class="num">${o.time.toFixed(1)}</td><td class="num">₹${o.fuel.toFixed(0)}</td></tr>`).join("")}</table></div>
    <h3>Directions</h3><ol class="steps" id="steps"></ol>`;
  renderSteps(r.metric);
  const pick = e => {
    const row = e.target.closest("tr[data-m]"); if (!row) return;
    stopAnim(); body.querySelectorAll("tr[data-m]").forEach(t => t.classList.toggle("active", t === row));
    S.shown = r.options[row.dataset.m].path; renderSteps(row.dataset.m); draw();
  };
  body.querySelector(".options").onclick = pick;
  body.querySelector(".options").onkeydown = e => { if (e.key === "Enter") pick(e); };
}
function renderSteps(m) {
  const o = S.result.options[m]; if (!o) return;
  $("steps").innerHTML = `<li>Start at <b>${esc(S.nodes[S.from].name)}</b></li>` + o.steps.map(s =>
    `<li>${esc(S.nodes[s.to].name)}<small>${s.kind} · ${s.km.toFixed(2)} km · ${s.time.toFixed(1)} min${s.jam > .4 ? " · heavy traffic" : ""}</small></li>`).join("");
}

/* ---------- map drawing ---------- */
const canvas = $("map"), ctx = canvas.getContext("2d");
function resize() {
  const r = canvas.getBoundingClientRect(), k = devicePixelRatio || 1;
  if (!r.width) return;
  canvas.width = r.width * k; canvas.height = r.height * k; ctx.setTransform(k, 0, 0, k, 0, 0); fit();
}
function fit() {
  const r = canvas.getBoundingClientRect(); if (!S.nodes.length || !r.width) return;
  const xs = S.nodes.map(n => n.x), ys = S.nodes.map(n => n.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const s = Math.min((r.width - 80) / Math.max(x1 - x0, 1), (r.height - 110) / Math.max(y1 - y0, 1));
  S.view = {s, x: (r.width - (x1 + x0) * s) / 2, y: (r.height - (y1 + y0) * s) / 2}; draw();
}
const pos = n => [n.x * S.view.s + S.view.x, n.y * S.view.s + S.view.y];
function line(a, b, color, width, dash = []) {
  ctx.beginPath(); ctx.setLineDash(dash); ctx.moveTo(...pos(a)); ctx.lineTo(...pos(b));
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round"; ctx.stroke(); ctx.setLineDash([]);
}
function dot(n, radius, fill, ring) {
  ctx.beginPath(); ctx.arc(...pos(n), radius, 0, 7); ctx.fillStyle = fill; ctx.fill();
  if (ring) { ctx.strokeStyle = ring; ctx.lineWidth = 2; ctx.stroke(); }
}
function label(text, x, y, color = "#cfe2f7") {
  ctx.font = "500 11px 'Space Grotesk',system-ui"; ctx.textAlign = "center";
  ctx.lineWidth = 4; ctx.strokeStyle = "#081423"; ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
}
function draw() {
  const r = canvas.getBoundingClientRect(); ctx.clearRect(0, 0, r.width, r.height);
  if (!S.nodes.length) return;
  const s = S.view.s, z = Math.max(.45, Math.min(1.6, s / 60)), traffic = $("traffic").value / 100;
  ctx.fillStyle = "#1d33501f";                       // background grid
  const g = Math.max(24, s / 2);
  for (let x = ((S.view.x % g) + g) % g; x < r.width; x += g) ctx.fillRect(x, 0, 1, r.height);
  for (let y = ((S.view.y % g) + g) % g; y < r.height; y += g) ctx.fillRect(0, y, r.width, 1);

  const style = {highway: ["#6d8fc4", 5], arterial: ["#46658c", 3.2], street: ["#2b4362", 2]};
  for (const e of S.roads) {
    const a = S.nodes[e.u], b = S.nodes[e.v], [color, w] = style[e.kind];
    if (e.closed) { line(a, b, "#ff6b5e", 2, [5, 6]); continue; }
    line(a, b, color, w * z);
    const jam = e.congestion * traffic;
    if ($("showTraffic").checked && jam > .35) line(a, b, `rgba(226,87,76,${Math.min(1, jam + .15)})`, Math.max(1.2, w * z * .5));
    const [ax, ay] = pos(a), [bx, by] = pos(b), mx = (ax + bx) / 2, my = (ay + by) / 2;
    if (e.oneway && s > 35) {
      ctx.save(); ctx.translate(mx, my); ctx.rotate(Math.atan2(by - ay, bx - ax)); ctx.beginPath();
      ctx.moveTo(6, 0); ctx.lineTo(-4, -5); ctx.lineTo(-4, 5); ctx.fillStyle = "#a9c4e6"; ctx.fill(); ctx.restore();
    }
    if ($("showWeights").checked && s > 55) {
      const speed = {highway: [60, 8.5], arterial: [40, 7], street: [25, 7.8]}[e.kind];
      const v = S.metric === "distance" ? e.km : S.metric === "time" ? e.km / speed[0] * 60 * (1 + 2.5 * jam) : e.km * speed[1] * (1 + .9 * jam);
      label(v.toFixed(1), mx, my - 4, "#8da6c3");
    }
  }

  const A = S.anim, seen = new Set();
  if (A) A.items.slice(0, A.i).forEach((group, i) => group.forEach(id => {
    seen.add(id); dot(S.nodes[id], (i >= A.i - A.step ? 9 : 6) * z, i >= A.i - A.step ? "#ffffff" : A.color + "aa");
  }));
  for (const n of S.nodes) if (!seen.has(n.id)) dot(n, (n.landmark ? 4.5 : 2.8) * z, n.landmark ? "#cfe2f7" : "#6b87a8");

  if (S.shown && S.shown.length && (!A || A.i >= A.items.length)) {
    const p = S.shown.map(i => S.nodes[i]);
    ctx.shadowColor = "#b8f35a"; ctx.shadowBlur = 14;
    for (let i = 1; i < p.length; i++) line(p[i - 1], p[i], "#b8f35a", 5 * z);
    ctx.shadowBlur = 0;
    for (let i = 1; i < p.length; i++) line(p[i - 1], p[i], "#0b2b12", 1.5 * z, [6, 10]);
    p.forEach(n => dot(n, 3.5 * z, "#f3ffe0"));
  }
  const taken = [];
  for (const n of S.nodes) if (n.landmark && s > 28) {
    const [x, y] = pos(n); if (taken.some(t => Math.abs(t[0] - x) < 90 && Math.abs(t[1] - y) < 16)) continue;
    taken.push([x, y]); label(n.name, x, y - 10);
  }
  const pin = (id, color, text) => {
    const n = S.nodes[id], [x, y] = pos(n); dot(n, 12, color, "#fff");
    ctx.font = "700 12px system-ui"; ctx.textAlign = "center"; ctx.fillStyle = "#061120"; ctx.fillText(text, x, y + 4);
  };
  S.vias.forEach((v, i) => pin(v, "#ffd166", i + 1)); pin(S.from, "#4ee6a8", "A"); pin(S.to, "#ff6b5e", "B");
  if (S.roadStart !== null) dot(S.nodes[S.roadStart], 15, "#35d0ff44", "#35d0ff");
}

/* ---------- search animation ---------- */
function stopAnim() { if (S.anim) cancelAnimationFrame(S.anim.frame); S.anim = null; $("playInfo").textContent = ""; }
function play(name) {
  if (!S.result) return toast("Find a route first.");
  stopAnim();
  const res = S.result.results[name], dij = name === "dijkstra";
  const items = dij ? res.trace.flat().map(v => [v]) : res.trace.flat(1);
  S.shown = res.path;
  const A = S.anim = {items, i: 0, step: 1, color: dij ? "#35d0ff" : "#ffb444", last: 0};
  const tick = now => {
    if (S.anim !== A) return;
    const speed = +$("speed").value;
    if (now - A.last > (dij ? 45 : 600 / speed)) {
      A.step = dij ? Math.max(1, Math.round(speed * speed / 12)) : 1;
      A.i = Math.min(items.length, A.i + A.step); A.last = now;
      $("playInfo").textContent = dij ? `Settled ${A.i} of ${items.length} locations` : `Wave ${A.i} of ${items.length}: distances updated`;
      if (A.i >= items.length) A.step = 0;
      draw();
    }
    if (A.i < items.length) A.frame = requestAnimationFrame(tick);
  };
  A.frame = requestAnimationFrame(tick);
}
document.querySelectorAll("[data-play]").forEach(b => b.onclick = () => play(b.dataset.play));

/* ---------- map interaction ---------- */
function nearestNode(x, y, limit = 14) {
  let best = null, d = limit;
  for (const n of S.nodes) { const [a, b] = pos(n), k = Math.hypot(a - x, b - y); if (k < d) { d = k; best = n.id; } }
  return best;
}
function nearestRoad(x, y) {
  let best = null, d = 9;
  S.roads.forEach((e, i) => {
    const [ax, ay] = pos(S.nodes[e.u]), [bx, by] = pos(S.nodes[e.v]), dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    const k = Math.hypot(ax + t * dx - x, ay + t * dy - y); if (k < d) { d = k; best = i; }
  });
  return best;
}
const HINTS = {pick: "Click a location to set the start.", close: "Click a road to close or reopen it.",
  node: "Click empty space to add a location.", road: "Click two locations to connect them."};
segment("mode", v => { S.mode = v; S.roadStart = null; S.pickStart = true; $("hint").textContent = HINTS[v]; $("roadKind").hidden = v !== "road"; draw(); });
function mapClick(x, y) {
  const id = nearestNode(x, y);
  if (S.mode === "pick") {
    if (id === null) return;
    if (S.pickStart) { S.from = id; $("hint").textContent = "Now click the destination."; }
    else { S.to = id; $("hint").textContent = HINTS.pick; }
    const done = !S.pickStart; S.pickStart = done; refreshForm(); invalidate(done);
  } else if (S.mode === "close") {
    const i = nearestRoad(x, y); if (i === null) return;
    S.roads[i].closed = !S.roads[i].closed; refreshForm(); invalidate();
  } else if (S.mode === "node") {
    if (id !== null) return toast("There is already a location here.");
    if (S.nodes.length >= 2000) return toast("Location limit reached.");
    const k = S.nodes.length;
    S.nodes.push({id: k, x: (x - S.view.x) / S.view.s, y: (y - S.view.y) / S.view.s, name: `New Place ${k}`, landmark: true});
    refreshForm(); invalidate(false); toast("Location added. Use “Add road” to connect it.");
  } else {
    if (id === null) return;
    if (S.roadStart === null) { S.roadStart = id; draw(); return; }
    if (id !== S.roadStart) {
      const a = S.nodes[S.roadStart], b = S.nodes[id];
      S.roads.push({u: a.id, v: id, km: Math.max(.001, Math.hypot(a.x - b.x, a.y - b.y)), kind: $("roadKind").value, congestion: .1, oneway: false, closed: false});
    }
    S.roadStart = null; refreshForm(); invalidate();
  }
}
let drag = null;
canvas.onpointerdown = e => { drag = {x: e.offsetX, y: e.offsetY, vx: S.view.x, vy: S.view.y, moved: false}; canvas.setPointerCapture(e.pointerId); };
canvas.onpointermove = e => {
  const x = e.offsetX, y = e.offsetY, tip = $("tip");
  if (drag) {
    if (Math.hypot(x - drag.x, y - drag.y) > 5) drag.moved = true;
    if (drag.moved) { S.view.x = drag.vx + x - drag.x; S.view.y = drag.vy + y - drag.y; tip.hidden = true; draw(); return; }
  }
  const id = nearestNode(x, y), i = id === null ? nearestRoad(x, y) : null;
  let text = id !== null ? S.nodes[id].name : null;
  if (i !== null) { const r = S.roads[i]; text = `${r.kind}${r.oneway ? " (one-way)" : ""}${r.closed ? " · CLOSED" : ""}\n${r.km.toFixed(2)} km · congestion ${(r.congestion * $("traffic").value).toFixed(0)}%`; }
  tip.hidden = !text;
  if (text) { tip.textContent = text; tip.style.left = `${Math.min(x + 14, canvas.clientWidth - 200)}px`; tip.style.top = `${y + 14}px`; }
};
canvas.onpointerup = e => { if (drag && !drag.moved) mapClick(e.offsetX, e.offsetY); drag = null; };
canvas.onpointercancel = () => drag = null;
canvas.onpointerleave = () => $("tip").hidden = true;
canvas.addEventListener("wheel", e => {
  e.preventDefault();
  const v = S.view, k = Math.max(8, Math.min(400, v.s * Math.exp(-e.deltaY * .0012))) / v.s;
  v.x = e.offsetX - (e.offsetX - v.x) * k; v.y = e.offsetY - (e.offsetY - v.y) * k; v.s *= k; draw();
}, {passive: false});
$("fit").onclick = fit; $("showTraffic").onchange = draw; $("showWeights").onchange = draw;
new ResizeObserver(resize).observe(canvas);

/* ---------- performance lab ---------- */
const SERIES = {dijkstra: ["Dijkstra", "#35d0ff"], bellman: ["Bellman-Ford (early exit)", "#ffb444"], classic: ["Bellman-Ford (classic)", "#ff6fae"]};
$("bdens").oninput = e => $("bdensOut").textContent = `${e.target.value}%`;
$("run").onclick = async () => {
  const sizes = [...new Set($("sizes").value.split(",").map(Number).filter(n => Number.isInteger(n) && n >= 10 && n <= 2000))].sort((a, b) => a - b);
  if (!sizes.length) return toast("Enter whole numbers between 10 and 2000.");
  $("run").disabled = true; $("csv").disabled = true; $("prog").hidden = false; $("prog").value = 0; S.bench = []; renderBench();
  try {
    for (const [i, n] of sizes.entries()) {
      $("labMsg").textContent = `Measuring ${n} locations…`;
      S.bench.push(await api("benchmark", {n, density: $("bdens").value / 100, trials: +$("trials").value, classic: $("classic").checked}));
      $("prog").value = (i + 1) / sizes.length; renderBench();
    }
    $("labMsg").textContent = "Done. Timings vary a little between runs and computers.";
    $("csv").disabled = false;
  } catch { $("labMsg").textContent = "Benchmark stopped."; }
  $("run").disabled = false;
};
const fmt = v => v >= 1000 ? Math.round(v).toLocaleString() : v >= 10 ? v.toFixed(1) : v.toFixed(3);
function renderBench() {
  const data = S.bench, m = S.chartMetric;
  $("chartTitle").textContent = m === "ms" ? "Running time (ms)" : "Edge checks";
  const keys = Object.keys(SERIES).filter(k => data.some(d => d.algorithms[k]));
  $("keys").innerHTML = keys.map(k => `<span><i style="background:${SERIES[k][1]}"></i>${SERIES[k][0]}</span>`).join("");
  $("table").innerHTML = data.length ? `<tr><th>V</th><th>E</th>${keys.map(k => `<th>${SERIES[k][0]} ms</th><th>edge checks</th>`).join("")}<th>Passes</th><th>Same answer</th></tr>` +
    data.map(d => `<tr><td>${d.n}</td><td>${d.edges}</td>${keys.map(k => { const a = d.algorithms[k]; return a ? `<td class="num">${fmt(a.ms)}</td><td class="num">${a.edge_checks.toLocaleString()}</td>` : "<td>skipped</td><td>–</td>"; }).join("")}<td>${d.algorithms.bellman.passes}</td><td>${d.agree ? "✓" : "✗"}</td></tr>`).join("") : "";
  const last = data.at(-1);
  if (last) {
    const a = last.algorithms, times = k => `${(a[k].ms / a.dijkstra.ms).toFixed(1)}×`;
    $("summary").innerHTML = `<div>Dijkstra at ${last.n} locations<strong>${fmt(a.dijkstra.ms)} ms</strong></div>
      <div>Early-exit Bellman-Ford vs Dijkstra (time)<strong>${times("bellman")}</strong></div>
      ${a.classic ? `<div>Classic Bellman-Ford vs Dijkstra (time)<strong>${times("classic")}</strong></div>` : ""}`;
  } else $("summary").innerHTML = "";
  const box = $("chart");
  if (!data.length) { box.className = "empty"; box.textContent = "Results appear here as each size finishes."; return; }
  box.className = "";
  const W = 820, H = 360, L = 70, R = 20, T = 15, B = 45, log = $("log").checked;
  const values = data.flatMap(d => keys.map(k => d.algorithms[k]?.[m]).filter(v => v > 0));
  const max = Math.max(...values), lo = log ? Math.floor(Math.log10(Math.min(...values))) : 0;
  const hi = log ? Math.max(Math.ceil(Math.log10(max)), lo + 1) : max * 1.08;
  const nMin = data[0].n, nMax = data.at(-1).n;
  const X = n => nMax === nMin ? (L + W - R) / 2 : L + (n - nMin) / (nMax - nMin) * (W - L - R);
  const Y = v => H - B - ((log ? Math.log10(v) : v) - lo) / (hi - lo) * (H - T - B);
  const ticks = log ? Array.from({length: hi - lo + 1}, (_, i) => 10 ** (lo + i)) : Array.from({length: 6}, (_, i) => hi * i / 5);
  let svg = ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="#223a59"/><text x="${L - 8}" y="${Y(t) + 4}" text-anchor="end">${t >= 1e4 ? t.toExponential(0) : +t.toPrecision(3)}</text>`).join("");
  let lastX = -99;
  for (const d of data) if (X(d.n) - lastX > 34) { lastX = X(d.n); svg += `<text x="${lastX}" y="${H - 24}" text-anchor="middle">${d.n}</text>`; }
  svg += `<text x="${(L + W) / 2}" y="${H - 5}" text-anchor="middle">Locations (V)</text>`;
  for (const k of keys) {
    const pts = data.filter(d => d.algorithms[k]), c = SERIES[k][1];
    svg += `<polyline fill="none" stroke="${c}" stroke-width="2.5" points="${pts.map(d => `${X(d.n)},${Y(d.algorithms[k][m])}`).join(" ")}"/>`;
    svg += pts.map(d => `<circle cx="${X(d.n)}" cy="${Y(d.algorithms[k][m])}" r="5" fill="${c}"><title>${SERIES[k][0]}\nV = ${d.n}: ${fmt(d.algorithms[k][m])}</title></circle>`).join("");
  }
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Performance comparison chart">${svg}</svg>`;
}
segment("chartMetric", v => { S.chartMetric = v; renderBench(); });
$("log").onchange = renderBench;
$("csv").onclick = () => {
  const rows = [["vertices", "edges", "algorithm", "ms", "edge_checks", "passes"]];
  S.bench.forEach(d => Object.entries(d.algorithms).forEach(([k, a]) => rows.push([d.n, d.edges, k, a.ms, a.edge_checks, a.passes])));
  download("benchmark.csv", rows.map(r => r.join(",")).join("\n"), "text/csv");
};

/* ---------- algorithms tab ---------- */
async function demo(kind) {
  const r = await api("demo", {kind}), P = [[50, 130], [200, 45], [200, 215], [345, 55], [470, 170]], N = "ABCDE";
  let svg = `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#8da6c3"/></marker></defs>`;
  for (const [u, v, w] of r.edges) {
    const [x1, y1] = P[u], [x2, y2] = P[v], len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, c = w < 0 ? "#ff6b5e" : "#46658c";
    svg += `<line x1="${x1 + ux * 22}" y1="${y1 + uy * 22}" x2="${x2 - ux * 23}" y2="${y2 - uy * 23}" stroke="${c}" stroke-width="2.5" marker-end="url(#arr)"/><rect x="${mx - 15}" y="${my - 11}" width="30" height="22" rx="6" fill="#07111f" stroke="${c}"/><text x="${mx}" y="${my + 1}">${w}</text>`;
  }
  P.forEach(([x, y], i) => svg += `<circle cx="${x}" cy="${y}" r="20" fill="#13253d" stroke="#35d0ff" stroke-width="2"/><text x="${x}" y="${y + 1}">${N[i]}</text>`);
  $("demoSvg").innerHTML = svg;
  const show = v => v === null ? "∞" : v;
  $("demoTable").innerHTML = `<tr><th>To</th><th>Dijkstra</th><th>Bellman-Ford</th></tr>` + [...N].map((n, i) =>
    `<tr><td>${n}</td><td class="${!r.negative_cycle && r.dijkstra[i] !== r.bellman[i] ? "wrong" : ""}">${show(r.dijkstra[i])}</td><td>${r.negative_cycle && i ? "undefined" : show(r.bellman[i])}</td></tr>`).join("");
  $("demoNote").textContent = r.negative_cycle ? "Bellman-Ford detected a negative cycle (B → D → C → B). Going round it lowers the cost forever, so no shortest path exists to places it reaches. Dijkstra gives numbers without any warning."
    : r.dijkstra.some((v, i) => v !== r.bellman[i]) ? "Red values are wrong. Dijkstra settled B and D before it found the cheaper way through C." : "With non-negative weights both algorithms give identical distances.";
}
segment("demoKind", demo);

(async () => {
  renderBench(); await generate(); await demo("negative");
  const src = await api("source"); $("srcD").textContent = src.dijkstra; $("srcB").textContent = src.bellman;
})();
