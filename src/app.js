/* Cut Bench app shell — tabs, bench banner, shortcuts. Exposes window.GateApp. */
(function () {
  "use strict";
  const G = () => window.Gate;
  const TABS = [["1", "dashboard", "tabDash"], ["2", "cut bench", "tabCut"], ["3", "rig lab", "tabRig"], ["4", "sandbox", "tabBox"], ["5", "logger", "tabLog"], ["6", "keeper", "tabKeep"], ["7", "benches", "tabBench"]];
  function show(id) {
    ["tabDash", "tabCut", "tabRig", "tabBox", "tabLog", "tabKeep", "tabBench"].forEach((t) => { G().$(t).hidden = t !== id; });
    G().$$("#mainNav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
    try { G().$(id).scrollIntoView({ behavior: "auto", block: "start" }); window.scrollBy(0, -110); } catch (e) {}
  }
  function refreshGate() {
    const p = G().profile();
    const b = G().$("gateBanner");
    b.className = "";
    const cut = window.GateCut ? window.GateCut.stats() : null;
    b.innerHTML = "✂ <b>bench open</b> · level " + G().level(p.xp) + " · " + p.xp + "xp" +
      (cut ? " · " + (cut.actions || 0) + " cuts · " + (cut.exports || 0) + " exports" : "");
    G().$("brandMetaEl").textContent = "lv" + G().level(p.xp) + " · " + p.xp + "xp · bench";
    if (window.GateBox) window.GateBox.paintGate();
  }
  function boot() {
    const nav = G().$("mainNav");
    TABS.forEach(([n, label, id]) => {
      const b = document.createElement("button");
      b.dataset.tab = id;
      b.innerHTML = '<span class="n">' + n + "</span>" + label;
      b.onclick = () => show(id);
      nav.appendChild(b);
    });
    document.addEventListener("keydown", (e) => {
      const t = (e.target && e.target.tagName) || "";
      const typing = t === "INPUT" || t === "TEXTAREA" || t === "SELECT";
      if (typing) { if (e.key === "Escape") e.target.blur(); return; }
      if (e.key >= "1" && e.key <= "7") show(TABS[Number(e.key) - 1][2]);
      else if (e.key === "?") show("tabDash");
    });
    // retire the typing gate: old profiles unlock silently, once
    try {
      const p = G().profile();
      if (!p.gateUnlocked) {
        p.gateUnlocked = true; G().saveProfile(p);
        window.GateLog.log("info", "typing gate retired — bench open, all tools unlimited", null);
      }
    } catch (e) {}
    window.GateLog.boot();
    if (window.GateCut) window.GateCut.boot();
    window.GateBox.boot();
    window.GateKeep.boot();
    window.GateLearn.boot();
    if (window.GateRig) window.GateRig.boot();
    if (window.GateBench) window.GateBench.boot();
    G().on("profile", refreshGate);
    refreshGate();
    show("tabCut");
    window.GateLog.log("info", "cut bench pro boot — upload an image or try the sample card", null);
  }
  window.GateApp = { boot, show, refreshGate };
  if (document.readyState !== "loading") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
