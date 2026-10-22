// 图片 → 拼豆网格

import { rgbToLab, deltaE76, deltaE2000, nearestIndex } from './color.js';

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// 把图片按区域平均采样成 W×H 个格子，返回 Float32Array [r,g,b,a,...]
function sampleImage(img, W, H) {
  const iw = img.width;
  const ih = img.height;
  // 先把大图缩到格子数的 8 倍左右，再做区域平均，兼顾速度和质量
  const scale = Math.min(1, Math.max(W, H) * 8 / Math.max(iw, ih));
  const sw = Math.max(1, Math.round(iw * scale));
  const sh = Math.max(1, Math.round(ih * scale));
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, sw, sh);
  const data = ctx.getImageData(0, 0, sw, sh).data;

  const out = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const y0 = Math.min(sh - 1, Math.floor((y * sh) / H));
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / H));
    for (let x = 0; x < W; x++) {
      const x0 = Math.min(sw - 1, Math.floor((x * sw) / W));
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / W));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < sh; yy++) {
        let i = (yy * sw + x0) * 4;
        for (let xx = x0; xx < x1 && xx < sw; xx++, i += 4) {
          const al = data[i + 3];
          r += data[i] * al;
          g += data[i + 1] * al;
          b += data[i + 2] * al;
          a += al;
          n++;
        }
      }
      const o = (y * W + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = n ? a / n : 0;
    }
  }
  return out;
}

function adjust(px, { brightness = 0, contrast = 0, saturation = 0 }) {
  if (!brightness && !contrast && !saturation) return;
  const bAdd = brightness * 2.55;
  const c = contrast * 2.55;
  const cf = (259 * (c + 255)) / (255 * (259 - c));
  const sk = 1 + saturation / 100;
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i] + bAdd, g = px[i + 1] + bAdd, b = px[i + 2] + bAdd;
    r = cf * (r - 128) + 128;
    g = cf * (g - 128) + 128;
    b = cf * (b - 128) + 128;
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    px[i] = clamp255(gray + (r - gray) * sk);
    px[i + 1] = clamp255(gray + (g - gray) * sk);
    px[i + 2] = clamp255(gray + (b - gray) * sk);
  }
}

// 从边缘出发，把与背景色相近的连通区域标记为空
function removeBackground(labs, empty, W, H, tol) {
  const border = [];
  for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x);
  for (let y = 1; y < H - 1; y++) border.push(y * W, y * W + W - 1);
  const cand = border.filter((i) => !empty[i]);
  if (!cand.length) return;

  // 背景参考色：边缘上“相似邻居”最多的那个颜色
  const step = Math.max(1, Math.floor(cand.length / 200));
  let ref = null, bestVotes = -1;
  for (let a = 0; a < cand.length; a += step) {
    const la = labs[cand[a]];
    let votes = 0;
    for (let b = 0; b < cand.length; b += step) if (deltaE76(la, labs[cand[b]]) < tol) votes++;
    if (votes > bestVotes) {
      bestVotes = votes;
      ref = la;
    }
  }

  const seen = new Uint8Array(W * H);
  const stack = [];
  for (const i of cand) {
    if (!seen[i] && deltaE76(labs[i], ref) < tol) {
      seen[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const i = stack.pop();
    empty[i] = 1;
    const x = i % W, y = (i - x) / W;
    const nb = [];
    if (x > 0) nb.push(i - 1);
    if (x < W - 1) nb.push(i + 1);
    if (y > 0) nb.push(i - W);
    if (y < H - 1) nb.push(i + W);
    for (const n of nb) {
      if (!seen[n] && !empty[n] && deltaE76(labs[n], ref) < tol) {
        seen[n] = 1;
        stack.push(n);
      }
    }
  }
}

// 把颜色数量合并到 maxColors：每次去掉“合并代价”（数量 × 与最近颜色的色差）最小的颜色
function reduceColors(cells, labs, colors, maxColors) {
  const counts = new Map();
  for (const v of cells) if (v >= 0) counts.set(v, (counts.get(v) || 0) + 1);
  const active = new Set(counts.keys());
  const distCache = new Map();
  const dist = (a, b) => {
    const k = a < b ? a * 4096 + b : b * 4096 + a;
    let d = distCache.get(k);
    if (d === undefined) {
      d = deltaE2000(colors[a].lab, colors[b].lab);
      distCache.set(k, d);
    }
    return d;
  };
  while (active.size > maxColors) {
    let victim = -1, bestCost = Infinity;
    for (const a of active) {
      let nd = Infinity;
      for (const b of active) if (a !== b) nd = Math.min(nd, dist(a, b));
      const cost = counts.get(a) * nd;
      if (cost < bestCost) {
        bestCost = cost;
        victim = a;
      }
    }
    active.delete(victim);
    const rest = [...active];
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] === victim) {
        const k = nearestIndex(labs[i], colors, rest);
        cells[i] = k;
        counts.set(k, counts.get(k) + 1);
      }
    }
  }
  return [...active];
}

