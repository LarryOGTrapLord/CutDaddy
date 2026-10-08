/* Cut Bench — asset cutting + masking + retouching with persistent fine-tune.
   Exposes window.GateCut. Load order: core.js -> select.js -> this file.
   Everything persists to LS + kv mirror ("gate1.pro.*") and replays on boot.
   READING GUIDE (§ = banner below, search it to jump):
     §1  state + persistence ......... save/load/stats/parts (stats, save, load)
     §2  source image ................ setSource, upload, drawSample
     §3  mask replay ................. replayMask (replays strokes/rects/polys)
     §4  magic key + retouch ......... applyMagicOp, replayRetouch, heal/clone
     §5  composite + layers .......... maskedBaseCanvas, composite, layerImg
     §6  edges + snapping ............ ensureEdgeMap (Sobel), magnetic, applySnaps
     §7  path engine ................. getActivePath..undoPath, trace/strokePoly
     §8  edit canvas ................. renderEdit (draw), wireEdit (touch/mouse)
     §9  lasso + nudge + picker ...... applyLasso, nudgeSel, pickAndMagic
     §10 parts grid .................. sendToGrid, exportPart, editPartBack, paintParts
     §11 selections panel ............ paintRects, paintPolys (multi-box/poly UI)
     §12 layer ops ................... selectionToLayer (copy/cut→layer), paintLayers
     §13 auto-select ................. strokeActivePath, snapActivePath,
                                       selectSubject (flood+Moore), blobs
     §14 projects + layout ........... switchProject, applyLayout, popResult
     §15 toolbar + recipe ............ paintTool, syncInputs, recipeJSON/applyRecipe
     §16 boot ........................ boot() wires every button, migrates, replays
   Touch conventions: tap empty canvas = new box, tap shape = select/move,
   handles reshape; lasso/path close = new poly. Ids end Btn/El/Ctn/Input. */
