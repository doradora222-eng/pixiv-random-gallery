
// ==UserScript==
// @name         Pixiv Random Gallery
// @namespace    pixiv-random-gallery
// @version      2.0.3
// @description  Pixiv bookmarks random gallery with history and multi-page support
// @match        https://www.pixiv.net/users/*/bookmarks/artworks*
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  if (window.__pixivRandomGalleryLoaded) return;
  window.__pixivRandomGalleryLoaded = true;

  const $ = (id) => document.getElementById(id);
  const userId = location.pathname.match(/\/users\/(\d+)/)?.[1];
  if (!userId) return;

  let history = [];
  let historyIndex = -1;
  let busy = false;
  let touchStartX = 0;
  let touchStartY = 0;

  const api = async (url) => {
    const response = await fetch(url, {
      credentials: "include"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    if (json.error) throw new Error(json.message || "Pixiv API error");
    return json.body;
  };

  const bookmarkUrl = (rest, offset, limit = 1) =>
    `/ajax/user/${userId}/illusts/bookmarks?tag=&offset=${offset}&limit=${limit}&rest=${rest}&lang=ja`;

  async function getRandomWork() {
    const counts = await Promise.all([
      api(bookmarkUrl("show", 0, 1)),
      api(bookmarkUrl("hide", 0, 1))
    ]);

    const choices = counts
      .map((body, index) => ({
        rest: index === 0 ? "show" : "hide",
        total: body.total || 0
      }))
      .filter((item) => item.total > 0);

    if (!choices.length) throw new Error("ブックマーク作品が見つかりません");

    for (let attempt = 0; attempt < 5; attempt++) {
      const total = choices.reduce((sum, item) => sum + item.total, 0);
      let pick = Math.floor(Math.random() * total);
      let selected = choices[0];

      for (const item of choices) {
        if (pick < item.total) {
          selected = item;
          break;
        }
        pick -= item.total;
      }

      const body = await api(
        bookmarkUrl(selected.rest, Math.floor(Math.random() * selected.total), 1)
      );
      const works = body.works || [];

      if (works.length) {
        const work = works[Math.floor(Math.random() * works.length)];
        if (!history.length || work.id !== history[history.length - 1].work.id) {
          return work;
        }
      }
    }

    throw new Error("作品を取得できませんでした。もう一度お試しください");
  }

  async function getWorkPages(work) {
    const body = await api(`/ajax/illust/${work.id}/pages?lang=ja`);
    if (Array.isArray(body) && body.length) {
      return body.map((page) =>
        page.urls?.regular ||
        page.urls?.original ||
        page.urls?.small ||
        work.url
      ).filter(Boolean);
    }
    return [work.url].filter(Boolean);
  }

  function updateButtons(entry) {
    const pageNumber = $("prg-page-number");
    const pagePrev = $("prg-page-prev");
    const pageNext = $("prg-page-next");
    const workPrev = $("prg-work-prev");
    const workNext = $("prg-work-next");

    if (!entry) {
      pageNumber.textContent = "";
      pagePrev.disabled = true;
      pageNext.disabled = true;
      workPrev.disabled = busy || historyIndex <= 0;
      workNext.disabled = busy;
      return;
    }

    pageNumber.textContent =
      `${entry.pageIndex + 1} / ${entry.pages.length}`;

    pagePrev.disabled = busy || entry.pageIndex <= 0;
    pageNext.disabled =
      busy || entry.pageIndex >= entry.pages.length - 1;
    workPrev.disabled = busy || historyIndex <= 0;
    workNext.disabled = busy;
  }

  function showCurrentPage() {
    const entry = history[historyIndex];
    if (!entry) return;

    busy = true;
    updateButtons(entry);

    const img = $("prg-image");
    img.onload = () => {
      busy = false;
      updateButtons(history[historyIndex]);
    };
    img.onerror = () => {
      busy = false;
      updateButtons(history[historyIndex]);
      $("prg-status").textContent = "画像を読み込めませんでした";
    };

    const status = $("prg-status");
status.textContent = entry.work.title || "Pixivで作品を見る";
status.href = `https://www.pixiv.net/artworks/${entry.work.id}`;
    img.src = entry.pages[entry.pageIndex];
  }

  async function openWork(work, addToHistory = true) {
    busy = true;
    updateButtons(null);
    $("prg-status").removeAttribute("href");
    $("prg-status").textContent = "作品を読み込み中…";

    try {
      const pages = await getWorkPages(work);
      if (!pages.length) throw new Error("画像が見つかりません");

      const entry = {
        work,
        pages,
        pageIndex: 0
      };

      if (addToHistory) {
        history = history.slice(0, historyIndex + 1);
        history.push(entry);

        if (history.length > 100) history.shift();
        historyIndex = history.length - 1;
      } else {
        history[historyIndex] = entry;
      }

      showCurrentPage();
    } catch (error) {
      console.error(error);
      $("prg-status").textContent =
        `読み込みエラー：${error.message}`;
      busy = false;
      updateButtons(history[historyIndex]);
    }
  }

  async function nextWork() {
    if (busy) return;
    busy = true;
    updateButtons(null);

    try {
      const work = await getRandomWork();
      busy = false;
      await openWork(work);
    } catch (error) {
      console.error(error);
      $("prg-status").textContent =
        `作品取得エラー：${error.message}`;
      busy = false;
      updateButtons(history[historyIndex]);
    }
  }

  function previousWork() {
    if (busy || historyIndex <= 0) return;
    historyIndex--;
    showCurrentPage();
  }

  function nextPage() {
    if (busy) return;
    const entry = history[historyIndex];
    if (!entry || entry.pageIndex >= entry.pages.length - 1) return;
    entry.pageIndex++;
    showCurrentPage();
  }

  function previousPage() {
    if (busy) return;
    const entry = history[historyIndex];
    if (!entry || entry.pageIndex <= 0) return;
    entry.pageIndex--;
    showCurrentPage();
  }

  function createGallery() {
    if ($("prg-overlay")) return;

    const style = document.createElement("style");
    style.textContent = `
      #prg-overlay {
        position: fixed;
        inset: 0;
        z-index: 999999;
        background: rgba(0,0,0,.96);
        color: white;
        display: none;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-family: sans-serif;
      }
      #prg-top {
        position: absolute;
        top: 12px;
        left: 12px;
        right: 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
      }
      #prg-status {
        font-size: 13px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 75%;
      }
      #prg-image {
        max-width: 100%;
        max-height: 78vh;
        object-fit: contain;
      }
      #prg-controls {
        position: absolute;
        bottom: 20px;
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        align-items: center;
        gap: 8px;
        width: 100%;
      }
      #prg-overlay button,
      #prg-launch {
        border: 1px solid #777;
        border-radius: 8px;
        background: #292929;
        color: white;
        padding: 10px 14px;
        font-size: 14px;
      }
      #prg-overlay button:disabled {
        opacity: .35;
      }
      #prg-close {
        background: #555 !important;
      }
      #prg-launch {
        position: fixed;
        right: 15px;
        bottom: 90px;
        z-index: 999998;
        background: #5b3a9e;
      }
    `;
    document.head.appendChild(style);

    const launch = document.createElement("button");
    launch.id = "prg-launch";
    launch.textContent = "🎲 ランダムギャラリー";
    document.body.appendChild(launch);

    const overlay = document.createElement("div");
    overlay.id = "prg-overlay";
    overlay.innerHTML = `
      <div id="prg-top">
        <a id="prg-status" href="#" target="_blank" rel="noopener noreferrer">準備完了</a>
        <button id="prg-close">閉じる ✕</button>
      </div>
      <img id="prg-image" alt="Pixiv illustration">
      <div id="prg-controls">
        <button id="prg-work-prev">前の作品</button>
<button id="prg-page-next">次のページ</button>
<span id="prg-page-number"></span>
<button id="prg-page-prev">前のページ</button>
        <button id="prg-work-next">次の作品 🎲</button>
      </div>
    `;
    document.body.appendChild(overlay);

    launch.addEventListener("click", () => {
      overlay.style.display = "flex";
      if (historyIndex < 0) nextWork();
    });

    $("prg-close").addEventListener("click", () => {
      overlay.style.display = "none";
    });

    $("prg-work-prev").addEventListener("click", previousWork);
    $("prg-work-next").addEventListener("click", nextWork);
    $("prg-page-prev").addEventListener("click", previousPage);
    $("prg-page-next").addEventListener("click", nextPage);

    overlay.addEventListener("touchstart", (event) => {
      if (event.target.closest("button")) return;
      touchStartX = event.changedTouches[0].screenX;
      touchStartY = event.changedTouches[0].screenY;
    }, { passive: true });

    overlay.addEventListener("touchend", (event) => {
      if (event.target.closest("button")) return;

      const dx = event.changedTouches[0].screenX - touchStartX;
      const dy = event.changedTouches[0].screenY - touchStartY;

      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;

      if (dx < 0) {
        const entry = history[historyIndex];
        if (entry && entry.pageIndex < entry.pages.length - 1) {
          nextPage();
        } else {
          nextWork();
        }
      } else {
        const entry = history[historyIndex];
        if (entry && entry.pageIndex > 0) {
          previousPage();
        } else {
          previousWork();
        }
      }
    }, { passive: true });
  }

  createGallery();
})();
