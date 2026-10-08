/* PATCHES the ragdoll — silent mascot. Never moves, never talks.
   Every trigger (cut milestones, sandbox pass, rig milestones, level-up)
   sews on one patch and drops a keeper note holding a small asset.
   Goal loop: patch up the doll (24) + collect the assets. Exposes window.GateDoll. */
(function () {
  "use strict";
  const G = () => window.Gate;
  const KEY = "gate1.pro.doll";
  const MAX = 24;
  const MILESTONES = { 6: 20, 12: 40, 18: 60, 24: 120 };

  // asset drops, cycled in order — each note body is something usable
  const ASSETS = [
    { title: "cut preset: green screen", tags: ["asset", "cut"], body: "magic color #2fae5f, tolerance 32.\nclick the green, then keep-brush the edges back.\nfeather 2, contract 0." },
    { title: "cut preset: portrait hair", tags: ["asset", "cut"], body: "brush 24, hardness 20, feather 4, contract -2.\ncut around hair, then keep-stroke the strands.\nzoom the page (ctrl-+) for fine work." },
    { title: "sandbox snippet: assert", tags: ["asset", "sandbox"], body: "function assert(c, m){ if(!c) throw new Error(m || 'assert'); }\nconsole.log('wired');\nassert(2 + 2 === 4, 'math broke');\nreturn 'assert ok';" },
    { title: "rig pose: hero stance", tags: ["asset", "rig"], body: "paste angles into Rig Lab sliders:\nupperArmN -30, upperArmF 30, thighN -12, thighF 12, head 4\nscreenshot it. that's your cover art." },
    { title: "palette: lab neon", tags: ["asset", "palette"], body: "#38e1a8 #5ec8ff #ffcc55 #ff6b6b #0a0e12\nuse for canvas + UI accents." },
    { title: "retouch recipe: clean scan", tags: ["asset", "retouch"], body: "heal dust spots (brush = spot size),\nbright +6, contrast +12, warmth -8, sharpen 25.\nclone-stamp torn corners from nearby paper." },
    { title: "sandbox snippet: fib", tags: ["asset", "sandbox"], body: "function fib(n){ return n < 2 ? n : fib(n-1) + fib(n-2); }\nconsole.log('fib10', fib(10));\nif (fib(10) !== 55) throw new Error('fib broken');\nreturn fib(10);" },
    { title: "keeper template: lab notes", tags: ["asset", "keeper"], body: "OBSERVED:\nTRIED:\nRESULT:\nNEXT:\ncopy this into new notes. future-you says thanks." },
    { title: "rig pose: sneak", tags: ["asset", "rig"], body: "torso 18, head 10, thighN -30, shinN 35, thighF 10, upperArmN 20\nlower the body Y by 20. sneaky." },
    { title: "palette: dusk rig", tags: ["asset", "palette"], body: "#6c5ce7 #4fc3ff #e8a95e #ff5a5a #22262e\nfar limbs = darker shade of near." },
    { title: "cut preset: product shot", tags: ["asset", "cut"], body: "rect-crop tight, lasso the product,\nmagic the backdrop at tolerance 24,\ncontract +1, feather 1, export PNG." },
    { title: "retouch recipe: sticker pop", tags: ["asset", "retouch"], body: "cut the subject, contract +2 for a clean edge,\nsaturate 130, contrast +15, sharpen 40.\nread as sticker / sprite." },
    { title: "rig checklist", tags: ["asset", "rig"], body: "regions fit? pivots on joints? far limbs behind?\npose test: wave. dance test: on.\nexport JSON + snapshot. keep as note." },
  ];

  // 24 stitch positions on the 48x64 doll (x, y, size, rot)
  const SPOTS = [
    [14, 40, 9, 12], [30, 44, 8, -15], [22, 52, 10, 5], [12, 30, 7, -20], [34, 32, 8, 18],
    [24, 24, 7, 0], [10, 50, 8, 25], [36, 54, 9, -8], [18, 60, 7, 14], [28, 62, 8, -22],
    [8, 40, 6, 30], [40, 42, 6, -30], [20, 34, 6, 8], [30, 28, 6, -12], [24, 46, 6, 20],
    [14, 58, 6, -5], [34, 60, 6, 10], [22, 18, 6, 0], [28, 20, 5, 15], [18, 26, 5, -15],
    [26, 56, 5, 25], [12, 22, 5, -25], [36, 24, 5, 20], [24, 38, 5, 0],
  ];
  const COLORS = ["#38e1a8", "#5ec8ff", "#ffcc55", "#ff6b6b", "#c39bff", "#ffb27a"];

  const db = () => G().lsGet(KEY, { updatedAt: 0, patches: [], nextAsset: 0 });
  function save(d) { d.updatedAt = Date.now(); G().lsSet(KEY, d); G().store(KEY, null).save(d); }
  const count = () => db().patches.length;

  function paint() {
    const grp = G().$("dollPatches"), bar = G().$("dollBar");
    if (!grp || !bar) return;
    const d = db(), n = Math.min(MAX, d.patches.length);
    grp.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const [x, y, s, r] = SPOTS[i];
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", x - s / 2); rect.setAttribute("y", y - s / 2);
      rect.setAttribute("width", s); rect.setAttribute("height", s);
      rect.setAttribute("rx", 1.5);
      rect.setAttribute("fill", COLORS[i % COLORS.length]);
      rect.setAttribute("stroke", "#0a0e12");
      rect.setAttribute("stroke-width", "1");
      rect.setAttribute("stroke-dasharray", "2 1.2");
      rect.setAttribute("transform", "rotate(" + r + " " + x + " " + y + ")");
      grp.appendChild(rect);
    }
    const last = d.patches[d.patches.length - 1];
    G().$("dollStatusEl").innerHTML = "PATCHES · <b>" + n + "/" + MAX + "</b> patches" +
      (n >= MAX ? " · <b>fully patched</b>" : "") +
      (last ? ' · last drop: <b>' + G().esc(last.asset) + "</b>" : " · no drops yet — go cut something");
    const btn = G().$("dollNoteBtn");
    if (btn) btn.hidden = !last;
  }

  function dropNote(asset, why) {
    const d = db();
    const a = ASSETS[d.nextAsset % ASSETS.length];
    d.nextAsset++;
    const kdb = G().lsGet("gate1.pro.keeper", { updatedAt: 0, notes: [] });
    kdb.notes.push({
      id: "n" + Date.now().toString(36) + "d",
      title: "patch #" + (d.patches.length + 1) + ": " + (asset || a.title),
      body: (asset && asset.body) || a.body,
      tags: ["patch", "asset", why || "drop"],
      pinned: false, fromMascot: true, updatedAt: Date.now(),
    });
    kdb.updatedAt = Date.now();
    G().lsSet("gate1.pro.keeper", kdb); G().store("gate1.pro.keeper", null).save(kdb);
    if (window.GateKeep) window.GateKeep.paint();
    return a.title;
  }

  function addPatch(kind) {
    const d = db();
    if (d.patches.length >= MAX) return count();
    const title = dropNote(null, kind);
    d.patches.push({ t: Date.now(), kind, asset: title });
    save(d); paint();
    window.GateLog.log("keeper", "PATCHES left a note (" + kind + "): " + title, null);
    G().addXP(6, "patch (" + kind + ")");
    if (MILESTONES[d.patches.length]) {
      G().addXP(MILESTONES[d.patches.length], "patch milestone " + d.patches.length + "/" + MAX);
      window.GateLog.log("info", "PATCHES milestone " + d.patches.length + "/" + MAX + " — bonus xp", null);
    }
    if (d.patches.length >= MAX) window.GateLog.log("info", "PATCHES is fully patched. it does not thank you. it cannot move.", null);
    return count();
  }

  let lastLevel = 1;
  try { lastLevel = G().level(G().profile().xp); } catch (e) {}

  function boot() {
    if (!G().$("dollBar")) return;
    paint();
    G().$("dollNoteBtn").onclick = () => { if (window.GateApp) window.GateApp.show("tabKeep"); };
    G().on("sandbox", (res) => { if (res && res.ok && (!res.checks || res.checks.every((c) => c.pass))) addPatch("sandbox"); });
    G().on("cut", (ev) => {
      const k = ev && ev.kind;
      if (k === "magic" || k === "lasso" || k === "export" || k === "keep" || k === "retouch") addPatch("cut-" + k);
    });
    G().on("rig", (ev) => {
      const k = ev && ev.kind;
      if (k === "dice" || k === "export" || k === "selftest") addPatch("rig-" + k);
    });
    G().on("profile", (p) => {
      if (!p) return;
      const lv = G().level(p.xp || 0);
      if (lv > lastLevel) { lastLevel = lv; addPatch("level"); }
    });
  }

  window.GateDoll = { boot, addPatch, count, paint };
  window.GatePersona = { boot, speak() {}, say() {} }; // retired: silent now
  if (document.readyState !== "loading") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
