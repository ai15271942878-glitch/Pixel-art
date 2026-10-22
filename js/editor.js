// 像素画编辑器：画布渲染、缩放平移、绘图工具、撤销重做

import { nearestIndex } from './color.js';

const MIN_SCALE = 1;
const MAX_SCALE = 120;
const HISTORY_LIMIT = 200;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function lineCells(x0, y0, x1, y1) {
  const pts = [];
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    pts.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return pts;
}

function rectCells(a, b, filled) {
  const pts = [];
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (filled || x === x0 || x === x1 || y === y0 || y === y1) pts.push([x, y]);
    }
  }
  return pts;
}

// 椭圆：以拖拽框为外接矩形；描边取填充区域的边界格
function ellipseCells(a, b, filled) {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2 + 0.5, ry = (y1 - y0) / 2 + 0.5;
  const inside = (x, y) => {
    const dx = (x - cx) / rx, dy = (y - cy) / ry;
    return dx * dx + dy * dy <= 1;
  };
  const pts = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue;
      if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) pts.push([x, y]);
    }
  }
  return pts;
}

// 笔刷：从落点向右下扩展成 N×N 方块
function brushCells(pts, n) {
  if (n <= 1) return pts;
  const out = [];
  for (const [x, y] of pts) for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) out.push([x + dx, y + dy]);
  return out;
}

export class Editor {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks;

    this.width = 29;
    this.height = 29;
    this.cells = new Int16Array(this.width * this.height).fill(-1);
    this.palette = { id: '', name: '', colors: [] };
    this.color = 0;
    this.tool = 'pencil';
    this.prevTool = 'pencil';
    this.view = { s: 16, ox: 0, oy: 0 };
    this.opts = { grid: true, codes: false, boardSize: 0, mirrorX: false, mirrorY: false, brush: 1 };
    this.highlight = null;

    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;

    this.pointers = new Map();
    this.action = null;
    this.hover = null;
    this.spaceDown = false;

