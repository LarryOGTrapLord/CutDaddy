/* GateSelect — shared selection-box editor used by the cut bench crop and rig regions.
   One box model everywhere: 8 handles (corners pull two sides, edges pull one —
   the other sides never move), drag-inside moves the whole box, lock freezes it,
   outline color + line style (solid / dash / dots / x-cross / marching ants).
   Pure canvas helpers, no dependencies. Exposes window.GateSelect. */
(function () {
  "use strict";

  const STYLES = ["solid", "dash", "dots", "x", "ants"];

  // 8 handles in canvas px: corners + edge midpoints
  function handles(x, y, w, h) {
    const cx = x + w / 2, cy = y + h / 2;
    return [
      { m: "nw", x: x, y: y }, { m: "n", x: cx, y: y }, { m: "ne", x: x + w, y: y },
      { m: "e", x: x + w, y: cy },
      { m: "se", x: x + w, y: y + h }, { m: "s", x: cx, y: y + h }, { m: "sw", x: x, y: y + h },
      { m: "w", x: x, y: cy },
    ];
  }
  function hitHandle(hs, x, y, rad) {
    for (let i = 0; i < hs.length; i++) {
      if (Math.hypot(x - hs[i].x, y - hs[i].y) <= rad) return hs[i].m;
    }
    return null;
  }
  function inBox(b, x, y, pad) {
    const p = pad || 0;
    return x >= b.x - p && x <= b.x + b.w + p && y >= b.y - p && y <= b.y + b.h + p;
  }

  // Mutate box {x,y,w,h} by dragging handle m. start = box snapshot at grab,
  // dx/dy = pointer delta since grab (same units). Only the grabbed sides move.
  function applyDrag(box, m, start, dx, dy, min) {
    const mn = min == null ? 4 : min;
    const setW = (v) => { box.w = Math.max(mn, v); };
    const setH = (v) => { box.h = Math.max(mn, v); };
    if (m === "move") { box.x = start.x + dx; box.y = start.y + dy; return box; }
    if (m.indexOf("e") >= 0) setW(start.w + dx);
    if (m.indexOf("w") >= 0) {
      const w = Math.max(mn, start.w - dx);
      box.x = start.x + (start.w - w); box.w = w;
    }
    if (m.indexOf("s") >= 0) setH(start.h + dy);
    if (m.indexOf("n") >= 0) {
      const h = Math.max(mn, start.h - dy);
      box.y = start.y + (start.h - h); box.h = h;
    }
    return box;
  }

  // Styled outline + handles. o = {color, style, t, selected, locked, dim, hs}
  function drawBox(g, x, y, w, h, o) {
    o = o || {};
    const color = o.color || "#38e1a8";
    const style = STYLES.indexOf(o.style) >= 0 ? o.style : "solid";
    const t = o.t || 0;
    g.save();
    g.globalAlpha = o.locked ? 0.55 : (o.dim ? 0.6 : 1);
    g.strokeStyle = color;
    g.fillStyle = color;
    const lw = o.selected ? 2.5 : 1.4;
    if (style === "dots") {
      g.lineWidth = Math.max(3, lw + 1);
      g.lineCap = "round";
      g.setLineDash([0.1, 7]);
    } else if (style === "dash") {
      g.lineWidth = lw;
      g.setLineDash([8, 5]);
    } else if (style === "ants") {
      g.lineWidth = lw;
      g.setLineDash([10, 6]);
      g.lineDashOffset = -((t / 60) % 16);
    } else {
      g.lineWidth = lw; // solid + x
      g.setLineDash([]);
    }
    g.strokeRect(x, y, w, h);
    if (style === "x") { // cross through the box
      g.beginPath();
      g.moveTo(x, y); g.lineTo(x + w, y + h);
      g.moveTo(x + w, y); g.lineTo(x, y + h);
      g.stroke();
    }
    g.setLineDash([]); g.lineDashOffset = 0;
    if (o.locked) { // padlock glyph, top-left inside
      const lx = x + 7, ly = y + 7;
      g.lineWidth = 2;
      g.strokeRect(lx, ly + 5, 12, 9);
      g.beginPath(); g.arc(lx + 6, ly + 5, 4, Math.PI, 0); g.stroke();
      g.fillRect(lx + 5, ly + 8, 2, 3);
    } else if (o.selected) {
      const s = Math.max(8, o.hs || 10), h2 = s / 2;
      handles(x, y, w, h).forEach((pt) => {
        g.fillStyle = color;
        g.fillRect(pt.x - h2, pt.y - h2, s, s);
        g.strokeStyle = "#0a0e12"; g.lineWidth = 1.5;
        g.strokeRect(pt.x - h2, pt.y - h2, s, s);
      });
    }
    g.restore();
  }

  window.GateSelect = { STYLES, handles, hitHandle, inBox, applyDrag, drawBox };
})();
