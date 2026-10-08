/* Learning dashboard — XP, streaks, bench curve, tips. Exposes window.GateLearn. */
(function () {
  "use strict";
  const G = () => window.Gate;
  function spark(canvas, vals, label) {
    const g = canvas.getContext("2d"), W = canvas.width = canvas.clientWidth * 2 || 600, H = canvas.height = 160;
    g.fillStyle = "#0a0e12"; g.fillRect(0, 0, W, H);
    if (!vals.length) { g.fillStyle = "#7d93ad"; g.font = "24px monospace"; g.fillText(label || "cut something — the curve appears", 20, 80); return; }
    const max = Math.max(...vals, 10);
    g.strokeStyle = "#38e1a8"; g.lineWidth = 3; g.beginPath();
    vals.forEach((v, i) => {
      const x = 10 + (i / Math.max(1, vals.length - 1)) * (W - 20), y = H - 14 - (v / max) * (H - 30);
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    });
    g.stroke();
    g.fillStyle = "#7d93ad"; g.font = "22px monospace";
    g.fillText(vals[vals.length - 1] + "xp", 14, 30);
  }
  function xpSeries() {
    // rebuild a rough per-session XP curve from the log (learn entries carry +Nxp)
    try {
      const all = window.GateLog.all();
      const vals = [];
      let run = 0;
      all.slice(-120).forEach((e) => {
        if (e.kind === "learn") {
          const m = /\+(\d+)xp/.exec(e.msg || "");
          if (m) { run += Number(m[1]); vals.push(run); }
        }
      });
      return vals.slice(-30);
    } catch (e) { return []; }
  }
  function paint() {
    if (!G().$("dashEl")) return;
    const p = G().profile(), lvl = G().level(p.xp);
    const sRuns = window.GateBox ? window.GateBox.runs() : [];
    const notes = window.GateKeep ? window.GateKeep.notes() : [];
    const cut = window.GateCut ? window.GateCut.stats() : { actions: 0, exports: 0, keeps: 0, days: [] };
    const passN = sRuns.filter((r) => r.passed).length;
    G().$("dashEl").innerHTML =
      '<div class="grid2">' +
      '<div class="stat"><div class="v">Lv ' + lvl + '</div><div class="l">' + p.xp + ' xp · ' + (100 - (p.xp % 100)) + ' to next</div><div class="xpbar" style="margin-top:8px"><i style="width:' + (p.xp % 100) + '%"></i></div></div>' +
      '<div class="stat"><div class="v">' + (p.streakDays || []).length + '🔥</div><div class="l">day streak · bench open</div></div>' +
      '<div class="stat"><div class="v">' + (cut.actions || 0) + '</div><div class="l">cut actions · ' + (cut.exports || 0) + ' exports · ' + (cut.keeps || 0) + ' kept</div></div>' +
      '<div class="stat"><div class="v">' + passN + "/" + sRuns.length + '</div><div class="l">sandbox passes · ' + notes.length + " notes kept</div></div></div>";
    spark(G().$("learnSpark"), xpSeries());
    const weak = G().$("learnWeakEl");
    if (weak) {
      const r = window.GateCut && window.GateCut.recipeJSON ? window.GateCut.recipeJSON() : null;
      weak.innerHTML = r
        ? "bench: " + r.strokes.length + " strokes · " + r.magics.length + " magic cuts · " + r.retouchOps.length + " retouch ops · feather " + r.feather + " · contract " + r.contract
        : "bench is empty — upload an image or try the sample card.";
    }
    let tip = "Magic-cut the sample card's green, then paint back the edges with the keep brush.";
    if ((cut.actions || 0) >= 10 && !(cut.exports || 0)) tip = "Nice cutting — hit export PNG to get a transparent asset.";
    else if ((cut.exports || 0) >= 1 && !(cut.keeps || 0)) tip = "Exported! Keep it as a note so PATCHES can file it.";
    else if ((cut.keeps || 0) >= 1) tip = "Asset filed. Feed a cut PNG into Rig Lab as a character source.";
    G().$("learnTipEl").innerHTML = tip;
  }
  function boot() {
    if (!G().$("dashEl")) return;
    ["log", "cut", "sandbox", "keeper", "profile"].forEach((ev) => G().on(ev, () => paint()));
    paint();
  }
  window.GateLearn = { boot, paint };
})();
