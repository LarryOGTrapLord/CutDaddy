/* Info logger — every event, one searchable stream. Exposes window.GateLog. */
(function () {
  "use strict";
  const G = () => window.Gate;
  const KEY = "gate1.pro.log";
  const CAP = 1000, DOM_CAP = 200;
  const KINDS = ["info", "warn", "error", "cut", "test", "keeper", "learn", "gate", "type"];
  let paused = false, held = [], kindF = "all", q = "";
  const store = () => G().store(KEY, { updatedAt: 0, entries: [] });
  function all() { return (G().lsGet(KEY, { entries: [] }).entries) || []; }
  function log(kind, msg, data) {
    if (!KINDS.includes(kind)) kind = "info";
    const db = G().lsGet(KEY, { updatedAt: 0, entries: [] });
    const e = { t: Date.now(), kind, msg: String(msg ?? "").slice(0, 500), data: data === undefined ? undefined : JSON.parse(JSON.stringify(data).slice(0, 1500)) };
    db.entries.push(e);
    while (db.entries.length > CAP) db.entries.shift();
    db.updatedAt = Date.now();
    G().lsSet(KEY, db);
    G().store(KEY, null).save(db);
    G().emit("log", e);
    paintOne(e);
    return e;
  }
  function match(e) { return (kindF === "all" || e.kind === kindF) && (!q || ((e.kind + " " + e.msg).toLowerCase().includes(q))); }
  function row(e) {
    const d = document.createElement("div");
    d.innerHTML = '<span class="mono">' + new Date(e.t).toISOString().slice(11, 19) + '</span> <span class="pill ' + e.kind + '">' + e.kind + "</span> " + G().esc(e.msg);
    return d;
  }
  function paintOne(e) {
    const list = G().$("logList"); if (!list) return;
    if (paused) { held.push(e); if (held.length > 100) held.shift(); paintPause(); return; }
    if (!match(e)) return;
    list.appendChild(row(e));
    while (list.children.length > DOM_CAP) list.firstChild.remove();
    if (G().$("logScrollChk") && G().$("logScrollChk").checked) list.scrollTop = list.scrollHeight;
    paintCount();
  }
  function paintAll() {
    const list = G().$("logList"); if (!list) return;
    list.innerHTML = "";
    const frag = document.createDocumentFragment();
    all().slice(-DOM_CAP).forEach((e) => { if (match(e)) frag.appendChild(row(e)); });
    list.appendChild(frag);
    list.scrollTop = list.scrollHeight;
    paintCount();
  }
  function paintCount() {
    const el = G().$("logCountEl"); if (!el) return;
    const a = all();
    el.textContent = q || kindF !== "all" ? a.filter(match).length + "/" + a.length : String(a.length);
  }
  function paintPause() { const b = G().$("logPauseBtn"); if (b) b.textContent = paused ? "resume (" + held.length + ")" : "pause"; }
  function boot() {
    if (!G().$("logList")) return;
    const ks = G().$("logKindEl");
    ks.innerHTML = '<option value="all">all kinds</option>' + KINDS.map((k) => '<option value="' + k + '">' + k + "</option>").join("");
    ks.onchange = () => { kindF = ks.value; paintAll(); };
    G().$("logSearchInput").oninput = G().debounce((e) => { q = e.target.value.trim().toLowerCase(); paintAll(); }, 150);
    G().$("logPauseBtn").onclick = () => {
      paused = !paused;
      if (!paused && held.length) { held.forEach((e) => { if (match(e)) G().$("logList").appendChild(row(e)); }); held = []; paintAll(); }
      paintPause();
    };
    G().$("logClearBtn").onclick = () => { if (!confirm("clear log?")) return; G().lsSet(KEY, { updatedAt: Date.now(), entries: [] }); paintAll(); };
    G().$("logExportBtn").onclick = () => G().download("gate1-log.json", JSON.stringify(all(), null, 2));
    G().$("logCsvBtn").onclick = () => {
      const csv = "t,kind,msg\n" + all().map((e) => new Date(e.t).toISOString() + "," + e.kind + ',"' + String(e.msg).replace(/"/g, '""') + '"').join("\n");
      G().download("gate1-log.csv", csv, "text/csv");
    };
    paintAll();
  }
  window.GateLog = { log, all, boot, KINDS };
})();
