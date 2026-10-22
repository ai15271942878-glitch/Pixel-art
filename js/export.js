// 导出：PNG 像素图、带色号的拼豆图纸、项目文件

export function countCells(cells) {
  const m = new Map();
  for (const v of cells) if (v >= 0) m.set(v, (m.get(v) || 0) + 1);
  return m;
}

export function renderPNG(doc, scale) {
  const { width: W, height: H, cells } = doc;
  const cols = doc.palette.colors;
  const small = document.createElement('canvas');
  small.width = W;
  small.height = H;
  const sctx = small.getContext('2d');
  const img = sctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const v = cells[i];
    if (v < 0) continue;
    const [r, g, b] = cols[v].rgb;
    img.data.set([r, g, b, 255], i * 4);
  }
  sctx.putImageData(img, 0, 0);
  const c = document.createElement('canvas');
  c.width = W * scale;
  c.height = H * scale;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, c.width, c.height);
  return c;
}

// 计数线位置（格子边界下标，含外框）。center10：从中心向两边每 10 格一条；every5：从左上角每 5 格一条
export function countLineBounds(n, mode) {
  const set = new Set([0, n]);
  if (mode === 'every5') {
    for (let i = 5; i < n; i += 5) set.add(i);
  } else if (mode === 'center10') {
    const c = Math.floor(n / 2);
    set.add(c);
    for (let i = c + 10; i < n; i += 10) set.add(i);
    for (let i = c - 10; i > 0; i -= 10) set.add(i);
  }
  return [...set].sort((a, b) => a - b);
}

