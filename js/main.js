import { PALETTES, DEFAULT_PALETTE, preparePalette, parsePaletteText, paletteToText } from './palettes.js';
import { Editor } from './editor.js';
import { convertImage } from './convert.js';
import {
  countCells, renderPNG, renderPattern, downloadBlob, serializeProject, parseProject,
} from './export.js';

const $ = (id) => document.getElementById(id);

const store = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 存储不可用时忽略 */
    }
  },
};

const KEY_AUTOSAVE = 'beadpixel.autosave';
const KEY_PALETTES = 'beadpixel.customPalettes';
const KEY_SETTINGS = 'beadpixel.settings.v2';

// ---------- 色卡管理 ----------

let customPalettes = store.get(KEY_PALETTES) || {};
const preparedCache = new Map();

function paletteDef(id) {
  return PALETTES[id] || customPalettes[id];
}

function getPalette(id) {
  if (!preparedCache.has(id)) {
    const def = paletteDef(id);
    if (!def) return null;
    preparedCache.set(id, preparePalette(id, def.name, def.colors));
  }
  return preparedCache.get(id);
}

function saveCustomPalette(id, name, colors) {
  customPalettes[id] = { name, colors };
  preparedCache.delete(id);
  store.set(KEY_PALETTES, customPalettes);
}

function fillPaletteSelect() {
  const sel = $('opt-palette');
  sel.innerHTML = '';
  const addGroup = (label, entries) => {
    if (!entries.length) return;
    const g = document.createElement('optgroup');
    g.label = label;
    for (const [id, def] of entries) g.append(new Option(`${def.name}（${def.colors.length} 色）`, id));
    sel.append(g);
  };
  addGroup('内置', Object.entries(PALETTES));
  addGroup('我的色卡', Object.entries(customPalettes));
  sel.value = editor.palette.id;
}

// 项目文件里带的色卡：和已有色卡完全一致就复用，否则存成自定义色卡
function adoptPalette(p) {
  const same = (def) =>
    def &&
    def.colors.length === p.colors.length &&
    def.colors.every((c, i) => c[0] === p.colors[i][0] && c[2].toUpperCase() === String(p.colors[i][2]).toUpperCase());
  if (same(paletteDef(p.id))) return getPalette(p.id);
  for (const [id, def] of Object.entries({ ...PALETTES, ...customPalettes })) if (same(def)) return getPalette(id);
  const id = 'custom-' + Date.now().toString(36);
  saveCustomPalette(id, p.name || '项目色卡', p.colors.map((c) => [String(c[0]), String(c[1]), String(c[2])]));
  return getPalette(id);
}

// ---------- 编辑器 ----------

const state = {
  image: null,
  live: false, // 生成后未手动编辑时，参数改动实时刷新
  lastPalette: null,
};

const editor = new Editor($('canvas'), {
  onChange: (kind) => {
    if (kind !== 'load') state.live = false;
    scheduleRefresh();
  },
  onHover: updateHover,
  onToolChange: updateToolButtons,
  onColorChange: () => {
    updateCurrentColor();
    markSelectedSwatch();
  },
  onViewChange: () => {
    $('st-zoom').textContent = `缩放 ${Math.round(editor.view.s)} px/格`;
  },
});

let refreshQueued = false;
function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    refreshAll();
  });
  scheduleAutosave();
}

function refreshAll() {
  if (editor.palette !== state.lastPalette) {
    state.lastPalette = editor.palette;
    if ($('opt-palette').value !== editor.palette.id) $('opt-palette').value = editor.palette.id;
    renderPaletteGrid();
  } else if ($('palette-used').checked) {
    renderPaletteGrid();
  }
  updateCurrentColor();
  renderStats();
  $('st-size').textContent = `${editor.width} × ${editor.height} 格`;
  if (document.activeElement !== $('size-w')) $('size-w').value = editor.width;
  if (document.activeElement !== $('size-h')) $('size-h').value = editor.height;
  $('btn-undo').disabled = !editor.undoStack.length;
  $('btn-redo').disabled = !editor.redoStack.length;
}

let autosaveTimer = 0;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => store.set(KEY_AUTOSAVE, JSON.parse(serializeProject(editor))), 800);
}

