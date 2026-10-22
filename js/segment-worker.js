// AI 抠图后台线程：加载 ONNX 模型并推理，避免卡住页面

import * as ort from '../vendor/onnxruntime-web/ort.wasm.min.mjs';

ort.env.wasm.wasmPaths = new URL('../vendor/onnxruntime-web/', import.meta.url).href;
// GitHub Pages 不能开启跨源隔离，多线程不可用时退回单线程
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

const CACHE_NAME = 'beadpixel-models-v1';
let sessionPromise = null;

async function fetchModel(url) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    if (hit) return await hit.arrayBuffer();
  } catch {
    /* 缓存不可用时直接下载 */
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`模型下载失败（HTTP ${res.status}）`);
  const total = +res.headers.get('content-length') || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    postMessage({ type: 'progress', loaded, total });
  }
  const buf = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(url, new Response(buf.slice().buffer, { headers: { 'content-type': 'application/octet-stream' } }));
  } catch {
    /* 存不进缓存也不影响这次使用 */
  }
  return buf.buffer;
}

function getSession(url) {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const buf = await fetchModel(url);
      postMessage({ type: 'status', stage: 'init' });
      return ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    })();
    sessionPromise.catch(() => {
      sessionPromise = null;
    });
  }
  return sessionPromise;
}

self.onmessage = async (e) => {
  const { id, modelUrl, input, size } = e.data;
  try {
    const session = await getSession(modelUrl);
    postMessage({ type: 'status', stage: 'run' });
    const tensor = new ort.Tensor('float32', input, [1, 3, size, size]);
    const out = await session.run({ [session.inputNames[0]]: tensor });
    const mask = out[session.outputNames[0]].data;
    postMessage({ type: 'done', id, mask }, [mask.buffer]);
  } catch (err) {
    postMessage({ type: 'error', id, message: String(err?.message || err) });
  }
};
