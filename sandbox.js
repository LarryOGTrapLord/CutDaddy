/* Sandbox tester — safe JS runs, unlimited. Exposes window.GateBox. */
(function () {
  "use strict";
  const G = () => window.Gate;
  const RUNS_KEY = "gate1.pro.sandbox";
  let frame = null, pending = null;
  const EXAMPLES = {
    hello: "// hello gate\nconst name = \"tester\";\nconsole.log(\"hello \" + name);\nreturn 2 + 2;",
    fib: "// fib + assert\nfunction fib(n){ return n < 2 ? n : fib(n-1) + fib(n-2); }\nconsole.log(\"fib10\", fib(10));\nif (fib(10) !== 55) throw new Error(\"fib broken\");\nreturn fib(10);",
    gate: "// gate check: must return 42\nconsole.log(\"checking...\");\nreturn 40 + 2;"
  };
  function unlocked() { return true; }
  function runs() { return G().lsGet(RUNS_KEY, { updatedAt: 0, runs: [] }).runs || []; }
  function saveRun(r) {
    const db = G().lsGet(RUNS_KEY, { updatedAt: 0, runs: [] });
    db.runs.push(r); db.runs = db.runs.slice(-100); db.updatedAt = Date.now();
    G().lsSet(RUNS_KEY, db); G().store(RUNS_KEY, null).save(db);
  }
  function ensureFrame() {
    if (frame) return frame;
    frame = document.createElement("iframe");
    frame.className = "sandboxFrame";
    frame.setAttribute("sandbox", "allow-scripts");
    document.body.appendChild(frame);
    window.addEventListener("message", (ev) => {
      const d = ev.data;
      if (!d || d.__gateBox !== true || !pending) return;
      const p = pending; pending = null;
      clearTimeout(p.timer);
      p.done(d);
    });
    return frame;
  }
  function srcdoc(code) {
    // user code compiles via new Function so syntax errors are catchable
    // (inline <script> parse errors would silently kill the frame = fake timeout)
    const payload = JSON.stringify(String(code)).replace(/</g, "\\u003c");
    return "<!doctype html><script>" +
      "const logs=[]; console.log=(...a)=>logs.push(a.map(String).join(' ')); console.error=(...a)=>logs.push('ERROR: '+a.map(String).join(' '));" +
      "const done=(m)=>parent.postMessage(Object.assign({__gateBox:true,logs},m),'*');" +
      "let fn=null; try{ fn=new Function(" + payload + "); }" +
      "catch(e){ done({ok:false,error:'SYNTAX: '+String((e&&e.message)||e).slice(0,500)}); }" +
      "if(fn){ let r; try{ r=fn(); }" +
      "catch(e){ done({ok:false,error:String((e&&e.message)||e).slice(0,500)}); fn=null; }" +
      "if(fn){ if(r&&typeof r.then==='function'){ r.then(v=>done({ok:true,value:String(v).slice(0,2000)})).catch(e=>done({ok:false,error:String((e&&e.message)||e).slice(0,500)})); } " +
      "else done({ok:true,value:(r===undefined?'undefined':String(r)).slice(0,2000)}); } }" +
      "</scr" + "ipt>";
  }
  function run(code) {
    return new Promise((resolve) => {
      const fr = ensureFrame();
      const timer = setTimeout(() => { if (pending) { pending = null; resolve({ ok: false, error: "TIMEOUT: 3s exceeded", logs: [] }); } }, 3000);
      pending = { timer, done: resolve };
      try { fr.srcdoc = srcdoc(code); } catch (e) { pending = null; clearTimeout(timer); resolve({ ok: false, error: String(e.message || e), logs: [] }); }
    });
  }
  const TESTS = [
    { name: "returns 42", check: (v) => String(v).trim() === "42" },
    { name: "no ERROR lines", check: (v, r) => !(r.logs || []).some((l) => /^ERROR/.test(l)) },
    { name: "logged something", check: (v, r) => (r.logs || []).length > 0 }
  ];
  async function runTests(code) {
    const r = await run(code);
    if (!r.ok) return { ...r, checks: TESTS.map((t) => ({ name: t.name, pass: false })) };
    const checks = TESTS.map((t) => { let pass = false; try { pass = !!t.check(r.value, r); } catch (e) { pass = false; } return { name: t.name, pass }; });
    return { ...r, checks };
  }
  function paintOut(res, ms) {
    const el = G().$("sandboxOut");
    let html = res.ok ? '<span class="pill pass">ok</span>' : '<span class="pill fail">fail</span>';
    html += ' <span class="mono">' + ms + "ms</span>\n";
    (res.logs || []).forEach((l) => { html += G().esc(l) + "\n"; });
    if (res.ok) html += "→ " + G().esc(res.value);
    else html += "✖ " + G().esc(res.error);
    if (res.checks) html += "\n" + res.checks.map((c) => (c.pass ? "✅ " : "❌ ") + G().esc(c.name)).join("\n");
    el.innerHTML = html;
  }
  async function doRun(withTests) {
    const code = G().$("sandboxCode").value;
    const btn = withTests ? G().$("sandboxTestBtn") : G().$("sandboxRunBtn");
    btn.disabled = true; btn.textContent = "running…";
    const t0 = performance.now();
    try {
      const res = withTests ? await runTests(code) : await run(code);
      const ms = Math.round(performance.now() - t0);
      paintOut(res, ms);
      const passed = res.ok && (!res.checks || res.checks.every((c) => c.pass));
      saveRun({ t: Date.now(), ok: res.ok, passed: !!passed, ms, len: code.length, tests: withTests });
      G().addXP(passed ? 15 : 3, passed ? "sandbox pass" : "sandbox run");
      window.GateLog.log("test", "sandbox " + (passed ? "PASS" : res.ok ? "ran" : "FAIL") + " (" + ms + "ms, " + code.length + "ch)" + (res.ok ? " → " + String(res.value).slice(0, 80) : ": " + res.error), null);
      G().emit("sandbox", res);
    } finally { btn.disabled = false; btn.textContent = withTests ? "run + tests" : "▶ run"; paintGate(); }
  }
  function paintGate() {
    const el = G().$("sandboxGateEl"); if (!el) return;
    el.innerHTML = "unlimited runs · 3s timeout";
  }
  function boot() {
    if (!G().$("sandboxCode")) return;
    G().$("sandboxExEl").onchange = (e) => { G().$("sandboxCode").value = EXAMPLES[e.target.value] || ""; };
    G().$("sandboxCode").value = EXAMPLES.hello;
    G().$("sandboxRunBtn").onclick = () => doRun(false);
    G().$("sandboxTestBtn").onclick = () => doRun(true);
    G().$("sandboxClearBtn").onclick = () => { G().$("sandboxOut").textContent = "ready."; };
    paintGate();
    G().on("profile", paintGate);
  }
  window.GateBox = { boot, run, runTests, runs, paintGate };
})();
