// 图层拼接：多张图片叠放（移动、缩放、旋转、翻转、前后顺序），每层可以带抠图蒙版，
// 合成结果作为“转换成像素图”的原图

const MAX_SIDE = 2048;
let nextId = 1;

function toCanvas(source, maxSide = MAX_SIDE) {
  const k = Math.min(1, maxSide / Math.max(source.width, source.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(source.width * k));
  c.height = Math.max(1, Math.round(source.height * k));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

export function createComposition(source, name) {
  const comp = { width: 0, height: 0, layers: [] };
  const layer = addLayer(comp, source, name);
  comp.width = layer.w;
  comp.height = layer.h;
  layer.x = comp.width / 2;
  layer.y = comp.height / 2;
  return comp;
}

// 新图层放在最上面、居中，较大的图缩到画布的 80% 以内
export function addLayer(comp, source, name) {
  const src = toCanvas(source);
  const layer = {
    id: nextId++,
    name: name || `图层 ${comp.layers.length + 1}`,
    src,
    w: src.width,
    h: src.height,
    mask: null,
    cut: src,
    x: comp.width / 2,
    y: comp.height / 2,
    scale: 1,
    rotation: 0,
    flipX: false,
    visible: true,
  };
  if (comp.width) layer.scale = Math.min(1, (0.8 * comp.width) / layer.w, (0.8 * comp.height) / layer.h);
  comp.layers.push(layer);
  return layer;
}

export function setMask(layer, mask) {
  layer.mask = mask;
  updateCut(layer);
}

// 根据蒙版重新生成抠好的图层图像
export function updateCut(layer) {
  if (!layer.mask) {
    layer.cut = layer.src;
    return;
  }
  if (!layer.cut || layer.cut === layer.src) {
    layer.cut = document.createElement('canvas');
    layer.cut.width = layer.w;
    layer.cut.height = layer.h;
  }
  const ctx = layer.cut.getContext('2d');
  ctx.globalCompositeOperation = 'copy';
  ctx.drawImage(layer.src, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(layer.mask, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}

function ensureMask(layer) {
  if (layer.mask) return layer.mask;
  const m = document.createElement('canvas');
  m.width = layer.w;
  m.height = layer.h;
  const ctx = m.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, m.width, m.height);
  layer.mask = m;
  return m;
}

function applyLayerTransform(ctx, l) {
  ctx.translate(l.x, l.y);
  ctx.rotate((l.rotation * Math.PI) / 180);
  ctx.scale(l.scale * (l.flipX ? -1 : 1), l.scale);
}

export function drawLayers(ctx, comp) {
  for (const l of comp.layers) {
    if (!l.visible) continue;
    ctx.save();
    applyLayerTransform(ctx, l);
    ctx.drawImage(l.cut, -l.w / 2, -l.h / 2);
    ctx.restore();
  }
}

export function renderComposite(comp) {
  const c = document.createElement('canvas');
  c.width = comp.width;
  c.height = comp.height;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  drawLayers(ctx, comp);
  return c;
}

// 画布坐标 → 图层自身像素坐标
function toLayerLocal(l, x, y) {
  const a = (-l.rotation * Math.PI) / 180;
  const dx = x - l.x, dy = y - l.y;
  let lx = (dx * Math.cos(a) - dy * Math.sin(a)) / l.scale;
  const ly = (dx * Math.sin(a) + dy * Math.cos(a)) / l.scale;
  if (l.flipX) lx = -lx;
  return { x: lx + l.w / 2, y: ly + l.h / 2 };
}

function hitTest(l, x, y) {
  const p = toLayerLocal(l, x, y);
  if (p.x < 0 || p.y < 0 || p.x >= l.w || p.y >= l.h) return false;
  // 抠过图的层，只有保留下来的部分算点中
  if (!l.mask) return true;
  const a = l.mask.getContext('2d').getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data[3];
  return a > 40;
}

/**
 * 合成编辑器：在对话框里的 canvas 上显示合成结果，
 * 支持选中、拖动、双指缩放旋转图层，以及用画笔擦除 / 恢复蒙版。
 */
export class ComposeEditor {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks;
    this.comp = null;
    this.selected = null;
    this.tool = 'move';
    this.brush = 24; // 屏幕像素半径
    this.view = { k: 1, ox: 0, oy: 0 };
    this.pointers = new Map();
    this.action = null;
    this.cursor = null;
    this._raf = 0;
    this._bind();
    new ResizeObserver(() => this._resize()).observe(canvas.parentElement);
  }

  setComposition(comp) {
    this.comp = comp;
    if (!comp.layers.includes(this.selected)) this.selected = comp.layers[comp.layers.length - 1] || null;
    this._fit();
    this.render();
  }

  select(layer) {
    this.selected = layer;
    this.hooks.onSelect?.(layer);
    this.render();
  }

  setTool(tool) {
    this.tool = tool;
    this.canvas.dataset.tool = tool;
    this.render();
  }

  changed() {
    this.hooks.onChange?.();
    this.render();
  }

  _resize() {
    const p = this.canvas.parentElement;
    this.dpr = window.devicePixelRatio || 1;
    this.cssW = p.clientWidth;
    this.cssH = p.clientHeight;
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.canvas.style.width = this.cssW + 'px';
    this.canvas.style.height = this.cssH + 'px';
    this._fit();
    this.render();
  }

  _fit() {
    if (!this.comp || !this.cssW) return;
    const pad = 16;
    const k = Math.min((this.cssW - pad * 2) / this.comp.width, (this.cssH - pad * 2) / this.comp.height);
    this.view = {
      k,
      ox: (this.cssW - this.comp.width * k) / 2,
      oy: (this.cssH - this.comp.height * k) / 2,
    };
  }

  render() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this._draw();
    });
  }

  _draw() {
    const { ctx, comp } = this;
    if (!comp || !this.cssW) return;
    const { k, ox, oy } = this.view;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);

    // 透明区域用棋盘格表示
    const W = comp.width * k, H = comp.height * k;
    const cell = 12;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, W, H);
    ctx.clip();
    ctx.fillStyle = '#f4f4f7';
    ctx.fillRect(ox, oy, W, H);
    ctx.fillStyle = '#e2e2e8';
    for (let y = 0; y * cell < H; y++) {
      for (let x = (y & 1); x * cell < W; x += 2) ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
    }
    ctx.translate(ox, oy);
    ctx.scale(k, k);
    ctx.imageSmoothingQuality = 'high';
    drawLayers(ctx, comp);
    ctx.restore();

    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, W, H);

    // 选中图层的外框
    const l = this.selected;
    if (l && l.visible) {
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(k, k);
      applyLayerTransform(ctx, l);
      ctx.lineWidth = 1.5 / (k * l.scale);
      ctx.setLineDash([6 / (k * l.scale), 4 / (k * l.scale)]);
      ctx.strokeStyle = this.hooks.accent?.() || '#3b6cf6';
      ctx.strokeRect(-l.w / 2, -l.h / 2, l.w, l.h);
      ctx.restore();
    }

    // 画笔光标
    if (this.cursor && this.tool !== 'move') {
      ctx.beginPath();
      ctx.arc(this.cursor.x, this.cursor.y, this.brush, 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = this.tool === 'erase' ? '#d6334b' : '#2fa84f';
      ctx.stroke();
    }
  }

  _local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _toComp(p) {
    return { x: (p.x - this.view.ox) / this.view.k, y: (p.y - this.view.oy) / this.view.k };
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this._down(e));
    c.addEventListener('pointermove', (e) => this._move(e));
    c.addEventListener('pointerup', (e) => this._up(e));
    c.addEventListener('pointercancel', (e) => this._up(e));
    c.addEventListener('pointerleave', () => {
      this.cursor = null;
      this.render();
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const l = this.selected;
        if (!l) return;
        l.scale = Math.max(0.02, Math.min(20, l.scale * Math.exp(-e.deltaY * 0.0015)));
        this.changed();
      },
      { passive: false },
    );
  }

  _down(e) {
    if (!this.comp) return;
    const p = this._local(e);
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, p);
    const l = this.selected;

    if (this.pointers.size === 2 && l) {
      const [a, b] = [...this.pointers.values()];
      this.action = {
        type: 'pinch',
        d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        ang: Math.atan2(b.y - a.y, b.x - a.x),
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        scale: l.scale,
        rotation: l.rotation,
        lx: l.x,
        ly: l.y,
      };
      return;
    }
    if (this.pointers.size > 1) return;

    const q = this._toComp(p);
    if (this.tool === 'move') {
      // 从最上层往下找点中的图层
      for (let i = this.comp.layers.length - 1; i >= 0; i--) {
        const t = this.comp.layers[i];
        if (t.visible && hitTest(t, q.x, q.y)) {
          if (t !== this.selected) this.select(t);
          break;
        }
      }
      const s = this.selected;
      if (s) this.action = { type: 'drag', sx: q.x, sy: q.y, lx: s.x, ly: s.y };
    } else if (l) {
      ensureMask(l);
      this.action = { type: 'paint', last: q };
      this._paint(q, q);
    }
  }

  _move(e) {
    const p = this._local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    this.cursor = e.pointerType === 'mouse' || this.action?.type === 'paint' ? p : null;
    const a = this.action;
    const l = this.selected;
    if (!a || !l) {
      if (this.tool !== 'move') this.render();
      return;
    }
    if (a.type === 'pinch') {
      if (this.pointers.size < 2) return;
      const [p1, p2] = [...this.pointers.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      l.scale = Math.max(0.02, Math.min(20, (a.scale * d) / a.d));
      l.rotation = a.rotation + ((ang - a.ang) * 180) / Math.PI;
      l.x = a.lx + ((p1.x + p2.x) / 2 - a.cx) / this.view.k;
      l.y = a.ly + ((p1.y + p2.y) / 2 - a.cy) / this.view.k;
      this.changed();
    } else if (a.type === 'drag') {
      const q = this._toComp(p);
      l.x = a.lx + q.x - a.sx;
      l.y = a.ly + q.y - a.sy;
      this.changed();
    } else if (a.type === 'paint') {
      const q = this._toComp(p);
      this._paint(a.last, q);
      a.last = q;
    }
  }

  _up(e) {
    this.pointers.delete(e.pointerId);
    if (this.action?.type === 'pinch' && this.pointers.size) return;
    const wasPaint = this.action?.type === 'paint';
    this.action = null;
    if (wasPaint) this.hooks.onChange?.();
    this.render();
  }

  // 在蒙版上画一段线：擦除变透明，恢复变不透明
  _paint(from, to) {
    const l = this.selected;
    const a = toLayerLocal(l, from.x, from.y);
    const b = toLayerLocal(l, to.x, to.y);
    const r = this.brush / (this.view.k * l.scale);
    const ctx = l.mask.getContext('2d');
    ctx.globalCompositeOperation = this.tool === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = ctx.fillStyle = '#000';
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    updateCut(l);
    this.render();
  }
}
