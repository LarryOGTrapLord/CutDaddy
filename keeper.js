/* Intuitive data keeper — notes with tags, pins, search. Exposes window.GateKeep. */
(function () {
  "use strict";
  const G = () => window.Gate;
  const KEY = "gate1.pro.keeper";
  const data = () => G().lsGet(KEY, { updatedAt: 0, notes: [] });
  function save(db) { db.updatedAt = Date.now(); G().lsSet(KEY, db); G().store(KEY, null).save(db); }
  function notes() { return (data().notes) || []; }
  let q = "", tagF = "all";
  function allTags() {
    const s = new Set();
    notes().forEach((n) => { (n.tags || []).forEach((t) => { s.add(t); }); });
    return Array.from(s).sort();
  }
  function filtered() {
    const qq = q;
    const rows = notes().filter((n) => {
      if (tagF !== "all" && !(n.tags || []).includes(tagF)) return false;
      if (!qq) return true;
      const hay = ((n.title || "") + " " + (n.body || "") + " " + (n.tags || []).join(" ")).toLowerCase();
      return hay.includes(qq);
    });
    return rows.sort((a, b) => ((b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) || (b.updatedAt - a.updatedAt));
  }
  function paint() {
    const list = G().$("keeperList"); if (!list) return;
    const rows = filtered();
    list.innerHTML = rows.length ? "" : '<div class="kv">nothing here — write your first note above.</div>';
    const frag = document.createDocumentFragment();
    rows.forEach((n) => {
      const d = document.createElement("div");
      d.className = "note" + (n.pinned ? " pinned" : "");
      d.innerHTML = "<h4>" + (n.pinned ? "📌 " : "") + G().esc(n.title || "(untitled)") + '</h4><div class="body">' + G().esc(n.body) + "</div>" +
        '<div style="margin-top:6px">' + (n.tags || []).map((t) => '<span class="tag">' + G().esc(t) + "</span>").join("") + '<span class="mono">' + new Date(n.updatedAt).toISOString().slice(0, 16).replace("T", " ") + "</span></div>";
      const bar = document.createElement("div");
      bar.className = "row"; bar.style.marginTop = "8px";
      const mk = (label, fn) => { const b = document.createElement("button"); b.textContent = label; b.onclick = fn; bar.appendChild(b); };
      mk(n.pinned ? "unpin" : "pin", () => { n.pinned = !n.pinned; n.updatedAt = Date.now(); const db = data(); db.notes = db.notes.map((x) => x.id === n.id ? n : x); save(db); paint(); paintTags(); });
      mk("edit", () => { G().$("keeperTitleInput").value = n.title; G().$("keeperBodyInput").value = n.body; G().$("keeperTagsInput").value = (n.tags || []).join(", "); G().$("keeperIdInput").value = n.id; G().$("keeperTitleInput").focus(); });
      mk("delete", () => { if (!confirm("delete note?")) return; const db = data(); db.notes = db.notes.filter((x) => x.id !== n.id); save(db); window.GateLog.log("keeper", "note deleted: " + n.title, null); paint(); paintTags(); G().emit("keeper", null); });
      d.appendChild(bar);
      frag.appendChild(d);
    });
    list.appendChild(frag);
    const c = G().$("keeperCountEl");
    if (c) c.textContent = rows.length + "/" + notes().length;
  }
  function paintTags() {
    const sel = G().$("keeperTagEl"); if (!sel) return;
    const keep = tagF;
    sel.innerHTML = '<option value="all">all tags</option>' + allTags().map((t) => '<option value="' + G().esc(t) + '">' + G().esc(t) + "</option>").join("");
    if (allTags().includes(keep)) { sel.value = keep; tagF = keep; } else tagF = "all";
  }
  function upsert() {
    const title = G().$("keeperTitleInput").value.trim(), body = G().$("keeperBodyInput").value.trim();
    const tags = G().$("keeperTagsInput").value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).slice(0, 5);
    const id = G().$("keeperIdInput").value || null;
    if (!id && !title && !body) return;
    const db = data();
    if (id) {
      const n = db.notes.find((x) => x.id === id);
      if (n) { n.title = title; n.body = body; n.tags = tags; n.updatedAt = Date.now(); window.GateLog.log("keeper", "note updated: " + title, null); }
    } else {
      db.notes.push({ id: "n" + Date.now().toString(36), title, body, tags, pinned: false, updatedAt: Date.now() });
      window.GateLog.log("keeper", "note kept: " + (title || body.slice(0, 40)), null);
      G().addXP(4, "keeper note");
    }
    save(db);
    G().$("keeperTitleInput").value = ""; G().$("keeperBodyInput").value = ""; G().$("keeperTagsInput").value = ""; G().$("keeperIdInput").value = "";
    paint(); paintTags(); G().emit("keeper", null);
  }
  function boot() {
    if (!G().$("keeperList")) return;
    G().$("keeperSaveBtn").onclick = upsert;
    G().$("keeperClearBtn").onclick = () => { G().$("keeperTitleInput").value = ""; G().$("keeperBodyInput").value = ""; G().$("keeperTagsInput").value = ""; G().$("keeperIdInput").value = ""; };
    G().$("keeperSearchInput").oninput = G().debounce((e) => { q = e.target.value.trim().toLowerCase(); paint(); }, 150);
    G().$("keeperTagEl").onchange = (e) => { tagF = e.target.value; paint(); };
    G().$("keeperExportBtn").onclick = () => G().download("gate1-keeper.json", JSON.stringify(notes(), null, 2));
    G().$("keeperImportBtn").onclick = () => G().$("keeperFileInput").click();
    G().$("keeperFileInput").onchange = () => {
      const f = G().$("keeperFileInput").files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const arr = JSON.parse(r.result);
          if (!Array.isArray(arr)) throw new Error("not an array");
          const db = data();
          arr.slice(0, 200).forEach((n) => { if (n && (n.title || n.body)) db.notes.push({ id: "n" + Math.random().toString(36).slice(2), title: String(n.title || ""), body: String(n.body || ""), tags: [], pinned: false, updatedAt: Date.now() }); });
          save(db); paint(); paintTags(); window.GateLog.log("keeper", "imported " + arr.length + " notes", null);
        } catch (e) { alert("import failed: " + e.message); }
      };
      r.readAsText(f);
      G().$("keeperFileInput").value = "";
    };
    paint(); paintTags();
  }
  window.GateKeep = { boot, notes, paint };
})();
