// AI 抠图：在浏览器本地运行动漫人物分割模型（ISNet anime-seg），得到透明度蒙版

const MODEL_URL = new URL('../models/isnet-anime-int8.onnx', import.meta.url).href;
const SIZE = 1024;
const MEAN = [0.485, 0.456, 0.406];

let worker = null;
let pending = null;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./segment-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const msg = e.data;
      if (!pending) return;
      if (msg.type === 'progress') pending.onStatus?.({ stage: 'download', loaded: msg.loaded, total: msg.total });
      else if (msg.type === 'status') pending.onStatus?.({ stage: msg.stage });
      else if (msg.type === 'done') pending.resolve(msg.mask);
      else if (msg.type === 'error') pending.reject(new Error(msg.message));
    };
    worker.onerror = (e) => pending?.reject(new Error(e.message || 'AI 引擎加载失败'));
  }
  return worker;
}

export function isSegmenting() {
  return !!pending;
}

// 取消正在进行的抠图：直接结束后台线程，下次使用时重新创建（模型已在缓存里）
export function cancelSegment() {
  if (!pending) return;
  worker?.terminate();
  worker = null;
  const p = pending;
  pending = null;
  p.reject(new Error('已取消'));
}

/**
 * 对图片做 AI 抠图，返回与原图同尺寸的蒙版 canvas（alpha 通道表示保留程度）。
 * onStatus({ stage: 'download' | 'init' | 'run', loaded?, total? })
 */
export async function segment(source, onStatus) {
  if (pending) throw new Error('上一张还在处理中');
  const w = source.width, h = source.height;

  // 预处理：缩放到 1024×1024，归一化后按 CHW 排列
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, SIZE, SIZE);
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
  let max = 1;
  for (let i = 0; i < px.length; i += 4) max = Math.max(max, px[i], px[i + 1], px[i + 2]);
  const plane = SIZE * SIZE;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = px[i * 4] / max - MEAN[0];
    input[plane + i] = px[i * 4 + 1] / max - MEAN[1];
    input[2 * plane + i] = px[i * 4 + 2] / max - MEAN[2];
  }

  const mask = await new Promise((resolve, reject) => {
    pending = { resolve, reject, onStatus };
    getWorker().postMessage({ id: Date.now(), modelUrl: MODEL_URL, input, size: SIZE }, [input.buffer]);
  }).finally(() => {
    pending = null;
  });

  // 后处理：拉伸到 0..1，写进 alpha，再缩放回原图尺寸
  let lo = Infinity, hi = -Infinity;
  for (const v of mask) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  // 模型没认出主体时，输出整体都很低
  let kept = 0;
  for (const v of mask) if ((v - lo) / span > 0.5) kept++;
  if (hi < 0.3 || kept < plane * 0.005) throw new Error('没有识别到人物或主体，已保留原图');
  const small = document.createElement('canvas');
  small.width = small.height = SIZE;
  const sctx = small.getContext('2d');
  const img = sctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < plane; i++) img.data[i * 4 + 3] = Math.round(((mask[i] - lo) / span) * 255);
  sctx.putImageData(img, 0, 0);

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(small, 0, 0, w, h);
  return out;
}
