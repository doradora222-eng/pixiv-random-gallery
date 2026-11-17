
// ==UserScript==
// @name         Pixiv Random Gallery
// @namespace    pixiv-random-gallery
// @version      2.0.0
// @description  Random Pixiv gallery with history and manga pages
// @match        https://www.pixiv.net/users/*/bookmarks/artworks*
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  if (document.getElementById("prg-gallery-launcher")) return;

  const match = location.pathname.match(
    /\/users\/(\d+)\/bookmarks\/artworks/
  );
  if (!match) return;

  const userId = match[1];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let history = [];
  let historyIndex = -1;
  let busy = false;
  let touchStartX = 0;
  let touchStartY = 0;
  let requestId = 0;

  const button = document.createElement("button");
  button.id = "prg-gallery-launcher";
  button.textContent = "🎲 ランダムギャラリー";
  button.style.cssText = `
    position:fixed;z-index:999998;bottom:25px;
    left:50%;transform:translateX(-50%);
    padding:15px 22px;border:0;border-radius:30px;
    background:#8068df;color:white;font-size:16px;
    font-weight:bold;box-shadow:0 3px 15px #0006;
  `;
  document.body.appendChild(button);

  const overlay = document.createElement("div");
  overlay.style.cssText = `
    display:none;position:fixed;inset:0;
    z-index:999999;background:#111;color:white;
    padding:20px;overflow:auto;text-align:center;
    font-family:-apple-system,sans-serif;
  `;

  overlay.innerHTML = `
    <div style="max-width:700px;margin:auto;padding-top:20px">
      <button id="prg-close" style="
        float:right;padding:10px 18px;border:0;
        border-radius:10px;background:#444;color:white">
        閉じる
      </button>

      <h2 style="clear:both;padding-top:25px">
        Pixiv Random Gallery
      </h2>

      <p id="prg-status">準備中...</p>

      <img id="prg-image" alt="作品画像" style="
        display:none;width:100%;max-height:68vh;
        object-fit:contain;border-radius:10px">

      <p id="prg-page-number" style="color:#aaa"></p>

      <div style="display:flex;gap:10px;margin:15px 0">
        <button id="prg-page-prev" style="
          flex:1;padding:12px;border:0;border-radius:10px;
          background:#444;color:white">
          前のページ
        </button>
        <button id="prg-page-next" style="
          flex:1;padding:12px;border:0;border-radius:10px;
          background:#444;color:white">
          次のページ
        </button>
      </div>

      <h3 id="prg-title"></h3>
      <p id="prg-author" style="color:#aaa"></p>

      <a id="prg-link" target="_blank" rel="noopener"
        style="color:#c6baff;display:block;margin:18px">
        pixivで作品を見る ↗
      </a>

      <div style="display:flex;gap:10px">
        <button id="prg-work-prev" style="
          flex:1;padding:16px 8px;border:0;
          border-radius:12px;background:#444;color:white;
          font-size:15px">
          ← 前の作品
        </button>

        <button id="prg-next" style="
          flex:1;padding:16px 8px;border:0;
          border-radius:12px;background:#8068df;
          color:white;font-size:15px;font-weight:bold">
          🎲 次の作品
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const $ = id => overlay.querySelector("#prg-" + id);

  async function getPage(rest, offset, limit) {
    const params = new URLSearchParams({
      tag: "",
      offset: String(offset),
      limit: String(limit),
      rest,
      lang: "ja"
    });

    const response = await fetch(
      `/ajax/user/${userId}/illusts/bookmarks?${params}`,
      { credentials: "same-origin" }
    );

    if (!response.ok) {
      throw new Error("通信エラー：" + response.status);
    }

    const json = await response.json();

    if (json.error || !json.body) {
      throw new Error(json.message || "取得できませんでした");
    }

    return json.body;
  }

  async function getRandomWork() {
    const types = [];

    for (const rest of ["show", "hide"]) {
      const body = await getPage(rest, 0, 1);
      const total = Number(body.total || 0);

      if (total > 0) types.push({ rest, total });
      await sleep(300);
    }

    const total = types.reduce((n, x) => n + x.total, 0);

    if (!total) {
      throw new Error("ブックマークが見つかりません");
    }

    let choice = Math.floor(Math.random() * total);
    let selectedType = types[0];

    for (const type of types) {
      if (choice < type.total) {
        selectedType = type;
        break;
      }
      choice -= type.total;
    }

    const body = await getPage(selectedType.rest, choice, 1);
    const work = body.works?.[0];

    if (!work) {
      throw new Error("作品を取得できませんでした");
    }

    return { work, total };
  }

  async function getWorkPages(workId) {
    const response = await fetch(
      `/ajax/illust/${workId}/pages`,
      { credentials: "same-origin" }
    );

    if (!response.ok) {
      throw new Error("ページ情報の取得に失敗しました");
    }

    const json = await response.json();

    if (json.error || !json.body?.length) {
      throw new Error("画像情報が見つかりません");
    }

    return json.body.map(page =>
      page.urls.regular ||
      page.urls.original
    ).filter(Boolean);
  }

  function updateButtons(entry) {
    $("page-number").textContent =
      `ページ ${entry.pageIndex + 1} / ${entry.pages.length}`;

    $("page-prev").disabled = busy || entry.pageIndex === 0;
    $("page-next").disabled =
      busy || entry.pageIndex >= entry.pages.length - 1;

    $("work-prev").disabled = busy || historyIndex <= 0;
    $("next").disabled = busy;
  }

  async function showCurrentPage() {
    const entry = history[historyIndex];
    if (!entry) return;

    const id = ++requestId;
    busy = true;
    updateButtons(entry);

    $("status").textContent = "画像を読み込んでいます...";

    const img = $("image");
    img.style.display = "none";

    img.onload = () => {
      if (id !== requestId) return;

      img.style.display = "block";
      $("status").textContent =
        `全 ${entry.total} 件から選択`;
      busy = false;
      updateButtons(entry);
    };

    img.onerror = () => {
      if (id !== requestId) return;

      $("status").textContent = "画像を表示できませんでした";
      busy = false;
      updateButtons(entry);
    };

    img.src = entry.pages[entry.pageIndex];
  }

  async function openEntry(entry) {
    const id = ++requestId;
    busy = true;

    $("status").textContent = "作品情報を取得しています...";
    $("image").style.display = "none";

    $("title").textContent = entry.work.title || "タイトル不明";
    $("author").textContent =
      "作者：" + (entry.work.userName || "不明");

    $("link").href =
      "https://www.pixiv.net/artworks/" + entry.work.id;

    try {
      entry.pages = await getWorkPages(entry.work.id);

      if (id !== requestId) return;

      entry.pageIndex = 0;

      await showCurrentPage();

    } catch (error) {
      if (id !== requestId) return;

      entry.pages = [entry.work.url];
      entry.pageIndex = 0;

      $("status").textContent =
        "ページ情報を取得できませんでした。通常画像を表示します";

      await showCurrentPage();
    }
  }

  async function nextWork() {
    if (busy) return;

    busy = true;
    $("status").textContent = "次の作品を探しています...";
    updateButtons(null);

    try {
      // 途中から新しい作品へ進んだ場合、
      // その先の履歴は新しい履歴に置き換える
      history = history.slice(0, historyIndex + 1);

      const result = await getRandomWork();

      const entry = {
        work: result.work,
        total: result.total,
        pages: [],
        pageIndex: 0
      };

      history.push(entry);

      // 履歴が増えすぎないよう最大100作品
      if (history.length > 100) history.shift();

      historyIndex = history.length - 1;

      busy = false;
      await openEntry(entry);

    } catch (error) {
      busy = false;
      $("status").textContent = "エラー：" + error.message;
      updateButtons(history[historyIndex]);
    }
  }

  async function previousWork() {
    if (busy || historyIndex <= 0) return;

    historyIndex--;
    await openEntry(history[historyIndex]);
  }

  async function changePage(direction) {
    if (busy) return;

    const entry = history[historyIndex];
    if (!entry) return;

    const nextIndex = entry.pageIndex + direction;

    if (nextIndex < 0 || nextIndex >= entry.pages.length) return;

    entry.pageIndex = nextIndex;
    await showCurrentPage();
  }

  button.addEventListener("click", () => {
    overlay.style.display = "block";
    if (historyIndex === -1) nextWork();
  });

  $("close").addEventListener("click", () => {
    overlay.style.display = "none";
  });

  $("next").addEventListener("click", nextWork);
  $("work-prev").addEventListener("click", previousWork);
  $("page-prev").addEventListener("click", () => changePage(-1));
  $("page-next").addEventListener("click", () => changePage(1));

  // 左右スワイプ
  overlay.addEventListener("touchstart", event => {
    if (event.target.closest("button, a")) return;

    const touch = event.changedTouches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
  }, { passive: true });

  overlay.addEventListener("touchend", event => {
    if (event.target.closest("button, a")) return;

    const touch = event.changedTouches[0];
    const diffX = touch.clientX - touchStartX;
    const diffY = touch.clientY - touchStartY;

    if (
      Math.abs(diffX) > 60 &&
      Math.abs(diffX) > Math.abs(diffY) * 1.3
    ) {
      const entry = history[historyIndex];
      if (!entry || busy) return;

      if (diffX < 0) {
        // 左：次のページ。最終ページなら次の作品
        if (entry.pageIndex < entry.pages.length - 1) {
          changePage(1);
        } else {
          nextWork();
        }
      } else {
        // 右：前のページ。1ページ目なら前の作品
        if (entry.pageIndex > 0) {
          changePage(-1);
        } else {
          previousWork();
        }
      }
    }
  }, { passive: true });

})();