// ---------- 色板与当前颜色 ----------

function renderPaletteGrid() {
  const grid = $('palette-grid');
  const q = $('palette-search').value.trim().toLowerCase();
  const onlyUsed = $('palette-used').checked;
  const used = onlyUsed ? countCells(editor.cells) : null;
  grid.innerHTML = '';
  editor.palette.colors.forEach((c, i) => {
    if (used && !used.has(i)) return;
    if (q && !c.code.toLowerCase().includes(q) && !c.name.toLowerCase().includes(q)) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.style.background = c.hex;
    b.style.color = c.text;
    b.textContent = c.code;
    b.title = `${c.code} ${c.name} ${c.hex}`;
    b.dataset.index = i;
    if (i === editor.color) b.classList.add('selected');
    grid.append(b);
  });
}

function markSelectedSwatch() {
  for (const b of $('palette-grid').children) b.classList.toggle('selected', +b.dataset.index === editor.color);
}

function updateCurrentColor() {
  const c = editor.palette.colors[editor.color];
  $('cur-swatch').style.background = c ? c.hex : 'transparent';
  $('cur-code').textContent = c ? c.code : '—';
  $('cur-name').textContent = c ? `${c.name} · ${c.hex}` : '';
}

$('palette-grid').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-index]');
  if (!b) return;
  editor.setColor(+b.dataset.index);
  if (editor.tool === 'eraser' || editor.tool === 'eyedropper' || editor.tool === 'hand') editor.setTool('pencil');
});
$('palette-search').addEventListener('input', renderPaletteGrid);
$('palette-used').addEventListener('change', renderPaletteGrid);

// ---------- 用料统计 ----------

function renderStats() {
  const counts = [...countCells(editor.cells).entries()].sort((a, b) => b[1] - a[1]);
  const total = counts.reduce((s, [, n]) => s + n, 0);
  $('stats-sum').textContent = `共 ${total} 颗 · ${counts.length} 色`;
  $('st-total').textContent = `共 ${total} 颗 · ${counts.length} 色`;
  const list = $('stats-list');
  list.innerHTML = '';
  for (const [i, n] of counts) {
    const c = editor.palette.colors[i];
    const li = document.createElement('li');
    li.dataset.index = i;
    if (editor.highlight === i) li.classList.add('on');
    li.innerHTML = `<span class="swatch"></span><span class="code"></span><span class="name"></span><span class="n"></span>
      <button type="button" title="把这种颜色全部换成当前颜色">⇄</button>`;
    li.querySelector('.swatch').style.background = c.hex;
    li.querySelector('.code').textContent = c.code;
    li.querySelector('.name').textContent = c.name;
    li.querySelector('.n').textContent = n;
    list.append(li);
  }
}

$('stats-list').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const i = +li.dataset.index;
  if (e.target.closest('button')) {
    if (i !== editor.color) editor.replaceColor(i, editor.color);
    return;
  }
  editor.setHighlight(editor.highlight === i ? null : i);
  renderStats();
});

// ---------- 状态栏 ----------

function updateHover(h) {
  if (!h) {
    $('st-pos').textContent = '—';
    return;
  }
  const c = h.v >= 0 ? editor.palette.colors[h.v] : null;
  $('st-pos').textContent = `第 ${h.x + 1} 列，第 ${h.y + 1} 行` + (c ? ` · ${c.code} ${c.name}` : ' · 空');
}

// ---------- 工具栏 ----------

function updateToolButtons(tool) {
  for (const b of document.querySelectorAll('[data-tool]')) b.classList.toggle('active', b.dataset.tool === tool);
}

$('toolbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tool]');
  if (b) editor.setTool(b.dataset.tool);
});
const BRUSHES = [1, 2, 4, 8];
function setBrush(n) {
  editor.setOption('brush', n);
  $('brush-size').value = String(n);
}
$('brush-size').onchange = (e) => setBrush(+e.target.value);
$('btn-undo').onclick = () => editor.undo();
$('btn-redo').onclick = () => editor.redo();
$('btn-zoom-in').onclick = () => editor.zoomBy(1.25);
$('btn-zoom-out').onclick = () => editor.zoomBy(0.8);
$('btn-fit').onclick = () => editor.fit();
for (const [id, key] of [['btn-mirror-x', 'mirrorX'], ['btn-mirror-y', 'mirrorY']]) {
  $(id).onclick = () => {
    const on = !editor.opts[key];
    editor.setOption(key, on);
    $(id).classList.toggle('on', on);
  };
}