// 打印用图纸：四边序号带 + 格子色号 + 计数线 + 拼豆板分界 + 用料清单
export function renderPattern(doc, {
  cell = 26, codes = true, legend = true, boardSize = 29, countLines = 'center10', maxSide = 0,
} = {}) {
  const { width: W, height: H, cells } = doc;
  const cols = doc.palette.colors;
  const counts = countCells(cells);
  const used = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = used.reduce((s, [, n]) => s + n, 0);

  const plan = (cs) => {
    const ruler = Math.max(18, Math.round(cs * 1.1));
    const pad = 20, titleH = 46, itemW = 180, itemH = 30;
    const gridW = W * cs, gridH = H * cs;
    const width = Math.max(pad * 2 + ruler * 2 + gridW, 560);
    const legendCols = Math.max(1, Math.floor((width - pad * 2) / itemW));
    const legendH = legend && used.length ? 40 + Math.ceil(used.length / legendCols) * itemH : 0;
    const height = pad + titleH + ruler * 2 + gridH + legendH + pad;
    return { cs, ruler, pad, titleH, itemW, itemH, gridW, gridH, width, height, legendCols, legendH };
  };
  let L = plan(Math.max(6, Math.min(cell, Math.floor(12000 / Math.max(W, H)))));
  // 限制最长边：先缩小格子，实在放不下再整体缩图
  while (maxSide && L.cs > 6 && Math.max(L.width, L.height) > maxSide) L = plan(L.cs - 1);
  const { cs, ruler, pad, titleH, itemW, itemH, gridW, gridH, width, height, legendCols, legendH } = L;

  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#111';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = '600 20px system-ui, sans-serif';
  ctx.fillText('拼豆图纸', pad, pad + 14);
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillStyle = '#555';
  ctx.fillText(`${W} × ${H} 格 · 共 ${total} 颗 · ${used.length} 种颜色 · 色卡：${doc.palette.name}`, pad, pad + 36, width - pad * 2);

  const gx = Math.round((width - gridW) / 2);
  const gy = pad + titleH + ruler;

  // 序号带
  ctx.fillStyle = '#D6EBF8';
  ctx.fillRect(gx - ruler, gy - ruler, gridW + ruler * 2, ruler);
  ctx.fillRect(gx - ruler, gy + gridH, gridW + ruler * 2, ruler);
  ctx.fillRect(gx - ruler, gy, ruler, gridH);
  ctx.fillRect(gx + gridW, gy, ruler, gridH);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = cells[y * W + x];
      if (v < 0) continue;
      ctx.fillStyle = cols[v].hex;
      ctx.fillRect(gx + x * cs, gy + y * cs, cs, cs);
    }
  }

  // 色号：尽量大，放不下时按宽度缩小
  if (codes && cs >= 12) {
    ctx.textAlign = 'center';
    const sizeFor = new Map();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = cells[y * W + x];
        if (v < 0) continue;
        const code = cols[v].code;
        let px = sizeFor.get(code);
        if (px === undefined) {
          px = Math.min(28, cs * 0.5);
          ctx.font = `700 ${px}px system-ui, sans-serif`;
          const w = ctx.measureText(code).width;
          if (w > cs * 0.9) px *= (cs * 0.9) / w;
          sizeFor.set(code, px);
        }
        ctx.font = `700 ${px}px system-ui, sans-serif`;
        ctx.fillStyle = cols[v].text;
        ctx.fillText(code, gx + (x + 0.5) * cs, gy + (y + 0.5) * cs + 0.5);
      }
    }
  }

  const vline = (x, color, lw) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(gx + x * cs, gy);
    ctx.lineTo(gx + x * cs, gy + gridH);
    ctx.stroke();
  };
  const hline = (y, color, lw) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(gx, gy + y * cs);
    ctx.lineTo(gx + gridW, gy + y * cs);
    ctx.stroke();
  };
  for (let x = 1; x < W; x++) vline(x + 0.5 / cs, 'rgba(0,0,0,0.18)', 1);
  for (let y = 1; y < H; y++) hline(y + 0.5 / cs, 'rgba(0,0,0,0.18)', 1);
  for (const x of countLineBounds(W, countLines)) vline(x, '#000', 2);
  for (const y of countLineBounds(H, countLines)) hline(y, '#000', 2);
  if (boardSize > 0) {
    for (let x = boardSize; x < W; x += boardSize) vline(x, 'rgba(220,40,60,0.9)', 2);
    for (let y = boardSize; y < H; y += boardSize) hline(y, 'rgba(220,40,60,0.9)', 2);
  }

  // 序号（行列都从 1 开始，四边都标，方便对照）
  ctx.fillStyle = '#1D4E70';
  ctx.textAlign = 'center';
  ctx.font = `600 ${Math.min(14, Math.max(8, cs * 0.45))}px system-ui, sans-serif`;
  const every = cs >= 16 ? 1 : 5;
  const labelled = (i) => every === 1 || i === 0 || (i + 1) % every === 0;
  for (let x = 0; x < W; x++) {
    if (!labelled(x)) continue;
    const tx = gx + (x + 0.5) * cs;
    ctx.fillText(String(x + 1), tx, gy - ruler / 2, cs * every);
    ctx.fillText(String(x + 1), tx, gy + gridH + ruler / 2, cs * every);
  }
  for (let y = 0; y < H; y++) {
    if (!labelled(y)) continue;
    const ty = gy + (y + 0.5) * cs;
    ctx.fillText(String(y + 1), gx - ruler / 2, ty, ruler - 2);
    ctx.fillText(String(y + 1), gx + gridW + ruler / 2, ty, ruler - 2);
  }

  if (legendH) {
    let ly = gy + gridH + ruler + 16;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#111';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.fillText('用料清单', pad, ly + 6);
    ly += 28;
    used.forEach(([v, n], k) => {
      const col = cols[v];
      const x = pad + (k % legendCols) * itemW;
      const y = ly + Math.floor(k / legendCols) * itemH;
      ctx.fillStyle = col.hex;
      ctx.fillRect(x, y, 38, 24);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, 37, 23);
      ctx.fillStyle = col.text;
      ctx.textAlign = 'center';
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.fillText(col.code, x + 19, y + 12.5, 36);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#222';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText(`${col.name}  × ${n}`, x + 46, y + 12.5, itemW - 52);
    });
  }

  if (maxSide && Math.max(width, height) > maxSide) {
    const k = maxSide / Math.max(width, height);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(width * k));
    out.height = Math.max(1, Math.round(height * k));
    const octx = out.getContext('2d');
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(c, 0, 0, out.width, out.height);
    return out;
  }
  return c;
}

export function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => downloadBlob(blob, filename), 'image/png');
}

export function downloadText(text, filename, type = 'application/json') {
  downloadBlob(new Blob([text], { type }), filename);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function serializeProject(doc) {
  return JSON.stringify({
    app: 'bead-pixel-studio',
    version: 1,
    width: doc.width,
    height: doc.height,
    palette: {
      id: doc.palette.id,
      name: doc.palette.name,
      colors: doc.palette.colors.map((c) => [c.code, c.name, c.hex]),
    },
    cells: Array.from(doc.cells),
  });
}

export function parseProject(text) {
  const p = typeof text === 'string' ? JSON.parse(text) : text;
  const W = p.width | 0, H = p.height | 0;
  if (!(W > 0 && H > 0 && W <= 1000 && H <= 1000)) throw new Error('项目尺寸无效');
  if (!p.palette || !Array.isArray(p.palette.colors) || !p.palette.colors.length) throw new Error('项目缺少色卡');
  if (!Array.isArray(p.cells) || p.cells.length !== W * H) throw new Error('项目格子数据不完整');
  const n = p.palette.colors.length;
  const cells = Int16Array.from(p.cells, (v) => (Number.isInteger(v) && v >= 0 && v < n ? v : -1));
  return { width: W, height: H, cells, palette: p.palette };
}