function dither(px, empty, cells, colors, allowed, W, H) {
  const buf = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    buf[i * 3] = px[i * 4];
    buf[i * 3 + 1] = px[i * 4 + 1];
    buf[i * 3 + 2] = px[i * 4 + 2];
  }
  const cache = new Map();
  const push = (x, y, er, eg, eb, f) => {
    if (x < 0 || x >= W || y >= H) return;
    const j = y * W + x;
    if (empty[j]) return;
    buf[j * 3] += er * f;
    buf[j * 3 + 1] += eg * f;
    buf[j * 3 + 2] += eb * f;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (empty[i]) continue;
      const r = Math.round(clamp255(buf[i * 3]));
      const g = Math.round(clamp255(buf[i * 3 + 1]));
      const b = Math.round(clamp255(buf[i * 3 + 2]));
      const key = (r << 16) | (g << 8) | b;
      let k = cache.get(key);
      if (k === undefined) {
        k = nearestIndex(rgbToLab(r, g, b), colors, allowed);
        cache.set(key, k);
      }
      cells[i] = k;
      const [pr, pg, pb] = colors[k].rgb;
      const er = r - pr, eg = g - pg, eb = b - pb;
      push(x + 1, y, er, eg, eb, 7 / 16);
      push(x - 1, y + 1, er, eg, eb, 3 / 16);
      push(x, y + 1, er, eg, eb, 5 / 16);
      push(x + 1, y + 1, er, eg, eb, 1 / 16);
    }
  }
}

// 去掉孤立的杂点：8 邻域都和它不同色时，改成邻居里最多的颜色
function cleanup(cells, W, H) {
  const src = cells.slice();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const v = src[i];
      const tally = new Map();
      let same = false;
      for (let dy = -1; dy <= 1 && !same; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = src[ny * W + nx];
          if (n === v) {
            same = true;
            break;
          }
          tally.set(n, (tally.get(n) || 0) + 1);
        }
      }
      if (same || !tally.size) continue;
      let best = v, bc = 0;
      for (const [k, c] of tally) if (c > bc) { bc = c; best = k; }
      cells[i] = best;
    }
  }
}

/**
 * @param {ImageBitmap|HTMLImageElement} img
 * @param {object} o  width, height, palette, maxColors, dither, removeBg, bgTolerance,
 *                    cleanup, brightness, contrast, saturation
 */
export function convertImage(img, o) {
  const W = o.width, H = o.height, n = W * H;
  const colors = o.palette.colors;
  const px = sampleImage(img, W, H);
  adjust(px, o);

  const empty = new Uint8Array(n);
  const labs = new Array(n);
  for (let i = 0; i < n; i++) {
    if (px[i * 4 + 3] < 128) empty[i] = 1;
    else labs[i] = rgbToLab(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
  }
  if (o.removeBg) removeBackground(labs, empty, W, H, o.bgTolerance ?? 12);

  const all = colors.map((_, i) => i);
  const cells = new Int16Array(n).fill(-1);
  const cache = new Map();
  for (let i = 0; i < n; i++) {
    if (empty[i]) continue;
    const key = (Math.round(px[i * 4]) << 16) | (Math.round(px[i * 4 + 1]) << 8) | Math.round(px[i * 4 + 2]);
    let k = cache.get(key);
    if (k === undefined) {
      k = nearestIndex(labs[i], colors, all);
      cache.set(key, k);
    }
    cells[i] = k;
  }

  let allowed = all;
  if (o.maxColors > 0) allowed = reduceColors(cells, labs, colors, o.maxColors);
  if (o.dither) dither(px, empty, cells, colors, allowed, W, H);
  if (o.cleanup) cleanup(cells, W, H);

  return { width: W, height: H, cells };
}