// ---------- 显示与画布 ----------

$('disp-grid').onchange = (e) => {
  editor.setOption('grid', e.target.checked);
  saveSettings();
};
$('disp-codes').onchange = (e) => {
  editor.setOption('codes', e.target.checked);
  if (e.target.checked && editor.view.s < 16) toast('放大到每格 16px 以上才会显示色号');
  saveSettings();
};
$('disp-board').onchange = (e) => {
  editor.setOption('boardSize', +e.target.value);
  saveSettings();
};

const clampSize = (v) => Math.max(1, Math.min(300, Math.round(+v) || 1));

$('btn-resize').onclick = () => editor.resize(clampSize($('size-w').value), clampSize($('size-h').value), $('size-anchor').value);
$('btn-flip-h').onclick = () => editor.flip(true);
$('btn-flip-v').onclick = () => editor.flip(false);
for (const b of document.querySelectorAll('[data-shift]')) {
  b.onclick = () => editor.shift(...b.dataset.shift.split(',').map(Number));
}

// ---------- 图片导入与转换 ----------

const optIds = ['opt-width', 'opt-height', 'opt-mode', 'opt-edge', 'opt-maxcolors', 'opt-brightness', 'opt-contrast', 'opt-saturation',
  'opt-bgtol', 'opt-removebg', 'opt-cleanup', 'opt-dither', 'opt-lock'];

function readOptions() {
  return {
    width: clampSize($('opt-width').value),
    height: clampSize($('opt-height').value),
    mode: $('opt-mode').value,
    edge: +$('opt-edge').value,
    maxColors: Math.max(0, +$('opt-maxcolors').value | 0),
    brightness: +$('opt-brightness').value,
    contrast: +$('opt-contrast').value,
    saturation: +$('opt-saturation').value,
    removeBg: $('opt-removebg').checked,
    bgTolerance: +$('opt-bgtol').value,
    cleanup: $('opt-cleanup').checked,
    dither: $('opt-dither').checked,
  };
}

function saveSettings() {
  const s = {};
  for (const id of optIds) {
    const el = $(id);
    s[id] = el.type === 'checkbox' ? el.checked : el.value;
  }
  for (const id of ['disp-grid', 'disp-codes', 'disp-board']) {
    const el = $(id);
    s[id] = el.type === 'checkbox' ? el.checked : el.value;
  }
  store.set(KEY_SETTINGS, s);
}

function loadSettings() {
  const s = store.get(KEY_SETTINGS);
  if (!s) return;
  for (const [id, v] of Object.entries(s)) {
    const el = $(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  }
  editor.setOption('grid', $('disp-grid').checked);
  editor.setOption('codes', $('disp-codes').checked);
  editor.setOption('boardSize', +$('disp-board').value);
}

function syncOutputs() {
  for (const k of ['brightness', 'contrast', 'saturation', 'bgtol', 'edge']) $('out-' + k).textContent = $('opt-' + k).value;
  $('row-bgtol').hidden = !$('opt-removebg').checked;
  // 插画模式按主色取色，不做抖动
  const illustration = $('opt-mode').value === 'illustration';
  $('row-edge').hidden = !illustration;
  $('row-dither').hidden = illustration;
}

function autoHeight() {
  if (!state.image || !$('opt-lock').checked) return;
  const w = clampSize($('opt-width').value);
  $('opt-height').value = clampSize((w * state.image.height) / state.image.width);
}

async function loadImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    toast('请选择图片文件');
    return;
  }
  try {
    state.image = await createImageBitmap(file);
  } catch {
    toast('无法读取这张图片');
    return;
  }
  const prev = $('src-preview');
  if (prev.src) URL.revokeObjectURL(prev.src);
  prev.src = URL.createObjectURL(file);
  prev.hidden = false;
  $('drop-hint').hidden = true;
  $('btn-convert').disabled = false;
  autoHeight();
  runConvert('push');
}

