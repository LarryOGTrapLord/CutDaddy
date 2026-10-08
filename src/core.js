/* Gate core — utils + persistent store + event bus + XP.
   Load FIRST. Exposes window.Gate. No dependencies. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
  const debounce = (fn, ms) => { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms || 150); }; };
  function download(name, text, type) {
    const b = new Blob([text], { type: type || "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  // --- storage: localStorage primary, kv mirror (folder gate1) ---
  const kv = () => { try { const k = window.root && window.root.kv && window.root.kv.gate1; return (k && typeof k.get === "function") ? k : null; } catch (e) { return null; } };
  function lsGet(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : clone(fallback); }
    catch (e) { return clone(fallback); }
  }
  function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  let mirrorT = 0;
  function mirror(key, val) {
    const k = kv(); if (!k) return;
    clearTimeout(mirrorT);
    mirrorT = setTimeout(() => { try { k.set(key, val).catch(() => {}); } catch (e) {} }, 800);
  }
  function store(key, fallback) {
    return {
      load() { return lsGet(key, fallback); },
      save(val) { lsSet(key, val); mirror(key, val); },
      async adopt() { // pull newer kv copy if present
        try {
          const k = kv(); if (!k) return null;
          const remote = await k.get(key);
          const local = lsGet(key, null);
          if (remote && remote.updatedAt && (!local || (local.updatedAt || 0) < remote.updatedAt)) { lsSet(key, remote); return remote; }
        } catch (e) {}
        return null;
      }
    };
  }
  // --- event bus ---
  const subs = {};
  function on(ev, fn) { (subs[ev] = subs[ev] || []).push(fn); }
  function emit(ev, data) { (subs[ev] || []).forEach((fn) => { try { fn(data); } catch (e) {} }); }
  // --- profile / XP / streak ---
  const profileStore = store("gate1.pro.profile", { updatedAt: 0, xp: 0, gateUnlocked: true, gateBest: null, runs: 0, streakDays: [], lastDay: null });
  function profile() { return lsGet("gate1.pro.profile", { updatedAt: 0, xp: 0, gateUnlocked: true, gateBest: null, runs: 0, streakDays: [], lastDay: null }); }
  function saveProfile(p) { p.updatedAt = Date.now(); lsSet("gate1.pro.profile", p); mirror("gate1.pro.profile", p); emit("profile", p); }
  function level(xp) { return 1 + Math.floor(xp / 100); }
  function addXP(n, why) {
    const p = profile();
    p.xp += n; p.runs++;
    const day = new Date().toISOString().slice(0, 10);
    if (p.lastDay !== day) {
      p.lastDay = day;
      if (!p.streakDays.includes(day)) { p.streakDays.push(day); p.streakDays = p.streakDays.slice(-30); }
    }
    saveProfile(p);
    if (window.GateLog) window.GateLog.log("learn", "+" + n + "xp " + (why || ""), null);
    return p;
  }
  window.Gate = { $, $$, esc, clone, debounce, download, store, lsGet, lsSet, on, emit, profile, saveProfile, level, addXP };
})();
