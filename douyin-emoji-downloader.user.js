// ==UserScript==
// @name         抖音收藏表情包批量下载
// @namespace    https://github.com/Yiipu
// @version      1.0.0
// @description  打开私信表情面板后，一键采集并下载所有收藏表情包
// @author       Yiipu
// @match        https://www.douyin.com/*
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      douyinpic.com
// @connect      zjcdn.com
// @connect      *
// @license      GPL3
// @updateURL    https://raw.githubusercontent.com/Yiipu/greasyfork/main/douyin-emoji-downloader.user.js
// @downloadURL  https://raw.githubusercontent.com/Yiipu/greasyfork/main/douyin-emoji-downloader.user.js
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const FOLDER = "抖音收藏表情包";
  const MIN_GAP_MS = 150;

  // ---- 提取：与 Python 版 extract_emoji_urls 同逻辑 ----

  function pickSrc(img) {
    return (
      img.src ||
      img.getAttribute("data-src") ||
      img.getAttribute("data-original") ||
      ""
    );
  }

  function normalizeSrc(src) {
    if (src.startsWith("//")) src = "https:" + src;
    return src;
  }

  function isEmojiSrc(src) {
    return (
      src.startsWith("http") &&
      (src.includes("emoticon") || src.includes("emotion"))
    );
  }

  function extractFromDoc(doc) {
    const urls = new Set();
    for (const img of doc.querySelectorAll("img")) {
      const src = normalizeSrc(pickSrc(img));
      if (src && isEmojiSrc(src)) urls.add(src);
    }
    return urls;
  }

  function extractAll() {
    const urls = extractFromDoc(document);
    // 兜底：扫描同源 iframe（对应 Python 版遍历 page.frames）
    for (const frame of document.querySelectorAll("iframe")) {
      try {
        if (frame.contentDocument) {
          for (const u of extractFromDoc(frame.contentDocument)) urls.add(u);
        }
      } catch (_) {
        /* 跨域 iframe 不可读，跳过 */
      }
    }
    // 清洗 + 按文件名去重（对应 Python 版 clean_url / seen / names）
    const byName = new Map();
    for (const raw of urls) {
      if (!raw.startsWith("http")) continue;
      const fname = raw.split("?")[0].split("/").pop();
      if (fname && !byName.has(fname)) byName.set(fname, raw);
    }
    return [...byName.entries()]; // [ [fname, url], ... ]
  }

  // ---- 下载 ----

  function extOf(fname, url) {
    const m = fname.match(/\.(gif|webp|apng|png|jpe?g|svg|bmp)$/i);
    return m ? m[1].toLowerCase() : "png";
  }

  function saveBlob(blob, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename.split("/").pop(); // 锚点下载不支持子目录
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  function gmFetchBlob(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        url,
        responseType: "blob",
        headers: { Referer: "https://www.douyin.com/" },
        onload: (r) =>
          r.status === 200 ? resolve(r.response) : reject(new Error("HTTP " + r.status)),
        onerror: () => reject(new Error("网络错误")),
      });
    });
  }

  async function downloadOne(url, filename) {
    // 优先 GM_download（支持子目录、不弹 CORS 问题）
    if (typeof GM_download === "function") {
      try {
        await new Promise((resolve, reject) =>
          GM_download({ url, name: filename, onload: resolve, onerror: reject })
        );
        return true;
      } catch (_) {
        /* 落入 blob 兜底 */
      }
    }
    try {
      saveBlob(await gmFetchBlob(url), filename);
      return true;
    } catch (e) {
      console.error("[抖音表情下载]", url, e);
      return false;
    }
  }

  // ---- UI ----

  let btn;
  function toast(msg, ms = 3000) {
    const t = document.createElement("div");
    t.textContent = msg;
    Object.assign(t.style, {
      position: "fixed", right: "16px", bottom: "76px", zIndex: 99999,
      background: "rgba(0,0,0,.8)", color: "#fff", padding: "10px 14px",
      borderRadius: "8px", fontSize: "13px", maxWidth: "320px",
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  async function run() {
    if (btn.disabled) return;
    btn.disabled = true;
    const found = extractAll();
    if (!found.length) {
      toast("未找到表情，请先打开「消息 → 聊天窗口 → 😊 → 自定义表情」面板并向下滚动加载");
      btn.disabled = false;
      return;
    }
    if (!confirm(`共发现 ${found.length} 个收藏表情，开始下载？`)) {
      btn.disabled = false;
      return;
    }
    let ok = 0, fail = 0;
    for (let i = 0; i < found.length; i++) {
      const [fname, url] = found[i];
      const filename = `${FOLDER}/emoji_${String(i + 1).padStart(4, "0")}.${extOf(fname, url)}`;
      btn.textContent = `⏳ ${i + 1}/${found.length}`;
      (await downloadOne(url, filename)) ? ok++ : fail++;
      await new Promise((r) => setTimeout(r, MIN_GAP_MS));
    }
    toast(`✅ 成功 ${ok} 个，❌ 失败 ${fail} 个，已保存到浏览器下载目录的「${FOLDER}」子文件夹`);
    btn.textContent = "🫡 采集表情";
    btn.disabled = false;
  }

  function mount() {
    btn = document.createElement("button");
    btn.textContent = "🫡 采集表情";
    Object.assign(btn.style, {
      position: "fixed", right: "16px", bottom: "24px", zIndex: 99999,
      background: "#fe2c55", color: "#fff", border: "none",
      padding: "10px 16px", borderRadius: "24px",
      fontSize: "14px", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.3)",
    });
    btn.onclick = run;
    document.body.appendChild(btn);
  }

  if (typeof GM_registerMenuCommand === "function") {
    GM_registerMenuCommand("采集收藏表情包", run);
  }

  if (document.body) mount();
  else addEventListener("DOMContentLoaded", mount);

  // 控制台调试出口
  window.__douyinEmoji = { extractAll, run };
})();