function runConvert(history) {
  if (!state.image) return;
  const o = { ...readOptions(), palette: getPalette($('opt-palette').value) };
  const doc = convertImage(state.image, o);
  editor.load({ ...doc, palette: o.palette }, { history, fit: history === 'push' ? true : 'auto' });
  state.live = true;
  if (history === 'push') toast('已生成像素图，可以 Ctrl+Z 撤销');
}

let liveTimer = 0;
function onOptionChange(e) {
  syncOutputs();
  if (e && (e.target.id === 'opt-width' || e.target.id === 'opt-lock')) autoHeight();
  saveSettings();
  if (!state.live || !state.image) return;
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => runConvert('keep'), 120);
}

for (const id of optIds) $(id).addEventListener('input', onOptionChange);
for (const id of ['opt-removebg', 'opt-cleanup', 'opt-dither', 'opt-lock']) $(id).addEventListener('change', onOptionChange);

$('btn-convert').onclick = () => runConvert('push');

// 恢复默认参数：尺寸、色卡和转换风格保持不变，其余转换参数回到页面初始值
const RESET_IDS = ['opt-edge', 'opt-maxcolors', 'opt-brightness', 'opt-contrast', 'opt-saturation', 'opt-bgtol',
  'opt-removebg', 'opt-cleanup', 'opt-dither'];
const optDefaults = Object.fromEntries(RESET_IDS.map((id) => {
  const el = $(id);
  return [id, el.type === 'checkbox' ? el.defaultChecked : el.defaultValue];
}));
$('btn-reset-opts').onclick = () => {
  for (const [id, v] of Object.entries(optDefaults)) {
    const el = $(id);
    if (el.type === 'checkbox') el.checked = v;
    else el.value = v;
  }
  syncOutputs();
  saveSettings();
  if (state.image) runConvert(state.live ? 'keep' : 'push');
  toast(state.image ? '参数已恢复默认，并重新生成了像素图' : '参数已恢复默认');
};

$('opt-palette').addEventListener('change', (e) => {
  const pal = getPalette(e.target.value);
  if (!pal) return;
  if (state.live && state.image) runConvert('keep');
  else if (editor.hasContent()) {
    editor.remapPalette(pal);
    toast(`已把画布颜色换成「${pal.name}」里最接近的颜色`);
  } else editor.load({ width: editor.width, height: editor.height, cells: editor.cells, palette: pal }, { history: 'keep', fit: false });
});

const dz = $('dropzone');
$('file-image').onchange = (e) => loadImageFile(e.target.files[0]);
for (const t of ['dragenter', 'dragover']) {
  window.addEventListener(t, (e) => {
    e.preventDefault();
    dz.classList.add('over');
  });
}
for (const t of ['dragleave', 'drop']) window.addEventListener(t, () => dz.classList.remove('over'));
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (!f) return;
  if (f.name.endsWith('.json')) openProjectFile(f);
  else loadImageFile(f);
});
window.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith('image/'));
  if (item) loadImageFile(item.getAsFile());
});

// ---------- 新建 / 打开 / 保存 ----------

$('btn-new').onclick = () => {
  $('new-w').value = editor.width;
  $('new-h').value = editor.height;
  $('dlg-new').showModal();
};
$('dlg-new').addEventListener('close', () => {
  if ($('dlg-new').returnValue !== 'ok') return;
  const w = clampSize($('new-w').value), h = clampSize($('new-h').value);
  editor.load({ width: w, height: h, cells: new Int16Array(w * h).fill(-1), palette: editor.palette }, { history: 'push' });
  state.live = false;
});