(function () {
  "use strict";
  const G = () => window.Gate;
  const KEY = "gate1.pro.cutbench";
  const STATS_KEY = "gate1.pro.cutstats";
  const PARTS_KEY = "gate1.pro.cutparts";
  const MAXD = 960, STORE_MAXD = 768, PART_MAXD = 512, MAX_PARTS = 24;

  const DEF = () => ({
    tool: "keep", brushSize: 36, hardness: 65,
    overlay: true, checker: true,
    feather: 2, contract: 0, tolerance: 32, magicColor: "#2fae5f",
    adj: { bright: 0, contrast: 0, sat: 100, warm: 0, sharp: 0 },
    cutRect: null, poly: [], strokes: [], magics: [],
    rects: [], polys: [], activeRectId: null, activePolyId: null, shapeSeq: 0,
    layers: [], activeLayerId: null, cutouts: [],
    viewMode: "comp", layout: "side", viewSplit: 50, viewLock: false, subjTol: 36,
    retouchOps: [], cloneSrc: null,
    selColor: "#38e1a8", selStyle: "ants", cutLock: false,
    inverse: false,
    lassoMode: "draw",
    paths: [], activePathId: null, pathMode: "draw", pathSel: -1,
    showGrid: false, gridSnap: false, gridN: 16,
    edgeSnap: false, showEdges: false, gridZoom: 128,
  });
  let S = DEF();
  const PALETTE = ["#38e1a8", "#5ec8ff", "#ffcc55", "#ff6b6b", "#c792ea", "#ff9f43", "#7dff6a", "#ff6ad5"];
  const MAX_LAYERS = 6, LAYER_MAXD = 768;

  // live canvases (not persisted)
  let srcC = null, srcW = 0, srcH = 0;
  let retC = null;
  let adjC = null;
  let maskC = null;
  let hasImage = false;
  let hist = [];
  let lassoDraft = [];
  let brushDown = null, rectDrag = null, cloneStroke = null;
  let cursor = null;
  // lasso/path edit state (transient)
  let lassoSel = -1, lassoDrag = null, lassoDrawDown = false;
  let pathDrawDown = false, pathDrag = null, pathMove = null;
  let pathHist = [];
  // parts grid (persisted separately)
  let parts = [];
  // edge map cache (Sobel magnitude 0..255)
  let edgeMag = null, edgeW = 0, edgeH = 0, edgeVisC = null;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rel = (e, c) => {
    const r = c.getBoundingClientRect();
    return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)];
  };
  const touchRadPx = (c) => {
    try {
      const r = c.getBoundingClientRect();
      const s = c.width / Math.max(1, r.width);
      return clamp(26 * s, 14, 48);
    } catch (e) { return 22; }
  };
  const gcd = (a, b) => { a = Math.abs(Math.round(a)) || 1; b = Math.abs(Math.round(b)) || 1; while (b) { const t = a % b; a = b; b = t; } return a || 1; };

  /* ---------- stats ---------- */
  /* ==================================================================
     §1 state + persistence: stats/XP, save/load (LS + kv), parts store.
     ================================================================== */
  function stats() { return G().lsGet(STATS_KEY, { updatedAt: 0, actions: 0, exports: 0, keeps: 0, days: [] }); }
  function bump(k) {
    const s = stats();
    s[k] = (s[k] || 0) + 1;
    const day = new Date().toISOString().slice(0, 10);
    if (!s.days.includes(day)) { s.days.push(day); s.days = s.days.slice(-30); }
    s.updatedAt = Date.now();
    G().lsSet(STATS_KEY, s); G().store(STATS_KEY, null).save(s);
  }

  /* ---------- persistence (per-project) ---------- */
  let saveT = 0;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      try {
        const doc = Object.assign({ updatedAt: Date.now() }, S);
        if (projId) {
          const l = projList();
          const e = l.find((p) => p.id === projId);
          if (e) { e.doc = doc; e.updatedAt = Date.now(); saveProjList(l); }
        } else { G().lsSet(KEY, doc); G().store(KEY, null).save(doc); }
      } catch (e) { /* quota: recipe stays in memory */ }
    }, 400);
  }
  function saveSourceThumb() {
    if (!srcC) return;
    try {
      const sc = Math.min(1, STORE_MAXD / Math.max(srcW, srcH));
      const t = document.createElement("canvas");
      t.width = Math.max(1, Math.round(srcW * sc)); t.height = Math.max(1, Math.round(srcH * sc));
      t.getContext("2d").drawImage(srcC, 0, 0, t.width, t.height);
      const url = t.toDataURL("image/png");
      if (url.length < 1800000) {
        if (projId) {
          const l = projList();
          const e = l.find((p) => p.id === projId);
          if (e) { e.doc = Object.assign(e.doc || {}, stateDoc(), { sourceDataUrl: url, sourceW: srcW, sourceH: srcH }); e.updatedAt = Date.now(); saveProjList(l); }
        } else {
          const doc = G().lsGet(KEY, {});
          doc.sourceDataUrl = url; doc.sourceW = srcW; doc.sourceH = srcH; doc.updatedAt = Date.now();
          G().lsSet(KEY, doc);
        }
      }
    } catch (e) {}
  }
  function load() {
    try {
      const d = G().lsGet(KEY, null);
      if (d && typeof d === "object") {
        const fresh = DEF();
        Object.keys(fresh).forEach((k) => { if (d[k] !== undefined) fresh[k] = d[k]; });
        if (fresh.adj) fresh.adj = Object.assign(DEF().adj, fresh.adj);
        if (!Array.isArray(fresh.poly)) fresh.poly = [];
        ["strokes", "magics", "retouchOps", "paths", "rects", "polys", "layers", "cutouts"].forEach((k) => { if (!Array.isArray(fresh[k])) fresh[k] = []; });
        // v2 → v3 migration: single cutRect/poly become the first box/poly selections
        if (!fresh.rects.length && Array.isArray(fresh.cutRect) && fresh.cutRect.length === 4) {
          fresh.rects = [{ id: "r0", r: fresh.cutRect.slice(), color: fresh.selColor || DEF().selColor, mode: "add", on: true }];
          fresh.activeRectId = "r0";
        }
        if (!fresh.polys.length && Array.isArray(fresh.poly) && fresh.poly.length >= 3) {
          fresh.polys = [{ id: "q0", pts: fresh.poly.map((q) => [q[0], q[1]]), color: "#5ec8ff", mode: "add", on: true }];
          fresh.activePolyId = "q0";
        }
        fresh.cutRect = null; fresh.poly = [];
        fresh.rects = fresh.rects.filter((r) => r && Array.isArray(r.r) && r.r.length === 4).map((r, i) => ({
          id: String(r.id || ("r" + i)), r: r.r.map((v) => clamp(+v || 0, 0, 1)),
          color: String(r.color || PALETTE[i % PALETTE.length]), mode: r.mode === "sub" ? "sub" : "add", on: r.on !== false,
        }));
        fresh.polys = fresh.polys.filter((p) => p && Array.isArray(p.pts)).map((p, i) => ({
          id: String(p.id || ("q" + i)),
          pts: p.pts.filter((q) => Array.isArray(q) && q.length >= 2).map((q) => [clamp(+q[0] || 0, 0, 1), clamp(+q[1] || 0, 0, 1)]),
          color: String(p.color || PALETTE[(i + 1) % PALETTE.length]), mode: p.mode === "sub" ? "sub" : "add", on: p.on !== false,
        }));
        fresh.layers = fresh.layers.filter((l) => l && l.dataUrl).map((l, i) => ({
          id: String(l.id || ("l" + i)), name: String(l.name || ("layer " + (i + 1))), dataUrl: String(l.dataUrl),
          on: l.on !== false, op: clamp(+l.op || 100, 0, 100), blend: String(l.blend || "source-over"),
          ox: +l.ox || 0, oy: +l.oy || 0,
        })).slice(0, MAX_LAYERS);
        if (fresh.layers.length && !fresh.layers.some((l) => l.id === fresh.activeLayerId)) fresh.activeLayerId = fresh.layers[0].id;
        if (!Array.isArray(fresh.cutouts)) fresh.cutouts = [];
        if (!["comp", "mask", "base"].includes(fresh.viewMode)) fresh.viewMode = "comp";
        if (!["side", "stack", "edit", "result"].includes(fresh.layout)) fresh.layout = "side";
        fresh.viewSplit = clamp(+fresh.viewSplit || 50, 20, 80); fresh.viewLock = !!fresh.viewLock;
        fresh.subjTol = clamp(+fresh.subjTol || 36, 8, 80);
        fresh.shapeSeq = +fresh.shapeSeq || (fresh.rects.length + fresh.polys.length);
        if (!fresh.rects.some((r) => r.id === fresh.activeRectId)) fresh.activeRectId = fresh.rects.length ? fresh.rects[0].id : null;
        if (!fresh.polys.some((p) => p.id === fresh.activePolyId)) fresh.activePolyId = fresh.polys.length ? fresh.polys[0].id : null;        fresh.paths = fresh.paths.filter((p) => p && Array.isArray(p.pts)).map((p, i) => ({
          id: String(p.id || ("p" + i)), name: String(p.name || ("path " + (i + 1))),
          pts: p.pts.filter((q) => Array.isArray(q) && q.length >= 2).map((q) => [clamp(+q[0] || 0, 0, 1), clamp(+q[1] || 0, 0, 1)]),
          closed: !!p.closed, smooth: p.smooth !== false,
        }));
        if (fresh.paths.length && !fresh.paths.some((p) => p.id === fresh.activePathId)) fresh.activePathId = fresh.paths[0].id;
        if (!["draw", "edit"].includes(fresh.lassoMode)) fresh.lassoMode = "draw";
        if (!["draw", "edit"].includes(fresh.pathMode)) fresh.pathMode = "draw";
        fresh.gridN = clamp(parseInt(fresh.gridN, 10) || 16, 4, 64);
        S = fresh;
        hist = [];
        S.strokes.forEach((s) => hist.push({ k: "stroke", ref: s }));
        S.magics.forEach((m) => hist.push({ k: "magic", ref: m }));
        return d.sourceDataUrl || null;
      }
    } catch (e) {}
    return null;
  }
  function loadParts() {
    try {
      const d = G().lsGet(PARTS_KEY, []);
      parts = Array.isArray(d) ? d.filter((p) => p && p.dataUrl).slice(0, MAX_PARTS) : [];
    } catch (e) { parts = []; }
  }
  let partsSaveT = 0;
  function saveParts() {
    clearTimeout(partsSaveT);
    partsSaveT = setTimeout(() => {
      try {
        const doc = parts.slice(0, MAX_PARTS);
        G().lsSet(PARTS_KEY, doc); G().store(PARTS_KEY, null).save(doc);
      } catch (e) {
        window.GateLog.log("warn", "parts grid: storage full — nodes kept for this session only", null);
      }
    }, 400);
  }

  /* ---------- source ---------- */
  function fitCanvas(c) { c.width = srcW; c.height = srcH; }
  function invalidateEdges() { edgeMag = null; edgeVisC = null; edgeW = 0; edgeH = 0; }
  /* ==================================================================
     §2 source image: fit, set, upload, sample card, thumbnails.
     ================================================================== */
  function setSource(canvas, name) {
    const sc = Math.min(1, MAXD / Math.max(canvas.width, canvas.height));
    srcW = Math.max(1, Math.round(canvas.width * sc));
    srcH = Math.max(1, Math.round(canvas.height * sc));
    srcC = document.createElement("canvas"); fitCanvas(srcC);
    srcC.getContext("2d").drawImage(canvas, 0, 0, srcW, srcH);
    retC = document.createElement("canvas"); fitCanvas(retC);
    adjC = document.createElement("canvas"); fitCanvas(adjC);
    maskC = document.createElement("canvas"); fitCanvas(maskC);
    ["cutEdit", "cutView"].forEach((id) => { const c = G().$(id); if (c) fitCanvas(c); });
    hasImage = true;
    invalidateEdges();
    lassoDraft = []; lassoSel = -1; lassoDrag = null;
    if (S.showEdges || S.edgeSnap) ensureEdgeMap();
    replayAll();
    saveSourceThumb();
    window.GateLog.log("cut", "cut source: " + name + " (" + srcW + "x" + srcH + ")", null);
    paintCounts();
  }
  function clearMaskState() {
    S.cutRect = null; S.poly = []; lassoDraft = []; lassoSel = -1;
    S.rects = []; S.polys = []; S.activeRectId = null; S.activePolyId = null;
    S.strokes = []; S.magics = []; hist = [];
    S.retouchOps = []; S.cloneSrc = null;
    S.cutouts = [];
  }
  function upload(file) {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      try { URL.revokeObjectURL(img.src); } catch (e) {}
      setSource(c, file.name || "upload");
    };
    img.onerror = () => window.GateLog.log("error", "cut: could not read that image", null);
    img.src = URL.createObjectURL(file);
  }
  function drawSample() {
    const W = 512, H = 512, c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    g.fillStyle = "#2fae5f"; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = "rgba(0,0,0," + (Math.random() * 0.06) + ")";
      g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }
    g.fillStyle = "#c0392b";
    g.beginPath(); g.arc(130, 140, 70, 0, 7); g.fill();
    g.fillStyle = "#2456c8";
    g.beginPath(); g.roundRect(330, 90, 120, 120, 18); g.fill();
    g.fillStyle = "#f2c14e";
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 18 : 42;
      g[i ? "lineTo" : "moveTo"](400 + Math.cos(a) * r, 330 + Math.sin(a) * r);
    }
    g.closePath(); g.fill();
    g.fillStyle = "#e8a95e";
    g.beginPath(); g.arc(200, 330, 44, 0, 7); g.fill();
    g.beginPath(); g.roundRect(160, 375, 80, 100, 22); g.fill();
    g.fillStyle = "#7a4a1e";
    g.beginPath(); g.arc(186, 322, 6, 0, 7); g.fill();
    g.beginPath(); g.arc(214, 322, 6, 0, 7); g.fill();
    g.strokeStyle = "#7a4a1e"; g.lineWidth = 4; g.beginPath();
    g.arc(200, 340, 14, 0.4, Math.PI - 0.4); g.stroke();
    setSource(c, "sample card");
  }

  /* ---------- mask replay (inverse-aware) ---------- */
  function softBrush(g, x, y, r, hardness, rgb) {
    const inner = Math.max(0.5, r * (hardness / 100));
    const grad = g.createRadialGradient(x, y, inner, x, y, r);
    grad.addColorStop(0, "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",1)");
    grad.addColorStop(1, "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ",0)");
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  /* ---------- selections: multiple boxes + polys ---------- */
  function nextColor() { const c = PALETTE[(S.shapeSeq || 0) % PALETTE.length]; S.shapeSeq = (S.shapeSeq || 0) + 1; return c; }
  function enabledShapes() {
    return {
      rects: S.rects.filter((r) => r.on !== false),
      polys: S.polys.filter((p) => p.on !== false && p.pts.length >= 3),
    };
  }
  function hasAnyShape() { const s = enabledShapes(); return s.rects.length > 0 || s.polys.length > 0; }
  function getActiveRect() { return S.rects.find((r) => r.id === S.activeRectId) || null; }
  function getActivePoly() { return S.polys.find((p) => p.id === S.activePolyId) || null; }
  function rectPx(r) { return { x: r.r[0] * srcW, y: r.r[1] * srcH, w: r.r[2] * srcW, h: r.r[3] * srcH }; }
  function tracePolyPath(g, pts) {
    g.beginPath();
    pts.forEach(([px, py], i) => { i ? g.lineTo(px * srcW, py * srcH) : g.moveTo(px * srcW, py * srcH); });
    g.closePath();
  }
  function fillRectNorm(g, r) { g.fillRect(r[0] * srcW, r[1] * srcH, r[2] * srcW, r[3] * srcH); }
  function unionAddBBox() {
    // crop window = union bbox of enabled ADD rects (legacy single-rect crop behavior)
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0, n = 0;
    S.rects.forEach((r) => {
      if (r.on === false || r.mode === "sub") return;
      n++;
      x0 = Math.min(x0, r.r[0]); y0 = Math.min(y0, r.r[1]);
      x1 = Math.max(x1, r.r[0] + r.r[2]); y1 = Math.max(y1, r.r[1] + r.r[3]);
    });
    if (!n) return null;
    return [clamp(x0, 0, 1), clamp(y0, 0, 1), clamp(x1 - x0, 0.02, 1), clamp(y1 - y0, 0.02, 1)];
  }
  /* ==================================================================
     §3 mask replay: strokes + boxes + polys (+/-) + brushes => alpha. Non-destructive.
     ================================================================== */
  function replayMask() {
    const g = maskC.getContext("2d");
    g.globalCompositeOperation = "source-over";
    const sh = enabledShapes();
    const anySel = sh.rects.length > 0 || sh.polys.length > 0;
    const paintShapes = (addPass) => {
      sh.rects.forEach((r) => {
        if ((r.mode === "sub") === addPass) return;
        g.fillStyle = addPass ? "#fff" : "#000";
        fillRectNorm(g, r.r);
      });
      sh.polys.forEach((p) => {
        if ((p.mode === "sub") === addPass) return;
        g.fillStyle = addPass ? "#fff" : "#000";
        tracePolyPath(g, p.pts); g.fill();
      });
    };
    if (!S.inverse) {
      if (!anySel) { g.fillStyle = "#fff"; g.fillRect(0, 0, srcW, srcH); }
      else {
        g.fillStyle = "#000"; g.fillRect(0, 0, srcW, srcH);
        paintShapes(true);   // union of adds
        paintShapes(false);  // subs punch out
      }
    } else {
      // inverse: keep OUTSIDE the combined selection
      if (!anySel) { g.fillStyle = "#fff"; g.fillRect(0, 0, srcW, srcH); }
      else {
        g.fillStyle = "#fff"; g.fillRect(0, 0, srcW, srcH);
        // cut the (adds minus subs) region: draw adds black, then re-keep sub pockets white
        sh.rects.forEach((r) => {
          if (r.mode === "sub") return;
          g.fillStyle = "#000"; fillRectNorm(g, r.r);
        });
        sh.polys.forEach((p) => {
          if (p.mode === "sub") return;
          g.fillStyle = "#000"; tracePolyPath(g, p.pts); g.fill();
        });
        sh.rects.forEach((r) => {
          if (r.mode !== "sub") return;
          g.fillStyle = "#fff"; fillRectNorm(g, r.r);
        });
        sh.polys.forEach((p) => {
          if (p.mode !== "sub") return;
          g.fillStyle = "#fff"; tracePolyPath(g, p.pts); g.fill();
        });
      }
    }
    S.strokes.forEach((st) => {
      const rgb = st.mode === "keep" ? [255, 255, 255] : [0, 0, 0];
      g.globalCompositeOperation = "source-over";
      st.pts.forEach(([px, py]) => {
        softBrush(g, px * srcW, py * srcH, (st.size / 2) * (srcW / 480), st.hard, rgb);
      });
    });
    g.globalCompositeOperation = "source-over";
    S.magics.forEach((m) => applyMagicOp(m, true));
  }
  /* ==================================================================
     §4 magic color key + retouch ops + heal spot + clone stamp.
     ================================================================== */
  function hexRgb(hex) {
    const h = String(hex || "#000000").replace("#", "");
    const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
  }
  function applyMagicOp(m, fromReplay) {
    const mg = maskC.getContext("2d");
    const md = mg.getImageData(0, 0, srcW, srcH);
    const sg = srcC.getContext("2d").getImageData(0, 0, srcW, srcH);
    const [tr, tg, tb] = hexRgb(m.color), tol = m.tol, tol2 = tol * tol;
    const mp = md.data, sp = sg.data;
    for (let i = 0; i < mp.length; i += 4) {
      if (mp[i] < 128) continue;
      const dr = sp[i] - tr, dg = sp[i + 1] - tg, db = sp[i + 2] - tb;
      if (dr * dr + dg * dg + db * db <= tol2 * 3) { mp[i] = mp[i + 1] = mp[i + 2] = 0; mp[i + 3] = 255; }
    }
    mg.putImageData(md, 0, 0);
    if (!fromReplay) {
      S.magics.push(m); hist.push({ k: "magic", ref: m });
      afterMaskEdit("magic", "magic cut " + m.color + " ±" + m.tol);
    }
  }

  /* ---------- retouch replay ---------- */
  function replayRetouch() {
    const g = retC.getContext("2d");
    g.clearRect(0, 0, srcW, srcH);
    g.drawImage(srcC, 0, 0);
    S.retouchOps.forEach((op) => {
      if (op.k === "heal") paintHeal(g, op, true);
      else if (op.k === "clone") paintClone(g, op, true);
    });
  }
  function ringMedian(x, y, r) {
    const g = retC.getContext("2d");
    const x0 = clamp(Math.round(x - r * 2), 0, srcW - 1), x1 = clamp(Math.round(x + r * 2), 0, srcW - 1);
    const y0 = clamp(Math.round(y - r * 2), 0, srcH - 1), yy1 = clamp(Math.round(y + r * 2), 0, srcH - 1);
    let d;
    try { d = g.getImageData(x0, y0, x1 - x0 + 1, yy1 - y0 + 1).data; }
    catch (e) { return [200, 150, 120]; }
    const rs = [], gs = [], bs = [];
    for (let i = 0; i < d.length; i += 12) { rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]); }
    const med = (a) => { a.sort((p, q) => p - q); return a[Math.floor(a.length / 2)] || 128; };
    return [med(rs), med(gs), med(bs)];
  }
  function paintHeal(g, op, fromReplay) {
    const [mr, mg2, mb] = ringMedian(op.x, op.y, op.r);
    const grad = g.createRadialGradient(op.x, op.y, 1, op.x, op.y, op.r);
    grad.addColorStop(0, "rgb(" + mr + "," + mg2 + "," + mb + ")");
    grad.addColorStop(1, "rgba(" + mr + "," + mg2 + "," + mb + ",0)");
    g.save(); g.fillStyle = grad;
    g.beginPath(); g.arc(op.x, op.y, op.r, 0, 7); g.fill(); g.restore();
    if (!fromReplay) { S.retouchOps.push(op); afterRetouchEdit("heal", op.r); }
  }
  function paintClone(g, op, fromReplay) {
    const tmp = document.createElement("canvas"); tmp.width = srcW; tmp.height = srcH;
    tmp.getContext("2d").drawImage(retC, 0, 0);
    g.save();
    g.beginPath();
    op.path.forEach(([px, py], i) => { i ? g.lineTo(px, py) : g.moveTo(px, py); });
    g.lineWidth = op.r * 2; g.lineCap = "round"; g.lineJoin = "round";
    g.clip();
    const dx = op.sx - op.path[0][0], dy = op.sy - op.path[0][1];
    g.drawImage(tmp, dx, dy);
    g.restore();
    if (!fromReplay) { S.retouchOps.push(op); afterRetouchEdit("clone", op.r); }
  }

  /* ---------- adjustments + composite ---------- */
  function applyAdjustments() {
    const g = adjC.getContext("2d");
    g.clearRect(0, 0, srcW, srcH);
    g.drawImage(retC, 0, 0);
    const A = S.adj;
    if (!A.bright && !A.contrast && A.sat === 100 && !A.warm && !A.sharp) return;
    let img;
    try { img = g.getImageData(0, 0, srcW, srcH); } catch (e) { return; }
    const d = img.data;
    const br = A.bright * 1.2, co = 1 + A.contrast / 100, sat = A.sat / 100, wm = A.warm * 0.6;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i] + br + wm, gg = d[i + 1] + br, b = d[i + 2] + br - wm;
      r = (r - 128) * co + 128; gg = (gg - 128) * co + 128; b = (b - 128) * co + 128;
      if (sat !== 1) {
        const l = 0.299 * r + 0.587 * gg + 0.114 * b;
        r = l + (r - l) * sat; gg = l + (gg - l) * sat; b = l + (b - l) * sat;
      }
      d[i] = clamp(Math.round(r), 0, 255); d[i + 1] = clamp(Math.round(gg), 0, 255); d[i + 2] = clamp(Math.round(b), 0, 255);
    }
    g.putImageData(img, 0, 0);
    if (A.sharp > 0) {
      try {
        const blur = document.createElement("canvas"); blur.width = srcW; blur.height = srcH;
        const bg = blur.getContext("2d");
        bg.filter = "blur(2px)"; bg.drawImage(adjC, 0, 0); bg.filter = "none";
        const a = g.getImageData(0, 0, srcW, srcH), bd = bg.getImageData(0, 0, srcW, srcH);
        const k = (A.sharp / 100) * 0.9;
        for (let i = 0; i < a.data.length; i += 4) {
          a.data[i] = clamp(Math.round(a.data[i] + (a.data[i] - bd.data[i]) * k), 0, 255);
          a.data[i + 1] = clamp(Math.round(a.data[i + 1] + (a.data[i + 1] - bd.data[i + 1]) * k), 0, 255);
          a.data[i + 2] = clamp(Math.round(a.data[i + 2] + (a.data[i + 2] - bd.data[i + 2]) * k), 0, 255);
        }
        g.putImageData(a, 0, 0);
      } catch (e) {}
    }
  }
  function blurredMask(feather) {
    const t = document.createElement("canvas"); t.width = srcW; t.height = srcH;
    const g = t.getContext("2d");
    try { g.filter = feather > 0 ? "blur(" + feather + "px)" : "none"; } catch (e) {}
    g.drawImage(maskC, 0, 0);
    try { g.filter = "none"; } catch (e) {}
    try { return g.getImageData(0, 0, srcW, srcH); } catch (e) { return null; }
  }
  // full-frame base (retouch + adjustments) with the selection mask applied.
  // cutout shapes punched too unless skipCutouts. Returns a canvas srcW×srcH.
  /* ==================================================================
     §5 composite: base × mask, feather/contract, cutout snapshots, layer stack => result.
     ================================================================== */
  function maskedBaseCanvas(skipCutouts) {
    applyAdjustments();
    const bm = blurredMask(S.feather);
    let frame;
    try { frame = adjC.getContext("2d").getImageData(0, 0, srcW, srcH); }
    catch (e) { return null; }
    const fd = frame.data;
    const contract = S.contract / 100;
    if (bm) {
      const bd = bm.data;
      for (let i = 0, j = 0; i < fd.length; i += 4, j += 4) {
        let v = bd[j] / 255 - contract;
        v = clamp(v * 1.6 - 0.3, 0, 1);
        fd[i + 3] = Math.round(v * fd[i + 3]);
      }
    }
    if (!skipCutouts && S.cutouts.length) {
      const cm = cutoutMask();
      if (cm) {
        const cd = cm.data;
        for (let i = 0, j = 0; i < fd.length; i += 4, j += 4) {
          if (cd[j] > 10) fd[i + 3] = Math.round(fd[i + 3] * (1 - cd[j] / 255));
        }
      }
    }
    const out = document.createElement("canvas"); out.width = srcW; out.height = srcH;
    out.getContext("2d").putImageData(frame, 0, 0);
    return out;
  }
  // white = punched-out area (union of cutout shapes), blurred by feather
  function cutoutMask() {
    const t = document.createElement("canvas"); t.width = srcW; t.height = srcH;
    const g = t.getContext("2d");
    g.fillStyle = "#000"; g.fillRect(0, 0, srcW, srcH);
    g.fillStyle = "#fff";
    S.cutouts.forEach((c) => {
      if (!c) return;
      if (c.kind === "rect" && c.rect) fillRectNorm(g, c.rect);
      else if (c.kind === "poly" && c.pts && c.pts.length >= 3) { tracePolyPath(g, c.pts); g.fill(); }
    });
    try {
      const b = document.createElement("canvas"); b.width = srcW; b.height = srcH;
      const bg = b.getContext("2d");
      try { bg.filter = S.feather > 0 ? "blur(" + S.feather + "px)" : "none"; } catch (e) {}
      bg.drawImage(t, 0, 0);
      try { bg.filter = "none"; } catch (e) {}
      return bg.getImageData(0, 0, srcW, srcH);
    } catch (e) { return null; }
  }
  const layerImgCache = new Map();
  function layerImg(l) {
    if (!l) return null;
    let im = layerImgCache.get(l.id);
    if (im && im._url === l.dataUrl) return im;
    im = new Image();
    im._url = l.dataUrl; im._ready = false;
    im.onload = () => { im._ready = true; if (S.viewMode === "comp") composite(); renderEdit(); };
    im.src = l.dataUrl;
    layerImgCache.set(l.id, im);
    if (layerImgCache.size > 12) { const k = layerImgCache.keys().next().value; layerImgCache.delete(k); }
    return im;
  }
  function composite() {
    const view = G().$("cutView"); if (!view || !hasImage) return;
    popDirty.result = true;
    if (S.viewMode === "mask") {
      view.width = srcW; view.height = srcH;
      const g = view.getContext("2d");
      g.clearRect(0, 0, srcW, srcH);
      g.fillStyle = "#000"; g.fillRect(0, 0, srcW, srcH);
      try {
        const md = maskC.getContext("2d").getImageData(0, 0, srcW, srcH);
        const od = g.getImageData(0, 0, srcW, srcH);
        for (let i = 0; i < od.data.length; i += 4) {
          od.data[i] = od.data[i + 1] = od.data[i + 2] = md.data[i];
          od.data[i + 3] = 255;
        }
        g.putImageData(od, 0, 0);
      } catch (e) {}
      return;
    }
    if (S.viewMode === "base") {
      applyAdjustments();
      view.width = srcW; view.height = srcH;
      view.getContext("2d").drawImage(adjC, 0, 0);
      return;
    }
    const base = maskedBaseCanvas(false);
    if (!base) return;
    // crop to union of ADD boxes (legacy single-rect crop), full frame when inverse/none
    let cx = 0, cy = 0, cw = srcW, ch = srcH;
    if (!S.inverse) {
      const u = unionAddBBox();
      if (u) {
        cx = Math.round(u[0] * srcW); cy = Math.round(u[1] * srcH);
        cw = Math.max(1, Math.round(u[2] * srcW)); ch = Math.max(1, Math.round(u[3] * srcH));
      }
    }
    view.width = Math.max(1, cw); view.height = Math.max(1, ch);
    const g = view.getContext("2d");
    g.clearRect(0, 0, view.width, view.height);
    if (S.checker) {
      const s = 16;
      g.fillStyle = "#141c26"; g.fillRect(0, 0, view.width, view.height);
      g.fillStyle = "#0a0f16";
      for (let y = 0; y < view.height; y += s) for (let x = 0; x < view.width; x += s)
        if (((x / s) + (y / s)) % 2 < 1) g.fillRect(x, y, s, s);
    }
    g.drawImage(base, cx, cy, cw, ch, 0, 0, cw, ch);
    // layers on top (offset in px, opacity, blend)
    S.layers.forEach((l) => {
      if (l.on === false) return;
      const im = layerImg(l);
      if (!im || !im._ready) return;
      try {
        g.save();
        g.globalAlpha = clamp((+l.op == null ? 100 : +l.op) / 100, 0, 1);
        g.globalCompositeOperation = l.blend || "source-over";
        g.drawImage(im, cx - (+l.ox || 0), cy - (+l.oy || 0), cw, ch, 0, 0, cw, ch);
      } catch (e) {}
      g.restore();
    });
  }

  /* ---------- edge detect + snapping ---------- */
  /* ==================================================================
     §6 edge detection (Sobel) + magnetic snap + grid snap. Powers ⍈ snap + magnetic.
     ================================================================== */
  function ensureEdgeMap() {
    if (!srcC || !hasImage) return false;
    if (edgeMag && edgeW === srcW && edgeH === srcH) return true;
    try {
      const img = srcC.getContext("2d").getImageData(0, 0, srcW, srcH).data;
      const gw = srcW, gh = srcH;
      const gray = new Float32Array(gw * gh);
      for (let i = 0; i < gw * gh; i++) {
        gray[i] = 0.299 * img[i * 4] + 0.587 * img[i * 4 + 1] + 0.114 * img[i * 4 + 2];
      }
      const mag = new Uint8Array(gw * gh);
      for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
        const i = y * gw + x;
        const gx = -gray[i - gw - 1] - 2 * gray[i - 1] - gray[i + gw - 1] + gray[i - gw + 1] + 2 * gray[i + 1] + gray[i + gw + 1];
        const gy = -gray[i - gw - 1] - 2 * gray[i - gw] - gray[i - gw + 1] + gray[i + gw - 1] + 2 * gray[i + gw] + gray[i + gw + 1];
        const m = Math.sqrt(gx * gx + gy * gy);
        mag[i] = m > 255 ? 255 : m;
      }
      edgeMag = mag; edgeW = gw; edgeH = gh;
      const vis = document.createElement("canvas"); vis.width = gw; vis.height = gh;
      const vg = vis.getContext("2d");
      const vd = vg.createImageData(gw, gh);
      for (let i = 0; i < mag.length; i++) {
        const m = mag[i];
        vd.data[i * 4] = 94; vd.data[i * 4 + 1] = 200; vd.data[i * 4 + 2] = 255;
        vd.data[i * 4 + 3] = m < 40 ? 0 : clamp((m - 40) * 1.4, 0, 220);
      }
      vg.putImageData(vd, 0, 0);
      edgeVisC = vis;
      return true;
    } catch (e) { return false; }
  }
  function magnetic(nx, ny) {
    if (!edgeMag || edgeW !== srcW) { if (!ensureEdgeMap()) return [nx, ny]; }
    if (!edgeMag) return [nx, ny];
    const x = clamp(Math.round(nx * srcW), 0, srcW - 1), y = clamp(Math.round(ny * srcH), 0, srcH - 1);
    const R = clamp(Math.round(srcW * 0.028), 10, 26);
    let best = -1, bx = x, by = y, bd2 = Infinity;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 1 || yy < 1 || xx >= srcW - 1 || yy >= srcH - 1) continue;
      const m = edgeMag[yy * srcW + xx];
      if (m < 60) continue;
      const d2 = dx * dx + dy * dy;
      if (m > best + 20 || (Math.abs(m - best) <= 20 && d2 < bd2)) { best = m; bx = xx; by = yy; bd2 = d2; }
    }
    if (best < 0) return [nx, ny];
    return [clamp(bx / srcW, 0, 1), clamp(by / srcH, 0, 1)];
  }
  function snapGrid(nx, ny) {
    const n = clamp(S.gridN || 16, 4, 64);
    return [clamp(Math.round(nx * n) / n, 0, 1), clamp(Math.round(ny * n) / n, 0, 1)];
  }
  function applySnaps(nx, ny) {
    let sx = clamp(nx, 0, 1), sy = clamp(ny, 0, 1);
    if (S.gridSnap) { const s = snapGrid(sx, sy); sx = s[0]; sy = s[1]; }
    if (S.edgeSnap) { const m = magnetic(sx, sy); sx = m[0]; sy = m[1]; }
    return [sx, sy];
  }

  /* ---------- lasso + path point helpers ---------- */
  function activePolyPts() { const p = getActivePoly(); return p ? p.pts : null; }
  function lassoTarget() {
    if (lassoDraft.length) return lassoDraft;
    return activePolyPts() || [];
  }
  function lassoTargetKind() { return lassoDraft.length ? "draft" : "poly"; }
  function nearestVert(pts, x, y, radPx) {
    let bi = -1, bd = radPx * radPx;
    for (let i = 0; i < pts.length; i++) {
      const dx = pts[i][0] * srcW - x, dy = pts[i][1] * srcH - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bd) { bd = d2; bi = i; }
    }
    return bi;
  }
  function segDist(x, y, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
  }
  function nearestSegInsert(pts, x, y, radPx, closed) {
    if (pts.length < 2) return -1;
    const n = pts.length;
    const nSeg = closed ? n : n - 1;
    let bi = -1, bd = radPx;
    for (let i = 0; i < nSeg; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const d = segDist(x, y, a[0] * srcW, a[1] * srcH, b[0] * srcW, b[1] * srcH);
      if (d < bd) { bd = d; bi = (i + 1) % (n + 1); if (!closed && bi > n - 1) bi = i + 1; }
    }
    if (closed && bi === n) bi = n;
    return bi;
  }
  /* ==================================================================
     §7 path engine: active path, history/undo, trace, stroke, grid overlay, handles.
     ================================================================== */
  function getActivePath() {
    if (!S.paths.length) return null;
    return S.paths.find((p) => p.id === S.activePathId) || S.paths[0];
  }
  function ensureActivePath() {
    let p = getActivePath();
    if (p) return p;
    p = { id: "p" + Date.now().toString(36), name: "path " + (S.paths.length + 1), pts: [], closed: false, smooth: true };
    S.paths.push(p); S.activePathId = p.id; S.pathSel = -1;
    return p;
  }
  function pushPathHist() {
    try {
      pathHist.push(JSON.stringify({ paths: S.paths, active: S.activePathId }));
      if (pathHist.length > 40) pathHist.shift();
    } catch (e) {}
  }
  function undoPath() {
    const s = pathHist.pop();
    if (!s) { window.GateLog.log("info", "path: nothing to undo", null); return; }
    try {
      const o = JSON.parse(s);
      S.paths = Array.isArray(o.paths) ? o.paths : [];
      S.activePathId = o.active || (S.paths[0] && S.paths[0].id) || null;
      S.pathSel = -1;
      save(); paintPathBar(); paintCounts(); renderEdit();
      window.GateLog.log("cut", "path undo (" + S.paths.length + " paths)", null);
    } catch (e) {}
  }

  /* ---------- canvas paint ---------- */
  function applyAdjustmentsLight(g) { g.drawImage(adjC, 0, 0); }
  function strokePoly(g, pts, color, closeIt) {
    g.strokeStyle = color; g.lineWidth = 2; g.setLineDash([8, 5]);
    g.beginPath();
    pts.forEach(([px, py], i) => { i ? g.lineTo(px * srcW, py * srcH) : g.moveTo(px * srcW, py * srcH); });
    if (closeIt !== false) g.closePath();
    g.stroke(); g.setLineDash([]);
  }
  // Curved paths: Catmull-Rom through the anchors, so each anchor is a
  // bending pin. tracePath draws it, samplePathPts flattens the same curve
  // (normalized coords) so "use as selection" matches the drawing.
  function tracePath(g, p) {
    const pts = p.pts.map(([nx, ny]) => [nx * srcW, ny * srcH]);
    if (p.smooth !== false && pts.length >= 3) {
      const n = pts.length, closed = !!p.closed;
      const get = (i) => closed ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)];
      g.moveTo(pts[0][0], pts[0][1]);
      const segs = closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
        g.bezierCurveTo(
          p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
          p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
          p2[0], p2[1]);
      }
      if (closed) g.closePath();
    } else {
      pts.forEach(([x, y], i) => { i ? g.lineTo(x, y) : g.moveTo(x, y); });
      if (p.closed) g.closePath();
    }
  }
  function samplePathPts(p) {
    if (p.smooth === false || p.pts.length < 3) return p.pts.map((q) => [q[0], q[1]]);
    const pts = p.pts, n = pts.length, closed = !!p.closed;
    const get = (i) => closed ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)];
    const out = [], K = 10, segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
      for (let k = (i === 0 ? 0 : 1); k <= K; k++) {
        const t = k / K, t2 = t * t, t3 = t2 * t;
        out.push([
          0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
        ]);
      }
    }
    return out.map(([x, y]) => [clamp(x, 0, 1), clamp(y, 0, 1)]);
  }
  function drawGridOverlay(g) {
    const n = clamp(S.gridN || 16, 4, 64);
    g.save();
    g.strokeStyle = "rgba(94,200,255,.22)"; g.lineWidth = 1;
    for (let i = 1; i < n; i++) {
      const x = (i / n) * srcW;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, srcH); g.stroke();
      const y = (i / n) * srcH;
      g.beginPath(); g.moveTo(0, y); g.lineTo(srcW, y); g.stroke();
    }
    g.restore();
  }
  function drawHandles(g, pts, selIdx, color, big) {
    const r = big ? clamp(srcW * 0.028, 14, 26) : clamp(srcW * 0.016, 8, 16);
    pts.forEach(([px, py], i) => {
      const x = px * srcW, y = py * srcH;
      g.beginPath(); g.arc(x, y, i === selIdx ? r + 3 : r, 0, 7);
      g.fillStyle = i === selIdx ? "#ffcc55" : color;
      g.fill();
      g.lineWidth = 2; g.strokeStyle = "#0a0e12"; g.stroke();
      g.beginPath(); g.arc(x, y, i === selIdx ? r + 3 : r, 0, 7);
      g.strokeStyle = color; g.lineWidth = 1.5; g.stroke();
    });
  }
  /* ==================================================================
     §8 edit canvas: draws image + every box/poly (own color) + paths + overlays.
     ================================================================== */
  function renderEdit(t) {
    const c = G().$("cutEdit"); if (!c || !hasImage) return;
    popDirty.edit = true;
    const g = c.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    applyAdjustmentsLight(g);
    if (S.showEdges && edgeVisC) {
      try { g.save(); g.globalAlpha = 0.9; g.drawImage(edgeVisC, 0, 0); g.restore(); } catch (e) {}
    }
    if (S.overlay) {
      try {
        const md = maskC.getContext("2d").getImageData(0, 0, srcW, srcH);
        const ov = g.getImageData(0, 0, srcW, srcH);
        for (let i = 0; i < ov.data.length; i += 4) {
          if (md.data[i] < 128) {
            ov.data[i] = Math.round(ov.data[i] * 0.55 + 255 * 0.45);
            ov.data[i + 1] = Math.round(ov.data[i + 1] * 0.55 + 60 * 0.45);
            ov.data[i + 2] = Math.round(ov.data[i + 2] * 0.55 + 60 * 0.45);
          }
        }
        g.putImageData(ov, 0, 0);
      } catch (e) {}
    }
    if (S.showGrid) drawGridOverlay(g);
    // box selections — each with its own color; active gets handles
    S.rects.forEach((r) => {
      if (r.on === false) return;
      const b = rectPx(r);
      const active = r.id === S.activeRectId;
      if (!S.inverse && r.mode !== "sub") {
        g.fillStyle = "rgba(0,0,0,.45)";
        g.fillRect(0, 0, srcW, b.y); g.fillRect(0, b.y + b.h, srcW, srcH - b.y - b.h);
        g.fillRect(0, b.y, b.x, b.h);
        g.fillRect(b.x + b.w, b.y, srcW - b.x - b.w, b.h);
      } else if (r.mode === "sub") {
        g.fillStyle = "rgba(255,107,107,.14)";
        g.fillRect(b.x, b.y, b.w, b.h);
      } else if (S.inverse) {
        g.fillStyle = "rgba(255,159,67,.18)";
        g.fillRect(b.x, b.y, b.w, b.h);
      }
      if (window.GateSelect) window.GateSelect.drawBox(g, b.x, b.y, b.w, b.h, {
        color: r.mode === "sub" ? "#ff6b6b" : r.color, style: S.selStyle, t: t || 0,
        selected: active && S.tool === "rect", locked: S.cutLock, hs: handleRad(),
        dim: !active,
      });
      else { g.strokeStyle = r.color; g.lineWidth = 2; g.strokeRect(b.x, b.y, b.w, b.h); }
      if (S.inverse && active) {
        g.save();
        g.fillStyle = "#ff9f43"; g.font = "bold " + Math.max(12, srcW * 0.03) + "px monospace";
        g.fillText("INV", b.x + 6, b.y + 18);
        g.restore();
      }
    });
    // poly selections — each with its own color
    const actPoly = getActivePoly();
    S.polys.forEach((p) => {
      if (p.on === false || p.pts.length < 3) return;
      const active = actPoly && p.id === actPoly.id;
      const col = p.mode === "sub" ? "#ff6b6b" : p.color;
      strokePoly(g, p.pts, S.inverse ? "#ff9f43" : col);
      if (active && S.tool === "lasso" && S.lassoMode === "edit" && !lassoDraft.length) {
        drawHandles(g, p.pts, lassoSel, S.inverse ? "#ff9f43" : col, true);
      } else if (!active) {
        g.fillStyle = col;
        p.pts.forEach(([px, py]) => { g.beginPath(); g.arc(px * srcW, py * srcH, 3, 0, 7); g.fill(); });
      } else {
        g.fillStyle = S.inverse ? "#ff9f43" : col;
        p.pts.forEach(([px, py]) => { g.beginPath(); g.arc(px * srcW, py * srcH, 3.5, 0, 7); g.fill(); });
      }
    });
    // lasso draft (unapplied)
    if (lassoDraft.length) {
      const closed = lassoDraft.length >= 3;
      g.strokeStyle = "#ffcc55"; g.lineWidth = 2; g.setLineDash([6, 4]);
      g.beginPath();
      lassoDraft.forEach(([px, py], i) => { i ? g.lineTo(px * srcW, py * srcH) : g.moveTo(px * srcW, py * srcH); });
      if (closed) g.closePath();
      g.stroke(); g.setLineDash([]);
      if (S.tool === "lasso" && S.lassoMode === "edit") drawHandles(g, lassoDraft, lassoSel, "#ffcc55", true);
      else {
        g.fillStyle = "#ffcc55";
        lassoDraft.forEach(([px, py]) => { g.beginPath(); g.arc(px * srcW, py * srcH, 5, 0, 7); g.fill(); });
      }
      if (closed) {
        const [fx, fy] = lassoDraft[0];
        g.strokeStyle = "#ffcc55"; g.lineWidth = 2;
        g.beginPath(); g.arc(fx * srcW, fy * srcH, 10, 0, 7); g.stroke();
      }
    }
    // paths (curved ∿ when smooth — anchors are bending pins)
    S.paths.forEach((p) => {
      if (!p.pts.length) return;
      const active = getActivePath() && p.id === getActivePath().id;
      const col = active ? "#c792ea" : "rgba(199,146,234,.45)";
      if (p.pts.length >= 2) {
        g.strokeStyle = col; g.lineWidth = active ? 2.5 : 1.5;
        g.setLineDash(p.closed ? [] : [10, 6]);
        g.beginPath();
        tracePath(g, p);
        g.stroke(); g.setLineDash([]);
      } else {
        g.fillStyle = col;
        g.beginPath(); g.arc(p.pts[0][0] * srcW, p.pts[0][1] * srcH, 5, 0, 7); g.fill();
      }
      if (active && S.tool === "path") {
        if (S.pathMode === "edit") drawHandles(g, p.pts, S.pathSel, "#c792ea", true);
        else {
          g.fillStyle = "#c792ea";
          p.pts.forEach(([px, py]) => { g.beginPath(); g.arc(px * srcW, py * srcH, 5, 0, 7); g.fill(); });
        }
      }
    });
    if (S.cloneSrc) {
      g.strokeStyle = "#ffcc55"; g.lineWidth = 2;
      g.beginPath(); g.arc(S.cloneSrc[0] * srcW, S.cloneSrc[1] * srcH, 12, 0, 7); g.stroke();
      g.beginPath();
      g.moveTo(S.cloneSrc[0] * srcW - 18, S.cloneSrc[1] * srcH); g.lineTo(S.cloneSrc[0] * srcW + 18, S.cloneSrc[1] * srcH);
      g.moveTo(S.cloneSrc[0] * srcW, S.cloneSrc[1] * srcH - 18); g.lineTo(S.cloneSrc[0] * srcW, S.cloneSrc[1] * srcH + 18);
      g.stroke();
    }
    if (cursor && (S.tool === "keep" || S.tool === "cut" || S.tool === "heal" || S.tool === "clone")) {
      g.strokeStyle = S.tool === "keep" ? "#38e1a8" : S.tool === "cut" ? "#ff6b6b" : "#ffcc55";
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(cursor[0], cursor[1], (S.brushSize / 2) * (srcW / 480), 0, 7); g.stroke();
    }
  }
  function replayAll() {
    if (!hasImage) return;
    replayRetouch();
    applyAdjustments();
    replayMask();
    composite(); renderEdit();
  }
  const recompositeSoon = (() => {
    let t = 0;
    return () => { clearTimeout(t); t = setTimeout(() => { composite(); renderEdit(); }, 120); };
  })();

  /* ---------- edit events ---------- */
  function afterMaskEdit(kind, msg) {
    bump("actions");
    G().addXP(kind === "magic" ? 6 : 1, "cut " + kind);
    window.GateLog.log("cut", msg, null);
    composite(); renderEdit(); save(); paintCounts();
    G().emit("cut", { kind });
  }
  function afterRetouchEdit(kind, r) {
    replayRetouch(); applyAdjustments(); composite(); renderEdit(); save(); paintCounts();
    bump("actions");
    G().addXP(3, "cut retouch " + kind);
    window.GateLog.log("cut", "retouch " + kind + " (r" + Math.round(r) + ")", null);
    G().emit("cut", { kind: "retouch" });
  }
  function dabPoints(x0, y0, x1, y1, step) {
    const pts = [];
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(dist / (step || 4)));
    for (let i = 0; i <= n; i++) pts.push([x0 + (x1 - x0) * (i / n), y0 + (y1 - y0) * (i / n)]);
    return pts;
  }
  function cutBoxPx() { const r = getActiveRect(); if (!r) return null; const b = rectPx(r); return { x: b.x, y: b.y, w: b.w, h: b.h }; }
  function handleRad() { return Math.max(10, srcW * 0.025); }

  /* ==================================================================
     §8b edit interaction: touch/mouse down/move/up, hit-test, handles, brushes, clone.
     ================================================================== */
  function wireEdit() {
    const c = G().$("cutEdit"); if (!c) return;
    const pos = (e) => rel(e, c);
    c.style.touchAction = "none";
    c.onpointerdown = (e) => {
      if (!hasImage) return;
      try { c.setPointerCapture && c.setPointerCapture(e.pointerId); } catch (err) {}
      const [x, y] = pos(e);
      const rx = x / srcW, ry = y / srcH;
      if (S.tool === "rect") {
        if (S.cutLock) { window.GateLog.log("warn", "cut: selection locked — unlock to edit it", null); }
        else if (window.GateSelect) {
          const SEL = window.GateSelect;
          const rad = Math.max(handleRad(), touchRadPx(c) * 0.7);
          const A = getActiveRect();
          let done = false;
          if (A && A.on !== false) {
            const b = rectPx(A);
            const hit = SEL.hitHandle(SEL.handles(b.x, b.y, b.w, b.h), x, y, rad);
            if (hit) { rectDrag = { kind: "old", id: A.id, mode: hit, sb: { x: b.x, y: b.y, w: b.w, h: b.h }, px: x, py: y }; done = true; }
          }
          if (!done) {
            // topmost box under the pointer becomes active and moves
            const hitR = S.rects.slice().reverse().find((r) => r.on !== false && SEL.inBox(rectPx(r), x, y, 0));
            if (hitR) {
              const b = rectPx(hitR);
              S.activeRectId = hitR.id;
              rectDrag = { kind: "old", id: hitR.id, mode: "move", sb: { x: b.x, y: b.y, w: b.w, h: b.h }, ox: x - b.x, oy: y - b.y };
            } else {
              const nr = { id: "r" + Date.now().toString(36), r: [rx, ry, 0.02, 0.02], color: nextColor(), mode: "add", on: true };
              S.rects.push(nr); S.activeRectId = nr.id;
              rectDrag = { kind: "new", id: nr.id, mode: "new", x0: rx, y0: ry };
            }
          }
        } else rectDrag = { kind: "new", id: null, mode: "new", x0: rx, y0: ry };
      }
      else if (S.tool === "lasso") {
        const rad = touchRadPx(c);
        if (S.lassoMode === "edit") {
          // EDIT: never add on empty touch — only grab/move existing points
          const tgt = lassoTarget();
          if (!tgt.length) { window.GateLog.log("info", "lasso edit: nothing to edit — switch to + add pts", null); return; }
          const vi = nearestVert(tgt, x, y, rad);
          if (vi >= 0) {
            lassoSel = vi; lassoDrag = { idx: vi, pid: lassoDraft.length ? null : (getActivePoly() && getActivePoly().id) };
            renderEdit(); paintLassoBar();
          } else {
            const ins = nearestSegInsert(tgt, x, y, rad * 0.8, true);
            if (ins >= 0) {
              const s = applySnaps(rx, ry);
              tgt.splice(clamp(ins, 0, tgt.length), 0, s);
              lassoSel = clamp(ins, 0, tgt.length - 1); lassoDrag = { idx: lassoSel, pid: lassoDraft.length ? null : (getActivePoly() && getActivePoly().id) };
              renderEdit(); paintLassoBar();
            } else { lassoSel = -1; renderEdit(); paintLassoBar(); }
          }
        } else {
          // DRAW: tap adds, drag draws freehand, tap-near-start closes
          const s = applySnaps(rx, ry);
          if (lassoDraft.length >= 3) {
            const [fx, fy] = lassoDraft[0];
            if (Math.hypot((s[0] - fx) * srcW, (s[1] - fy) * srcH) < Math.max(14, rad * 0.7)) { applyLasso(); return; }
          }
          lassoDraft.push(s); lassoSel = lassoDraft.length - 1; lassoDrawDown = true;
          renderEdit(); paintLassoBar();
        }
      }
      else if (S.tool === "path") {
        const P = ensureActivePath();
        const rad = touchRadPx(c);
        if (S.pathMode === "edit") {
          if (!P.pts.length) { window.GateLog.log("info", "path edit: nothing to edit — switch to + add", null); return; }
          const vi = nearestVert(P.pts, x, y, rad);
          if (vi >= 0) { S.pathSel = vi; pathDrag = { idx: vi, pushed: false }; renderEdit(); paintPathBar(); paintNudge(); }
          else {
            const ins = nearestSegInsert(P.pts, x, y, rad * 0.8, P.closed);
            if (ins >= 0) {
              pushPathHist();
              const s = applySnaps(rx, ry);
              P.pts.splice(clamp(ins, 0, P.pts.length), 0, s);
              S.pathSel = clamp(ins, 0, P.pts.length - 1); pathDrag = { idx: S.pathSel, pushed: true };
              renderEdit(); paintPathBar(); paintNudge(); save();
            } else {
              // empty grab: drag moves the whole path freely; a tap (no drag) deselects
              pathMove = { x0: x, y0: y, moved: false, orig: null };
            }
          }
        } else {
          pushPathHist();
          const s = applySnaps(rx, ry);
          if (P.pts.length >= 3 && !P.closed) {
            const [fx, fy] = P.pts[0];
            if (Math.hypot((s[0] - fx) * srcW, (s[1] - fy) * srcH) < Math.max(14, rad * 0.7)) {
              P.closed = true; pathDrawDown = false; save(); renderEdit(); paintPathBar();
              window.GateLog.log("cut", "path closed (" + P.pts.length + " pts)", null);
              return;
            }
          }
          P.pts.push(s); S.pathSel = P.pts.length - 1; pathDrawDown = true;
          renderEdit(); paintPathBar();
        }
      }
      else if (S.tool === "keep" || S.tool === "cut") {
        brushDown = { mode: S.tool, size: S.brushSize, hard: S.hardness, pts: [[rx, ry]], last: [x, y] };
        paintLiveDab(x, y);
      }
      else if (S.tool === "magic") { pickAndMagic(x, y); }
      else if (S.tool === "heal") {
        const r = (S.brushSize / 2) * (srcW / 480);
        paintHeal(retC.getContext("2d"), { k: "heal", x, y, r: Math.max(4, r) }, false);
      }
      else if (S.tool === "clone") {
        if (e.altKey || window.GateCut._armSource) {
          S.cloneSrc = [rx, ry]; window.GateCut._armSource = false;
          renderEdit(); save(); paintTool();
          window.GateLog.log("cut", "clone source set", null);
        } else if (S.cloneSrc) {
          const r = Math.max(4, (S.brushSize / 2) * (srcW / 480));
          cloneStroke = { k: "clone", sx: S.cloneSrc[0] * srcW, sy: S.cloneSrc[1] * srcH, r, path: [[x, y]] };
        } else {
          window.GateLog.log("warn", "clone: alt-click (or 'set source') to pick a source first", null);
        }
      }
    };
    c.onpointermove = (e) => {
      if (!hasImage) return;
      const [x, y] = pos(e);
      cursor = [x, y];
      if (rectDrag) {
        const SEL = window.GateSelect;
        const R = S.rects.find((q) => q.id === rectDrag.id);
        const applyR = (nx, ny, nw, nh) => {
          if (R) R.r = [clamp(nx, 0, 1 - nw), clamp(ny, 0, 1 - nh), clamp(nw, 0.02, 1), clamp(nh, 0.02, 1)];
        };
        if (rectDrag.mode === "new") {
          const rx = x / srcW, ry = y / srcH;
          const nx = Math.min(rectDrag.x0, rx), ny = Math.min(rectDrag.y0, ry);
          applyR(nx, ny, Math.abs(rx - rectDrag.x0), Math.abs(ry - rectDrag.y0));
        } else if (rectDrag.mode === "move") {
          const w = rectDrag.sb.w / srcW, h = rectDrag.sb.h / srcH;
          applyR((x - rectDrag.ox) / srcW, (y - rectDrag.oy) / srcH, w, h);
        } else if (SEL) {
          const b = { x: rectDrag.sb.x, y: rectDrag.sb.y, w: rectDrag.sb.w, h: rectDrag.sb.h };
          SEL.applyDrag(b, rectDrag.mode, rectDrag.sb, x - rectDrag.px, y - rectDrag.py, Math.max(8, srcW * 0.02));
          applyR(b.x / srcW, b.y / srcH, b.w / srcW, b.h / srcH);
        }
        S.activeRectId = rectDrag.id;
        renderEdit();
      } else if (S.tool === "lasso" && lassoDrawDown && S.lassoMode === "draw") {
        const last = lassoDraft[lassoDraft.length - 1];
        const lx = last[0] * srcW, ly = last[1] * srcH;
        const minD = Math.max(6, srcW * 0.015);
        if (Math.hypot(x - lx, y - ly) >= minD) {
          const s = applySnaps(x / srcW, y / srcH);
          lassoDraft.push(s); lassoSel = lassoDraft.length - 1;
          renderEdit();
        } else renderEdit();
      } else if (S.tool === "lasso" && lassoDrag && S.lassoMode === "edit") {
        const tgt = lassoDrag.pid ? ((S.polys.find((p) => p.id === lassoDrag.pid) || {}).pts || []) : lassoDraft;
        if (tgt[lassoDrag.idx]) {
          const s = applySnaps(x / srcW, y / srcH);
          tgt[lassoDrag.idx] = s; lassoSel = lassoDrag.idx;
          renderEdit(); // mask replays on release for smooth touch drags
        }
      } else if (S.tool === "path" && pathDrawDown && S.pathMode === "draw") {
        const P = getActivePath(); if (P) {
          const last = P.pts[P.pts.length - 1];
          if (last) {
            const minD = Math.max(6, srcW * 0.015);
            if (Math.hypot(x - last[0] * srcW, y - last[1] * srcH) >= minD) {
              P.pts.push(applySnaps(x / srcW, y / srcH)); S.pathSel = P.pts.length - 1;
              renderEdit();
            } else renderEdit();
          }
        }
      } else if (S.tool === "path" && pathDrag && S.pathMode === "edit") {
        const P = getActivePath();
        if (P && P.pts[pathDrag.idx]) {
          if (!pathDrag.pushed) { pushPathHist(); pathDrag.pushed = true; }
          P.pts[pathDrag.idx] = applySnaps(x / srcW, y / srcH);
          S.pathSel = pathDrag.idx; renderEdit();
        }
      } else if (S.tool === "path" && pathMove && S.pathMode === "edit") {
        const P = getActivePath();
        if (P && P.pts.length) {
          const dx = x - pathMove.x0, dy = y - pathMove.y0;
          if (!pathMove.moved && Math.hypot(dx, dy) > 3) {
            pushPathHist(); pathMove.moved = true;
            pathMove.orig = P.pts.map((q) => [q[0], q[1]]);
          }
          if (pathMove.moved) {
            const ox = dx / srcW, oy = dy / srcH;
            P.pts = pathMove.orig.map(([nx, ny]) => [clamp(nx + ox, 0, 1), clamp(ny + oy, 0, 1)]);
          }
          renderEdit();
        }
      } else if (brushDown) {
        dabPoints(brushDown.last[0], brushDown.last[1], x, y).forEach(([dx, dy]) => {
          brushDown.pts.push([dx / srcW, dy / srcH]);
          paintLiveDab(dx, dy);
        });
        brushDown.last = [x, y];
      } else if (cloneStroke) {
        const [lx, ly] = cloneStroke.path[cloneStroke.path.length - 1];
        dabPoints(lx, ly, x, y).forEach(([dx, dy]) => cloneStroke.path.push([dx, dy]));
        previewCloneStroke();
      } else renderEdit();
    };
    const up = () => {
      if (rectDrag) {
        const R = S.rects.find((q) => q.id === rectDrag.id);
        if (R && (R.r[2] < 0.02 || R.r[3] < 0.02) && rectDrag.mode === "new") {
          S.rects = S.rects.filter((q) => q.id !== R.id);
          if (S.activeRectId === R.id) S.activeRectId = S.rects.length ? S.rects[S.rects.length - 1].id : null;
        } else if (R) {
          R.r = [clamp(R.r[0], 0, 1 - R.r[2]), clamp(R.r[1], 0, 1 - R.r[3]), clamp(R.r[2], 0.02, 1), clamp(R.r[3], 0.02, 1)];
          S.activeRectId = R.id;
        }
        delete S._newRect;
        const wasNew = rectDrag.mode === "new";
        rectDrag = null;
        bump("actions"); G().addXP(3, "cut rect");
        window.GateLog.log("cut", R && S.rects.includes(R) ? "box " + (wasNew ? "added" : "reshaped") + " (" + S.rects.length + " boxes" + (S.inverse ? ", INV" : "") + ")" : "box cleared", null);
        composite(); renderEdit(); save(); paintCounts(); paintRects();
        G().emit("cut", { kind: "rect" });
      }
      if (lassoDrawDown) { lassoDrawDown = false; paintLassoBar(); }
      if (lassoDrag) {
        const pid = lassoDrag.pid;
        lassoDrag = null;
        if (pid) {
          replayMask(); composite(); save(); paintCounts(); paintRects(); paintPolys();
          const P = S.polys.find((q) => q.id === pid);
          window.GateLog.log("cut", "lasso point moved (" + (P ? P.pts.length : 0) + " pts)", null);
        } else renderEdit();
        paintLassoBar();
      }
      if (pathDrawDown) { pathDrawDown = false; save(); paintPathBar(); }
      if (pathDrag) { pathDrag = null; save(); paintPathBar(); paintNudge(); renderEdit(); }
      if (pathMove) {
        const moved = pathMove.moved; pathMove = null;
        if (moved) {
          save(); paintPathBar(); paintNudge(); paintCounts(); renderEdit();
          window.GateLog.log("cut", "path moved", null);
        } else { S.pathSel = -1; renderEdit(); paintPathBar(); paintNudge(); }
      }
      if (brushDown) {
        const st = { mode: brushDown.mode, size: brushDown.size, hard: brushDown.hard, pts: brushDown.pts };
        brushDown = null;
        S.strokes.push(st); hist.push({ k: "stroke", ref: st });
        replayMask();
        afterMaskEdit(st.mode === "keep" ? "keep" : "cut", "mask brush '" + st.mode + "' (" + st.pts.length + " dabs, r" + st.size + ")");
      }
      if (cloneStroke) {
        const op = cloneStroke; cloneStroke = null;
        replayRetouch();
        paintClone(retC.getContext("2d"), op, false);
      }
    };
    c.onpointerup = up;
    c.onpointercancel = () => { brushDown = null; rectDrag = null; cloneStroke = null; lassoDrawDown = false; lassoDrag = null; pathDrawDown = false; pathDrag = null; pathMove = null; replayAll(); };
    c.onmouseleave = () => { cursor = null; if (!brushDown && !cloneStroke && !lassoDrag && !pathDrag) renderEdit(); };
    c.ondblclick = () => {
      if (S.tool === "lasso" && S.lassoMode === "draw" && lassoDraft.length >= 3) applyLasso();
      else if (S.tool === "path" && S.pathMode === "draw") {
        const P = getActivePath();
        if (P && P.pts.length >= 3 && !P.closed) { P.closed = true; save(); renderEdit(); paintPathBar(); }
      }
    };
  }
  function paintLiveDab(x, y) {
    const g = maskC.getContext("2d");
    const r = (brushDown.size / 2) * (srcW / 480);
    g.save();
    g.globalCompositeOperation = "source-over";
    softBrush(g, x, y, r, brushDown.hard, brushDown.mode === "keep" ? [255, 255, 255] : [0, 0, 0]);
    g.restore();
    composite(); renderEdit();
  }
  function previewCloneStroke() {
    replayRetouch();
    const g = retC.getContext("2d");
    const tmp = document.createElement("canvas"); tmp.width = srcW; tmp.height = srcH;
    tmp.getContext("2d").drawImage(retC, 0, 0);
    g.save();
    g.beginPath();
    cloneStroke.path.forEach(([px, py], i) => { i ? g.lineTo(px, py) : g.moveTo(px, py); });
    g.lineWidth = cloneStroke.r * 2; g.lineCap = "round"; g.lineJoin = "round"; g.clip();
    g.drawImage(tmp, cloneStroke.sx - cloneStroke.path[0][0], cloneStroke.sy - cloneStroke.path[0][1]);
    g.restore();
    applyAdjustments(); composite(); renderEdit();
  }
  /* ==================================================================
     §9 lasso close => new poly; nudge pad; magic picker; parts ratio.
     ================================================================== */
  function applyLasso() {
    const p = { id: "q" + Date.now().toString(36), pts: lassoDraft.slice(), color: nextColor(), mode: "add", on: true };
    S.polys.push(p); S.activePolyId = p.id;
    lassoDraft = []; lassoSel = -1;
    replayMask();
    bump("actions"); G().addXP(4, "cut lasso");
    window.GateLog.log("cut", "lasso closed (" + p.pts.length + " pts → poly " + S.polys.length + ") — " + (S.inverse ? "outside kept (inverse)" : "inside kept"), null);
    composite(); renderEdit(); save(); paintCounts(); paintLassoBar(); paintPolys();
    G().emit("cut", { kind: "lasso" });
  }
  /* ---------- precision nudge pad (1px tap · 5px double-tap) ---------- */
  function nudgeTarget() {
    if (S.tool === "path") {
      const P = getActivePath();
      if (P && S.pathSel >= 0 && P.pts[S.pathSel]) return { kind: "path", pts: P.pts, idx: S.pathSel };
    } else if (S.tool === "lasso") {
      const tgt = lassoTarget();
      if (lassoSel >= 0 && tgt[lassoSel]) return { kind: "lasso", kind2: lassoTargetKind(), pts: tgt, idx: lassoSel };
    }
    return null;
  }
  function nudgeSel(dxPx, dyPx) {
    const t = nudgeTarget();
    if (!t) { window.GateLog.log("info", "nudge: select a point in edit mode first", null); return; }
    const [nx, ny] = t.pts[t.idx];
    const sx = clamp(Math.round(nx * srcW) + dxPx, 0, srcW - 1) / srcW;
    const sy = clamp(Math.round(ny * srcH) + dyPx, 0, srcH - 1) / srcH;
    if (t.kind === "path") { pushPathHist(); t.pts[t.idx] = [sx, sy]; save(); paintPathBar(); }
    else {
      t.pts[t.idx] = [sx, sy];
      if (t.kind2 === "poly") { replayMask(); composite(); save(); paintCounts(); }
      else renderEdit();
      paintLassoBar();
    }
    renderEdit(); paintNudge();
  }
  const nudgeTap = {};
  function wireNudge(id, dx, dy) {
    const b = G().$(id); if (!b) return;
    b.onclick = () => {
      const now = Date.now();
      const step = (now - (nudgeTap[id] || 0) < 320) ? 5 : 1;
      nudgeTap[id] = now;
      nudgeSel(dx * step, dy * step);
    };
  }
  function paintNudge() {
    const pad = G().$("cutNudgePad"); if (!pad) return;
    const show = hasImage && (S.tool === "lasso" || S.tool === "path");
    pad.hidden = !show;
    if (!show) return;
    const t = nudgeTarget();
    const info = G().$("cutNudgeInfo");
    if (info) info.textContent = t ? ("#" + (t.idx + 1) + " · tap 1px · double-tap 5px") : "select a point in edit mode";
    ["cutNudgeL", "cutNudgeU", "cutNudgeD", "cutNudgeR"].forEach((bid) => { const b = G().$(bid); if (b) b.disabled = !t; });
  }
  function pickAndMagic(x, y) {    try {
      const px = srcC.getContext("2d").getImageData(clamp(Math.round(x), 0, srcW - 1), clamp(Math.round(y), 0, srcH - 1), 1, 1).data;
      const hex = "#" + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
      S.magicColor = hex;
      const inp = G().$("cutMagicColor"); if (inp) inp.value = hex;
      applyMagicOp({ color: hex, tol: S.tolerance }, false);
    } catch (e) { window.GateLog.log("error", "cut: magic pick failed", null); }
  }

  /* ---------- parts grid ---------- */
  function partRatio(w, h) { const d = gcd(w, h); return Math.round(w / d) + ":" + Math.round(h / d); }
  /* ==================================================================
     §10 parts grid: node per cut (element/asset/piece/object), scale, zoom, edit-back.
     ================================================================== */
  function sendToGrid() {
    if (!hasImage) { window.GateLog.log("warn", "grid: load an image first", null); return; }
    if (parts.length >= MAX_PARTS) { window.GateLog.log("warn", "grid: full (" + MAX_PARTS + " nodes) — delete one first", null); return; }
    composite();
    const view = G().$("cutView");
    if (!view || !view.width) return;
    const sc = Math.min(1, PART_MAXD / Math.max(view.width, view.height));
    const tw = Math.max(1, Math.round(view.width * sc)), th = Math.max(1, Math.round(view.height * sc));
    const t = document.createElement("canvas"); t.width = tw; t.height = th;
    t.getContext("2d").drawImage(view, 0, 0, tw, th);
    let url = "";
    try { url = t.toDataURL("image/png"); }
    catch (e) { window.GateLog.log("error", "grid: could not read cut", null); return; }
    const n = parts.length + 1;
    const kindEl = G().$("partKindSel");
    parts.push({
      id: "g" + Date.now().toString(36), name: "part " + n, dataUrl: url,
      kind: kindEl ? kindEl.value || "element" : "element",
      w: view.width, h: view.height, tw, th,
      ratio: partRatio(view.width, view.height),
      keptPct: maskKeptPct(), scaleW: 100, scaleH: 100, lock: true,
      feather: S.feather, contract: S.contract, inverse: !!S.inverse,
      createdAt: Date.now(), srcW, srcH,
    });
    saveParts(); paintParts(); paintCounts();
    bump("actions"); G().addXP(5, "cut to grid");
    window.GateLog.log("cut", "sent to grid as node (" + view.width + "x" + view.height + " · " + partRatio(view.width, view.height) + ")", null);
    G().emit("cut", { kind: "grid" });
  }
  function exportPart(id) {
    const p = parts.find((q) => q.id === id); if (!p) return;
    const img = new Image();
    img.onload = () => {
      const ow = Math.max(1, Math.round(p.tw * (p.scaleW / 100))), oh = Math.max(1, Math.round(p.th * (p.scaleH / 100)));
      const c = document.createElement("canvas"); c.width = ow; c.height = oh;
      c.getContext("2d").drawImage(img, 0, 0, ow, oh);
      c.toBlob((b) => {
        if (!b) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b); a.download = (p.name || "part").replace(/[^\w\-]+/g, "-") + ".png"; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      });
      bump("exports"); G().addXP(6, "grid export");
      window.GateLog.log("cut", "grid node exported: " + p.name + " (" + ow + "x" + oh + ")", null);
    };
    img.src = p.dataUrl;
  }
  function editPartBack(id) {
    const p = parts.find((q) => q.id === id); if (!p) return;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      clearMaskState();
      S.feather = p.feather != null ? p.feather : S.feather;
      S.contract = p.contract != null ? p.contract : S.contract;
      setSource(c, p.name + " (grid refine)");
      syncInputs();
      window.GateLog.log("cut", "grid node reloaded for refinement: " + p.name, null);
    };
    img.onerror = () => window.GateLog.log("error", "grid: could not reload node", null);
    img.src = p.dataUrl;
  }
  function paintParts() {
    const grid = G().$("cutPartsGrid"); if (!grid) return;
    const info = G().$("cutPartsInfo");
    const zoom = clamp(S.gridZoom || 128, 72, 240);
    grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(" + Math.max(150, zoom) + "px, 1fr))";
    grid.innerHTML = "";
    const filtEl = G().$("partFilterSel");
    const filt = filtEl ? filtEl.value || "" : "";
    const shown = filt ? parts.filter((p) => (p.kind || "element") === filt) : parts;
    if (!parts.length) {
      grid.innerHTML = '<div class="kv">empty — cut something, then “send cut to grid”. Each node keeps its own size · aspect · scale.</div>';
    } else {
      if (!shown.length) grid.innerHTML = '<div class="kv">nothing saved as ' + filt + ' yet.</div>';
      shown.forEach((p) => {
        const card = document.createElement("div");
        card.className = "part-card";
        const img = document.createElement("img");
        img.src = p.dataUrl; img.alt = p.name;
        img.style.height = zoom + "px";
        card.appendChild(img);
        const name = document.createElement("input");
        name.className = "pname"; name.value = p.name || "part"; name.setAttribute("aria-label", "node name");
        name.onchange = () => { p.name = name.value.slice(0, 60) || "part"; saveParts(); paintParts(); };
        card.appendChild(name);
        const badge = document.createElement("span");
        badge.className = "kind-tag"; badge.textContent = p.kind || "element";
        badge.style.cursor = "pointer"; badge.title = "tap to change kind";
        badge.onclick = () => {
          const order = ["element", "asset", "piece", "object"];
          p.kind = order[(order.indexOf(p.kind || "element") + 1) % order.length];
          saveParts(); paintParts();
        };
        card.appendChild(badge);
        const ow = Math.max(1, Math.round(p.tw * (p.scaleW / 100))), oh = Math.max(1, Math.round(p.th * (p.scaleH / 100)));
        const meta = document.createElement("div");
        meta.className = "pmeta";
        const date = new Date(p.createdAt || Date.now());
        meta.textContent = p.w + "x" + p.h + " · " + (p.ratio || partRatio(p.w, p.h)) +
          " · kept " + (p.keptPct != null ? p.keptPct : "?") + "%" +
          (p.inverse ? " · INV" : "") +
          "\n→ " + ow + "x" + oh + " @ " + p.scaleW + "%" + (p.scaleW === p.scaleH ? "" : " / " + p.scaleH + "%") +
          " · " + date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        card.appendChild(meta);
        const mkSlider = (label, val, fn) => {
          const lab = document.createElement("label");
          lab.className = "pscale";
          lab.textContent = label + " ";
          const r = document.createElement("input");
          r.type = "range"; r.min = "10"; r.max = "200"; r.value = String(val);
          const out = document.createElement("span");
          out.textContent = " " + val + "%";
          r.oninput = () => { fn(Number(r.value)); out.textContent = " " + r.value + "%"; };
          r.onchange = () => { saveParts(); paintParts(); };
          lab.appendChild(r); lab.appendChild(out);
          return lab;
        };
        card.appendChild(mkSlider("w", p.scaleW, (v) => {
          p.scaleW = clamp(v, 10, 200);
          if (p.lock) p.scaleH = p.scaleW;
        }));
        card.appendChild(mkSlider("h", p.scaleH, (v) => {
          p.scaleH = clamp(v, 10, 200);
          if (p.lock) p.scaleW = p.scaleH;
        }));
        const lockRow = document.createElement("label");
        lockRow.className = "kv";
        const lock = document.createElement("input");
        lock.type = "checkbox"; lock.checked = !!p.lock;
        lock.onchange = () => {
          p.lock = lock.checked;
          if (p.lock) p.scaleH = p.scaleW;
          saveParts(); paintParts();
        };
        lockRow.appendChild(lock);
        lockRow.appendChild(document.createTextNode(" lock proportions"));
        card.appendChild(lockRow);
        const row = document.createElement("div");
        row.className = "prow";
        const bE = document.createElement("button"); bE.className = "small"; bE.textContent = "export";
        bE.onclick = () => exportPart(p.id);
        const bR = document.createElement("button"); bR.className = "small"; bR.textContent = "edit";
        bR.title = "reload this node for further refinement";
        bR.onclick = () => editPartBack(p.id);
        const bD = document.createElement("button"); bD.className = "small danger"; bD.textContent = "✖";
        bD.onclick = () => {
          parts = parts.filter((q) => q.id !== p.id);
          saveParts(); paintParts(); paintCounts();
          window.GateLog.log("cut", "grid node deleted: " + p.name, null);
        };
        row.appendChild(bE); row.appendChild(bR); row.appendChild(bD);
        card.appendChild(row);
        grid.appendChild(card);
      });
    }
    if (info) {
      const kb = Math.round(parts.reduce((a, p) => a + (p.dataUrl || "").length, 0) * 0.75 / 1024);
      info.textContent = parts.length + " node" + (parts.length === 1 ? "" : "s") + (kb ? " · ~" + kb + "KB" : "");
    }
  }

  /* ---------- selections lists ---------- */
  /* ==================================================================
     §11 selections panel: multi-box + multi-poly rows (color/mode/on/dup/del).
     ================================================================== */
  function paintRects() {
    const box = G().$("rectList"); if (!box) return;
    box.innerHTML = "";
    const info = G().$("selCountEl");
    if (info) info.textContent = S.rects.length + " boxes · " + S.polys.length + " polys · " + S.layers.length + " layers";
    if (!S.rects.length) { box.innerHTML = '<div class="kv">no boxes — drag on the canvas with ▦ rect.</div>'; return; }
    S.rects.forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "sel-row" + (r.id === S.activeRectId ? " active" : "");
      const dot = document.createElement("span");
      dot.className = "dot"; dot.style.background = r.color;
      dot.title = "make active";
      dot.style.cursor = "pointer";
      dot.onclick = () => { S.activeRectId = r.id; save(); paintRects(); renderEdit(); };
      row.appendChild(dot);
      const nm = document.createElement("span"); nm.className = "nm";
      nm.textContent = "box " + (i + 1) + " · " + Math.round(r.r[2] * srcW) + "x" + Math.round(r.r[3] * srcH);
      row.appendChild(nm);
      const col = document.createElement("input");
      col.type = "color"; col.value = r.color; col.setAttribute("aria-label", "box color");
      col.oninput = (e) => { r.color = e.target.value; dot.style.background = r.color; renderEdit(); };
      col.onchange = () => save();
      row.appendChild(col);
      const mode = document.createElement("button"); mode.className = "small";
      mode.textContent = r.mode === "sub" ? "－ out" : "＋ keep";
      mode.title = "add to kept area vs cut out";
      mode.onclick = () => { r.mode = r.mode === "sub" ? "add" : "sub"; replayMask(); composite(); save(); paintCounts(); paintRects(); renderEdit(); };
      row.appendChild(mode);
      const on = document.createElement("label"); on.className = "kv";
      const chk = document.createElement("input"); chk.type = "checkbox"; chk.checked = r.on !== false;
      chk.onchange = () => { r.on = chk.checked; replayMask(); composite(); save(); paintCounts(); paintRects(); renderEdit(); };
      on.appendChild(chk); on.appendChild(document.createTextNode(" on"));
      row.appendChild(on);
      const del = document.createElement("button"); del.className = "small danger"; del.textContent = "✖";
      del.onclick = () => {
        S.rects = S.rects.filter((q) => q.id !== r.id);
        if (S.activeRectId === r.id) S.activeRectId = S.rects.length ? S.rects[0].id : null;
        replayMask(); composite(); save(); paintCounts(); paintRects(); renderEdit();
        window.GateLog.log("cut", "box deleted (" + S.rects.length + " left)", null);
      };
      row.appendChild(del);
      box.appendChild(row);
    });
  }
  function paintPolys() {
    const box = G().$("polyList"); if (!box) return;
    box.innerHTML = "";
    const info = G().$("selCountEl");
    if (info) info.textContent = S.rects.length + " boxes · " + S.polys.length + " polys · " + S.layers.length + " layers";
    if (!S.polys.length) { box.innerHTML = '<div class="kv">no polys — close a lasso, use ◎ subject, or → selection from a path.</div>'; return; }
    S.polys.forEach((p, i) => {
      const row = document.createElement("div");
      row.className = "sel-row" + (p.id === S.activePolyId ? " active" : "");
      const dot = document.createElement("span");
      dot.className = "dot"; dot.style.background = p.color;
      dot.title = "make active (editable)";
      dot.style.cursor = "pointer";
      dot.onclick = () => { S.activePolyId = p.id; lassoSel = -1; save(); paintPolys(); renderEdit(); paintNudge(); };
      row.appendChild(dot);
      const nm = document.createElement("span"); nm.className = "nm";
      nm.textContent = "poly " + (i + 1) + " · " + p.pts.length + " pts";
      row.appendChild(nm);
      const col = document.createElement("input");
      col.type = "color"; col.value = p.color; col.setAttribute("aria-label", "poly color");
      col.oninput = (e) => { p.color = e.target.value; dot.style.background = p.color; renderEdit(); };
      col.onchange = () => save();
      row.appendChild(col);
      const mode = document.createElement("button"); mode.className = "small";
      mode.textContent = p.mode === "sub" ? "－ out" : "＋ keep";
      mode.title = "add to kept area vs cut out";
      mode.onclick = () => { p.mode = p.mode === "sub" ? "add" : "sub"; replayMask(); composite(); save(); paintCounts(); paintPolys(); renderEdit(); };
      row.appendChild(mode);
      const on = document.createElement("label"); on.className = "kv";
      const chk = document.createElement("input"); chk.type = "checkbox"; chk.checked = p.on !== false;
      chk.onchange = () => { p.on = chk.checked; replayMask(); composite(); save(); paintCounts(); paintPolys(); renderEdit(); };
      on.appendChild(chk); on.appendChild(document.createTextNode(" on"));
      row.appendChild(on);
      const del = document.createElement("button"); del.className = "small danger"; del.textContent = "✖";
      del.onclick = () => {
        S.polys = S.polys.filter((q) => q.id !== p.id);
        if (S.activePolyId === p.id) { S.activePolyId = S.polys.length ? S.polys[0].id : null; lassoSel = -1; }
        replayMask(); composite(); save(); paintCounts(); paintPolys(); renderEdit(); paintNudge();
        window.GateLog.log("cut", "poly deleted (" + S.polys.length + " left)", null);
      };
      row.appendChild(del);
      box.appendChild(row);
    });
  }

  /* ---------- layers ---------- */
  let layerHist = [];
  /* ==================================================================
     §12 layer ops: copy/cut→layer, undo, blend/offset/order, layer list UI.
     ================================================================== */
  function pushLayerHist() {
    try {
      layerHist.push(JSON.stringify({ layers: S.layers, cutouts: S.cutouts, active: S.activeLayerId }));
      if (layerHist.length > 8) layerHist.shift();
    } catch (e) {}
  }
  function undoLayer() {
    const s = layerHist.pop();
    if (!s) { window.GateLog.log("info", "layers: nothing to undo", null); return; }
    try {
      const o = JSON.parse(s);
      S.layers = Array.isArray(o.layers) ? o.layers : [];
      S.cutouts = Array.isArray(o.cutouts) ? o.cutouts : [];
      S.activeLayerId = o.active || (S.layers[0] && S.layers[0].id) || null;
      save(); paintLayers(); paintCounts(); composite(); renderEdit();
      window.GateLog.log("cut", "layer undo (" + S.layers.length + " layers)", null);
    } catch (e) {}
  }
  function getActiveLayer() { return S.layers.find((l) => l.id === S.activeLayerId) || null; }
  function selectionToLayer(cut) {
    if (!hasImage) { window.GateLog.log("warn", "layers: load an image first", null); return; }
    if (!hasAnyShape() && !S.cutouts.length) { window.GateLog.log("warn", "layers: make a box/poly selection first", null); }
    if (S.layers.length >= MAX_LAYERS) { window.GateLog.log("warn", "layers: full (" + MAX_LAYERS + ") — delete one first", null); return; }
    const base = maskedBaseCanvas(true); // selection-masked, cutouts NOT punched (re-cut of empty area stays empty anyway)
    if (!base) return;
    // empty check: any alpha > 8?
    let empty = true;
    try {
      const d = base.getContext("2d").getImageData(0, 0, srcW, srcH).data;
      for (let i = 3; i < d.length; i += 41 * 4) { if (d[i] > 8) { empty = false; break; } }
    } catch (e) {}
    if (empty) { window.GateLog.log("warn", "layers: selection is empty — nothing to put on a layer", null); return; }
    const sc = Math.min(1, LAYER_MAXD / Math.max(srcW, srcH));
    const lw = Math.max(1, Math.round(srcW * sc)), lh = Math.max(1, Math.round(srcH * sc));
    const t = document.createElement("canvas"); t.width = lw; t.height = lh;
    t.getContext("2d").drawImage(base, 0, 0, lw, lh);
    let url = "";
    try { url = t.toDataURL("image/png"); } catch (e) { window.GateLog.log("error", "layers: could not read cutout", null); return; }
    pushLayerHist();
    const n = S.layers.length + 1;
    const nl = { id: "l" + Date.now().toString(36), name: "layer " + n, dataUrl: url, on: true, op: 100, blend: "source-over", ox: 0, oy: 0, lw, lh };
    S.layers.push(nl); S.activeLayerId = nl.id;
    if (cut) {
      // punch the current selection shapes out of the base (snapshot — later edits don't move the hole)
      const sh = enabledShapes();
      sh.rects.forEach((r) => S.cutouts.push({ id: "c" + Date.now().toString(36) + "r", kind: "rect", rect: r.r.slice() }));
      sh.polys.forEach((p) => S.cutouts.push({ id: "c" + Date.now().toString(36) + "p", kind: "poly", pts: p.pts.map((q) => [q[0], q[1]]) }));
    }
    save(); paintLayers(); paintCounts(); composite(); renderEdit();
    bump("actions"); G().addXP(6, cut ? "cut to layer" : "copy to layer");
    window.GateLog.log("cut", (cut ? "cut" : "copied") + " selection → " + nl.name + (cut ? " (base punched)" : ""), null);
    G().emit("cut", { kind: "layer" });
  }
  const BLENDS = ["source-over", "multiply", "screen", "overlay", "darken", "lighten"];
  function paintLayers() {
    const box = G().$("layerList"); if (!box) return;
    box.innerHTML = "";
    const info = G().$("layerCountEl");
    if (info) info.textContent = S.layers.length + " layers" + (S.cutouts.length ? " · " + S.cutouts.length + " punches" : "");
    const sc = G().$("selCountEl");
    if (sc) sc.textContent = S.rects.length + " boxes · " + S.polys.length + " polys · " + S.layers.length + " layers";
    if (!S.layers.length) {
      box.innerHTML = '<div class="kv">no layers — select something, then ⧉ copy→layer or ✂ cut→layer.</div>';
      return;
    }
    [...S.layers].reverse().forEach((l) => {
      const card = document.createElement("div");
      card.className = "layer-card" + (l.id === S.activeLayerId ? " active" : "");
      const top = document.createElement("div"); top.className = "lrow";
      const th = document.createElement("img"); th.className = "lthumb"; th.src = l.dataUrl; th.alt = l.name;
      th.style.cursor = "pointer"; th.title = "make active";
      th.onclick = () => { S.activeLayerId = l.id; save(); paintLayers(); };
      top.appendChild(th);
      const nm = document.createElement("input");
      nm.type = "text"; nm.value = l.name || "layer"; nm.setAttribute("aria-label", "layer name");
      nm.onchange = () => { l.name = nm.value.slice(0, 40) || "layer"; save(); paintLayers(); };
      top.appendChild(nm);
      const eye = document.createElement("button"); eye.className = "small"; eye.textContent = l.on !== false ? "👁" : "–";
      eye.title = "toggle visibility";
      eye.onclick = () => { pushLayerHist(); l.on = l.on === false ? true : false; save(); paintLayers(); composite(); };
      top.appendChild(eye);
      const up = document.createElement("button"); up.className = "small"; up.textContent = "↑";
      up.onclick = () => {
        const i = S.layers.indexOf(l);
        if (i < S.layers.length - 1) { pushLayerHist(); S.layers.splice(i, 1); S.layers.splice(i + 1, 0, l); save(); paintLayers(); composite(); }
      };
      const dn = document.createElement("button"); dn.className = "small"; dn.textContent = "↓";
      dn.onclick = () => {
        const i = S.layers.indexOf(l);
        if (i > 0) { pushLayerHist(); S.layers.splice(i, 1); S.layers.splice(i - 1, 0, l); save(); paintLayers(); composite(); }
      };
      top.appendChild(up); top.appendChild(dn);
      const del = document.createElement("button"); del.className = "small danger"; del.textContent = "✖";
      del.onclick = () => {
        pushLayerHist();
        S.layers = S.layers.filter((q) => q.id !== l.id);
        layerImgCache.delete(l.id);
        if (S.activeLayerId === l.id) S.activeLayerId = S.layers.length ? S.layers[0].id : null;
        save(); paintLayers(); paintCounts(); composite(); renderEdit();
        window.GateLog.log("cut", "layer deleted: " + l.name, null);
      };
      top.appendChild(del);
      card.appendChild(top);
      const ctl = document.createElement("div"); ctl.className = "lrow"; ctl.style.marginTop = "6px";
      const opL = document.createElement("label"); opL.className = "kv"; opL.textContent = "op ";
      const op = document.createElement("input");
      op.type = "range"; op.min = "0"; op.max = "100"; op.value = String(l.op == null ? 100 : l.op);
      op.oninput = () => { l.op = +op.value; composite(); };
      op.onchange = () => { pushLayerHist(); save(); };
      opL.appendChild(op); ctl.appendChild(opL);
      const bl = document.createElement("select"); bl.setAttribute("aria-label", "blend mode");
      BLENDS.forEach((b) => { const o = document.createElement("option"); o.value = b; o.textContent = b; bl.appendChild(o); });
      bl.value = l.blend || "source-over";
      bl.onchange = () => { pushLayerHist(); l.blend = bl.value; save(); composite(); };
      ctl.appendChild(bl);
      [["x", "ox"], ["y", "oy"]].forEach(([lab, key]) => {
        const lb = document.createElement("label"); lb.className = "kv"; lb.textContent = lab + " ";
        const ni = document.createElement("input");
        ni.type = "number"; ni.step = "1"; ni.value = String(Math.round(l[key] || 0));
        ni.onchange = () => { pushLayerHist(); l[key] = clamp(Math.round(+ni.value || 0), -srcW, srcW); save(); composite(); };
        lb.appendChild(ni); ctl.appendChild(lb);
      });
      card.appendChild(ctl);
      box.appendChild(card);
    });
  }

  /* ---------- path ops: stroke + snap-to-edges ---------- */
  /* ==================================================================
     §13 auto-select: ✎ stroke path to mask, ⍈ snap to edges, ◎ subject / ◉ blobs.
     ================================================================== */
  function strokeActivePath() {
    const P = getActivePath();
    if (!P || P.pts.length < 2) { window.GateLog.log("warn", "stroke: active path needs 2+ points", null); return; }
    const modeEl = G().$("cutPathStrokeMode");
    const mode = modeEl && modeEl.value === "keep" ? "keep" : "cut";
    const pts = samplePathPts(P);
    const st = { mode, size: S.brushSize, hard: S.hardness, pts };
    S.strokes.push(st); hist.push({ k: "stroke", ref: st });
    replayMask();
    afterMaskEdit(mode, "path stroked (" + mode + ", r" + S.brushSize + ", " + pts.length + " dabs)");
  }
  function snapActivePath() {
    const P = getActivePath();
    if (!P || !P.pts.length) { window.GateLog.log("warn", "snap: active path is empty", null); return; }
    if (!ensureEdgeMap()) { window.GateLog.log("warn", "snap: no edge map (load an image first)", null); return; }
    pushPathHist();
    for (let pass = 0; pass < 2; pass++) P.pts = P.pts.map(([nx, ny]) => magnetic(nx, ny));
    S.pathSel = -1;
    save(); paintPathBar(); renderEdit();
    bump("actions"); G().addXP(3, "path snapped");
    window.GateLog.log("cut", "path snapped to edges (" + P.pts.length + " pts)", null);
  }

  /* ---------- one-touch subject select ---------- */
  function douglasPeucker(pts, eps) {
    if (pts.length < 4) return pts.slice();
    const keep = new Array(pts.length).fill(false);
    keep[0] = keep[pts.length - 1] = true;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let dmax = 0, idx = -1;
      for (let i = a + 1; i < b; i++) {
        const d = segDist(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
        if (d > dmax) { dmax = d; idx = i; }
      }
      if (dmax > eps) { keep[idx] = true; stack.push([a, idx], [idx, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  function mooreTrace(mask, W, H, sx, sy) {
    const P = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : mask[y * W + x];
    const didx = (dx, dy) => { for (let i = 0; i < 8; i++) if (P[i][0] === dx && P[i][1] === dy) return i; return 0; };
    let cx = sx, cy = sy;
    // scan always starts AT the bg backtrack pixel: direction C→B, i.e. (B-C)
    let dir = didx(-1, 0); // west backtrack (bg: sx is first fg of its row)
    const d0 = dir;
    const pts = [[sx, sy]];
    let guard = 0;
    while (guard++ < W * H) {
      let m = -1;
      for (let k = 0; k < 8; k++) {
        const di = (dir + k) % 8;
        if (at(cx + P[di][0], cy + P[di][1])) { m = di; break; }
      }
      if (m < 0) break;
      const bx = cx + P[(m + 7) % 8][0], by = cy + P[(m + 7) % 8][1];
      cx += P[m][0]; cy += P[m][1];
      dir = didx(bx - cx, by - cy);
      pts.push([cx, cy]);
      if (pts.length > 6 && cx === sx && cy === sy && dir === d0) break;
    }
    return pts;
  }
  function selectSubject(multi) {
    if (!hasImage) { window.GateLog.log("warn", "subject: load an image first", null); return; }
    const W = 128, H = Math.max(1, Math.round(128 * srcH / srcW));
    const t = document.createElement("canvas"); t.width = W; t.height = H;
    const tg = t.getContext("2d");
    tg.drawImage(srcC, 0, 0, W, H);
    let px;
    try { px = tg.getImageData(0, 0, W, H).data; }
    catch (e) { window.GateLog.log("error", "subject: could not read image", null); return; }
    const tol = S.subjTol, tol2 = tol * tol;
    const bg = new Uint8Array(W * H); // 1 = background (flooded from borders)
    // Local-similarity flood: expand from borders while neighbor-to-neighbor color steps stay small.
    const q = [];
    for (let x = 0; x < W; x++) { q.push([x, 0], [x, H - 1]); }
    for (let y = 1; y < H - 1; y++) { q.push([0, y], [W - 1, y]); }
    while (q.length) {
      const [x, y] = q.pop();
      if (x < 0 || y < 0 || x >= W || y >= H || bg[y * W + x]) continue;
      bg[y * W + x] = 1;
      const i0 = (y * W + x) * 4, r0 = px[i0], g0 = px[i0 + 1], b0 = px[i0 + 2];
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || bg[ny * W + nx]) return;
        const ni = (ny * W + nx) * 4;
        const dr = px[ni] - r0, dg = px[ni + 1] - g0, db = px[ni + 2] - b0;
        if (dr * dr + dg * dg + db * db <= tol2) q.push([nx, ny]);
      });
    }
    // connected components of foreground
    const comp = new Int32Array(W * H).fill(-1);
    const comps = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (bg[y * W + x] || comp[y * W + x] >= 0) continue;
      const id = comps.length;
      const c = { area: 0, minx: W, miny: H, maxx: 0, maxy: 0, sx: x, sy: y };
      const st = [[x, y]]; comp[y * W + x] = id;
      while (st.length) {
        const [cx2, cy2] = st.pop();
        c.area++; c.minx = Math.min(c.minx, cx2); c.miny = Math.min(c.miny, cy2);
        c.maxx = Math.max(c.maxx, cx2); c.maxy = Math.max(c.maxy, cy2);
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
          const nx = cx2 + dx, ny = cy2 + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || bg[ny * W + nx] || comp[ny * W + nx] >= 0) return;
          comp[ny * W + nx] = id; st.push([nx, ny]);
        });
      }
      comps.push(c);
    }
    const total = W * H;
    const minA = multi ? total * 0.004 : total * 0.01;
    const keep = comps.filter((c) => c.area >= minA).sort((a, b) => b.area - a.area).slice(0, multi ? 6 : 1);
    if (!keep.length) { window.GateLog.log("warn", "subject: no foreground blob found — try raising tol", null); return; }
    let added = 0;
    keep.forEach((c) => {
      // topmost-leftmost fg pixel of this component as trace start
      let sx = -1, sy = -1;
      outer: for (let y = c.miny; y <= c.maxy; y++) for (let x = c.minx; x <= c.maxx; x++) {
        if (comp[y * W + x] === comps.indexOf(c) && !bg[y * W + x]) {
          // boundary pixel? prefer one with bg above
          if (y === 0 || bg[(y - 1) * W + x] || comp[(y - 1) * W + x] !== comps.indexOf(c)) { sx = x; sy = y; break outer; }
          if (sx < 0) { sx = x; sy = y; }
        }
      }
      let pts = null;
      if (sx >= 0) {
        const fg = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i++) fg[i] = (!bg[i] && comp[i] === comps.indexOf(c)) ? 1 : 0;
        const loop = mooreTrace(fg, W, H, sx, sy);
        if (loop.length >= 8) pts = douglasPeucker(loop, 1.6).slice(0, 160).map(([bx, by]) => [clamp(bx / W, 0, 1), clamp(by / H, 0, 1)]);
      }
      if (!pts || pts.length < 3) {
        // fallback: component bbox as a box selection
        S.rects.push({ id: "r" + Date.now().toString(36) + added, r: [c.minx / W, c.miny / H, (c.maxx - c.minx + 1) / W, (c.maxy - c.miny + 1) / H], color: nextColor(), mode: "add", on: true });
        S.activeRectId = S.rects[S.rects.length - 1].id;
      } else {
        const q = { id: "q" + Date.now().toString(36) + added, pts, color: nextColor(), mode: "add", on: true };
        S.polys.push(q); S.activePolyId = q.id;
      }
      added++;
    });
    replayMask(); composite(); save(); paintCounts(); paintRects(); paintPolys(); renderEdit();
    bump("actions"); G().addXP(6, multi ? "blobs select" : "subject select");
    window.GateLog.log("cut", (multi ? "blobs" : "subject") + " selected (" + added + " shape" + (added === 1 ? "" : "s") + ")", null);
    G().emit("cut", { kind: "subject" });
  }
  /* ---------- projects (multiple canvases) + layout ---------- */
  const PROJ_KEY = "gate1.pro.projects", APROJ_KEY = "gate1.pro.activeProj";
  const MAX_PROJS = 6;
  let projId = null;
  /* ==================================================================
     §14 projects (multi-canvas) + layout presets + pop-out result window.
     ================================================================== */
  function projList() { const l = G().lsGet(PROJ_KEY, []); return Array.isArray(l) ? l : []; }
  function saveProjList(l) { G().lsSet(PROJ_KEY, l); G().store(PROJ_KEY, null).save(l); }
  function stateDoc() { return Object.assign({ updatedAt: Date.now() }, S); }
  function saveNow() {
    // synchronous flush of current state into its project slot
    try {
      const l = projList();
      const e = l.find((p) => p.id === projId);
      if (e) {
        e.doc = stateDoc(); e.updatedAt = Date.now();
        try {
          const sz = JSON.stringify(l).length;
          if (sz > 4500000) window.GateLog.log("warn", "canvas too large to persist (" + Math.round(sz / 1048576) + "MB) — export recipe JSON to be safe", null);
        } catch (e2) {}
        saveProjList(l);
      }
      G().lsSet(APROJ_KEY, projId);
    } catch (e) {}
  }
  function loadDocIntoS(doc) {
    // same normalization as load(), but from a project doc object
    const fresh = DEF();
    Object.keys(fresh).forEach((k) => { if (doc[k] !== undefined) fresh[k] = doc[k]; });
    if (fresh.adj) fresh.adj = Object.assign(DEF().adj, fresh.adj);
    if (!Array.isArray(fresh.poly)) fresh.poly = [];
    ["strokes", "magics", "retouchOps", "paths", "rects", "polys", "layers", "cutouts"].forEach((k) => { if (!Array.isArray(fresh[k])) fresh[k] = []; });
    if (!fresh.rects.length && Array.isArray(fresh.cutRect) && fresh.cutRect.length === 4) {
      fresh.rects = [{ id: "r0", r: fresh.cutRect.slice(), color: fresh.selColor || DEF().selColor, mode: "add", on: true }];
      fresh.activeRectId = "r0";
    }
    if (!fresh.polys.length && Array.isArray(fresh.poly) && fresh.poly.length >= 3) {
      fresh.polys = [{ id: "q0", pts: fresh.poly.map((q) => [q[0], q[1]]), color: "#5ec8ff", mode: "add", on: true }];
      fresh.activePolyId = "q0";
    }
    fresh.cutRect = null; fresh.poly = [];
    fresh.rects = fresh.rects.filter((r) => r && Array.isArray(r.r) && r.r.length === 4).map((r, i) => ({
      id: String(r.id || ("r" + i)), r: r.r.map((v) => clamp(+v || 0, 0, 1)),
      color: String(r.color || PALETTE[i % PALETTE.length]), mode: r.mode === "sub" ? "sub" : "add", on: r.on !== false,
    }));
    fresh.polys = fresh.polys.filter((p) => p && Array.isArray(p.pts)).map((p, i) => ({
      id: String(p.id || ("q" + i)),
      pts: p.pts.filter((q) => Array.isArray(q) && q.length >= 2).map((q) => [clamp(+q[0] || 0, 0, 1), clamp(+q[1] || 0, 0, 1)]),
      color: String(p.color || PALETTE[(i + 1) % PALETTE.length]), mode: p.mode === "sub" ? "sub" : "add", on: p.on !== false,
    }));
    fresh.layers = fresh.layers.filter((l) => l && l.dataUrl).map((l, i) => ({
      id: String(l.id || ("l" + i)), name: String(l.name || ("layer " + (i + 1))), dataUrl: String(l.dataUrl),
      on: l.on !== false, op: clamp(+l.op || 100, 0, 100), blend: String(l.blend || "source-over"),
      ox: +l.ox || 0, oy: +l.oy || 0,
    })).slice(0, MAX_LAYERS);
    if (!fresh.rects.some((r) => r.id === fresh.activeRectId)) fresh.activeRectId = fresh.rects.length ? fresh.rects[0].id : null;
    if (!fresh.polys.some((p) => p.id === fresh.activePolyId)) fresh.activePolyId = fresh.polys.length ? fresh.polys[0].id : null;
    if (fresh.layers.length && !fresh.layers.some((l) => l.id === fresh.activeLayerId)) fresh.activeLayerId = fresh.layers[0].id;
    if (!Array.isArray(fresh.cutouts)) fresh.cutouts = [];
    if (!["comp", "mask", "base"].includes(fresh.viewMode)) fresh.viewMode = "comp";
    if (!["side", "stack", "edit", "result"].includes(fresh.layout)) fresh.layout = "side";
    fresh.viewSplit = clamp(+fresh.viewSplit || 50, 20, 80); fresh.viewLock = !!fresh.viewLock;
    fresh.subjTol = clamp(+fresh.subjTol || 36, 8, 80);
    fresh.shapeSeq = +fresh.shapeSeq || (fresh.rects.length + fresh.polys.length);
    if (fresh.paths && !fresh.paths.some((p) => p.id === fresh.activePathId)) fresh.activePathId = fresh.paths.length ? fresh.paths[0].id : null;
    if (!["draw", "edit"].includes(fresh.lassoMode)) fresh.lassoMode = "draw";
    if (!["draw", "edit"].includes(fresh.pathMode)) fresh.pathMode = "draw";
    fresh.gridN = clamp(parseInt(fresh.gridN, 10) || 16, 4, 64);
    S = fresh;
    hist = [];
    S.strokes.forEach((s) => hist.push({ k: "stroke", ref: s }));
    S.magics.forEach((m) => hist.push({ k: "magic", ref: m }));
    lassoDraft = []; lassoSel = -1; S.pathSel = -1;
    layerImgCache.clear(); layerHist = []; pathHist = [];
  }
  function restoreProjectSource(doc, thenSample) {
    if (doc && doc.sourceDataUrl) {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        setSource(c, "canvas restored");
        syncInputs(); applyLayout(); paintRects(); paintPolys(); paintLayers(); paintProjects();
      };
      img.onerror = () => drawSample();
      img.src = doc.sourceDataUrl;
    } else if (thenSample) drawSample();
    else { hasImage = false; replayAll(); paintCounts(); }
  }
  function switchProject(id) {
    if (id === projId) return;
    saveNow();
    const l = projList();
    const e = l.find((p) => p.id === id);
    if (!e) return;
    projId = id;
    G().lsSet(APROJ_KEY, projId);
    loadDocIntoS(e.doc || {});
    restoreProjectSource(e.doc || {}, false);
    syncInputs(); applyLayout(); paintRects(); paintPolys(); paintLayers(); paintProjects();
    window.GateLog.log("cut", "switched to canvas: " + e.name, null);
  }
  function paintProjects() {
    const sel = G().$("projSel"); if (!sel) return;
    const l = projList();
    sel.innerHTML = "";
    l.forEach((p) => {
      const o = document.createElement("option");
      o.value = p.id; o.textContent = p.name + (p.id === projId ? " ●" : "");
      sel.appendChild(o);
    });
    sel.value = projId || "";
    const nm = G().$("projNameInput");
    if (nm) {
      const cur = l.find((p) => p.id === projId);
      if (document.activeElement !== nm) nm.value = cur ? cur.name : "";
    }
  }
  function applyLayout() {
    const sec = G().$("tabCut"); if (!sec) return;
    sec.classList.remove("lay-stack", "lay-edit", "lay-result");
    if (S.layout && S.layout !== "side") sec.classList.add("lay-" + S.layout);
    [["laySideBtn", "side"], ["layStackBtn", "stack"], ["layEditBtn", "edit"], ["layResultBtn", "result"]].forEach(([id, v]) => {
      const b = G().$(id); if (b) b.classList.toggle("active", (S.layout || "side") === v);
    });
    const vm = G().$("cutViewMode"); if (vm) vm.value = S.viewMode || "comp";
    // intuitive split: side layout shares the row by %, other layouts take the full row
    const grid = G().$("cutGrid2");
    const side = (S.layout || "side") === "side";
    if (grid) grid.style.gridTemplateColumns = side ? (" " + clamp(S.viewSplit || 50, 20, 80) + "% " + (100 - clamp(S.viewSplit || 50, 20, 80)) + "%") : "";
    const wrap = G().$("cutSplitWrap"); if (wrap) wrap.style.display = side ? "" : "none";
    const sp = G().$("cutSplit");
    if (sp) { sp.value = String(clamp(S.viewSplit || 50, 20, 80)); sp.disabled = !!S.viewLock; sp.title = (S.viewLock ? "locked at " : "") + sp.value + "% edit"; }
    const lk = G().$("cutSplitLockBtn"); if (lk) lk.textContent = S.viewLock ? "🔒" : "🔓";
  }
  // live pop-out mirrors: one window per canvas, refreshed while open (dirty-flagged by composite/renderEdit)
  const popWins = { edit: null, result: null };
  const popDirty = { edit: false, result: false };
  function pushFrame(kind) {
    const w = popWins[kind];
    if (!w || w.closed) { popWins[kind] = null; return; }
    const src = G().$(kind === "edit" ? "cutEdit" : "cutView");
    const img = src && w.document.getElementById("popImg");
    if (!src || !img) return;
    try { img.src = src.toDataURL("image/png"); } catch (e) {}
  }
  function mirrorTick() {
    if (popDirty.result) { popDirty.result = false; pushFrame("result"); }
    if (popDirty.edit) { popDirty.edit = false; pushFrame("edit"); }
  }
  function popCanvas(kind) {
    if (!hasImage) { window.GateLog.log("info", "pop-out: nothing to show yet — upload an image first", null); return; }
    if (kind === "result") { composite(); } else { renderEdit(); }
    const title = kind === "edit" ? "cut edit (live)" : "cut result (live)";
    let w = popWins[kind];
    if (!w || w.closed) {
      w = window.open("", "_blank");
      if (!w) { window.GateLog.log("warn", "pop-out blocked — allow popups for this page", null); return; }
      w.document.write("<!doctype html><title>" + title + "</title>" +
        "<body style=\"margin:0;background:#0a0e12;color:#d7e6f5;font-family:monospace;display:flex;flex-direction:column;min-height:100vh;align-items:center;gap:8px;padding:12px;box-sizing:border-box\">" +
        "<div style=\"font-size:12px;color:#7d93ad\">" + title + " · live mirror — keep painting, it follows</div>" +
        "<img id=\"popImg\" style=\"max-width:96vw;max-height:88vh;border:1px solid #223148;border-radius:8px;background:#05080c\">" +
        "</body>");
      w.document.close();
      popWins[kind] = w;
      window.GateLog.log("cut", (kind === "edit" ? "edit" : "result") + " popped to its own live window", null);
    } else if (w.focus) { try { w.focus(); } catch (e) {} }
    if (kind === "result") popDirty.result = true; else popDirty.edit = true;
    pushFrame(kind);
  }
  function popResult() { popCanvas("result"); }

  /* ---------- panels ---------- */
  const TOOLS = [["rect", "▦ rect"], ["lasso", "⬠ lasso"], ["path", "⌁ path"], ["keep", "✚ keep"], ["cut", "✖ cut"], ["magic", "🪄 magic"], ["heal", "🩹 heal"], ["clone", "⧉ clone"]];
  /* ==================================================================
     §15 toolbar paint + recipe JSON export/import + counts + syncInputs.
     ================================================================== */
  function paintTool() {
    G().$$("#cutTools button").forEach((b) => b.classList.toggle("active", b.dataset.tool === S.tool));    const hint = {
      rect: "drag a fresh box · drag inside to move it · pull a handle to move one side only · lock freezes it." + (S.inverse ? " INV keeps the OUTSIDE." : " Inside is kept."),
      lasso: S.lassoMode === "edit"
        ? "EDIT mode: drag a point to move it · tap an edge to insert · nothing is added on empty taps. Switch to + add pts to extend."
        : "ADD mode: tap to add points, drag to draw freehand, tap the start ring (or Close) to finish — " + (S.inverse ? "outside kept (INV)." : "inside is kept."),
      path: (S.pathMode === "edit" ? "EDIT path: drag anchors · tap an edge to insert · drag empty space to move the whole path · ↩ undo restores · nudge pad: tap 1px, double-tap 5px · " : "ADD path: tap/drag anchors, tap start ring to close · ") + "→ selection copies it to the lasso. ∿/┐ toggles curved vs straight. Grid + magnetic snap in the snap row.",
      keep: "paint back areas the magic ate. Brush persists as replayable strokes.",
      cut: "paint away background. Size + hardness below persist.",
      magic: "click the background color — similar pixels are cut. Tolerance below persists.",
      heal: "click a blemish — fills it with the local median. Radius = brush size.",
      clone: "alt-click (or Set source) to pick source, then drag to stamp it over flaws.",
    }[S.tool];
    const el = G().$("cutToolEl");
    if (el) el.innerHTML = "<b>" + S.tool + "</b> · " + hint +
      (S.tool === "clone" && S.cloneSrc ? " · source @ " + Math.round(S.cloneSrc[0] * 100) + "," + Math.round(S.cloneSrc[1] * 100) + "%" : "") +
      (S.inverse ? " · <b>INV</b> (outside kept)" : "");
    paintLassoBar(); paintPathBar(); paintNudge();
  }
  function paintSel() {
    const b = G().$("cutLockBtn"); if (b) b.textContent = S.cutLock ? "🔒 locked" : "🔓 unlocked";
    const inv = G().$("cutInverseBtn"); if (inv) inv.textContent = S.inverse ? "◑ keep outside" : "◐ keep inside";
    const st = G().$("cutSelStyle"); if (st) st.value = S.selStyle;
    const cc = G().$("cutSelColor"); if (cc) cc.value = S.selColor;
  }
  function paintLassoBar() {
    const bar = G().$("cutLassoBar"); if (!bar) return;
    bar.hidden = S.tool !== "lasso";
    if (bar.hidden) return;
    const d = G().$("cutLassoDrawBtn"), e = G().$("cutLassoEditBtn");
    if (d) d.classList.toggle("active", S.lassoMode === "draw");
    if (e) e.classList.toggle("active", S.lassoMode === "edit");
    const info = G().$("cutLassoInfo");
    if (info) {
      const tgt = lassoTarget();
      info.textContent = (S.lassoMode === "edit" ? "edit" : "add") +
        " · " + tgt.length + " pts (" + lassoTargetKind() + ")" +
        (lassoSel >= 0 ? " · sel #" + (lassoSel + 1) : "") +
        (S.inverse ? " · INV" : "");
    }
  }
  function paintPathBar() {
    const bar = G().$("cutPathBar"); if (!bar) return;
    bar.hidden = S.tool !== "path";
    if (bar.hidden) return;
    const d = G().$("cutPathDrawBtn"), e = G().$("cutPathEditBtn");
    if (d) d.classList.toggle("active", S.pathMode === "draw");
    if (e) e.classList.toggle("active", S.pathMode === "edit");
    const sel = G().$("cutPathSel");
    if (sel) {
      const cur = getActivePath() ? getActivePath().id : "";
      sel.innerHTML = "";
      if (!S.paths.length) {
        const o = document.createElement("option"); o.value = ""; o.textContent = "no paths yet";
        sel.appendChild(o);
      } else S.paths.forEach((p, i) => {
        const o = document.createElement("option");
        o.value = p.id; o.textContent = (p.name || ("path " + (i + 1))) + " (" + p.pts.length + (p.closed ? "●" : "○") + ")";
        sel.appendChild(o);
      });
      sel.value = cur;
    }
    const info = G().$("cutPathInfo");
    if (info) {
      const P = getActivePath();
      info.textContent = P ? (S.pathMode === "edit" ? "edit" : "add") + " · " + P.pts.length + " pts" + (P.closed ? " · closed" : " · open") + (P.smooth !== false ? " · ∿" : " · ┐") + (S.pathSel >= 0 ? " · sel #" + (S.pathSel + 1) : "") : "tap to start a path";
    }
    const sm = G().$("cutPathSmoothBtn");
    if (sm) { const P = getActivePath(); sm.textContent = (!P || P.smooth !== false) ? "∿ smooth" : "┐ sharp"; sm.classList.toggle("active", !!P && P.smooth === false); }
  }
  function paintCounts() {
    const el = G().$("cutCountEl");
    if (el) el.textContent = S.strokes.length + " strokes · " + S.magics.length + " magic · " + S.retouchOps.length + " retouch" + (S.inverse ? " · INV" : "") + " · " + parts.length + " grid" + " · " + S.layers.length + " layers";
    const info = G().$("cutInfoEl");
    if (info && hasImage) {
      const kept = maskKeptPct();
      const u = unionAddBBox();
      info.textContent = "frame " + srcW + "x" + srcH +
        (u ? " · crop " + Math.round(u[2] * srcW) + "x" + Math.round(u[3] * srcH) : " · full frame") +
        (S.inverse ? " · inverse (outside kept)" : " · inside kept") +
        " · boxes " + S.rects.length + " · polys " + S.polys.length + (lassoDraft.length ? " + draft " + lassoDraft.length : "") +
        " · paths " + S.paths.length +
        " · kept " + kept + "%" +
        " · feather " + S.feather + " · contract " + S.contract +
        " · tune " + JSON.stringify(S.adj);
    }
    paintParts();
  }
  function maskKeptPct() {
    try {
      const d = maskC.getContext("2d").getImageData(0, 0, srcW, srcH).data;
      let n = 0; const step = 4 * 7;
      for (let i = 0; i < d.length; i += step) if (d[i] >= 128) n++;
      return Math.round((n / Math.ceil(d.length / step)) * 100);
    } catch (e) { return 100; }
  }
  function syncInputs() {
    const set = (id, v) => { const el = G().$(id); if (el) el.value = v; };
    set("cutBrushSize", S.brushSize);
    set("cutHard", S.hardness); set("cutFeather", S.feather);
    set("cutContract", S.contract); set("cutTol", S.tolerance);
    const mc = G().$("cutMagicColor"); if (mc) mc.value = S.magicColor;
    set("cutBri", S.adj.bright); set("cutCon", S.adj.contrast);
    set("cutSat", S.adj.sat); set("cutWarm", S.adj.warm); set("cutSharp", S.adj.sharp);
    const ov = G().$("cutOverlayChk"); if (ov) ov.checked = !!S.overlay;
    const ch = G().$("cutCheckerChk"); if (ch) ch.checked = !!S.checker;
    const gs = G().$("cutGridShowChk"); if (gs) gs.checked = !!S.showGrid;
    const gn = G().$("cutGridSnapChk"); if (gn) gn.checked = !!S.gridSnap;
    const gd = G().$("cutGridN"); if (gd) gd.value = String(S.gridN || 16);
    const es = G().$("cutEdgeSnapChk"); if (es) es.checked = !!S.edgeSnap;
    const ev = G().$("cutEdgeShowChk"); if (ev) ev.checked = !!S.showEdges;
    const gz = G().$("cutGridZoom"); if (gz) gz.value = String(S.gridZoom || 128);
    const st2 = G().$("subjTol"); if (st2) st2.value = String(S.subjTol || 36);
    const sp = G().$("cutSplit"); if (sp) sp.value = String(clamp(S.viewSplit || 50, 20, 80));
    applyLayout();
    paintSel();
    G().$$("#cutTools button").forEach((b) => b.classList.toggle("active", b.dataset.tool === S.tool));
    paintLassoBar(); paintPathBar();
  }

  function recipeJSON() {
    return {
      app: "cut-bench", v: 3, frame: [srcW, srcH],
      rects: S.rects, polys: S.polys, strokes: S.strokes, magics: S.magics,
      activeRectId: S.activeRectId, activePolyId: S.activePolyId,
      layers: S.layers, cutouts: S.cutouts, activeLayerId: S.activeLayerId,
      retouchOps: S.retouchOps, cloneSrc: S.cloneSrc,
      feather: S.feather, contract: S.contract, adj: Object.assign({}, S.adj),
      selColor: S.selColor, selStyle: S.selStyle, cutLock: !!S.cutLock,
      inverse: !!S.inverse, paths: S.paths, gridN: S.gridN,
      showGrid: !!S.showGrid, gridSnap: !!S.gridSnap,
      edgeSnap: !!S.edgeSnap, showEdges: !!S.showEdges,
      viewMode: S.viewMode, layout: S.layout || "side", subjTol: S.subjTol,
      viewSplit: clamp(S.viewSplit || 50, 20, 80), viewLock: !!S.viewLock,
    };
  }
  function applyRecipe(r) {
    if (!r || r.app !== "cut-bench") throw new Error("not a cut-bench recipe");
    // v1/v2 (cutRect/poly) → v3 (rects/polys)
    if (Array.isArray(r.rects)) { S.rects = r.rects; S.activeRectId = r.activeRectId || (S.rects[0] && S.rects[0].id) || null; }
    else if (Array.isArray(r.cutRect) && r.cutRect.length === 4) {
      S.rects = [{ id: "r0", r: r.cutRect.slice(), color: r.selColor || DEF().selColor, mode: "add", on: true }];
      S.activeRectId = "r0";
    } else { S.rects = []; S.activeRectId = null; }
    if (Array.isArray(r.polys)) { S.polys = r.polys; S.activePolyId = r.activePolyId || (S.polys[0] && S.polys[0].id) || null; }
    else if (Array.isArray(r.poly) && r.poly.length >= 3) {
      S.polys = [{ id: "q0", pts: r.poly.map((q) => [q[0], q[1]]), color: "#5ec8ff", mode: "add", on: true }];
      S.activePolyId = "q0";
    } else { S.polys = []; S.activePolyId = null; }
    S.cutRect = null; S.poly = [];
    S.shapeSeq = +r.shapeSeq || (S.rects.length + S.polys.length);
    S.strokes = r.strokes || []; S.magics = r.magics || [];
    S.layers = Array.isArray(r.layers) ? r.layers.filter((l) => l && l.dataUrl).slice(0, MAX_LAYERS) : [];
    S.activeLayerId = S.layers.some((l) => l.id === r.activeLayerId) ? r.activeLayerId : (S.layers[0] && S.layers[0].id) || null;
    S.cutouts = Array.isArray(r.cutouts) ? r.cutouts : [];
    S.retouchOps = r.retouchOps || []; S.cloneSrc = r.cloneSrc || null;
    S.feather = r.feather ?? 2; S.contract = r.contract ?? 0;
    S.selColor = r.selColor || DEF().selColor; S.selStyle = r.selStyle || "ants"; S.cutLock = !!r.cutLock;
    S.inverse = !!r.inverse;
    S.paths = Array.isArray(r.paths) ? r.paths.filter((p) => p && Array.isArray(p.pts)) : [];
    S.activePathId = S.paths.length ? (S.paths.some((p) => p.id === r.activePathId) ? r.activePathId : S.paths[0].id) : null;
    if (r.gridN) S.gridN = clamp(parseInt(r.gridN, 10) || 16, 4, 64);
    S.showGrid = !!r.showGrid; S.gridSnap = !!r.gridSnap;
    S.edgeSnap = !!r.edgeSnap; S.showEdges = !!r.showEdges;
    S.viewMode = ["comp", "mask", "base"].includes(r.viewMode) ? r.viewMode : "comp";
    S.layout = ["side", "stack", "edit", "result"].includes(r.layout) ? r.layout : "side";
    S.subjTol = clamp(+r.subjTol || 36, 8, 80);
    S.viewSplit = clamp(+r.viewSplit || 50, 20, 80); S.viewLock = !!r.viewLock;
    S.adj = Object.assign(DEF().adj, r.adj || {});
    hist = [];
    S.strokes.forEach((s) => hist.push({ k: "stroke", ref: s }));
    S.magics.forEach((m) => hist.push({ k: "magic", ref: m }));
    lassoDraft = []; lassoSel = -1; S.pathSel = -1;
    layerImgCache.clear(); layerHist = [];
    applyLayout();
    replayAll(); syncInputs(); save(); paintRects(); paintPolys(); paintLayers();
  }

  /* ---------- boot ---------- */
  let booted = false;
  /* ==================================================================
     §16 boot: wire every button, migrate legacy state, restore project, replay, paint all.
     ================================================================== */
  function boot() {
    if (booted) return; booted = true;
    if (!G().$("cutEdit")) return;
    loadParts();
    // projects: one migration of the legacy single-canvas doc, then per-canvas docs
    let pl = projList();
    if (!pl.length) {
      const legacy = G().lsGet(KEY, null);
      const hasWork = legacy && (legacy.sourceDataUrl || (legacy.rects && legacy.rects.length) || (legacy.polys && legacy.polys.length) || (legacy.paths && legacy.paths.length));
      pl = [{ id: "c" + Date.now().toString(36), name: "Canvas 1", updatedAt: Date.now(), doc: hasWork ? legacy : null }];
      saveProjList(pl);
    }
    projId = G().lsGet(APROJ_KEY, null);
    if (!pl.some((p) => p.id === projId)) projId = pl[0].id;
    G().lsSet(APROJ_KEY, projId);
    loadDocIntoS((pl.find((p) => p.id === projId) || {}).doc || {});
    const tg = G().$("cutTools");
    TOOLS.forEach(([id, label]) => {
      const b = document.createElement("button");
      b.textContent = label; b.dataset.tool = id; b.className = "small";
      b.title = id;
      b.onclick = () => {
        if (S.tool === "lasso") { lassoDrawDown = false; lassoDrag = null; }
        if (S.tool === "path") { pathDrawDown = false; pathDrag = null; }
        S.tool = id; save(); paintTool(); renderEdit();
      };
      tg.appendChild(b);
    });
    G().$("cutUploadBtn").onclick = () => G().$("cutFileInput").click();
    G().$("cutFileInput").onchange = () => {
      const f = G().$("cutFileInput").files[0]; if (f) upload(f);
      G().$("cutFileInput").value = "";
    };
    G().$("cutSampleBtn").onclick = () => drawSample();
    G().$("cutUndoBtn").onclick = () => {
      const last = hist.pop();
      if (!last) { window.GateLog.log("info", "cut: nothing to undo", null); return; }
      if (last.k === "stroke") S.strokes = S.strokes.filter((s) => s !== last.ref);
      else S.magics = S.magics.filter((m) => m !== last.ref);
      replayMask(); composite(); renderEdit(); save(); paintCounts();
      window.GateLog.log("cut", "undo " + last.k, null);
    };
    G().$("cutRetouchUndoBtn").onclick = () => {
      if (!S.retouchOps.length) { window.GateLog.log("info", "cut: no retouch to undo", null); return; }
      S.retouchOps.pop();
      replayRetouch(); applyAdjustments(); composite(); renderEdit(); save(); paintCounts();
      window.GateLog.log("cut", "undo retouch", null);
    };
    G().$("cutClearBtn").onclick = () => {
      S.strokes = []; S.magics = []; hist = [];
      S.rects = []; S.polys = []; S.activeRectId = null; S.activePolyId = null;
      lassoDraft = []; lassoSel = -1;
      S.cutRect = null; S.poly = [];
      replayMask(); composite(); renderEdit(); save(); paintCounts(); paintLassoBar(); paintRects(); paintPolys();
      window.GateLog.log("cut", "mask cleared — full frame kept", null);
    };
    G().$("cutLassoApplyBtn").onclick = () => { if (lassoDraft.length >= 3) applyLasso(); };
    G().$("cutLassoClearBtn").onclick = () => {
      lassoDraft = []; lassoSel = -1;
      S.polys = []; S.activePolyId = null; S.poly = [];
      replayMask(); composite(); renderEdit(); save(); paintCounts(); paintLassoBar(); paintPolys();
      window.GateLog.log("cut", "lasso cleared", null);
    };
    G().$("cutCloneSetBtn").onclick = () => {
      window.GateCut._armSource = true; S.tool = "clone";
      save(); paintTool();
      window.GateLog.log("cut", "clone: next click sets the source point", null);
    };
    G().$("cutRectFullBtn").onclick = () => {
      S.rects = []; S.activeRectId = null; S.cutRect = null;
      replayMask(); composite(); renderEdit(); save(); paintCounts(); paintRects();
      window.GateLog.log("cut", "boxes cleared — full frame", null);
    };
    G().$("cutMagicBtn").onclick = () => {
      const col = G().$("cutMagicColor").value || S.magicColor;
      S.magicColor = col;
      applyMagicOp({ color: col, tol: S.tolerance }, false);
    };
    G().$("cutLockBtn").onclick = () => {
      S.cutLock = !S.cutLock; save(); paintSel(); renderEdit();
      window.GateLog.log("cut", S.cutLock ? "selection locked" : "selection unlocked", null);
    };
    const invBtn = G().$("cutInverseBtn");
    if (invBtn) invBtn.onclick = () => {
      S.inverse = !S.inverse; save(); paintSel(); paintTool();
      replayMask(); composite(); renderEdit(); paintCounts();
      window.GateLog.log("cut", S.inverse ? "inverse ON — outside the selection is kept" : "inverse OFF — inside the selection is kept", null);
      G().emit("cut", { kind: "inverse" });
    };
    // lasso mode bar
    const ld = G().$("cutLassoDrawBtn"), le = G().$("cutLassoEditBtn");
    if (ld) ld.onclick = () => { S.lassoMode = "draw"; lassoDrag = null; save(); paintLassoBar(); paintTool(); renderEdit(); };
    if (le) le.onclick = () => { S.lassoMode = "edit"; lassoDrawDown = false; save(); paintLassoBar(); paintTool(); renderEdit(); };
    const lu = G().$("cutLassoUndoPtBtn");
    if (lu) lu.onclick = () => {
      const tgt = lassoTarget(), kind = lassoTargetKind();
      if (!tgt.length) return;
      tgt.pop(); lassoSel = tgt.length - 1;
      if (kind === "poly") { replayMask(); composite(); save(); paintCounts(); }
      else renderEdit();
      paintLassoBar();
    };
    const ldel = G().$("cutLassoDelPtBtn");
    if (ldel) ldel.onclick = () => {
      const tgt = lassoTarget(), kind = lassoTargetKind();
      if (lassoSel < 0 || !tgt[lassoSel]) { window.GateLog.log("info", "lasso: tap a point in edit mode to select it first", null); return; }
      tgt.splice(lassoSel, 1); lassoSel = -1;
      if (kind === "poly") {
        const P = getActivePoly();
        if (!P || P.pts.length < 3) {
          if (P) { S.polys = S.polys.filter((q) => q.id !== P.id); S.activePolyId = S.polys.length ? S.polys[0].id : null; }
          window.GateLog.log("cut", "lasso opened — under 3 pts, poly removed", null);
        }
        replayMask(); composite(); save(); paintCounts(); paintPolys();
      } else renderEdit();
      paintLassoBar();
    };
    // path bar
    const pd = G().$("cutPathDrawBtn"), pe = G().$("cutPathEditBtn");
    if (pd) pd.onclick = () => { S.pathMode = "draw"; pathDrag = null; save(); paintPathBar(); paintTool(); renderEdit(); };
    if (pe) pe.onclick = () => { S.pathMode = "edit"; pathDrawDown = false; save(); paintPathBar(); paintTool(); renderEdit(); };
    const pn = G().$("cutPathNewBtn");
    if (pn) pn.onclick = () => {
      pushPathHist();
      const p = { id: "p" + Date.now().toString(36), name: "path " + (S.paths.length + 1), pts: [], closed: false, smooth: true };
      S.paths.push(p); S.activePathId = p.id; S.pathSel = -1;
      save(); paintPathBar(); paintNudge(); paintCounts(); renderEdit();
    };
    const pc = G().$("cutPathCloseBtn");
    if (pc) pc.onclick = () => {
      const P = getActivePath(); if (!P) return;
      if (P.pts.length < 3) { window.GateLog.log("info", "path: need 3+ points to close", null); return; }
      pushPathHist();
      P.closed = !P.closed; save(); renderEdit(); paintPathBar();
      window.GateLog.log("cut", "path " + (P.closed ? "closed" : "opened") + " (" + P.pts.length + " pts)", null);
    };
    const pu = G().$("cutPathUseBtn");
    if (pu) pu.onclick = () => {
      const P = getActivePath();
      if (!P || P.pts.length < 3) { window.GateLog.log("warn", "path: active path needs 3+ points", null); return; }
      const q = { id: "q" + Date.now().toString(36), pts: samplePathPts(P), color: nextColor(), mode: "add", on: true };
      S.polys.push(q); S.activePolyId = q.id;
      lassoDraft = []; lassoSel = -1;
      replayMask(); composite(); save(); paintCounts(); paintPolys(); renderEdit();
      bump("actions"); G().addXP(4, "path to selection");
      window.GateLog.log("cut", "path → selection (" + P.pts.length + " pts → poly " + S.polys.length + ") — " + (S.inverse ? "outside kept" : "inside kept"), null);
    };
    const pdel = G().$("cutPathDelPtBtn");
    if (pdel) pdel.onclick = () => {
      const P = getActivePath(); if (!P) return;
      if (S.pathSel < 0 || !P.pts[S.pathSel]) { window.GateLog.log("info", "path: tap a point in edit mode first", null); return; }
      pushPathHist();
      P.pts.splice(S.pathSel, 1); S.pathSel = -1;
      if (!P.pts.length) S.paths = S.paths.filter((q) => q.id !== P.id);
      if (S.paths.length && !getActivePath()) S.activePathId = S.paths[0].id;
      save(); paintPathBar(); paintCounts(); renderEdit();
    };
    const pundo = G().$("cutPathUndoBtn");
    if (pundo) pundo.onclick = () => undoPath();
    const psmooth = G().$("cutPathSmoothBtn");
    if (psmooth) psmooth.onclick = () => {
      const P = getActivePath(); if (!P) return;
      pushPathHist();
      P.smooth = !(P.smooth !== false);
      save(); paintPathBar(); renderEdit();
      window.GateLog.log("cut", "path " + (P.smooth ? "curved ∿ — anchors bend it" : "sharp ┐ — straight lines"), null);
    };
    const psel = G().$("cutPathSel");
    if (psel) psel.onchange = (e) => { S.activePathId = e.target.value; S.pathSel = -1; save(); paintPathBar(); renderEdit(); };
    const pdelPath = G().$("cutPathDelBtn");
    if (pdelPath) pdelPath.onclick = () => {
      const P = getActivePath(); if (!P) return;
      pushPathHist();
      S.paths = S.paths.filter((q) => q.id !== P.id);
      if (S.paths.length) S.activePathId = S.paths[0].id; else S.activePathId = null;
      S.pathSel = -1;
      save(); paintPathBar(); paintCounts(); renderEdit();
      window.GateLog.log("cut", "path deleted (" + S.paths.length + " left)", null);
    };
    // nudge pad
    wireNudge("cutNudgeL", -1, 0); wireNudge("cutNudgeR", 1, 0);
    wireNudge("cutNudgeU", 0, -1); wireNudge("cutNudgeD", 0, 1);
    // snap bar
    const gs = G().$("cutGridShowChk");
    if (gs) gs.onchange = (e) => { S.showGrid = e.target.checked; save(); renderEdit(); };
    const gn = G().$("cutGridSnapChk");
    if (gn) gn.onchange = (e) => { S.gridSnap = e.target.checked; save(); renderEdit(); paintTool(); };
    const gd = G().$("cutGridN");
    if (gd) gd.onchange = (e) => { S.gridN = clamp(parseInt(e.target.value, 10) || 16, 4, 64); save(); renderEdit(); };
    const es = G().$("cutEdgeSnapChk");
    if (es) es.onchange = (e) => {
      S.edgeSnap = e.target.checked;
      if (S.edgeSnap && hasImage) { ensureEdgeMap(); window.GateLog.log("cut", "magnetic snap on — points pull to edges", null); }
      save(); renderEdit(); paintTool();
    };
    const ev = G().$("cutEdgeShowChk");
    if (ev) ev.onchange = (e) => {
      S.showEdges = e.target.checked;
      if (S.showEdges && hasImage) ensureEdgeMap();
      save(); renderEdit();
    };
    // parts grid
    const sg = G().$("cutSendGridBtn");
    if (sg) sg.onclick = () => sendToGrid();
    const gc = G().$("cutGridClearBtn");
    if (gc) gc.onclick = () => {
      if (!parts.length) return;
      parts = []; saveParts(); paintParts(); paintCounts();
      window.GateLog.log("cut", "parts grid cleared", null);
    };
    const gz = G().$("cutGridZoom");
    if (gz) {
      gz.oninput = (e) => { S.gridZoom = clamp(Number(e.target.value) || 128, 72, 240); paintParts(); };
      gz.onchange = () => save();
    }
    // selections lists
    const rdel = G().$("rectDelBtn");
    if (rdel) rdel.onclick = () => {
      const R = getActiveRect(); if (!R) { window.GateLog.log("info", "boxes: tap a box to select it first", null); return; }
      S.rects = S.rects.filter((q) => q.id !== R.id);
      if (S.activeRectId === R.id) S.activeRectId = S.rects.length ? S.rects[0].id : null;
      replayMask(); composite(); save(); paintCounts(); paintRects(); renderEdit();
      window.GateLog.log("cut", "box deleted (" + S.rects.length + " left)", null);
    };
    const rdup = G().$("rectDupBtn");
    if (rdup) rdup.onclick = () => {
      const R = getActiveRect(); if (!R) { window.GateLog.log("info", "boxes: tap a box to select it first", null); return; }
      const c = { id: "r" + Date.now().toString(36), r: [clamp(R.r[0] + 0.03, 0, 0.97), clamp(R.r[1] + 0.03, 0, 0.97), R.r[2], R.r[3]], color: nextColor(), mode: R.mode, on: true };
      S.rects.push(c); S.activeRectId = c.id;
      replayMask(); composite(); save(); paintCounts(); paintRects(); renderEdit();
      window.GateLog.log("cut", "box duplicated (" + S.rects.length + " boxes)", null);
    };
    const qdel = G().$("polyDelBtn");
    if (qdel) qdel.onclick = () => {
      const P = getActivePoly(); if (!P) { window.GateLog.log("info", "polys: tap a poly to select it first", null); return; }
      S.polys = S.polys.filter((q) => q.id !== P.id);
      if (S.activePolyId === P.id) { S.activePolyId = S.polys.length ? S.polys[0].id : null; lassoSel = -1; }
      replayMask(); composite(); save(); paintCounts(); paintPolys(); renderEdit(); paintNudge();
      window.GateLog.log("cut", "poly deleted (" + S.polys.length + " left)", null);
    };
    // path stroke + snap-to-edges
    const pstroke = G().$("cutPathStrokeBtn");
    if (pstroke) pstroke.onclick = () => strokeActivePath();
    const psnap = G().$("cutPathSnapBtn");
    if (psnap) psnap.onclick = () => snapActivePath();
    // auto subject + layers
    const st2 = G().$("subjTol");
    if (st2) {
      st2.oninput = (e) => { S.subjTol = clamp(Number(e.target.value) || 36, 8, 80); };
      st2.onchange = () => save();
    }
    const sj = G().$("subjBtn"); if (sj) sj.onclick = () => selectSubject(false);
    const bb = G().$("blobsBtn"); if (bb) bb.onclick = () => selectSubject(true);
    const cp = G().$("copyLayerBtn"); if (cp) cp.onclick = () => selectionToLayer(false);
    const ct = G().$("cutLayerBtn"); if (ct) ct.onclick = () => selectionToLayer(true);
    const lu2 = G().$("layerUndoBtn"); if (lu2) lu2.onclick = () => undoLayer();
    const lc = G().$("layerClearBtn");
    if (lc) lc.onclick = () => {
      if (!S.layers.length && !S.cutouts.length) return;
      pushLayerHist();
      S.layers = []; S.cutouts = []; S.activeLayerId = null;
      layerImgCache.clear();
      save(); paintLayers(); paintCounts(); composite(); renderEdit();
      window.GateLog.log("cut", "layers cleared", null);
    };
    // view + layout + pop-out
    const vm = G().$("cutViewMode");
    if (vm) vm.onchange = (e) => { S.viewMode = e.target.value || "comp"; save(); composite(); };
    const lay = (id, v) => { const b = G().$(id); if (b) b.onclick = () => { S.layout = v; save(); applyLayout(); }; };
    lay("laySideBtn", "side"); lay("layStackBtn", "stack"); lay("layEditBtn", "edit"); lay("layResultBtn", "result");
    const pop = G().$("popBtn"); if (pop) pop.onclick = () => popCanvas("result");
    const popE = G().$("popEditBtn"); if (popE) popE.onclick = () => popCanvas("edit");
    // intuitive split: slider sizes edit vs result, lock freezes it (persists per canvas)
    const sp = G().$("cutSplit");
    if (sp) {
      sp.oninput = (e) => { if (S.viewLock) return; S.viewSplit = clamp(Number(e.target.value) || 50, 20, 80); applyLayout(); };
      sp.onchange = () => save();
      sp.ondblclick = () => { if (S.viewLock) return; S.viewSplit = 50; save(); syncInputs(); };
    }
    const lk = G().$("cutSplitLockBtn");
    if (lk) lk.onclick = () => {
      S.viewLock = !S.viewLock; save(); applyLayout();
      window.GateLog.log("cut", S.viewLock ? "view split locked at " + S.viewSplit + "%" : "view split unlocked", null);
    };
    try { setInterval(mirrorTick, 900); } catch (e) {}
    // parts kind filter
    const pf = G().$("partFilterSel"); if (pf) pf.onchange = () => paintParts();
    // projects
    const ps = G().$("projSel");
    if (ps) ps.onchange = (e) => switchProject(e.target.value);
    const pnm = G().$("projNameInput");
    if (pnm) pnm.onchange = () => {
      const l = projList(); const e = l.find((p) => p.id === projId); if (!e) return;
      e.name = pnm.value.slice(0, 40) || e.name; e.updatedAt = Date.now(); saveProjList(l); paintProjects();
    };
    const pnew = G().$("projNewBtn");
    if (pnew) pnew.onclick = () => {
      saveNow();
      let l = projList();
      if (l.length >= MAX_PROJS) { window.GateLog.log("warn", "canvases: full (" + MAX_PROJS + ") — delete one first", null); return; }
      const p = { id: "c" + Date.now().toString(36), name: "Canvas " + (l.length + 1), updatedAt: Date.now(), doc: null };
      l.push(p); saveProjList(l);
      projId = p.id; G().lsSet(APROJ_KEY, projId);
      S = DEF(); hist = []; lassoDraft = []; lassoSel = -1; S.pathSel = -1;
      layerImgCache.clear(); layerHist = []; pathHist = [];
      drawSample();
      syncInputs(); applyLayout(); paintRects(); paintPolys(); paintLayers(); paintProjects();
      window.GateLog.log("cut", "new canvas: " + p.name, null);
    };
    const pdup = G().$("projDupBtn");
    if (pdup) pdup.onclick = () => {
      saveNow();
      let l = projList();
      if (l.length >= MAX_PROJS) { window.GateLog.log("warn", "canvases: full (" + MAX_PROJS + ") — delete one first", null); return; }
      const cur = l.find((p) => p.id === projId);
      let doc = null;
      try { doc = JSON.parse(JSON.stringify(stateDoc())); } catch (e) { window.GateLog.log("error", "canvas: too large to duplicate", null); return; }
      const p = { id: "c" + Date.now().toString(36), name: (cur ? cur.name : "Canvas") + " copy", updatedAt: Date.now(), doc };
      l.push(p); saveProjList(l);
      switchProject(p.id);
    };
    const pdelProj = G().$("projDelBtn");
    if (pdelProj) pdelProj.onclick = () => {
      if (pdelProj.dataset.armed) {
        delete pdelProj.dataset.armed; pdelProj.textContent = "✖";
        let l = projList();
        if (l.length <= 1) { window.GateLog.log("warn", "canvas: cannot delete the last one", null); return; }
        l = l.filter((p) => p.id !== projId);
        saveProjList(l);
        projId = l[0].id; G().lsSet(APROJ_KEY, projId);
        loadDocIntoS(l[0].doc || {});
        restoreProjectSource(l[0].doc || {}, true);
        syncInputs(); applyLayout(); paintRects(); paintPolys(); paintLayers(); paintProjects();
        window.GateLog.log("cut", "canvas deleted", null);
      } else {
        pdelProj.dataset.armed = "1"; pdelProj.textContent = "sure?";
        setTimeout(() => { if (pdelProj.dataset.armed) { delete pdelProj.dataset.armed; pdelProj.textContent = "✖"; } }, 3000);
      }
    };
    G().$("cutSelColor").oninput = (e) => { S.selColor = e.target.value; renderEdit(); };
    G().$("cutSelColor").onchange = () => save();
    G().$("cutSelStyle").onchange = (e) => { S.selStyle = e.target.value; save(); renderEdit(); };
    const tune = (id, fn) => {
      const el = G().$(id); if (!el) return;
      el.oninput = (e) => { fn(Number(e.target.value)); recompositeSoon(); paintCounts(); };
      el.onchange = () => { save(); };
    };
    tune("cutBrushSize", (v) => { S.brushSize = clamp(v, 2, 160); });
    tune("cutHard", (v) => { S.hardness = clamp(v, 0, 100); });
    tune("cutFeather", (v) => { S.feather = clamp(v, 0, 20); });
    tune("cutContract", (v) => { S.contract = clamp(v, -10, 10); });
    tune("cutTol", (v) => { S.tolerance = clamp(v, 0, 120); });
    tune("cutBri", (v) => { S.adj.bright = clamp(v, -100, 100); });
    tune("cutCon", (v) => { S.adj.contrast = clamp(v, -100, 100); });
    tune("cutSat", (v) => { S.adj.sat = clamp(v, 0, 200); });
    tune("cutWarm", (v) => { S.adj.warm = clamp(v, -100, 100); });
    tune("cutSharp", (v) => { S.adj.sharp = clamp(v, 0, 100); });
    const mc = G().$("cutMagicColor"); if (mc) mc.onchange = (e) => { S.magicColor = e.target.value; save(); };
    const ov = G().$("cutOverlayChk"); if (ov) ov.onchange = (e) => { S.overlay = e.target.checked; save(); renderEdit(); };
    const ch = G().$("cutCheckerChk"); if (ch) ch.onchange = (e) => { S.checker = e.target.checked; save(); composite(); };
    G().$("cutResetTuneBtn").onclick = () => {
      S.adj = DEF().adj; S.feather = 2; S.contract = 0;
      syncInputs(); replayAll(); save();
      window.GateLog.log("cut", "tune reset to defaults", null);
    };
    G().$("cutSnapBtn").onclick = () => {
      if (!hasImage) return;
      composite();
      G().$("cutView").toBlob((b) => {
        if (!b) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b); a.download = "cut-asset.png"; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      });
      bump("exports"); G().addXP(8, "cut exported");
      window.GateLog.log("cut", "asset exported (transparent PNG)", null);
      paintCounts();
      G().emit("cut", { kind: "export" });
    };
    G().$("cutKeepBtn").onclick = () => {
      if (!hasImage) return;
      composite();
      const url = G().$("cutView").toDataURL("image/png");
      const db = G().lsGet("gate1.pro.keeper", { updatedAt: 0, notes: [] });
      db.notes.push({
        id: "n" + Date.now().toString(36), title: "cut asset (" + G().$("cutView").width + "x" + G().$("cutView").height + ")",
        body: "transparent PNG data-url (paste into an <img> or canvas):\n" + url.slice(0, 4000) + (url.length > 4000 ? "\n…[truncated " + url.length + "ch total — full file via export PNG]" : ""),
        tags: ["cut", "asset"], pinned: false, updatedAt: Date.now(),
      });
      db.updatedAt = Date.now();
      G().lsSet("gate1.pro.keeper", db); G().store("gate1.pro.keeper", null).save(db);
      if (window.GateKeep) window.GateKeep.paint();
      bump("keeps"); G().addXP(5, "cut kept");
      window.GateLog.log("keeper", "cut asset kept as note", null);
      paintCounts();
      G().emit("cut", { kind: "keep" });
    };
    G().$("cutJsonBtn").onclick = () => {
      G().download("cut-recipe.json", JSON.stringify(recipeJSON(), null, 2));
      window.GateLog.log("cut", "recipe exported (" + S.strokes.length + " strokes)", null);
    };
    G().$("cutRecipeFileInput").onchange = () => {
      const f = G().$("cutRecipeFileInput").files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try { applyRecipe(JSON.parse(r.result)); window.GateLog.log("cut", "recipe applied", null); }
        catch (e) { window.GateLog.log("error", "cut: bad recipe file", null); }
      };
      r.readAsText(f);
      G().$("cutRecipeFileInput").value = "";
    };
    G().$("cutRecipeLoadBtn").onclick = () => G().$("cutRecipeFileInput").click();
    document.addEventListener("keydown", (e) => {
      const t = (e.target && e.target.tagName) || "";
      if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return;
      if (e.key === "Escape" && lassoDraft.length) { lassoDraft = []; lassoSel = -1; renderEdit(); paintLassoBar(); }
      if ((e.key === "Enter") && S.tool === "lasso" && S.lassoMode === "draw" && lassoDraft.length >= 3) applyLasso();
      if ((e.key === "Delete" || e.key === "Backspace") && S.tool === "lasso" && S.lassoMode === "edit" && lassoSel >= 0) {
        const tgt = lassoTarget(), kind = lassoTargetKind();
        tgt.splice(lassoSel, 1); lassoSel = -1;
        if (kind === "poly") {
          const P = getActivePoly();
          if (P && P.pts.length < 3) { S.polys = S.polys.filter((q) => q.id !== P.id); S.activePolyId = S.polys.length ? S.polys[0].id : null; }
          replayMask(); composite(); save(); paintCounts(); paintPolys();
        }
        else renderEdit();
        paintLassoBar();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && S.tool === "path" && S.pathMode === "edit" && S.pathSel >= 0) {
        const P = getActivePath();
        if (P && P.pts[S.pathSel]) {
          pushPathHist();
          P.pts.splice(S.pathSel, 1); S.pathSel = -1;
          save(); paintPathBar(); paintNudge(); renderEdit();
        }
      }
      if (e.key.indexOf("Arrow") === 0 && (S.tool === "lasso" || S.tool === "path")) {
        const st = e.shiftKey ? 5 : 1;
        if (e.key === "ArrowLeft") nudgeSel(-st, 0);
        else if (e.key === "ArrowRight") nudgeSel(st, 0);
        else if (e.key === "ArrowUp") nudgeSel(0, -st);
        else if (e.key === "ArrowDown") nudgeSel(0, st);
        e.preventDefault();
      }
    });
    wireEdit();
    syncInputs(); paintTool(); paintCounts(); paintSel(); paintParts(); paintRects(); paintPolys(); paintLayers(); paintProjects();
    const ants = (t) => {
      requestAnimationFrame(ants);
      try {
        if (!G().$("tabCut").hidden && hasImage && S.selStyle === "ants" && (S.rects.length || S.tool === "path")) renderEdit(t || 0);
      } catch (e) {}
    };
    requestAnimationFrame(ants);
    restoreProjectSource((pl.find((p) => p.id === projId) || {}).doc || {}, true);
  }

  window.GateCut = { boot, recipeJSON: () => (hasImage ? recipeJSON() : null), applyRecipe, stats, _armSource: false,
    getTool: () => S.tool,
    setTool: (t) => { S.tool = t; save(); paintTool(); renderEdit(); },
    getLayout: () => S.layout || "side",
    setLayout: (v) => { if (["side", "stack", "edit", "result"].includes(v)) { S.layout = v; save(); applyLayout(); } },
    getView: () => ({ split: clamp(S.viewSplit || 50, 20, 80), locked: !!S.viewLock }),
    setSplit: (v) => { if (!S.viewLock) { S.viewSplit = clamp(+v || 50, 20, 80); save(); applyLayout(); } },
    setLock: (v) => { S.viewLock = !!v; save(); applyLayout(); },
    popCanvas,
    _edgeDbg: () => {
      let max = 0, n = 0;
      try {
        if (edgeMag) for (let i = 0; i < edgeMag.length; i += 7) { if (edgeMag[i] > max) max = edgeMag[i]; if (edgeMag[i] >= 80) n++; }
      } catch (e) {}
      return { has: !!edgeMag, w: edgeW, h: edgeH, srcW, srcH, max, strong: n, showEdges: S.showEdges, edgeSnap: S.edgeSnap, hasVis: !!edgeVisC };
    },
    _dbg: () => ({ strokes: S.strokes.length, magics: S.magics.length, hist: hist.length, retouch: S.retouchOps.length, rects: S.rects.length, polys: S.polys.length, inverse: !!S.inverse, paths: S.paths.length, grid: parts.length, layers: S.layers.length, cutouts: S.cutouts.length, proj: projId }) };
  try {
    if (document.readyState !== "loading") boot();
    else document.addEventListener("DOMContentLoaded", boot);
  } catch (e) {}
})();
