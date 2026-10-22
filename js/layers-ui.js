// 原图来源：单张图片、AI 抠图、多图层拼接。合成结果交给 onSource 去转换成像素图。

import { createComposition, addLayer, setMask, renderComposite, ComposeEditor } from './compose.js';
import { segment, cancelSegment, isSegmenting } from './segment.js';

export function setupLayers({ $, toast, onSource }) {
  let comp = null;
  let dirty = false;
  const dlg = $('dlg-compose');

  const editor = new ComposeEditor($('compose-canvas'), {
    onSelect: () => {
      renderList();
      syncProps();
    },
    onChange: () => {
      dirty = true;
      syncProps();
    },
    accent: () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
  });

  // ---------- 来源 ----------

  async function readImage(file) {
    if (!file || !file.type.startsWith('image/')) throw new Error('请选择图片文件');
    try {
      return await createImageBitmap(file);
    } catch {
      throw new Error('无法读取这张图片');
    }
  }

  const baseName = (file) => (file.name || '粘贴的图片').replace(/\.[^.]+$/, '').slice(0, 24) || '图片';

  function emit() {
    onSource(renderComposite(comp));
  }

  async function replaceWith(file) {
    const bmp = await readImage(file);
    comp = createComposition(bmp, baseName(file));
    bmp.close?.();
    $('btn-ai-cut').disabled = $('btn-compose').disabled = false;
    emit();
  }

  async function addFiles(files) {
    let last = null;
    for (const f of files) {
      try {
        const bmp = await readImage(f);
        if (!comp) comp = createComposition(bmp, baseName(f));
        else addLayer(comp, bmp, baseName(f));
        bmp.close?.();
        last = comp.layers[comp.layers.length - 1];
      } catch (err) {
        toast(err.message);
      }
    }
    if (!last) return;
    $('btn-ai-cut').disabled = $('btn-compose').disabled = false;
    dirty = true;
    editor.setComposition(comp);
    editor.select(last);
  }

  // ---------- AI 抠图 ----------

  const statusEls = [...document.querySelectorAll('.ai-status')];
  function showStatus(text, frac) {
    for (const el of statusEls) {
      el.hidden = false;
      el.querySelector('.ai-text').textContent = text;
      const bar = el.querySelector('.ai-bar');
      bar.classList.toggle('busy', frac == null);
      bar.querySelector('span').style.width = frac == null ? '' : `${Math.round(frac * 100)}%`;
    }
  }
  function hideStatus() {
    for (const el of statusEls) el.hidden = true;
  }
  for (const el of statusEls) el.querySelector('.ai-cancel').onclick = () => cancelSegment();

  async function cutLayer(layer) {
    if (isSegmenting()) {
      toast('上一张还在抠图，请稍等');
      return false;
    }
    showStatus('正在准备 AI…', null);
    const t0 = performance.now();
    try {
      const mask = await segment(layer.src, (s) => {
        if (s.stage === 'download') {
          const mb = (n) => (n / 1048576).toFixed(1);
          // 服务器压缩传输时 total 是压缩后的大小，可能小于实际下载量
          const known = s.total && s.loaded <= s.total;
          showStatus(
            known ? `正在下载 AI 模型 ${mb(s.loaded)} / ${mb(s.total)} MB（只需下载一次）` : `正在下载 AI 模型 ${mb(s.loaded)} MB（只需下载一次）`,
            known ? s.loaded / s.total : null,
          );
        } else if (s.stage === 'init') showStatus('正在启动 AI…', null);
        else if (s.stage === 'run') showStatus('正在抠图，手机上可能需要几十秒…', null);
      });
      setMask(layer, mask);
      dirty = true;
      editor.changed();
      renderList();
      toast(`抠图完成，用时 ${Math.round((performance.now() - t0) / 1000)} 秒`);
      return true;
    } catch (err) {
      if (err.message === '已取消') toast('已取消抠图');
      else if (err.message.startsWith('没有识别到')) toast(err.message);
      else toast('AI 抠图失败：' + err.message);
      return false;
    } finally {
      hideStatus();
    }
  }

  // 主面板上的「AI 抠图」：只有一张图时直接抠，多张时打开图层拼接让用户选
  async function quickCut() {
    if (!comp) return;
    if (comp.layers.length > 1) {
      open();
      toast('先选中要抠图的图层，再点「AI 抠图」');
      return;
    }
    if (await cutLayer(comp.layers[0])) {
      dirty = false;
      emit();
    }
  }

  // ---------- 对话框 ----------

  function open() {
    if (!comp) return;
    dirty = false;
    dlg.showModal();
    editor.setComposition(comp);
    renderList();
    syncProps();
  }

  function close() {
    if (dlg.open) dlg.close();
  }

  dlg.addEventListener('close', () => {
    if (isSegmenting()) cancelSegment();
    if (dirty && comp) emit();
    dirty = false;
  });
  $('btn-compose-done').onclick = close;
  $('btn-compose').onclick = open;
  $('btn-ai-cut').onclick = quickCut;

  for (const b of dlg.querySelectorAll('[data-ctool]')) {
    b.onclick = () => {
      editor.setTool(b.dataset.ctool);
      for (const o of dlg.querySelectorAll('[data-ctool]')) o.classList.toggle('active', o === b);
      $('row-brush').hidden = b.dataset.ctool === 'move';
    };
  }
  $('row-brush').hidden = true;

  $('btn-layer-add').onclick = () => $('file-layer').click();
  $('file-layer').onchange = async (e) => {
    await addFiles([...e.target.files]);
    e.target.value = '';
  };

  // ---------- 图层列表 ----------

  function renderList() {
    const list = $('layer-list');
    list.innerHTML = '';
    if (!comp) return;
    // 最上层的图层排在列表最前面
    [...comp.layers].reverse().forEach((l) => {
      const li = document.createElement('li');
      li.dataset.id = l.id;
      li.classList.toggle('on', l === editor.selected);
      li.classList.toggle('off', !l.visible);
      const th = document.createElement('canvas');
      th.width = th.height = 80;
      const k = Math.min(80 / l.w, 80 / l.h);
      th.getContext('2d').drawImage(l.cut, (80 - l.w * k) / 2, (80 - l.h * k) / 2, l.w * k, l.h * k);
      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = l.name + (l.mask ? ' · 已抠图' : '');
      li.append(th, name);
      for (const [act, label, title] of [
        ['vis', l.visible ? '👁' : '—', l.visible ? '隐藏' : '显示'],
        ['up', '↑', '上移一层'],
        ['down', '↓', '下移一层'],
        ['del', '✕', '删除图层'],
      ]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.act = act;
        b.textContent = label;
        b.title = title;
        li.append(b);
      }
      list.append(li);
    });
  }

  $('layer-list').addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const i = comp.layers.findIndex((l) => l.id === +li.dataset.id);
    const l = comp.layers[i];
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'vis') l.visible = !l.visible;
    else if (act === 'up' && i < comp.layers.length - 1) comp.layers.splice(i, 2, comp.layers[i + 1], l);
    else if (act === 'down' && i > 0) comp.layers.splice(i - 1, 2, l, comp.layers[i - 1]);
    else if (act === 'del') {
      if (comp.layers.length === 1) {
        toast('至少要保留一个图层');
        return;
      }
      comp.layers.splice(i, 1);
      if (editor.selected === l) editor.selected = comp.layers[Math.min(i, comp.layers.length - 1)];
    } else if (!act) {
      editor.select(l);
      return;
    }
    dirty = true;
    editor.changed();
    renderList();
    syncProps();
  });

  // ---------- 选中图层的属性 ----------

  function syncProps() {
    const l = editor.selected;
    $('layer-props').hidden = !l;
    if (!l) return;
    $('lp-scale').value = Math.round(l.scale * 100);
    $('out-lp-scale').textContent = `${Math.round(l.scale * 100)}%`;
    const rot = ((((l.rotation + 180) % 360) + 360) % 360) - 180;
    $('lp-rotate').value = Math.round(rot);
    $('out-lp-rotate').textContent = `${Math.round(rot)}°`;
    $('lp-flip').checked = l.flipX;
    $('btn-layer-unmask').disabled = !l.mask;
  }

  $('lp-scale').oninput = (e) => {
    editor.selected.scale = +e.target.value / 100;
    editor.changed();
  };
  $('lp-rotate').oninput = (e) => {
    editor.selected.rotation = +e.target.value;
    editor.changed();
  };
  $('lp-flip').onchange = (e) => {
    editor.selected.flipX = e.target.checked;
    editor.changed();
  };
  $('lp-brush').oninput = (e) => {
    editor.brush = +e.target.value;
    $('out-lp-brush').textContent = e.target.value;
  };
  $('btn-layer-center').onclick = () => {
    const l = editor.selected;
    l.x = comp.width / 2;
    l.y = comp.height / 2;
    editor.changed();
  };
  $('btn-layer-unmask').onclick = () => {
    setMask(editor.selected, null);
    dirty = true;
    editor.changed();
    renderList();
  };
  $('btn-layer-cut').onclick = () => cutLayer(editor.selected);

  return {
    loadFile: replaceWith,
    addFiles,
    isOpen: () => dlg.open,
    close,
  };
}
