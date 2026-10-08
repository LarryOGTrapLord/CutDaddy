/* Control rack — minimal sticky bar + tool drawer + modular UI.
   Boot (after GateCut.boot): moves the 8 mode buttons into the rack, sweeps
   the config toolbar rows into a collapsible drawer, and renders proxy
   buttons for user-pinned tools. A proxy click()s its real button and
   mirrors its label/class/disabled via MutationObserver, so cut.js
   needs no changes. Pins, modes, drawer sections, drawer state, and panel
   visibility persist (LS + kv mirror via Gate.store) and are driven by the
   active workbench (src/bench.js). Exposes window.GateRack. */
(function () {
  "use strict";
  const G = () => window.Gate;
  const RACK_KEY = "gate1.pro.cutrack";
  // pinnable tools: [real button id, rack label]
  const PINS = [
    ["cutUploadBtn", "upload"], ["cutSampleBtn", "sample"],
    ["cutUndoBtn", "↩ undo"], ["cutRetouchUndoBtn", "undo ret"],
    ["cutClearBtn", "clear mask"], ["cutRectFullBtn", "full frame"],
    ["cutMagicBtn", "🪄 magic"], ["cutLockBtn", "lock"], ["cutInverseBtn", "inverse"],
    ["subjBtn", "◎ subject"], ["blobsBtn", "◉ blobs"],
    ["copyLayerBtn", "⧉ copy→L"], ["cutLayerBtn", "✂ cut→L"],
    ["cutPathUseBtn", "→sel"], ["cutPathStrokeBtn", "✎ stroke"], ["cutPathSnapBtn", "⍈ snap"],
    ["cutSnapBtn", "⤓ export"], ["cutJsonBtn", "JSON"], ["cutKeepBtn", "keep"],
    ["cutSendGridBtn", "＋ grid"], ["popBtn", "⧉ result pop"],
  ];
  const DEFAULT_PINS = ["cutUploadBtn", "subjBtn", "cutUndoBtn", "cutSnapBtn"];
  const ALL_MODES = ["rect", "lasso", "path", "keep", "cut", "magic", "heal", "clone"];
  // drawer modules: [row id, title] — contextual bars (lasso/path/nudge) stay put
  const MODULES = [
    ["tbSource", "source"], ["tbCanvas", "canvas"], ["tbHist", "history"],
    ["tbMagic", "magic key"], ["tbSel", "selection"], ["cutSnapBar", "snap"],
    ["tbAuto", "auto + layers"], ["tbView", "view + layout"],
  ];
  const PANELS = [
    ["tuneWrap", "retouch"], ["partsWrap", "parts grid"],
    ["selWrap", "selections"], ["layerWrap", "layers"],
  ];
  const store = G().store(RACK_KEY, { updatedAt: 0 });
  let S = store.load() || {};
  // minimalist default: closed drawer. v225 migrates old "drawer open" to closed once.
  if (S.rackV !== 225) { S.rackV = 225; if (S.drawer !== false) S.drawer = false; }
  if (!Array.isArray(S.pins)) S.pins = DEFAULT_PINS.slice();
  if (!Array.isArray(S.modes)) S.modes = null; // null = all modes (pre-bench)
  if (!Array.isArray(S.modules)) S.modules = null; // null = all sections
  if (typeof S.drawer !== "boolean") S.drawer = false; // minimalist: drawer closed
  if (!S.panels) S.panels = {};
  function save() { S.updatedAt = Date.now(); store.save(S); }
  function adoptToBench(patch) {
    try {
      if (window.GateBench && window.GateBench._adoptRack) window.GateBench._adoptRack(patch);
    } catch (e) {}
  }

  function syncProxy(p) {
    const real = G().$("" + p.dataset.real);
    if (!real) { p.hidden = true; return; }
    if (p.textContent !== real.textContent) p.textContent = real.textContent;
    const cls = (real.className || "") + " prox";
    if (p.className !== cls) p.className = cls;
    p.disabled = !!real.disabled;
    p.title = real.title || "";
    // proxies stay visible even when the drawer is closed — the drawer is
    // just storage for the real buttons. Only honour the button's own flag.
    p.hidden = !!real.hidden;
  }
  function syncAll() {
    G().$$("#rackPins button.prox").forEach(syncProxy);
  }
  function buildPins() {
    const wrap = G().$("rackPins");
    wrap.innerHTML = "";
    S.pins.forEach((id) => {
      const real = G().$("" + id);
      if (!real) return;
      const b = document.createElement("button");
      b.dataset.real = id;
      b.onclick = () => { const r = G().$("" + id); if (r && !r.disabled) r.click(); };
      wrap.appendChild(b);
      syncProxy(b);
    });
  }
  function applyModes() {
    const show = Array.isArray(S.modes) && S.modes.length ? S.modes : ALL_MODES;
    G().$$("#cutTools button[data-tool]").forEach((b) => {
      b.style.display = show.includes(b.dataset.tool) ? "" : "none";
    });
    // keep the paint tool on a visible mode
    try {
      const cur = window.GateCut && window.GateCut.getTool ? window.GateCut.getTool() : null;
      if (cur && !show.includes(cur)) {
        const first = document.querySelector('#cutTools button[data-tool="' + show[0] + '"]');
        if (first) first.click();
        else if (window.GateCut && window.GateCut.setTool) window.GateCut.setTool(show[0]);
      }
    } catch (e) {}
  }
  function applyModules() {
    const show = Array.isArray(S.modules) && S.modules.length ? S.modules : MODULES.map((m) => m[0]);
    MODULES.forEach(([id]) => {
      const row = G().$("" + id);
      if (!row) return;
      const mod = row.closest(".mod") || row;
      mod.style.display = show.includes(id) ? "" : "none";
    });
  }
  function applyPanels() {
    PANELS.forEach(([id]) => {
      const w = G().$("" + id);
      if (!w) return;
      const off = S.panels[id] === false;
      w.classList.toggle("wrap-off", off);
      const t = w.querySelector(":scope > h3 > button.collapse-btn");
      if (t) t.textContent = off ? "+" : "–";
    });
    G().$$("#rackPanelList button").forEach((b) => {
      b.classList.toggle("on", S.panels[b.dataset.panel] !== false);
    });
  }
  function applyDrawer() {
    G().$("toolDrawer").hidden = !S.drawer;
    G().$("rackToolsBtn").textContent = S.drawer ? "tools ▾" : "tools ▸";
  }
  function buildPop() {
    const grid = G().$("rackPinGrid");
    grid.innerHTML = "";
    PINS.forEach(([id, label]) => {
      if (!G().$("" + id)) return;
      const b = document.createElement("button");
      b.className = "small";
      b.textContent = label;
      b.classList.toggle("on", S.pins.includes(id));
      b.title = id;
      b.onclick = () => {
        S.pins = S.pins.includes(id) ? S.pins.filter((p) => p !== id) : S.pins.concat([id]);
        save(); buildPins(); buildPop(); adoptToBench({ pins: S.pins.slice() });
      };
      grid.appendChild(b);
    });
    const pl = G().$("rackPanelList");
    pl.innerHTML = "";
    PANELS.forEach(([id, label]) => {
      const b = document.createElement("button");
      b.className = "small on";
      b.textContent = label;
      b.dataset.panel = id;
      b.onclick = () => {
        S.panels[id] = S.panels[id] === false ? true : false;
        save(); applyPanels(); adoptToBench({ panels: Object.assign({}, S.panels) });
      };
      pl.appendChild(b);
    });
    applyPanels();
  }
  function organize() {
    // modes live in the rack, always visible
    const modes = G().$("cutTools");
    if (modes && modes.parentElement !== G().$("rackModes")) G().$("rackModes").appendChild(modes);
    // config rows move into the drawer as titled modules
    const body = G().$("toolDrawerBody");
    MODULES.forEach(([id, title]) => {
      const row = G().$("" + id);
      if (!row || row.parentElement === body || row.closest("#toolDrawerBody")) return;
      const mod = document.createElement("div");
      mod.className = "mod";
      const head = document.createElement("div");
      head.className = "mod-head";
      head.textContent = title;
      mod.appendChild(head);
      body.appendChild(mod);
      mod.appendChild(row);
    });
    // collapse buttons on panels
    PANELS.forEach(([id]) => {
      const w = G().$("" + id);
      const h3 = w && w.querySelector(":scope > h3");
      if (!h3 || h3.querySelector("button.collapse-btn")) return;
      const t = document.createElement("button");
      t.className = "small collapse-btn";
      t.textContent = "–";
      t.setAttribute("aria-label", "collapse panel");
      t.onclick = () => {
        S.panels[id] = S.panels[id] === false ? true : false;
        save(); applyPanels(); adoptToBench({ panels: Object.assign({}, S.panels) });
      };
      h3.appendChild(t);
    });
    buildPins(); buildPop(); applyModes(); applyModules(); applyPanels(); applyDrawer();
    // mirror real-button state onto proxies (labels like lock/inverse change)
    const deb = G().debounce(syncAll, 60);
    new MutationObserver(deb).observe(G().$("toolDrawerBody"), {
      subtree: true, attributes: true, attributeFilter: ["class", "disabled", "hidden"],
      characterData: true, childList: true,
    });
    syncAll();
  }
  function boot() {
    // wait for cut.js boot (mode buttons created + wired there)
    let tries = 0;
    const tick = () => {
      tries++;
      const ready = window.GateCut && G().$("cutTools") && G().$("cutTools").querySelector("button");
      if (ready || tries > 60) {
        if (ready) organize();
        else if (window.GateLog) window.GateLog.log("warn", "rack: cut bench not ready, drawer skipped", null);
        return;
      }
      setTimeout(tick, 250);
    };
    G().$("rackToolsBtn").onclick = () => {
      S.drawer = !S.drawer; save(); applyDrawer();
      adoptToBench({ drawer: S.drawer });
      if (S.drawer) G().$("toolDrawer").scrollIntoView({ behavior: "auto", block: "nearest" });
    };
    G().$("rackCustomBtn").onclick = () => {
      const p = G().$("rackPop");
      p.hidden = !p.hidden;
    };
    G().$("rackResetBtn").onclick = () => {
      S = { updatedAt: 0, rackV: 225, pins: DEFAULT_PINS.slice(), modes: null, modules: null, drawer: false, panels: {} };
      save(); buildPins(); buildPop(); applyModes(); applyModules(); applyPanels(); applyDrawer();
      adoptToBench({ pins: S.pins.slice(), panels: {}, drawer: false });
    };
    tick();
  }
  // external control (workbenches): filter modes, pins, drawer sections, panels.
  function setPins(ids) { S.pins = (ids || []).filter((id) => G().$("" + id)); save(); buildPins(); buildPop(); }
  function setPanels(map) { S.panels = Object.assign({}, map || {}); save(); applyPanels(); buildPop(); }
  function setModes(modes) { S.modes = Array.isArray(modes) && modes.length ? modes.slice() : null; save(); applyModes(); }
  function setModules(mods) { S.modules = Array.isArray(mods) && mods.length ? mods.slice() : null; save(); applyModules(); }
  function setDrawer(open) { S.drawer = !!open; save(); applyDrawer(); }
  function getState() { return { pins: S.pins.slice(), modes: S.modes ? S.modes.slice() : null, modules: S.modules ? S.modules.slice() : null, panels: Object.assign({}, S.panels), drawer: !!S.drawer }; }
  function applyBench(b) {
    if (!b) return;
    S.pins = Array.isArray(b.pins) && b.pins.length ? b.pins.filter((id) => G().$("" + id)) : DEFAULT_PINS.slice();
    S.modes = Array.isArray(b.modes) && b.modes.length ? b.modes.slice() : null;
    S.modules = Array.isArray(b.modules) && b.modules.length ? b.modules.slice() : null;
    S.panels = {};
    Object.keys(b.panels || {}).forEach((k) => { S.panels[k] = b.panels[k] !== false; });
    S.drawer = !!b.drawer;
    save(); buildPins(); buildPop(); applyModes(); applyModules(); applyPanels(); applyDrawer();
  }
  window.GateRack = { boot, setPins, setPanels, setModes, setModules, setDrawer, getState, applyBench };
  if (document.readyState !== "loading") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