    this.bitmap = document.createElement('canvas');
    this.checker = document.createElement('canvas');
    this.needsBitmap = true;
    this.cssW = 0;
    this.cssH = 0;
    this.dpr = 1;
    this._raf = 0;
    this._autoFit = true;
    this._readTheme();
    const onTheme = () => {
      this._readTheme();
      this.requestRender();
    };
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme);
    new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    this._bindEvents();
    new ResizeObserver(() => this._resize()).observe(canvas.parentElement);
  }

  // ---------- 文档 ----------

  // history: 'push' 可撤销；'keep' 直接替换但保留已有撤销记录；'reset' 清空撤销记录
  load({ width, height, cells, palette }, { history = 'reset', fit = true } = {}) {
    const undoable = history === 'push';
    if (undoable) this.beginHistory();
    else {
      if (history === 'reset') this.undoStack.length = 0;
      this.redoStack.length = 0;
    }
    const resized = width !== this.width || height !== this.height;
    this.width = width;
    this.height = height;
    this.cells = cells;
    if (palette) this.palette = palette;
    if (this.color >= this.palette.colors.length) this.color = 0;
    this.highlight = null;
    if (undoable) this.endHistory('load');
    this._markDirty();
    if (fit === true || (fit === 'auto' && resized)) this.fit();
    this._emit('load');
  }

  hasContent() {
    return this.cells.some((v) => v >= 0);
  }

  counts() {
    const m = new Map();
    for (const v of this.cells) if (v >= 0) m.set(v, (m.get(v) || 0) + 1);
    return m;
  }

  // 换色卡：同色号的直接对应，否则映射到新色卡里最接近的颜色
  remapPalette(palette) {
    this.beginHistory();
    const all = palette.colors.map((_, i) => i);
    const byCode = new Map(palette.colors.map((c, i) => [c.code, i]));
    const map = this.palette.colors.map((c) => byCode.get(c.code) ?? nearestIndex(c.lab, palette.colors, all));
    for (let i = 0; i < this.cells.length; i++) {
      const v = this.cells[i];
      if (v >= 0) this.cells[i] = map[v] ?? -1;
    }
    const cur = this.palette.colors[this.color];
    this.palette = palette;
    this.color = cur ? nearestIndex(cur.lab, palette.colors, all) : 0;
    this.highlight = null;
    this._markDirty();
    this.endHistory('palette');
  }

  replaceColor(from, to) {
    this.beginHistory();
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i] === from) this.cells[i] = to;
    this._markDirty();
    this.endHistory('edit');
  }

  resize(nw, nh, anchor = 'center') {
    const ow = this.width, oh = this.height, old = this.cells;
    if (nw === ow && nh === oh) return;
    this.beginHistory();
    const dx = anchor === 'center' ? Math.floor((nw - ow) / 2) : 0;
    const dy = anchor === 'center' ? Math.floor((nh - oh) / 2) : 0;
    const cells = new Int16Array(nw * nh).fill(-1);
    for (let y = 0; y < oh; y++) {
      const ny = y + dy;
      if (ny < 0 || ny >= nh) continue;
      for (let x = 0; x < ow; x++) {
        const nx = x + dx;
        if (nx >= 0 && nx < nw) cells[ny * nw + nx] = old[y * ow + x];
      }
    }
    this.width = nw;
    this.height = nh;
    this.cells = cells;
    this._markDirty();
    this.endHistory('resize');
    this.fit();
  }

  // 整体平移画面内容（超出边界的部分会被裁掉）
  shift(dx, dy) {
    const W = this.width, H = this.height, old = this.cells;
    this.beginHistory();
    const cells = new Int16Array(W * H).fill(-1);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < W && ny >= 0 && ny < H) cells[ny * W + nx] = old[y * W + x];
      }
    }
    this.cells = cells;
    this._markDirty();
    this.endHistory('edit');
  }

  flip(horizontal) {
    const W = this.width, H = this.height, old = this.cells;
    this.beginHistory();
    const cells = new Int16Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        cells[y * W + x] = horizontal ? old[y * W + (W - 1 - x)] : old[(H - 1 - y) * W + x];
      }
    }
    this.cells = cells;
    this._markDirty();
    this.endHistory('edit');
  }

  // ---------- 撤销 / 重做 ----------

  _snapshot() {
    return { width: this.width, height: this.height, cells: this.cells.slice(), palette: this.palette };
  }

  beginHistory() {
    if (!this.pending) this.pending = this._snapshot();
  }

  endHistory(kind = 'edit') {
    const p = this.pending;
    this.pending = null;
    if (!p || !this._differs(p)) return;
    this.undoStack.push(p);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    this._emit(kind);
  }

  _differs(p) {
    if (p.width !== this.width || p.height !== this.height || p.palette !== this.palette) return true;
    const a = p.cells, b = this.cells;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
    return false;
  }

  undo() {
    if (this.action || !this.undoStack.length) return;
    this.redoStack.push(this._snapshot());
    this._restore(this.undoStack.pop());
  }

  redo() {
    if (this.action || !this.redoStack.length) return;
    this.undoStack.push(this._snapshot());
    this._restore(this.redoStack.pop());
  }

  _restore(p) {
    const resized = p.width !== this.width || p.height !== this.height;
    this.width = p.width;
    this.height = p.height;
    this.cells = p.cells;
    this.palette = p.palette;
    if (this.color >= this.palette.colors.length) this.color = 0;
    this.highlight = null;
    this._markDirty();
    if (resized) this.fit();
    this._emit('history');
  }

  // ---------- 工具与选项 ----------

  setTool(tool) {
    if (tool !== 'eyedropper') this.prevTool = tool;
    this.tool = tool;
    this.canvas.dataset.tool = tool;
    this.hooks.onToolChange?.(tool);
  }

  setColor(i) {
    this.color = i;
    this.hooks.onColorChange?.(i);
    this.requestRender();
  }

  setOption(key, value) {
    this.opts[key] = value;
    this.requestRender();
  }

  setHighlight(i) {
    this.highlight = i;
    this._markDirty();
  }

  // ---------- 视图 ----------

  fit() {
    if (!this.cssW) return;
    const pad = 24;
    const s = Math.floor(Math.min((this.cssW - pad * 2) / this.width, (this.cssH - pad * 2) / this.height));
    this.view.s = clamp(s, MIN_SCALE, MAX_SCALE);
    this.view.ox = Math.round((this.cssW - this.width * this.view.s) / 2);
    this.view.oy = Math.round((this.cssH - this.height * this.view.s) / 2);
    this._autoFit = true;
    this._viewChanged();
  }

  zoomAt(px, py, factor) {
    const { s, ox, oy } = this.view;
    const ns = clamp(s * factor, MIN_SCALE, MAX_SCALE);
    this.view.ox = px - ((px - ox) * ns) / s;
    this.view.oy = py - ((py - oy) * ns) / s;
    this.view.s = ns;
    this._autoFit = false;
    this._viewChanged();
  }

  zoomBy(factor) {
    this.zoomAt(this.cssW / 2, this.cssH / 2, factor);
  }

  _viewChanged() {
    this.hooks.onViewChange?.(this.view);
    this.requestRender();
  }

  _resize() {
    const parent = this.canvas.parentElement;
    this.cssW = parent.clientWidth;
    this.cssH = parent.clientHeight;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.canvas.style.width = this.cssW + 'px';
    this.canvas.style.height = this.cssH + 'px';
    // 用户还没手动缩放 / 平移时，窗口尺寸变化后自动适应
    if (this._autoFit && this.cssW > 0) this.fit();
    this.requestRender();
  }

  _readTheme() {
    const cs = getComputedStyle(document.documentElement);
    this.theme = {
      bg: cs.getPropertyValue('--canvas-bg').trim() || '#e4e4ea',
      accent: cs.getPropertyValue('--accent').trim() || '#3b6cf6',
    };
  }

  // ---------- 渲染 ----------

  requestRender() {
    if (!this._raf) {
      this._raf = requestAnimationFrame(() => {
        this._raf = 0;
        this._render();
      });
    }
  }

  _markDirty() {
    this.needsBitmap = true;
    this.requestRender();
  }

  _buildBitmaps() {
    const W = this.width, H = this.height;
    if (this.bitmap.width !== W || this.bitmap.height !== H) {
      this.bitmap.width = this.checker.width = W;
      this.bitmap.height = this.checker.height = H;
      const cctx = this.checker.getContext('2d');
      const ci = cctx.createImageData(W, H);
      for (let i = 0; i < W * H; i++) {
        const x = i % W, y = (i - x) / W;
        const v = (x + y) & 1 ? 236 : 248;
        ci.data[i * 4] = ci.data[i * 4 + 1] = v;
        ci.data[i * 4 + 2] = v + 4 > 255 ? 255 : v + 4;
        ci.data[i * 4 + 3] = 255;
      }
      cctx.putImageData(ci, 0, 0);
    }
    const ctx = this.bitmap.getContext('2d');
    const img = ctx.createImageData(W, H);
    const d = img.data;
    const cols = this.palette.colors;
    const hl = this.highlight;
    for (let i = 0; i < W * H; i++) {
      const v = this.cells[i];
      if (v < 0 || !cols[v]) continue;
      let [r, g, b] = cols[v].rgb;
      if (hl !== null && v !== hl) {
        r += (255 - r) * 0.85;
        g += (255 - g) * 0.85;
        b += (255 - b) * 0.85;
      }
      d[i * 4] = r;
      d[i * 4 + 1] = g;
      d[i * 4 + 2] = b;
      d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  _render() {
    const ctx = this.ctx, dpr = this.dpr;
    if (!this.cssW) return;
    if (this.needsBitmap) {
      this._buildBitmaps();
      this.needsBitmap = false;
    }
    const { s, ox, oy } = this.view;
    const W = this.width, H = this.height;
    const cols = this.palette.colors;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.theme.bg;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.checker, ox, oy, W * s, H * s);
    ctx.drawImage(this.bitmap, ox, oy, W * s, H * s);

    const a = this.action;
    if (a && a.type === 'shape') {
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = cols[a.v]?.hex || '#000';
      for (const [x, y] of this._mirrored(this._shapeCells(a, true))) {
        if (x >= 0 && y >= 0 && x < W && y < H) ctx.fillRect(ox + x * s, oy + y * s, s, s);
      }
      ctx.globalAlpha = 1;
    }

    const x0 = clamp(Math.floor(-ox / s), 0, W), x1 = clamp(Math.ceil((this.cssW - ox) / s), 0, W);
    const y0 = clamp(Math.floor(-oy / s), 0, H), y1 = clamp(Math.ceil((this.cssH - oy) / s), 0, H);

    // 色号文字
    if (this.opts.codes && s >= 16) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const hl = this.highlight;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const v = this.cells[y * W + x];
          if (v < 0 || !cols[v] || (hl !== null && v !== hl)) continue;
          const code = cols[v].code;
          const fs = Math.min(18, Math.floor(s * (code.length > 3 ? 0.3 : 0.36)));
          ctx.font = `600 ${fs}px system-ui, sans-serif`;
          ctx.fillStyle = cols[v].text;
          ctx.fillText(code, ox + (x + 0.5) * s, oy + (y + 0.5) * s, s - 2);
        }
      }
    }

    // 网格线（按设备像素对齐，保证清晰）
    const px = (v) => (Math.round(v * dpr) + 0.5) / dpr;
    if (this.opts.grid && s >= 5) {
      ctx.beginPath();
      for (let x = x0; x <= x1; x++) {
        ctx.moveTo(px(ox + x * s), oy + y0 * s);
        ctx.lineTo(px(ox + x * s), oy + y1 * s);
      }
      for (let y = y0; y <= y1; y++) {
        ctx.moveTo(ox + x0 * s, px(oy + y * s));
        ctx.lineTo(ox + x1 * s, px(oy + y * s));
      }
      ctx.lineWidth = 1 / dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.16)';
      ctx.stroke();
    }

    // 拼豆板分界线
    const bs = this.opts.boardSize;
    if (bs > 0) {
      ctx.beginPath();
      for (let x = bs; x < W; x += bs) {
        ctx.moveTo(px(ox + x * s), oy);
        ctx.lineTo(px(ox + x * s), oy + H * s);
      }
      for (let y = bs; y < H; y += bs) {
        ctx.moveTo(ox, px(oy + y * s));
        ctx.lineTo(ox + W * s, px(oy + y * s));
      }
      ctx.lineWidth = 2 / dpr;
      ctx.strokeStyle = 'rgba(220,40,60,0.75)';
      ctx.stroke();
    }

    // 对称轴
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = this.theme.accent;
    if (this.opts.mirrorX) {
      ctx.beginPath();
      ctx.moveTo(ox + (W / 2) * s, oy - 8);
      ctx.lineTo(ox + (W / 2) * s, oy + H * s + 8);
      ctx.stroke();
    }
    if (this.opts.mirrorY) {
      ctx.beginPath();
      ctx.moveTo(ox - 8, oy + (H / 2) * s);
      ctx.lineTo(ox + W * s + 8, oy + (H / 2) * s);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeRect(px(ox), px(oy), Math.round(W * s), Math.round(H * s));

    // 悬停格子
    const h = this.hover;
    if (h && h.x >= 0 && h.y >= 0 && h.x < W && h.y < H) {
      ctx.lineWidth = Math.max(1.5, Math.min(3, s / 8));
      ctx.strokeStyle = this.theme.accent;
      const fp = this.tool === 'pencil' || this.tool === 'eraser' ? this.opts.brush : 1;
      ctx.strokeRect(ox + h.x * s, oy + h.y * s, s * fp, s * fp);
      if (this.opts.mirrorX || this.opts.mirrorY) {
        ctx.globalAlpha = 0.5;
        for (const [mx, my] of this._mirrored([[h.x, h.y]]).slice(1)) ctx.strokeRect(ox + mx * s, oy + my * s, s, s);
        ctx.globalAlpha = 1;
      }
    }
  }

  // ---------- 交互 ----------

  _bindEvents() {
    const c = this.canvas;
    c.dataset.tool = this.tool;
    c.addEventListener('pointerdown', (e) => this._onDown(e));
    c.addEventListener('pointermove', (e) => this._onMove(e));
    c.addEventListener('pointerup', (e) => this._onUp(e, false));
    c.addEventListener('pointercancel', (e) => this._onUp(e, true));
    c.addEventListener('pointerleave', () => {
      if (!this.action) {
        this.hover = null;
        this.hooks.onHover?.(null);
        this.requestRender();
      }
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = this._local(e);
        if (e.shiftKey) {
          this.view.ox -= e.deltaY || e.deltaX;
          this._autoFit = false;
          this._viewChanged();
          return;
        }
        this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
      },
      { passive: false },
    );
  }

  _local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _cellAt(p) {
    return { x: Math.floor((p.x - this.view.ox) / this.view.s), y: Math.floor((p.y - this.view.oy) / this.view.s) };
  }

  _inBounds(c) {
    return c.x >= 0 && c.y >= 0 && c.x < this.width && c.y < this.height;
  }

  _onDown(e) {
    const p = this._local(e);
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, p);

    if (this.pointers.size === 2) {
      // 双指：取消正在进行的绘制，进入缩放
      this._cancelAction();
      const [a, b] = [...this.pointers.values()];
      this.action = {
        type: 'pinch',
        d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        ...this.view,
      };
      return;
    }
    if (this.pointers.size > 2 || this.action) return;

    if (e.button === 1 || this.spaceDown || this.tool === 'hand') {
      this.action = { type: 'pan', x: p.x, y: p.y, ox: this.view.ox, oy: this.view.oy };
      this.canvas.classList.add('grabbing');
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;

    let tool = this.tool;
    if (e.button === 2) tool = 'eraser';
    else if (e.altKey) tool = 'eyedropper';
    const cell = this._cellAt(p);

    switch (tool) {
      case 'pencil':
      case 'eraser': {
        const v = tool === 'eraser' ? -1 : this.color;
        this.beginHistory();
        this._paint(brushCells([[cell.x, cell.y]], this.opts.brush), v);
        this.action = { type: 'draw', v, last: cell };
        break;
      }
      case 'line':
      case 'rect':
      case 'ellipse':
        this.action = { type: 'shape', tool, start: cell, end: cell, v: this.color, filled: tool !== 'line' && e.shiftKey };
        this.requestRender();
        break;
      case 'bucket':
        if (!this._inBounds(cell)) break;
        this.beginHistory();
        if (e.shiftKey) this._replaceAt(cell, this.color);
        else this._floodFill(cell, this.color);
        this.endHistory('edit');
        break;
      case 'eyedropper':
        this._pick(cell);
        break;
    }
  }

  _onMove(e) {
    const p = this._local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    const a = this.action;

    if (a && a.type === 'pinch') {
      if (this.pointers.size < 2) return;
      const [p1, p2] = [...this.pointers.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
      const ns = clamp((a.s * d) / a.d, MIN_SCALE, MAX_SCALE);
      this.view.s = ns;
      this.view.ox = cx - ((a.cx - a.ox) / a.s) * ns;
      this.view.oy = cy - ((a.cy - a.oy) / a.s) * ns;
      this._autoFit = false;
      this._viewChanged();
      return;
    }
    if (a && a.type === 'pan') {
      this.view.ox = a.ox + p.x - a.x;
      this.view.oy = a.oy + p.y - a.y;
      this._autoFit = false;
      this._viewChanged();
      return;
    }

    const cell = this._cellAt(p);
    const h = this.hover;
    const moved = !h || h.x !== cell.x || h.y !== cell.y;
    this.hover = cell;
    if (moved) this.hooks.onHover?.(this._inBounds(cell) ? { ...cell, v: this.cells[cell.y * this.width + cell.x] } : null);

    if (a && a.type === 'draw' && moved) {
      this._paint(brushCells(lineCells(a.last.x, a.last.y, cell.x, cell.y), this.opts.brush), a.v);
      a.last = cell;
    } else if (a && a.type === 'shape') {
      a.end = cell;
      a.filled = a.tool !== 'line' && e.shiftKey;
    }
    if (moved || a) this.requestRender();
  }

  _onUp(e, cancelled) {
    this.pointers.delete(e.pointerId);
    const a = this.action;
    if (!a) return;
    if (a.type === 'pinch') {
      if (this.pointers.size === 0) this.action = null;
      return;
    }
    if (a.type === 'draw') this.endHistory('edit');
    if (a.type === 'shape' && !cancelled) {
      this.beginHistory();
      this._paint(this._shapeCells(a, true), a.v);
      this.endHistory('edit');
    }
    if (a.type === 'pan') this.canvas.classList.remove('grabbing');
    this.action = null;
    this.requestRender();
  }

  _cancelAction() {
    const a = this.action;
    if (a && a.type === 'draw' && this.pending) {
      this.cells = this.pending.cells;
      this.pending = null;
      this._markDirty();
      this._emit('edit');
    }
    this.canvas.classList.remove('grabbing');
    this.action = null;
    this.requestRender();
  }

  _shapeCells(a, withBrush = false) {
    let pts;
    if (a.tool === 'line') pts = lineCells(a.start.x, a.start.y, a.end.x, a.end.y);
    else if (a.tool === 'rect') pts = rectCells(a.start, a.end, a.filled);
    else pts = ellipseCells(a.start, a.end, a.filled);
    // 实心图形忽略笔刷
    return withBrush && !a.filled ? brushCells(pts, this.opts.brush) : pts;
  }

  _mirrored(pts) {
    const { mirrorX, mirrorY } = this.opts;
    if (!mirrorX && !mirrorY) return pts;
    const W = this.width, H = this.height;
    const out = [];
    for (const [x, y] of pts) {
      out.push([x, y]);
      if (mirrorX) out.push([W - 1 - x, y]);
      if (mirrorY) out.push([x, H - 1 - y]);
      if (mirrorX && mirrorY) out.push([W - 1 - x, H - 1 - y]);
    }
    return out;
  }

  _paint(pts, v) {
    const W = this.width, H = this.height;
    let changed = false;
    for (const [x, y] of this._mirrored(pts)) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      if (this.cells[i] !== v) {
        this.cells[i] = v;
        changed = true;
      }
    }
    if (changed) {
      this._markDirty();
      this._emit('edit');
    }
  }

  _floodFill(c, v) {
    const W = this.width, H = this.height, cells = this.cells;
    const start = c.y * W + c.x;
    const target = cells[start];
    if (target === v) return;
    const stack = [start];
    cells[start] = v;
    while (stack.length) {
      const i = stack.pop();
      const x = i % W, y = (i - x) / W;
      if (x > 0 && cells[i - 1] === target) { cells[i - 1] = v; stack.push(i - 1); }
      if (x < W - 1 && cells[i + 1] === target) { cells[i + 1] = v; stack.push(i + 1); }
      if (y > 0 && cells[i - W] === target) { cells[i - W] = v; stack.push(i - W); }
      if (y < H - 1 && cells[i + W] === target) { cells[i + W] = v; stack.push(i + W); }
    }
    this._markDirty();
  }

  _replaceAt(c, v) {
    const target = this.cells[c.y * this.width + c.x];
    if (target === v) return;
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i] === target) this.cells[i] = v;
    this._markDirty();
  }

  _pick(c) {
    if (!this._inBounds(c)) return;
    const v = this.cells[c.y * this.width + c.x];
    if (v >= 0) this.setColor(v);
    if (this.tool === 'eyedropper') this.setTool(this.prevTool);
  }

  _emit(kind) {
    this.hooks.onChange?.(kind);
  }
}
