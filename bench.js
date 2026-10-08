/* Custom workbenches — named tool presets that drive the cut bench.
   Each bench = {id, name, modes[], pins[], modules[], panels{}, layout, drawer}.
   Modes filter the 8 paint tools, pins drive the rack quick bar, modules show/hide
   drawer sections, panels collapse retouch/parts/selections/layers, layout sets
   side/stack/edit/result. Stored LS + kv (gate1.pro.benches). Exposes GateBench. */
(function () {
  "use strict";
  const G = () => window.Gate;
  const KEY = "gate1.pro.benches";

  const MODES = [
    ["rect", "▦ rect", "boxes"],
    ["lasso", "⬠ lasso", "polys"],
    ["path", "⌁ path", "curves"],
    ["keep", "✚ keep", "paint back"],
    ["cut", "✖ cut", "paint away"],
    ["magic", "🪄 magic", "color key"],
    ["heal", "🩹 heal", "blemish"],
    ["clone", "⧉ clone", "stamp"],
  ];
  const ACTIONS = [
    ["cutUploadBtn", "upload", "load image"],
    ["cutSampleBtn", "sample", "practice card"],
    ["cutUndoBtn", "↩ undo", "undo mask stroke"],
    ["cutRetouchUndoBtn", "undo ret", "undo retouch"],
    ["cutClearBtn", "clear mask", "wipe mask+shapes"],
    ["cutRectFullBtn", "full frame", "clear boxes"],
    ["cutLassoApplyBtn", "close lasso", "finish poly"],
    ["cutLassoClearBtn", "clear lasso", "wipe polys"],
    ["cutCloneSetBtn", "clone src", "set stamp point"],
    ["cutMagicBtn", "magic apply", "key the color"],
    ["cutLockBtn", "lock", "freeze selection"],
    ["cutInverseBtn", "in/out", "keep inside/outside"],
    ["subjBtn", "◎ subject", "biggest blob"],
    ["blobsBtn", "◉ blobs", "every piece"],
    ["copyLayerBtn", "⧉ copy→L", "lift to layer"],
    ["cutLayerBtn", "✂ cut→L", "punch to layer"],
    ["cutPathUseBtn", "→sel", "path to selection"],
    ["cutPathStrokeBtn", "✎ stroke", "paint path"],
    ["cutPathSnapBtn", "⍈ snap", "path to edges"],
    ["cutPathNewBtn", "new path", "fresh curve"],
    ["cutPathCloseBtn", "close", "close curve"],
    ["cutPathUndoBtn", "↩ path", "undo path op"],
    ["cutPathSmoothBtn", "∿/┐", "curve/straight"],
    ["cutPathDelBtn", "del path", "remove curve"],
    ["rectDupBtn", "dup box", "copy box"],
    ["rectDelBtn", "del box", "remove box"],
    ["polyDelBtn", "del poly", "remove poly"],
    ["layerUndoBtn", "undo layer", "layer step back"],
    ["layerClearBtn", "clear layers", "wipe stack"],
    ["cutSendGridBtn", "＋ grid", "cut to parts"],
    ["cutGridClearBtn", "clear grid", "wipe parts"],
    ["cutSnapBtn", "⤓ export", "transparent PNG"],
    ["cutJsonBtn", "JSON", "share recipe"],
    ["cutRecipeLoadBtn", "load recipe", "import JSON"],
    ["cutKeepBtn", "keep", "note asset"],
    ["popBtn", "⧉ result pop", "result window"],
    ["popEditBtn", "⧉ edit pop", "edit window"],
    ["cutSplitLockBtn", "split lock", "freeze split"],
  ];
  const MODULES = [
    ["tbSource", "source", "upload / sample"],
    ["tbCanvas", "canvas", "projects"],
    ["tbHist", "history", "undo / clear / lasso"],
    ["tbMagic", "magic key", "color + tolerance"],
    ["tbSel", "selection", "color / lock / in-out"],
    ["cutSnapBar", "snap", "grid + magnetic"],
    ["tbAuto", "auto+layers", "subject / copy-cut"],
    ["tbView", "view", "composite / layout / pop"],
  ];
  const PANELS = [
    ["tuneWrap", "retouch", "tune sliders"],
    ["partsWrap", "parts grid", "cut nodes"],
    ["selWrap", "selections", "boxes + polys"],
    ["layerWrap", "layers", "layer stack"],
  ];
  const LAYOUTS = [["side", "side"], ["stack", "stack"], ["edit", "edit"], ["result", "result"]];

  const uid = (p) => (p || "b") + Date.now().toString(36) + Math.floor(Math.random() * 999);
  function presets() {
    const T = Date.now();
    return [
      { id: "bench-minimal", name: "Minimal", modes: ["rect", "keep", "cut", "magic"], pins: ["cutUploadBtn", "subjBtn", "cutUndoBtn", "cutSnapBtn"], modules: ["tbSource", "tbCanvas", "tbMagic", "tbAuto"], panels: { tuneWrap: true, partsWrap: false, selWrap: false, layerWrap: false }, layout: "side", drawer: false, updatedAt: T, preset: true },
      { id: "bench-cutmask", name: "Cut + Mask", modes: ["rect", "lasso", "keep", "cut", "magic"], pins: ["cutUploadBtn", "cutSampleBtn", "cutUndoBtn", "cutInverseBtn", "subjBtn", "cutSnapBtn", "cutSendGridBtn"], modules: ["tbSource", "tbCanvas", "tbHist", "tbMagic", "tbSel", "tbAuto"], panels: { tuneWrap: true, partsWrap: true, selWrap: true, layerWrap: false }, layout: "side", drawer: false, updatedAt: T, preset: true },
      { id: "bench-trace", name: "Trace + Path", modes: ["rect", "lasso", "path"], pins: ["cutUploadBtn", "cutPathUseBtn", "cutPathStrokeBtn", "cutPathSnapBtn", "cutUndoBtn", "cutSnapBtn"], modules: ["tbSource", "tbCanvas", "tbHist", "tbSel", "cutSnapBar"], panels: { tuneWrap: false, partsWrap: true, selWrap: true, layerWrap: false }, layout: "edit", drawer: false, updatedAt: T, preset: true },
      { id: "bench-retouch", name: "Retouch", modes: ["keep", "cut", "heal", "clone", "magic"], pins: ["cutUploadBtn", "cutRetouchUndoBtn", "cutClearBtn", "cutCloneSetBtn", "cutKeepBtn", "cutSnapBtn"], modules: ["tbSource", "tbHist", "tbMagic", "tbView"], panels: { tuneWrap: true, partsWrap: false, selWrap: false, layerWrap: false }, layout: "side", drawer: false, updatedAt: T, preset: true },
      { id: "bench-full", name: "Full bench", modes: MODES.map((m) => m[0]), pins: ["cutUploadBtn", "cutSampleBtn", "cutUndoBtn", "cutRetouchUndoBtn", "cutClearBtn", "cutMagicBtn", "cutLockBtn", "cutInverseBtn", "subjBtn", "blobsBtn", "copyLayerBtn", "cutLayerBtn", "cutPathUseBtn", "cutPathStrokeBtn", "cutPathSnapBtn", "cutSnapBtn", "cutJsonBtn", "cutKeepBtn", "cutSendGridBtn", "popBtn"], modules: MODULES.map((m) => m[0]), panels: { tuneWrap: true, partsWrap: true, selWrap: true, layerWrap: true }, layout: "side", drawer: true, updatedAt: T, preset: true },
    ];
  }

  const store = () => G().store(KEY, { updatedAt: 0 });
  let S = null; // {benches:[], activeId, editId}
  function load() {
    try { S = G().lsGet(KEY, null); } catch (e) { S = null; }
    if (!S || !Array.isArray(S.benches) || !S.benches.length) {
      S = { updatedAt: Date.now(), benches: presets(), activeId: "bench-minimal", editId: "bench-minimal" };
      save();
    }
    if (!S.benches.some((b) => b.id === S.activeId)) S.activeId = S.benches[0].id;
    if (!S.benches.some((b) => b.id === S.editId)) S.editId = S.activeId;
    return S;
  }
  function save() { S.updatedAt = Date.now(); try { G().lsSet(KEY, S); store().save(S); } catch (e) {} }
  const get = (id) => S.benches.find((b) => b.id === id) || null;
  const active = () => get(S.activeId) || S.benches[0];

  function setLayout(name) {
    try {
      if (window.GateCut && window.GateCut.setLayout) { window.GateCut.setLayout(name); return; }
    } catch (e) {}
    const map = { side: "laySideBtn", stack: "layStackBtn", edit: "layEditBtn", result: "layResultBtn" };
    const b = G().$(map[name] || "laySideBtn");
    if (b) b.click();
  }

  function applyBench(b, opts) {
    if (!b) return;
    S.activeId = b.id;
    if (!opts || opts.save !== false) save();
    try {
      if (window.GateRack && window.GateRack.applyBench) window.GateRack.applyBench(b);
      else {
        if (window.GateRack && window.GateRack.setPins) window.GateRack.setPins(b.pins);
        if (window.GateRack && window.GateRack.setPanels) {
          const m = {};
          Object.keys(b.panels || {}).forEach((k) => { m[k] = b.panels[k] !== false; });
          window.GateRack.setPanels(m);
        }
        if (window.GateRack && window.GateRack.setModes) window.GateRack.setModes(b.modes);
        if (window.GateRack && window.GateRack.setModules) window.GateRack.setModules(b.modules);
        if (window.GateRack && window.GateRack.setDrawer) window.GateRack.setDrawer(!!b.drawer);
      }
    } catch (e) {}
    setLayout(b.layout || "side");
    // if the current paint tool was filtered out, jump to the first visible one
    try {
      const cur = window.GateCut && window.GateCut.getTool ? window.GateCut.getTool() : null;
      if (cur && b.modes && b.modes.length && !b.modes.includes(cur)) {
        const btn = document.querySelector('#cutTools button[data-tool="' + b.modes[0] + '"]');
        if (btn) btn.click();
        else if (window.GateCut && window.GateCut.setTool) window.GateCut.setTool(b.modes[0]);
      }
    } catch (e) {}
    paintSwitcher();
    paintList();
    if (S.editId === b.id) paintEditor();
    try { window.GateLog.log("cut", "bench: " + b.name + " (" + (b.modes || []).length + " tools · " + (b.pins || []).length + " quick)", null); } catch (e) {}
  }
  function use(id) { const b = get(id); if (b) applyBench(b); }

  /* ---------- builder UI ---------- */
  function chip(label, hint, on, cb) {
    const b = document.createElement("button");
    b.className = "small" + (on ? " on" : "");
    b.textContent = label;
    if (hint) b.title = hint;
    b.onclick = cb;
    return b;
  }
  function paintSwitcher() {
    const sel = G().$("benchSelCut");
    if (sel) {
      sel.innerHTML = "";
      S.benches.forEach((b) => {
        const o = document.createElement("option");
        o.value = b.id;
        o.textContent = b.name + " (" + (b.modes || []).length + ")";
        sel.appendChild(o);
      });
      sel.value = S.activeId;
    }
    const meta = G().$("benchActiveMeta");
    if (meta) {
      const b = active();
      meta.textContent = (b.modes || []).length + " tools · " + (b.pins || []).length + " quick · " + (b.layout || "side");
    }
  }
  function paintList() {
    const list = G().$("benchList");
    if (!list) return;
    list.innerHTML = "";
    S.benches.forEach((b) => {
      const row = document.createElement("div");
      row.className = "sel-row" + (b.id === S.activeId ? " active" : "");
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = b.id === S.activeId ? "var(--acc)" : "transparent";
      dot.style.border = "2px solid var(--line)";
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.innerHTML = "<b>" + G().esc(b.name) + "</b> <span class=\"kv\">" + (b.modes || []).length + " tools · " + (b.pins || []).length + " quick" + (b.preset ? " · preset" : "") + "</span>";
      const useB = document.createElement("button");
      useB.className = "small" + (b.id === S.activeId ? "" : " primary");
      useB.textContent = b.id === S.activeId ? "✓ active" : "use";
      useB.onclick = () => { use(b.id); };
      const edB = document.createElement("button");
      edB.className = "small";
      edB.textContent = "edit";
      edB.onclick = () => { S.editId = b.id; save(); paintEditor(); paintList(); };
      const duB = document.createElement("button");
      duB.className = "small";
      duB.textContent = "⧉";
      duB.title = "duplicate";
      duB.onclick = () => { duplicate(b.id); };
      const delB = document.createElement("button");
      delB.className = "small danger";
      delB.textContent = "✖";
      delB.title = "delete";
      delB.disabled = S.benches.length <= 1;
      delB.onclick = () => { remove(b.id); };
      row.append(dot, nm, useB, edB, duB, delB);
      list.appendChild(row);
    });
    const c = G().$("benchCountEl");
    if (c) c.textContent = S.benches.length + " benches · active: " + active().name;
  }
  function paintEditor() {
    const ed = G().$("benchEditor");
    if (!ed) return;
    const b = get(S.editId) || active();
    S.editId = b.id;
    G().$("benchNameInput").value = b.name || "";
    G().$("benchLayoutSel").value = b.layout || "side";
    G().$("benchDrawerChk").checked = !!b.drawer;
    const isActive = b.id === S.activeId;
    G().$("benchEditMeta").textContent = (isActive ? "editing the ACTIVE bench — changes apply live" : "editing a draft — press “use this bench” to apply") + " · id " + b.id.slice(-6);
    G().$("benchUseBtn").textContent = isActive ? "✓ active bench" : "use this bench";
    // modes
    const mg = G().$("benchModesGrid");
    mg.innerHTML = "";
    MODES.forEach(([id, label, hint]) => {
      mg.appendChild(chip(label, hint + " — tap to add/remove", (b.modes || []).includes(id), () => {
        const bb = get(S.editId); if (!bb) return;
        bb.modes = (bb.modes || []).includes(id) ? bb.modes.filter((m) => m !== id) : (bb.modes || []).concat([id]);
        if (!bb.modes.length) bb.modes = [id];
        bb.updatedAt = Date.now(); save();
        if (bb.id === S.activeId) applyBench(bb);
        else { paintEditor(); paintList(); paintSwitcher(); }
      }));
    });
    // actions
    const ag = G().$("benchActionsGrid");
    ag.innerHTML = "";
    ACTIONS.forEach(([id, label, hint]) => {
      if (!document.getElementById(id)) return; // only wireable tools
      ag.appendChild(chip(label, hint + " — tap to add/remove", (b.pins || []).includes(id), () => {
        const bb = get(S.editId); if (!bb) return;
        bb.pins = (bb.pins || []).includes(id) ? bb.pins.filter((p) => p !== id) : (bb.pins || []).concat([id]);
        bb.updatedAt = Date.now(); save();
        if (bb.id === S.activeId) applyBench(bb);
        else { paintEditor(); paintList(); paintSwitcher(); }
      }));
    });
    // modules
    const dg = G().$("benchModulesGrid");
    dg.innerHTML = "";
    MODULES.forEach(([id, label, hint]) => {
      dg.appendChild(chip(label, hint, (b.modules || []).includes(id), () => {
        const bb = get(S.editId); if (!bb) return;
        bb.modules = (bb.modules || []).includes(id) ? bb.modules.filter((m) => m !== id) : (bb.modules || []).concat([id]);
        bb.updatedAt = Date.now(); save();
        if (bb.id === S.activeId) applyBench(bb);
        else { paintEditor(); paintList(); paintSwitcher(); }
      }));
    });
    // panels
    const pg = G().$("benchPanelsGrid");
    pg.innerHTML = "";
    PANELS.forEach(([id, label, hint]) => {
      pg.appendChild(chip(label, hint, (b.panels || {})[id] !== false, () => {
        const bb = get(S.editId); if (!bb) return;
        bb.panels = bb.panels || {};
        bb.panels[id] = bb.panels[id] === false ? true : false;
        bb.updatedAt = Date.now(); save();
        if (bb.id === S.activeId) applyBench(bb);
        else { paintEditor(); paintList(); paintSwitcher(); }
      }));
    });
  }
  function duplicate(id) {
    const b = get(id); if (!b) return;
    const c = JSON.parse(JSON.stringify(b));
    c.id = uid("b"); c.name = (b.name || "bench") + " copy"; c.preset = false; c.updatedAt = Date.now();
    S.benches.push(c); S.editId = c.id; save();
    paintSwitcher(); paintList(); paintEditor();
  }
  function remove(id) {
    if (S.benches.length <= 1) return;
    S.benches = S.benches.filter((b) => b.id !== id);
    if (S.activeId === id) S.activeId = S.benches[0].id;
    if (S.editId === id) S.editId = S.activeId;
    save(); paintSwitcher(); paintList(); paintEditor();
    applyBench(active(), { save: true });
  }
  function createNew() {
    const c = JSON.parse(JSON.stringify(active()));
    c.id = uid("b"); c.name = "Bench " + (S.benches.length + 1); c.preset = false; c.updatedAt = Date.now();
    S.benches.push(c); S.editId = c.id; save();
    paintSwitcher(); paintList(); paintEditor();
    try { window.GateLog.log("cut", "bench created: " + c.name + " — add tools below, then “use this bench”", null); } catch (e) {}
  }

  function boot() {
    if (!G().$("benchList")) return;
    load();
    // adopt newer kv copy if present, then repaint
    try {
      const st = G().store(KEY, null);
      if (st && st.adopt) st.adopt().then((remote) => {
        if (remote && Array.isArray(remote.benches) && remote.benches.length && (remote.updatedAt || 0) > (S.updatedAt || 0)) {
          S = remote;
          if (!S.benches.some((b) => b.id === S.activeId)) S.activeId = S.benches[0].id;
          if (!S.benches.some((b) => b.id === S.editId)) S.editId = S.activeId;
          try { G().lsSet(KEY, S); } catch (e) {}
          paintSwitcher(); paintList(); paintEditor();
          applyBench(active(), { save: false });
        }
      }).catch(() => {});
    } catch (e) {}
    G().$("benchNewBtn").onclick = createNew;
    G().$("benchDupBtn").onclick = () => duplicate(S.editId);
    G().$("benchDelBtn").onclick = () => remove(S.editId);
    G().$("benchUseBtn").onclick = () => use(S.editId);
    G().$("benchResetBtn").onclick = () => {
      S = { updatedAt: Date.now(), benches: presets(), activeId: "bench-minimal", editId: "bench-minimal" };
      save(); paintSwitcher(); paintList(); paintEditor(); applyBench(active());
    };
    G().$("benchNameInput").onchange = (e) => {
      const b = get(S.editId); if (!b) return;
      b.name = String(e.target.value || "").slice(0, 40) || "Untitled";
      b.preset = false; b.updatedAt = Date.now(); save();
      paintSwitcher(); paintList(); paintEditor();
    };
    G().$("benchLayoutSel").onchange = (e) => {
      const b = get(S.editId); if (!b) return;
      b.layout = e.target.value || "side"; b.updatedAt = Date.now(); save();
      if (b.id === S.activeId) applyBench(b); else paintEditor();
    };
    G().$("benchDrawerChk").onchange = (e) => {
      const b = get(S.editId); if (!b) return;
      b.drawer = !!e.target.checked; b.updatedAt = Date.now(); save();
      if (b.id === S.activeId) applyBench(b); else paintEditor();
    };
    const sel = G().$("benchSelCut");
    if (sel) sel.onchange = (e) => { S.editId = e.target.value; use(e.target.value); };
    const go = G().$("benchGoBtn");
    if (go) go.onclick = () => { if (window.GateApp) window.GateApp.show("tabBench"); };
    paintSwitcher(); paintList(); paintEditor();
    // wait for rack + cut, then apply the active bench (minimalist by default)
    let tries = 0;
    const tick = () => {
      tries++;
      const ready = window.GateRack && window.GateCut && G().$("cutTools") && G().$("cutTools").querySelector("button");
      if (ready || tries > 60) {
        if (ready) applyBench(active(), { save: false });
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  }

  window.GateBench = { boot, use, active, list: () => (S ? S.benches.slice() : []), get, MODES, ACTIONS,
    // rack writes through here so manual pin/panel/drawer tweaks land on the active bench
    _adoptRack(patch) {
      if (!S || !patch) return;
      const b = active(); if (!b) return;
      if (Array.isArray(patch.pins)) b.pins = patch.pins.slice();
      if (patch.panels) b.panels = Object.assign({}, patch.panels);
      if (patch.drawer !== undefined) b.drawer = !!patch.drawer;
      b.updatedAt = Date.now(); b.preset = false; save();
      paintSwitcher(); paintList();
      if (S.editId === b.id) paintEditor();
    } };
  if (document.readyState !== "loading") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
