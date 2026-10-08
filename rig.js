/* Rig Lab — Act 1: 2D rigged character from any image.
   Replicable technique: TEMPLATE REGIONS -> DICE -> PIVOTS -> LAYERS -> POSE.
   1. Take a front-facing character image (upload anything, or use the sample hero).
   2. Canonical 15-part sections map is overlaid as regions; drag them to fit.
   3. DICE cuts each region to its own sprite (rigid pieces, full transparency kept).
   4. Set a pivot per part (joints: neck/waist/shoulders/elbows/wrists/hips/knees/ankles).
   5. Layer order (back->front) decides draw; pose sliders drive FK bone angles.
   Same recipe works for ANY character image. Exposes window.GateRig. */
(function () {
  "use strict";
  const G = () => window.Gate;
  const LS_KEY = "gate1.pro.riglab";
  const MAXD = 512;

  /* Canonical sections map: id, label, parent joint, default region (x,y,w,h 0..1),
     default pivot inside region (0..1). Order below = draw order back -> front. */
  const PARTS = [
    { id: "handF", label: "Hand · far", parent: "foreArmF", r: [0.22, 0.58, 0.10, 0.08], p: [0.5, 0] },
    { id: "foreArmF", label: "Forearm · far", parent: "upperArmF", r: [0.22, 0.44, 0.12, 0.14], p: [0.5, 0] },
    { id: "upperArmF", label: "Upper arm · far", parent: "torso", r: [0.24, 0.27, 0.12, 0.17], p: [0.5, 0] },
    { id: "footF", label: "Foot · far", parent: "shinF", r: [0.36, 0.92, 0.13, 0.07], p: [0.5, 0] },
    { id: "shinF", label: "Shin · far", parent: "thighF", r: [0.39, 0.78, 0.10, 0.14], p: [0.5, 0] },
    { id: "thighF", label: "Thigh · far", parent: "pelvis", r: [0.39, 0.62, 0.10, 0.16], p: [0.5, 0] },
    { id: "pelvis", label: "Pelvis (root)", parent: null, r: [0.37, 0.50, 0.26, 0.12], p: [0.5, 0] },
    { id: "torso", label: "Torso", parent: "pelvis", r: [0.36, 0.24, 0.28, 0.28], p: [0.5, 1] },
    { id: "thighN", label: "Thigh · near", parent: "pelvis", r: [0.51, 0.62, 0.10, 0.16], p: [0.5, 0] },
    { id: "shinN", label: "Shin · near", parent: "thighN", r: [0.51, 0.78, 0.10, 0.14], p: [0.5, 0] },
    { id: "footN", label: "Foot · near", parent: "shinN", r: [0.51, 0.92, 0.13, 0.07], p: [0.5, 0] },
    { id: "upperArmN", label: "Upper arm · near", parent: "torso", r: [0.64, 0.27, 0.12, 0.17], p: [0.5, 0] },
    { id: "foreArmN", label: "Forearm · near", parent: "upperArmN", r: [0.66, 0.44, 0.12, 0.14], p: [0.5, 0] },
    { id: "handN", label: "Hand · near", parent: "foreArmN", r: [0.68, 0.58, 0.10, 0.08], p: [0.5, 0] },
    { id: "head", label: "Head", parent: "torso", r: [0.35, 0.02, 0.30, 0.22], p: [0.5, 1] },
  ];
  const byId = {};
  PARTS.forEach((p) => { byId[p.id] = p; });

  const PRESETS = {
    bind: {},
    wave: { upperArmN: -140, foreArmN: -25, head: 8, torso: -4 },
    walk: { thighN: -22, shinN: 16, footN: 8, thighF: 20, shinF: 6, upperArmN: 16, upperArmF: -16, foreArmN: 8 },
    bow: { torso: 28, head: 18, upperArmN: 12, upperArmF: 12, thighN: -6, thighF: -6 },
  };

  // live state
  let src = null, srcW = 0, srcH = 0;           // source canvas pixels
  let crops = {};                                // id -> canvas
  let rects = {}, pivots = {};                   // id -> [x,y,w,h], [px,py] (relative)
  let order = PARTS.map((p) => p.id);            // back -> front
  let pose = {}, root = { x: 0, y: 0, rot: 0 };
  let sel = "head", drag = null, dancing = false, hasImage = false;
  let locks = {}, selColor = "#5ec8ff", selStyle = "dash";
  function handleRad() { return Math.max(10, srcW * 0.02); }

  function defPose() { const o = {}; PARTS.forEach((p) => { o[p.id] = 0; }); return o; }
  function resetRecipe() {
    rects = {}; pivots = {}; locks = {};
    selColor = "#5ec8ff"; selStyle = "dash";
    PARTS.forEach((p) => { rects[p.id] = p.r.slice(); pivots[p.id] = p.p.slice(); });
    order = PARTS.map((p) => p.id);
    pose = defPose(); root = { x: 0, y: 0, rot: 0 };
  }
  resetRecipe();

  function saveRecipe() {
    try { G().lsSet(LS_KEY, { updatedAt: Date.now(), rects, pivots, locks, selColor, selStyle, order, pose, root }); } catch (e) {}
  }
  function loadRecipe() {
    try {
      const s = G().lsGet(LS_KEY, null);
      if (s && s.rects) {
        Object.keys(s.rects).forEach((k) => { if (byId[k]) rects[k] = s.rects[k]; });
        Object.keys(s.pivots || {}).forEach((k) => { if (byId[k]) pivots[k] = s.pivots[k]; });
        if (Array.isArray(s.order)) { const oo = s.order.filter((k) => byId[k]); PARTS.forEach((p) => { if (!oo.includes(p.id)) oo.push(p.id); }); order = oo; }
        Object.keys(s.pose || {}).forEach((k) => { if (k in pose) pose[k] = s.pose[k]; });
        if (s.root) root = s.root;
        if (s.locks) locks = s.locks;
        if (s.selColor) selColor = s.selColor;
        if (s.selStyle) selStyle = s.selStyle;
        return true;
      }
    } catch (e) {}
    return false;
  }

  /* ---------- sample hero: vector character drawn exactly onto the template ---------- */
  function drawSample() {
    const W = 512, H = 512;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");
    const R = (id) => { const r = rects[id]; return [r[0] * W, r[1] * H, r[2] * W, r[3] * H]; };
    const rr = (x, y, w, h, rad) => { g.beginPath(); g.roundRect(x, y, w, h, rad); g.fill(); };
    const FAR = { skin: "#c98f4e", cloth: "#2f6f9f", pants: "#4a3f78", shoe: "#22262e" };
    const NEAR = { skin: "#e8a95e", cloth: "#4fc3ff", pants: "#6c5ce7", shoe: "#333a44" };
    const limbs = [["F", FAR], ["N", NEAR]];
    // far limbs first, near limbs later (matches draw order)
    limbs.forEach(([side, C]) => {
      let r = R("thigh" + side); g.fillStyle = C.pants; rr(r[0], r[1], r[2], r[3], 10);
      r = R("shin" + side); g.fillStyle = C.pants; rr(r[0], r[1], r[2], r[3], 9);
      r = R("foot" + side); g.fillStyle = C.shoe; rr(r[0], r[1], r[2], r[3], 8);
      r = R("upperArm" + side); g.fillStyle = C.cloth; rr(r[0], r[1], r[2], r[3], 12);
      r = R("foreArm" + side); g.fillStyle = C.skin; rr(r[0], r[1], r[2], r[3], 11);
      r = R("hand" + side); g.fillStyle = C.skin;
      g.beginPath(); g.arc(r[0] + r[2] / 2, r[1] + r[3] / 2, r[2] * 0.48, 0, 7); g.fill();
    });
    let r = R("pelvis"); g.fillStyle = "#3a6ea5"; rr(r[0], r[1], r[2], r[3], 10);
    r = R("torso"); g.fillStyle = "#4fc3ff"; rr(r[0], r[1], r[2], r[3], 18);
    g.fillStyle = "#2470a8"; g.fillRect(r[0] + r[2] * 0.42, r[1] + 4, 5, r[3] - 8); // zipper
    r = R("head"); g.fillStyle = "#e8a95e"; rr(r[0], r[1], r[2], r[3], 34);
    // face
    g.fillStyle = "#222";
    g.beginPath(); g.arc(r[0] + r[2] * 0.36, r[1] + r[3] * 0.45, 6, 0, 7); g.fill();
    g.beginPath(); g.arc(r[0] + r[2] * 0.64, r[1] + r[3] * 0.45, 6, 0, 7); g.fill();
    g.strokeStyle = "#7a4a1e"; g.lineWidth = 4; g.beginPath();
    g.arc(r[0] + r[2] / 2, r[1] + r[3] * 0.58, 18, 0.3, Math.PI - 0.3); g.stroke();
    // antenna
    g.strokeStyle = "#888"; g.lineWidth = 5; g.beginPath();
    g.moveTo(r[0] + r[2] / 2, r[1] + 4); g.lineTo(r[0] + r[2] / 2, r[1] - 22); g.stroke();
    g.fillStyle = "#ff5a5a"; g.beginPath(); g.arc(r[0] + r[2] / 2, r[1] - 26, 7, 0, 7); g.fill();
    setSource(c, "sample hero");
  }

  /* ---------- source + dice ---------- */
  function setSource(canvas, name) {
    const sc = Math.min(1, MAXD / Math.max(canvas.width, canvas.height));
    srcW = Math.round(canvas.width * sc); srcH = Math.round(canvas.height * sc);
    src = document.createElement("canvas"); src.width = srcW; src.height = srcH;
    src.getContext("2d").drawImage(canvas, 0, 0, srcW, srcH);
    ["rigEdit", "rigView"].forEach((id) => { const c = G().$(id); if (c) { c.width = srcW; c.height = srcH; } });
    hasImage = true;
    diceAll();
    paintParts(); paintPose(); renderEdit();
    window.GateLog.log("info", "rig source: " + name + " (" + srcW + "x" + srcH + ")", null);
  }
  function upload(file) {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      try { URL.revokeObjectURL(img.src); } catch (e) {}
      setSource(c, file.name || "upload");
    };
    img.onerror = () => window.GateLog.log("error", "rig: could not read that image", null);
    img.src = URL.createObjectURL(file);
  }
  function rectPx(id) { const r = rects[id]; return [r[0] * srcW, r[1] * srcH, r[2] * srcW, r[3] * srcH]; }
  function pivotPx(id) { const r = rectPx(id), p = pivots[id]; return [r[0] + p[0] * r[2], r[1] + p[1] * r[3]]; }
  function diceAll() {
    if (!src) return 0;
    const g = src.getContext("2d");
    const data = g.getImageData(0, 0, srcW, srcH);
    crops = {};
    order.forEach((id) => {
      const [x, y, w, h] = rectPx(id).map(Math.round);
      const cw = Math.max(1, w), ch = Math.max(1, h);
      const c = document.createElement("canvas"); c.width = cw; c.height = ch;
      const cg = c.getContext("2d");
      const sx = Math.max(0, Math.min(srcW - 1, x)), sy = Math.max(0, Math.min(srcH - 1, y));
      const sw = Math.max(1, Math.min(cw, srcW - sx)), sh = Math.max(1, Math.min(ch, srcH - sy));
      cg.drawImage(src, sx, sy, sw, sh, sx - x, sy - y, sw, sh);
      crops[id] = c;
    });
    void data;
    return order.length;
  }

  /* ---------- FK render ---------- */
  const I = () => [1, 0, 0, 1, 0, 0];
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const T = (x, y) => [1, 0, 0, 1, x, y];
  const R = (deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, 0, 0]; };
  function chainOf(id) { const ch = []; let cur = id; while (cur) { ch.unshift(cur); cur = byId[cur].parent; } return ch; }
  function anglesNow(t) {
    if (!dancing) return pose;
    const o = Object.assign({}, pose), s = t / 600;
    o.upperArmN = (pose.upperArmN || 0) + Math.sin(s) * 35;
    o.upperArmF = (pose.upperArmF || 0) - Math.sin(s) * 35;
    o.foreArmN = (pose.foreArmN || 0) + Math.max(0, Math.sin(s * 2)) * 25;
    o.thighN = (pose.thighN || 0) + Math.sin(s) * 18;
    o.thighF = (pose.thighF || 0) - Math.sin(s) * 18;
    o.shinN = (pose.shinN || 0) + Math.max(0, -Math.sin(s)) * 22;
    o.shinF = (pose.shinF || 0) + Math.max(0, Math.sin(s)) * 22;
    o.head = (pose.head || 0) + Math.sin(s * 0.5) * 8;
    o.torso = (pose.torso || 0) + Math.sin(s) * 4;
    return o;
  }
  function renderView(t) {
    const c = G().$("rigView"); if (!c || !c.width) return;
    const g = c.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    if (!hasImage) { g.fillStyle = "#7d93ad"; g.font = "14px monospace"; g.fillText("upload an image or load the sample hero", 16, 30); return; }
    const A = anglesNow(t || 0);
    let M0 = mul(T(root.x, root.y), R(root.rot));
    order.forEach((id) => {
      const crop = crops[id]; if (!crop) return;
      let M = M0;
      chainOf(id).forEach((j) => { const p = pivotPx(j); M = mul(mul(mul(M, T(p[0], p[1])), R(A[j] || 0)), T(-p[0], -p[1])); });
      const [ox, oy] = rectPx(id);
      const F = mul(M, T(ox, oy));
      g.setTransform(F[0], F[1], F[2], F[3], F[4], F[5]);
      g.drawImage(crop, 0, 0);
    });
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  function renderEdit(t) {
    const c = G().$("rigEdit"); if (!c || !src) return;
    const SEL = window.GateSelect, hr = handleRad();
    const g = c.getContext("2d");
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(src, 0, 0);
    order.forEach((id) => {
      const [x, y, w, h] = rectPx(id);
      const isSel = id === sel, locked = !!locks[id];
      if (SEL) SEL.drawBox(g, x, y, w, h, { color: selColor, style: selStyle, t: t || 0, selected: isSel, locked, dim: !isSel, hs: hr });
      else { g.strokeStyle = isSel ? "#38e1a8" : "rgba(94,200,255,.75)"; g.lineWidth = isSel ? 2.5 : 1.2; g.strokeRect(x, y, w, h); }
      g.fillStyle = isSel ? "#ffcc55" : "#5ec8ff";
      g.font = "11px monospace";
      g.fillText(byId[id].label + (locked ? " 🔒" : ""), x + 3, y + 12);
      const [px, py] = pivotPx(id);
      g.fillStyle = isSel ? "#ffcc55" : "#ff6b6b";
      g.beginPath(); g.arc(px, py, isSel ? 7 : 5, 0, 7); g.fill();
      g.strokeStyle = "#0a0e12"; g.lineWidth = 1.5; g.stroke();
    });
  }

  /* ---------- edit interactions ---------- */
  function evtPos(e, c) {
    const r = c.getBoundingClientRect();
    return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)];
  }
  function hitPart(x, y) {
    for (let i = order.length - 1; i >= 0; i--) {
      const [rx, ry, rw, rh] = rectPx(order[i]);
      if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) return order[i];
    }
    return null;
  }
  function wireEdit() {
    const c = G().$("rigEdit"); if (!c) return;
    c.onmousedown = (e) => {
      if (!hasImage) return;
      const SEL = window.GateSelect, hr = handleRad();
      const [x, y] = evtPos(e, c);
      const [px, py] = pivotPx(sel);
      if (!locks[sel] && Math.hypot(x - px, y - py) < 14) { drag = { mode: "pivot" }; return; }
      const [sx, sy, sw, sh] = rectPx(sel);
      if (!locks[sel] && SEL) {
        const hit = SEL.hitHandle(SEL.handles(sx, sy, sw, sh), x, y, hr);
        if (hit) { drag = { mode: "handle:" + hit, sb: { x: sx, y: sy, w: sw, h: sh }, px: x, py: y }; return; }
        if (SEL.inBox({ x: sx, y: sy, w: sw, h: sh }, x, y, 0)) {
          drag = { mode: "move", sb: { x: sx / srcW, y: sy / srcH, w: sw / srcW, h: sh / srcH }, ox: x - sx, oy: y - sy };
          return;
        }
      }
      const hit = hitPart(x, y);
      if (hit && hit !== sel) {
        sel = hit; paintParts(); paintRectInputs(); paintLock(); renderEdit();
        if (locks[sel]) window.GateLog.log("warn", "rig: " + byId[sel].label + " is locked — unlock to move it", null);
        return;
      }
      if (locks[sel]) return;
      const r = rects[sel];
      drag = { mode: "move", sb: { x: r[0], y: r[1], w: r[2], h: r[3] }, ox: x - r[0] * srcW, oy: y - r[1] * srcH };
    };
    c.onmousemove = (e) => {
      if (!drag || !hasImage) return;
      const SEL = window.GateSelect;
      const [x, y] = evtPos(e, c);
      if (drag.mode === "pivot") {
        const [rx, ry, rw, rh] = rectPx(sel);
        pivots[sel] = [
          Math.max(0, Math.min(1, (x - rx) / Math.max(1, rw))),
          Math.max(0, Math.min(1, (y - ry) / Math.max(1, rh))),
        ];
      } else if (drag.mode.indexOf("handle:") === 0) {
        const b = { x: drag.sb.x, y: drag.sb.y, w: drag.sb.w, h: drag.sb.h };
        if (SEL) SEL.applyDrag(b, drag.mode.slice(7), drag.sb, x - drag.px, y - drag.py, Math.max(8, srcW * 0.02));
        rects[sel] = [b.x / srcW, b.y / srcH, b.w / srcW, b.h / srcH];
      } else {
        const r = rects[sel];
        r[0] = Math.max(0, Math.min(1 - drag.sb.w, (x - drag.ox) / srcW));
        r[1] = Math.max(0, Math.min(1 - drag.sb.h, (y - drag.oy) / srcH));
      }
      paintRectInputs(); renderEdit();
    };
    const up = () => { if (drag) { drag = null; diceAll(); paintParts(); saveRecipe(); } };
    c.onmouseup = up; c.onmouseleave = up;
  }

  /* ---------- panels ---------- */
  function paintParts() {
    const box = G().$("rigPartsEl"); if (!box) return;
    box.innerHTML = "";
    const frag = document.createDocumentFragment();
    order.slice().reverse().forEach((id) => { // front-most first
      const idx = order.indexOf(id);
      const row = document.createElement("div");
      row.className = "row";
      row.style.cssText = "border:1px solid var(--line);border-radius:8px;padding:6px;margin-bottom:6px" + (id === sel ? ";border-color:var(--acc)" : "");
      const b = document.createElement("button");
      b.textContent = byId[id].label;
      b.title = "select · parent: " + (byId[id].parent || "root") + " · layer " + idx;
      b.style.flex = "1";
      b.onclick = () => { sel = id; paintParts(); paintRectInputs(); paintPoseSel(); renderEdit(); };
      const up = document.createElement("button"); up.textContent = "↑"; up.title = "layer forward";
      up.onclick = () => { if (idx < order.length - 1) { order.splice(idx, 1); order.splice(idx + 1, 0, id); diceAll(); paintParts(); renderEdit(); saveRecipe(); } };
      const dn = document.createElement("button"); dn.textContent = "↓"; dn.title = "layer back";
      dn.onclick = () => { if (idx > 0) { order.splice(idx, 1); order.splice(idx - 1, 0, id); diceAll(); paintParts(); renderEdit(); saveRecipe(); } };
      row.appendChild(b); row.appendChild(up); row.appendChild(dn);
      frag.appendChild(row);
    });
    box.appendChild(frag);
    const n = G().$("rigCountEl");
    if (n) n.textContent = order.length + " parts";
  }
  function paintRectInputs() {
    const r = rects[sel]; if (!r || !G().$("rigRX")) return;
    G().$("rigRX").value = r[0].toFixed(3); G().$("rigRY").value = r[1].toFixed(3);
    G().$("rigRW").value = r[2].toFixed(3); G().$("rigRH").value = r[3].toFixed(3);
    G().$("rigSelEl").textContent = byId[sel].label + " · parent " + (byId[sel].parent || "root") + (locks[sel] ? " · 🔒 locked" : "");
  }
  function paintLock() {
    const b = G().$("rigLockBtn");
    if (b) b.textContent = locks[sel] ? "🔒 locked" : "🔓 unlocked";
    const cc = G().$("rigSelColor"); if (cc) cc.value = selColor;
    const st = G().$("rigSelStyle"); if (st) st.value = selStyle;
  }
  function paintPose() {
    const box = G().$("rigPoseEl"); if (!box) return;
    box.innerHTML = "";
    const frag = document.createDocumentFragment();
    PARTS.forEach((p) => {
      const d = document.createElement("div");
      d.className = "row"; d.dataset.joint = p.id;
      d.style.marginBottom = "2px";
      d.innerHTML = '<span class="mono" style="width:112px">' + G().esc(p.label) + '</span>';
      const s = document.createElement("input");
      s.type = "range"; s.min = "-120"; s.max = "120"; s.step = "1"; s.value = pose[p.id] || 0;
      s.style.flex = "1"; s.setAttribute("aria-label", p.label + " angle");
      const v = document.createElement("b");
      v.className = "mono"; v.style.width = "44px"; v.textContent = (pose[p.id] || 0) + "°";
      s.oninput = () => { pose[p.id] = Number(s.value); v.textContent = s.value + "°"; saveRecipe(); };
      s.ondblclick = () => { pose[p.id] = 0; s.value = 0; v.textContent = "0°"; saveRecipe(); };
      d.appendChild(s); d.appendChild(v);
      frag.appendChild(d);
    });
    box.appendChild(frag);
    paintPoseSel();
  }
  function paintPoseSel() {
    G().$$("#rigPoseEl .row").forEach((d) => {
      d.style.outline = d.dataset.joint === sel ? "1px solid var(--acc)" : "none";
    });
  }
  function applyPreset(name) {
    pose = defPose();
    Object.assign(pose, PRESETS[name] || {});
    paintPose(); saveRecipe();
    window.GateLog.log("info", "rig pose: " + name, null);
    G().addXP(3, "rig pose " + name);
    G().emit("rig", { kind: "pose", name });
  }
  function rigJSON() {
    return {
      app: "gate-one-rig", v: 1, name: "character-rig",
      order: order.slice(),
      parts: PARTS.map((p) => ({ id: p.id, parent: p.parent, rect: rects[p.id].map((v) => +v.toFixed(4)), pivot: pivots[p.id].map((v) => +v.toFixed(4)) })),
      pose: Object.assign({}, pose), root: Object.assign({}, root),
    };
  }

  /* ---------- boot ---------- */
  let booted = false;
  function boot() {
    if (booted) return; booted = true;
    if (!G().$("rigEdit")) return;
    loadRecipe();
    G().$("rigUploadBtn").onclick = () => G().$("rigFileInput").click();
    G().$("rigFileInput").onchange = () => {
      const f = G().$("rigFileInput").files[0]; if (f) upload(f);
      G().$("rigFileInput").value = "";
    };
    G().$("rigSampleBtn").onclick = () => { resetRecipe(); drawSample(); G().emit("rig", { kind: "sample" }); };
    G().$("rigDiceBtn").onclick = () => {
      const n = diceAll(); paintParts(); renderEdit(); saveRecipe();
      window.GateLog.log("test", "rig DICED: " + n + " rigid parts cut + reassembled", null);
      G().addXP(10, "rig diced");
      G().emit("rig", { kind: "dice", n });
    };
    G().$("rigResetBtn").onclick = () => { resetRecipe(); paintLock(); if (hasImage) { diceAll(); paintParts(); paintPose(); renderEdit(); saveRecipe(); } };
    G().$("rigLockBtn").onclick = () => {
      locks[sel] = !locks[sel]; if (!locks[sel]) delete locks[sel];
      paintParts(); paintRectInputs(); paintLock(); renderEdit(); saveRecipe();
      window.GateLog.log("info", "rig " + byId[sel].label + (locks[sel] ? " locked" : " unlocked"), null);
    };
    G().$("rigSelColor").oninput = (e) => { selColor = e.target.value; renderEdit(); };
    G().$("rigSelColor").onchange = () => saveRecipe();
    G().$("rigSelStyle").onchange = (e) => { selStyle = e.target.value; saveRecipe(); renderEdit(); };
    [["rigRX", 0], ["rigRY", 1], ["rigRW", 2], ["rigRH", 3]].forEach(([id, k]) => {
      G().$(id).onchange = (e) => {
        const v = Math.max(0, Math.min(1, Number(e.target.value) || 0));
        rects[sel][k] = k < 2 ? Math.min(v, 1 - rects[sel][k + 2]) : Math.max(0.02, v);
        diceAll(); renderEdit(); saveRecipe();
      };
    });
    ["bind", "wave", "walk", "bow"].forEach((name) => {
      G().$("rigPose" + name[0].toUpperCase() + name.slice(1) + "Btn").onclick = () => applyPreset(name);
    });
    G().$("rigDanceChk").onchange = (e) => { dancing = e.target.checked; };
    [["rigRootX", "x", -120, 120], ["rigRootY", "y", -120, 120], ["rigRootR", "rot", -45, 45]].forEach(([id, k]) => {
      G().$(id).oninput = (e) => { root[k] = Number(e.target.value); saveRecipe(); };
    });
    G().$("rigSnapBtn").onclick = () => {
      const c = G().$("rigView");
      c.toBlob((b) => { if (b) { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "rig-pose.png"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); } });
      window.GateLog.log("info", "rig snapshot exported", null);
      G().addXP(5, "rig snapshot");
    };
    G().$("rigJsonBtn").onclick = () => {
      G().download("character-rig.json", JSON.stringify(rigJSON(), null, 2));
      window.GateLog.log("info", "rig JSON exported (" + order.length + " parts)", null);
      G().addXP(8, "rig exported");
      G().emit("rig", { kind: "export" });
    };
    G().$("rigKeepBtn").onclick = () => {
      const db = G().lsGet("gate1.pro.keeper", { updatedAt: 0, notes: [] });
      db.notes.push({ id: "n" + Date.now().toString(36), title: "rig: character-rig (" + order.length + " parts)", body: JSON.stringify(rigJSON()), tags: ["rig", "asset"], pinned: false, updatedAt: Date.now() });
      db.updatedAt = Date.now();
      G().lsSet("gate1.pro.keeper", db); G().store("gate1.pro.keeper", null).save(db);
      if (window.GateKeep) window.GateKeep.paint();
      window.GateLog.log("keeper", "rig kept as note asset", null);
      G().addXP(5, "rig kept");
      G().emit("rig", { kind: "keep" });
    };
    G().$("rigTestBtn").onclick = async () => {
      const rig = rigJSON();
      // local structural validation always runs (no tier caps); pro also runs it caged
      const problems = [];
      if (!rig || rig.parts.length < 15) problems.push("expected 15 canonical parts, got " + (rig ? rig.parts.length : 0));
      (rig ? rig.parts : []).forEach((p) => {
        if (p.parent && !rig.parts.some((q) => q.id === p.parent)) problems.push("orphan " + p.id);
        (p.rect || []).forEach((v) => { if (!(v >= 0 && v <= 1)) problems.push(p.id + " rect out of range"); });
      });
      if (problems.length) {
        G().$("rigTestOut").innerHTML = '<span class="pill fail">rig invalid</span> ' + G().esc(problems.slice(0, 3).join(" · "));
        window.GateLog.log("test", "rig self-test FAIL: " + problems[0], null);
        return;
      }
      const code = "const rig = " + JSON.stringify(rig) + ";\n" +
        "console.log('parts', rig.parts.length);\n" +
        "if (rig.parts.length < 15) throw new Error('expected 15 canonical parts');\n" +
        "rig.parts.forEach((p) => { if (p.parent && !rig.parts.some((q) => q.id === p.parent)) throw new Error('orphan ' + p.id); });\n" +
        "console.log('parents ok');\nreturn 'rig ok: ' + rig.parts.length + ' parts, order ' + rig.order.length;";
      const res = await window.GateBox.run(code);
      const el = G().$("rigTestOut");
      el.innerHTML = res.ok
        ? '<span class="pill pass">rig valid (sandbox)</span> ' + G().esc(String(res.value)) + "\n" + (res.logs || []).map(G().esc).join("\n")
        : '<span class="pill fail">rig invalid</span> ' + G().esc(res.error || "");
      window.GateLog.log("test", "rig self-test " + (res.ok ? "PASS (sandbox)" : "FAIL"), null);
      if (res.ok) { G().addXP(12, "rig self-test"); G().emit("rig", { kind: "selftest" }); }
    };
    wireEdit();
    paintParts(); paintRectInputs(); paintPose(); paintLock();
    drawSample(); // boot with the sample hero so Act 1 is playable instantly
    const loop = (t) => {
      requestAnimationFrame(loop);
      if (G().$("tabRig") && G().$("tabRig").hidden) return;
      renderView(t || 0);
      if (selStyle === "ants") renderEdit(t || 0);
    };
    requestAnimationFrame(loop);
  }

  window.GateRig = { boot, rigJSON: () => (hasImage ? rigJSON() : null), PARTS };
  // self-boot: app.js may have booted before this script executed
  try {
    if (document.readyState !== "loading") boot();
    else document.addEventListener("DOMContentLoaded", boot);
  } catch (e) {}
})();
