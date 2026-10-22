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

// 打印用图纸：格子 + 色号 + 坐标尺 + 拼豆板分界 + 用料清单
export function renderPattern(doc, { cell = 24, codes = true, legend = true, boardSize = 29 } = {}) {
  const { width: W, height: H, cells } = doc;
  const cols = doc.palette.colors;
  const counts = countCells(cells);
  const used = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = used.reduce((s, [, n]) => s + n, 0);

  const cs = Math.max(6, Math.min(cell, Math.floor(12000 / Math.max(W, H))));
  const ruler = 30;
  const pad = 24;
  const titleH = 46;
  const gridW = W * cs, gridH = H * cs;
  const width = Math.max(pad * 2 + ruler * 2 + gridW, 640);
  const itemW = 200, itemH = 30;
  const legendCols = Math.max(1, Math.floor((width - pad * 2) / itemW));
  const legendH = legend && used.length ? 44 + Math.ceil(used.length / legendCols) * itemH : 0;
  const height = pad + titleH + ruler * 2 + gridH + legendH + pad;

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
  ctx.fillText(
    `${W} × ${H} 格 · 共 ${total} 颗 · ${used.length} 种颜色 · 色卡：${doc.palette.name}`,
    pad,
    pad + 36,
  );

  const gx = Math.round((width - gridW) / 2);
  const gy = pad + titleH + ruler;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = cells[y * W + x];
      if (v < 0) continue;
      ctx.fillStyle = cols[v].hex;
      ctx.fillRect(gx + x * cs, gy + y * cs, cs, cs);
    }
  }

  if (codes && cs >= 14) {
    ctx.textAlign = 'center';
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = cells[y * W + x];
        if (v < 0) continue;
        const code = cols[v].code;
        ctx.font = `600 ${Math.floor(cs * (code.length > 3 ? 0.3 : 0.36))}px system-ui, sans-serif`;
        ctx.fillStyle = cols[v].text;
        ctx.fillText(code, gx + (x + 0.5) * cs, gy + (y + 0.5) * cs + 0.5, cs - 2);
      }
    }
  }

  const line = (x0, y0, x1, y1) => {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  for (const [step, color, lw] of [
    [1, 'rgba(0,0,0,0.18)', 1],
    [5, 'rgba(0,0,0,0.45)', 1],
    [boardSize, 'rgba(220,40,60,0.9)', 2],
  ]) {
    if (!step || step < 1) continue;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    for (let x = step; x < W; x += step) line(gx + x * cs + 0.5, gy, gx + x * cs + 0.5, gy + gridH);
    for (let y = step; y < H; y += step) line(gx, gy + y * cs + 0.5, gx + gridW, gy + y * cs + 0.5);
  }
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 2;
  ctx.strokeRect(gx, gy, gridW, gridH);

  // 坐标尺（四边都标，方便对照）
  ctx.fillStyle = '#444';
  ctx.textAlign = 'center';
  ctx.font = `${Math.min(11, Math.max(8, cs * 0.45))}px system-ui, sans-serif`;
  const every = cs >= 16 ? 1 : 5;
  for (let x = 0; x < W; x++) {
    if ((x + 1) % every && x) continue;
    const tx = gx + (x + 0.5) * cs;
    ctx.fillText(String(x + 1), tx, gy - ruler / 2);
    ctx.fillText(String(x + 1), tx, gy + gridH + ruler / 2);
  }
  for (let y = 0; y < H; y++) {
    if ((y + 1) % every && y) continue;
    const ty = gy + (y + 0.5) * cs;
    ctx.fillText(String(y + 1), gx - ruler / 2, ty);
    ctx.fillText(String(y + 1), gx + gridW + ruler / 2, ty);
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
      ctx.fillRect(x, y, 34, 22);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, 33, 21);
      ctx.fillStyle = col.text;
      ctx.textAlign = 'center';
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.fillText(col.code, x + 17, y + 11.5, 32);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#222';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText(`${col.name}  × ${n}`, x + 42, y + 11.5, itemW - 50);
    });
  }
  return c;
}

export function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => downloadBlob(blob, filename), 'image/png');
}

export function downloadText(text, filename, type = 'application/json') {
  downloadBlob(new Blob([text], { type }), filename);
}

function downloadBlob(blob, filename) {
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