function projectName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `拼豆-${editor.width}x${editor.height}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function saveProject() {
  showTextResult('保存项目', serializeProject(editor), projectName() + '.json', 'application/json',
    '点「下载」保存成 .json 文件。下载没反应时，可以点「复制内容」保存到备忘录，之后在「打开项目」里粘贴。');
}

// ---------- 导出结果 ----------
// 有些页面环境（例如嵌在别的网站里）会拦截下载，所以导出结果先展示出来，再提供下载、长按保存或复制

let resultFile = null;

function showResult(title, { blob, url, text }, filename, hint) {
  if (resultFile?.url) URL.revokeObjectURL(resultFile.url);
  resultFile = { blob, url, filename };
  $('res-title').textContent = title;
  $('res-preview').hidden = !url;
  if (url) $('res-img').src = url;
  $('res-text').hidden = text === undefined;
  $('res-text').value = text ?? '';
  $('btn-res-copy').hidden = text === undefined;
  $('res-hint').textContent = hint;
  $('dlg-result').showModal();
}

function showImageResult(title, canvas, filename) {
  canvas.toBlob((blob) => {
    showResult(title, { blob, url: URL.createObjectURL(blob) }, filename,
      `${canvas.width} × ${canvas.height} 像素。点「下载」保存；下载没反应时，手机长按图片、电脑右键图片另存为。`);
  }, 'image/png');
}

function showTextResult(title, text, filename, type, hint) {
  showResult(title, { blob: new Blob([text], { type }), text }, filename, hint);
}

$('btn-res-download').onclick = () => {
  if (resultFile) downloadBlob(resultFile.blob, resultFile.filename);
};
$('btn-res-copy').onclick = async () => {
  const ta = $('res-text');
  try {
    await navigator.clipboard.writeText(ta.value);
    toast('已复制');
  } catch {
    ta.focus();
    ta.select();
    toast('已选中全部内容，请按 Ctrl+C 或长按复制');
  }
};

function openProject(p) {
  const palette = adoptPalette(p.palette);
  fillPaletteSelect();
  editor.load({ ...p, palette }, { history: 'push' });
  state.live = false;
  toast('项目已打开');
}

async function openProjectFile(file) {
  try {
    openProject(parseProject(await file.text()));
  } catch (err) {
    toast('打开失败：' + err.message);
  }
}

$('btn-save').onclick = saveProject;
$('btn-open').onclick = () => {
  $('open-text').value = '';
  $('open-error').textContent = '';
  $('dlg-open').showModal();
};
$('btn-open-file').onclick = () => $('file-project').click();
$('file-project').onchange = (e) => {
  if (e.target.files[0]) {
    $('dlg-open').close();
    openProjectFile(e.target.files[0]);
  }
  e.target.value = '';
};
$('btn-open-text').onclick = () => {
  try {
    openProject(parseProject($('open-text').value.trim()));
    $('dlg-open').close();
  } catch (err) {
    $('open-error').textContent = '内容无法识别：' + (err instanceof SyntaxError ? '不是完整的项目内容' : err.message);
  }
};

// ---------- 导出 ----------

$('btn-export').onclick = () => $('dlg-export').showModal();
$('btn-exp-pattern').onclick = () => {
  const c = renderPattern(editor, {
    cell: Math.max(8, Math.min(60, +$('exp-cell').value || 26)),
    countLines: $('exp-lines').value,
    maxSide: $('exp-cap').checked ? 2048 : 0,
    codes: $('exp-codes').checked,
    legend: $('exp-legend').checked,
    boardSize: editor.opts.boardSize,
  });
  showImageResult('拼豆图纸', c, projectName() + '-图纸.png');
};
$('btn-exp-png').onclick = () => {
  showImageResult('像素图', renderPNG(editor, Math.max(1, Math.min(64, +$('exp-scale').value || 10))), projectName() + '.png');
};
$('btn-exp-csv').onclick = () => {
  const rows = [['色号', '名称', '色值', '数量']];
  const counts = [...countCells(editor.cells).entries()].sort((a, b) => b[1] - a[1]);
  for (const [i, n] of counts) {
    const c = editor.palette.colors[i];
    rows.push([c.code, c.name, c.hex, n]);
  }
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  showTextResult('用料清单', '﻿' + csv, projectName() + '-用料.csv', 'text/csv',
    '可以用 Excel 或 WPS 打开。下载没反应时，复制后粘贴到表格里。');
};

// ---------- 色卡导入对话框 ----------

$('btn-palette-manage').onclick = () => {
  const id = editor.palette.id;
  const isCustom = !!customPalettes[id];
  $('pal-name').value = isCustom ? customPalettes[id].name : '';
  $('pal-text').value = isCustom ? paletteToText(editor.palette) : '';
  $('btn-pal-delete').hidden = !isCustom;
  delete $('btn-pal-delete').dataset.armed;
  $('btn-pal-delete').textContent = '删除当前自定义色卡';
  $('pal-error').textContent = '';
  $('dlg-palette').dataset.editing = isCustom ? id : '';
  $('dlg-palette').showModal();
};
$('btn-pal-load-current').onclick = () => {
  $('pal-text').value = paletteToText(editor.palette);
  if (!$('pal-name').value) $('pal-name').value = editor.palette.name + '（副本）';
  $('dlg-palette').dataset.editing = '';
};
$('btn-pal-save').onclick = () => {
  const { colors, errors } = parsePaletteText($('pal-text').value);
  if (errors.length) {
    $('pal-error').textContent = errors.slice(0, 5).join('\n');
    return;
  }
  if (!colors.length) {
    $('pal-error').textContent = '色卡里至少需要一种颜色';
    return;
  }
  const id = $('dlg-palette').dataset.editing || 'custom-' + Date.now().toString(36);
  saveCustomPalette(id, $('pal-name').value.trim() || '我的色卡', colors);
  fillPaletteSelect();
  $('opt-palette').value = id;
  $('opt-palette').dispatchEvent(new Event('change'));
  // 编辑当前正在用的色卡时，强制刷新色板
  if (editor.palette.id === id && editor.palette !== getPalette(id)) editor.remapPalette(getPalette(id));
  $('dlg-palette').close();
  toast(`色卡已保存（${colors.length} 色）`);
};
$('btn-pal-delete').onclick = () => {
  const id = $('dlg-palette').dataset.editing;
  if (!id) return;
  const btn = $('btn-pal-delete');
  // 两次点击确认，避免误删
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1';
    btn.textContent = '再点一次确认删除';
    $('pal-error').textContent = '删除后，画布上的颜色会换成 MARD 221 色里最接近的颜色。';
    return;
  }
  delete customPalettes[id];
  preparedCache.delete(id);
  store.set(KEY_PALETTES, customPalettes);
  editor.remapPalette(getPalette(DEFAULT_PALETTE));
  fillPaletteSelect();
  $('dlg-palette').close();
};

// ---------- 快捷键 ----------

const toolKeys = {
  b: 'pencil', p: 'pencil', e: 'eraser', g: 'bucket', i: 'eyedropper', l: 'line', r: 'rect', o: 'ellipse', h: 'hand',
};

window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea, dialog')) return;
  const k = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (mod && k === 'z') {
    e.preventDefault();
    if (e.shiftKey) editor.redo();
    else editor.undo();
  } else if (mod && k === 'y') {
    e.preventDefault();
    editor.redo();
  } else if (mod && k === 's') {
    e.preventDefault();
    saveProject();
  } else if (e.code === 'Space') {
    e.preventDefault();
    editor.spaceDown = true;
  } else if (!mod && !e.altKey) {
    if (toolKeys[k]) editor.setTool(toolKeys[k]);
    else if (k === '+' || k === '=') editor.zoomBy(1.25);
    else if (k === '-') editor.zoomBy(0.8);
    else if (k === '0') editor.fit();
    else if (k === '#') $('disp-grid').click();
    else if (k === '[' || k === ']') {
      const i = BRUSHES.indexOf(editor.opts.brush) + (k === ']' ? 1 : -1);
      setBrush(BRUSHES[Math.max(0, Math.min(BRUSHES.length - 1, i))]);
    }
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') editor.spaceDown = false;
});
window.addEventListener('blur', () => (editor.spaceDown = false));

// ---------- 提示 ----------

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- 启动 ----------

function start() {
  loadSettings();
  syncOutputs();
  let restored = false;
  const saved = store.get(KEY_AUTOSAVE);
  if (saved) {
    try {
      const p = parseProject(saved);
      editor.load({ ...p, palette: adoptPalette(p.palette) });
      restored = true;
    } catch {
      /* 自动保存损坏时从空白开始 */
    }
  }
  if (!restored) {
    editor.load({ width: 29, height: 29, cells: new Int16Array(29 * 29).fill(-1), palette: getPalette(DEFAULT_PALETTE) });
  }
  fillPaletteSelect();
  updateToolButtons(editor.tool);
  refreshAll();
}

start();
