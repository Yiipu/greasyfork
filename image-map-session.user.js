// ==UserScript==
// @name         image-map.net 会话续编助手
// @namespace    https://github.com/Yiipu
// @version      1.0.2
// @description  为 image-map.net 添加自动保存/恢复：编辑自动存到浏览器本地 IndexedDB（仅坐标与文件名，KB 级，不含图片字节、不上传任何数据），重选图片时询问恢复上次编辑，支持 JSON 导出/导入与多图分槽。
// @author       Yiipu
// @match        https://www.image-map.net/*
// @grant        unsafeWindow
// @grant        GM_registerMenuCommand
// @grant        GM_download
// @license      GPL3
// @updateURL    https://raw.githubusercontent.com/Yiipu/greasyfork/main/image-map-session.user.js
// @downloadURL  https://raw.githubusercontent.com/Yiipu/greasyfork/main/image-map-session.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  // Tampermonkey 沙箱隔离：页面 jQuery 须通过 unsafeWindow 访问。
  // 无 unsafeWindow 的环境（书签/控制台）退化为 window（此时 window 即页面 window）。
  const pageWin = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

  /* ---------- 常量 ---------- */
  const DB_NAME = 'image-map-session';
  const STORE = 'session';
  const DEBOUNCE_MS = 500;
  const STATUS_ID = 'im-session-status';

  /* ---------- 防改版护栏：接口探测不符则完全让路 ---------- */
  function probe() {
    if (typeof pageWin.jQuery === 'undefined') return null;
    const $ = pageWin.jQuery;
    if (!$.fn || !$.fn.imageMapper) return null;
    const el = document.querySelector('#image-map');
    if (!el) return null;
    const idx = $(el).data('imageMapper');
    if (typeof idx !== 'number') return null;
    let data;
    try { data = $(el).imageMapper('getData'); } catch (e) { return null; }
    if (!data || !data.state || typeof data.state.areaLength !== 'number' || !Array.isArray(data.area)) return null;
    return { $, el, idx, data };
  }

  /* ---------- IndexedDB ---------- */
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbPut(key, val) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbDelete(key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbAllKeys() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbCount() {
    try { return (await idbAllKeys()).length; } catch (e) { return 0; }
  }

  /* ---------- 序列化 / 反序列化 ---------- */
  function sessionKey(fileName, imageUrl) {
    return fileName || (imageUrl ? imageUrl.replace(/^https?:\/\//, '').replace(/[?#].*$/, '') : null);
  }

  function serialize(data, fileName, imageUrl, naturalW, naturalH) {
    const areas = data.area.map(a => ({
      shape: a.shape || 'rect',
      href: a.href || '',
      title: a.title || '',
      target: a.target || '',
      coords: (a.coords || []).map(c => ({ naturalX: c.naturalX, naturalY: c.naturalY })),
    }));
    // 剥离 SVG DOM 引用（原约定：el 统一置 false；写入副本，不动内存对象）
    return {
      v: 1,
      fileName: fileName || null,
      imageUrl: imageUrl || null,
      naturalWidth: naturalW,
      naturalHeight: naturalH,
      active: data.state.areaIndex,
      savedAt: new Date().toISOString(),
      areas,
    };
  }

  function deserialize(saved) {
    if (!saved || saved.v !== 1 || !Array.isArray(saved.areas)) return null;
    for (const a of saved.areas) {
      if (!['rect', 'poly', 'circle'].includes(a.shape)) return null;
      if (!Array.isArray(a.coords)) return null;
    }
    return saved;
  }

  /* ---------- 状态条（纯文字，无按钮） ---------- */
  let statusEl = null;
  function ensureStatus() {
    if (statusEl && document.body.contains(statusEl)) return statusEl;
    statusEl = document.createElement('div');
    statusEl.id = STATUS_ID;
    statusEl.style.cssText = [
      'position:fixed', 'left:12px', 'bottom:12px', 'z-index:99999',
      'background:rgba(0,0,0,.72)', 'color:#9fd6ff', 'font:12px/1.6 monospace',
      'padding:6px 12px', 'border-radius:6px', 'pointer-events:none',
      'max-width:70vw', 'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis',
    ].join(';');
    document.body.appendChild(statusEl);
    return statusEl;
  }
  function setStatus(text, isError) {
    const el = ensureStatus();
    el.textContent = text;
    el.style.color = isError ? '#ff9a9a' : '#9fd6ff';
  }
  function fmtTime(iso) {
    const d = iso ? new Date(iso) : new Date();
    return d.toLocaleTimeString('zh-CN', { hour12: false });
  }

  const debouncedSave = (() => {
    let t = null;
    return () => {
      clearTimeout(t);
      t = setTimeout(() => { t = null; saveNow(); }, DEBOUNCE_MS);
    };
  })();

  /* ---------- 核心：当前会话上下文 ---------- */
  // state: { fileName, imageUrl, key, naturalW, naturalH, restoreAbandoned }
  const ctx = { session: null };

  async function saveNow() {
    const p = probe();
    if (!p || !ctx.session) return; // 图片未选时不写
    const { $, el } = p;
    const data = $(el).imageMapper('getData');
    const s = ctx.session;
    try {
      const rec = serialize(data, s.fileName, s.imageUrl, s.naturalW, s.naturalH);
      // 无任何区域坐标的空会话不落盘（首次选图后尚未编辑的状态）
      const hasContent = rec.areas.some(a => a.coords.length > 0 || a.title || a.href);
      if (!hasContent) { setStatus(`已选图 ${s.fileName || s.imageUrl}，尚未编辑`); return; }
      await idbPut(s.key, rec);
      setStatus(`已保存 ${fmtTime(rec.savedAt)} · ${s.fileName || s.imageUrl}`);
    } catch (e) {
      setStatus(`保存失败: ${e && e.message ? e.message : e}`, true);
    }
  }

  function flushSave() {
    if (ctx.session) saveNow();
  }

  /* ---------- 编辑监听（F1） ---------- */
  function bindEditingListeners($, el) {
    // SVG 形状/顶点变化：拖点、加点、右键删点、形状重绘
    const svg = document.querySelector('svg.image-mapper-svg');
    if (svg) {
      new MutationObserver(() => debouncedSave()).observe(svg, { subtree: true, childList: true, attributes: true, attributeFilter: ['points', 'cx', 'cy', 'x', 'y', 'width', 'height'] });
    }
    // 表格输入：link/title/target/shape/active
    document.addEventListener('change', e => {
      const n = e.target;
      if (n && n.name && /^im\[\d+\]\[/.test(n.name)) debouncedSave();
    }, true);
    // 增删行（无坐标变化时也要落盘）
    document.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('button.add-row, button.remove-row');
      if (b) debouncedSave();
    }, true);
    // 兜底
    window.addEventListener('beforeunload', flushSave);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
  }

  /* ---------- 恢复（F2） ---------- */
  function injectAreas($, el, saved) {
    const data = $(el).imageMapper('getData');
    // 改写 getData 返回的引用（update 已重置为 1 个空 rect area，全部替换）
    data.area = saved.areas.map(a => ({
      el: false,
      shape: a.shape,
      href: a.href,
      title: a.title,
      target: a.target,
      coords: a.coords.map(c => ({ naturalX: c.naturalX, naturalY: c.naturalY })),
    }));
    data.state.areaLength = data.area.length;
    data.state.areaIndex = Math.min(saved.active || 0, data.area.length - 1);
    $(el).imageMapper('refresh');
    $(el).trigger('update');
  }

  function bindImageEntryHooks($, el) {
    // 本地图：#image-mapper-file change。原站自己的 handler（FileReader → update）与
    // 我方监听顺序未定义，故轮询等待 img.src 变为 dataURL 且加载完成后再处理，
    // 避免在原站 update 生效前读取旧 img 状态。
    const fileInput = document.getElementById('image-mapper-file');
    if (fileInput) {
      fileInput.addEventListener('change', () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) return;
        waitForImgReady(() => onImageChosen($, el, { kind: 'local', fileName: f.name }));
      });
    }
    // 远程图：#image-mapper-continue click，同样等 img 就绪
    const cont = document.getElementById('image-mapper-continue');
    if (cont) {
      cont.addEventListener('click', () => {
        waitForImgReady(() => {
          const url = ($('img.image-mapper-img').attr('src') || '');
          if (/^https?:\/\//.test(url)) onImageChosen($, el, { kind: 'remote', imageUrl: url });
        });
      });
    }
  }

  // 等 img.src 非空且 naturalWidth > 0（原站 update 已生效、图片已解码）
  function waitForImgReady(cb, startedAt) {
    const t0 = startedAt || Date.now();
    const img = document.querySelector('img.image-mapper-img');
    if (img && img.getAttribute('src') && img.naturalWidth > 0) { cb(); return; }
    if (Date.now() - t0 > 15000) { console.warn('[image-map 续编] 等待图片加载超时'); return; }
    setTimeout(() => waitForImgReady(cb, t0), 100);
  }

  async function onImageChosen($, el, info) {
    const key = sessionKey(info.fileName, info.imageUrl);
    if (!key) return;
    ctx.session = { fileName: info.fileName || null, imageUrl: info.imageUrl || null, key, naturalW: 0, naturalH: 0 };

    let saved = null;
    try { saved = await idbGet(key); } catch (e) { /* 读取失败按无存档 */ }
    const valid = saved ? deserialize(saved) : null;
    if (saved && !valid) {
      if (confirm('该图的上次存档无效（版本或结构不符），已忽略。')) { /* 仅提示 */ }
      setStatus('存档无效，已忽略', true);
      return; // 不设 naturalW 等；等待 img onload 后由 updateSessionNatural 补
    }

    if (valid) {
      const n = valid.areas.length;
      const t = fmtTime(valid.savedAt);
      let msg = `${valid.fileName || valid.imageUrl} 有上次编辑（${n} 个区域，${t} 保存）。确定恢复？取消将开始新会话并覆盖该图的旧存档`;
      const img = document.querySelector('img.image-mapper-img');
      // 尺寸校验：img 已由原站加载（change 后立即触发 update），此处可能尚未完成；
      // 若已可读 natural 尺寸则比对，否则跳过（恢复流程本身挂在 onload 后，也可在那时比对）
      if (img && img.naturalWidth > 0 && valid.naturalWidth &&
          (img.naturalWidth !== valid.naturalWidth || img.naturalHeight !== valid.naturalHeight)) {
        msg = `注意：图片尺寸与上次不同（上次 ${valid.naturalWidth}×${valid.naturalHeight}，本次 ${img.naturalWidth}×${img.naturalHeight}），坐标将错位。\n\n` + msg;
      }
      if (!confirm(msg)) {
        // 取消 = 明确放弃恢复；自动保存正常写入并覆盖旧存档
        ctx.session.restoreAbandoned = true;
        setStatus(`新会话 · ${info.fileName || info.imageUrl}（旧存档将在编辑后被覆盖）`);
        return;
      }
      // 确定恢复：注入流程挂在 img onload 后执行
      restoreAfterLoad($, el, valid, info);
    } else {
      setStatus(`新会话 · ${info.fileName || info.imageUrl}`);
    }
  }

  function restoreAfterLoad($, el, valid, info) {
    const img = document.querySelector('img.image-mapper-img');
    const doRestore = () => {
      // img onload 已过，natural 尺寸可得；补尺寸校验（远程图 confirm 时点通常还没加载完）
      if (valid.naturalWidth && img.naturalWidth &&
          (img.naturalWidth !== valid.naturalWidth || img.naturalHeight !== valid.naturalHeight)) {
        if (!confirm(`注意：图片尺寸与上次不同（上次 ${valid.naturalWidth}×${valid.naturalHeight}，本次 ${img.naturalWidth}×${img.naturalHeight}），坐标将错位。仍要恢复？`)) {
          ctx.session.restoreAbandoned = true;
          setStatus(`新会话 · ${info.fileName || info.imageUrl}（旧存档将在编辑后被覆盖）`);
          return;
        }
      }
      injectAreas($, el, valid);
      ctx.session.naturalW = img.naturalWidth;
      ctx.session.naturalH = img.naturalHeight;
      setStatus(`已恢复 ${valid.areas.length} 个区域 · ${info.fileName || info.imageUrl}`);
    };
    if (img && img.naturalWidth > 0) {
      // 已加载
      setTimeout(doRestore, 0);
    } else if (img) {
      img.addEventListener('load', () => setTimeout(doRestore, 0), { once: true });
    } else {
      // img 元素尚未创建（update 未完成），轮询等
      const t = setInterval(() => {
        const i = document.querySelector('img.image-mapper-img');
        if (i && i.naturalWidth > 0) { clearInterval(t); doRestore(); }
      }, 100);
      setTimeout(() => clearInterval(t), 5000);
    }
  }

  /* ---------- Tampermonkey 菜单（F3/F4） ---------- */
  function registerMenu($, el) {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('导出当前会话 JSON', async () => {
      const p = probe();
      if (!p || !ctx.session) { alert('当前没有已选图的会话'); return; }
      const data = $(p.el).imageMapper('getData');
      const rec = serialize(data, ctx.session.fileName, ctx.session.imageUrl, ctx.session.naturalW, ctx.session.naturalH);
      const blob = new Blob([JSON.stringify(rec, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const d = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `imagemap-session-${ctx.session.fileName || 'remote'}-${d}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    GM_registerMenuCommand('导入 JSON', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = async () => {
        const f = input.files && input.files[0];
        if (!f) return;
        try {
          const rec = deserialize(JSON.parse(await f.text()));
          if (!rec) { alert('JSON 结构无效（需 v:1 会话存档）'); return; }
          const key = sessionKey(rec.fileName, rec.imageUrl);
          if (!key) { alert('JSON 缺少 fileName/imageUrl'); return; }
          await idbPut(key, rec);
          setStatus(`已导入 ${rec.fileName || rec.imageUrl}，选该图即可恢复`);
        } catch (e) {
          alert(`导入失败: ${e.message || e}`);
        }
      };
      input.click();
    });
    GM_registerMenuCommand('清除当前会话存档', async () => {
      const p = probe();
      if (!p || !ctx.session) { alert('当前没有已选图的会话'); return; }
      if (!confirm(`确定清除 ${ctx.session.fileName || ctx.session.imageUrl} 的存档？此操作不可恢复。`)) return;
      await idbDelete(ctx.session.key);
      setStatus('存档已清除');
    });
  }

  /* ---------- 启动 ---------- */
  function boot() {
    const p = probe();
    if (!p) {
      // 接口探测失败：完全让路，不注入任何东西
      console.warn('[image-map 续编] 原站接口探测失败，脚本已让路');
      return;
    }
    const { $, el } = p;
    bindEditingListeners($, el);
    bindImageEntryHooks($, el);
    registerMenu($, el);
    idbCount().then(n => {
      if (n > 0) setStatus(`有 ${n} 个已存档会话（选图即恢复）`);
    });
    // 记录 natural 尺寸：img onload 后（恢复/保存都需要）
    const img = document.querySelector('img.image-mapper-img');
    if (img) {
      img.addEventListener('load', () => {
        if (ctx.session) { ctx.session.naturalW = img.naturalWidth; ctx.session.naturalH = img.naturalHeight; }
      }, { once: false });
    }
  }

  // 等插件 init 完成：轮询 data('imageMapper') 就绪
  (function waitInit() {
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      const el = document.querySelector('#image-map');
      if (el && typeof pageWin.jQuery !== 'undefined' && typeof pageWin.jQuery(el).data('imageMapper') === 'number') {
        clearInterval(t);
        boot();
      } else if (tries > 50) { // 5s 后放弃
        clearInterval(t);
        console.warn('[image-map 续编] 等待原站初始化超时，脚本未启动');
      }
    }, 100);
  })();
})();
