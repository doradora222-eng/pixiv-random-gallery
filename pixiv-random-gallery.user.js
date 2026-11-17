
// ==UserScript==
// @name         Pixiv Random Gallery
// @namespace    pixiv-random-gallery
// @version      1.0.0
// @description  Randomly view your Pixiv bookmarks
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

  let current = null;
  let busy = false;

  const button = document.createElement("button");
  button.id = "prg-gallery-launcher";
  button.textContent = "🎲 ランダムギャラリー";
  button.style.cssText = `
    position:fixed;
    z-index:999998;
    bottom:25px;
    left:50%;
    transform:translateX(-50%);
    padding:15px 22px;
    border:0;
    border-radius:30px;
    background:#8068df;
    color:white;
    font-size:16px;
    font-weight:bold;
    box-shadow:0 3px 15px #0006;
  `;
  document.body.appendChild(button);

  const overlay = document.createElement("div");
  overlay.style.cssText = `
    display:none;
    position:fixed;
    inset:0;
    z-index:999999;
    background:#111;
    color:white;
    padding:20px;
    overflow:auto;
    text-align:center;
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
      <h3 id="prg-title"></h3>
      <p id="prg-author" style="color:#aaa"></p>
      <a id="prg-link" target="_blank" rel="noopener"
        style="color:#c6baff;display:block;margin:18px">
        pixivで作品を見る ↗
      </a>
      <button id="prg-next" style="
        width:100%;padding:16px;border:0;
        border-radius:12px;background:#8068df;
        color:white;font-size:17px;font-weight:bold">
        🎲 次の作品
      </button>
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

  async function nextWork() {
    if (busy) return;

    busy = true;
    $("next").disabled = true;
    $("status").textContent = "作品を探しています...";
    $("image").style.display = "none";

    try {
      const types = [];

      for (const rest of ["show", "hide"]) {
        const body = await getPage(rest, 0, 1);
        const total = Number(body.total || 0);

        if (total > 0) types.push({ rest, total });
        await sleep(300);
      }

      const total = types.reduce((n, x) => n + x.total, 0);

      if (!total) throw new Error("ブックマークが見つかりません");

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

      if (!work) throw new Error("作品を取得できませんでした");

      current = work;

      $("title").textContent = work.title || "タイトル不明";
      $("author").textContent = "作者：" + (work.userName || "不明");
      $("link").href =
        "https://www.pixiv.net/artworks/" + work.id;

      
      const img = $("image");

      img.onload = () => {
        $("status").textContent = "高画質画像を表示中（全 " + total + " 件）";
        img.style.display = "block";
      };

      img.onerror = () => {
        $("status").textContent = "高画質画像を表示できませんでした";
        img.style.display = "none";
      };

      try {
        const pageResponse = await fetch(
          `/ajax/illust/${work.id}/pages`,
          { credentials: "same-origin" }
        );

        if (!pageResponse.ok) {
          throw new Error("画像情報の取得に失敗");
        }

        const pageJson = await pageResponse.json();

        if (pageJson.error || !pageJson.body?.length) {
          throw new Error("画像URLが見つかりません");
        }

        const urls = pageJson.body[0].urls;

        img.src = urls.regular || urls.original || work.url;

      } catch (error) {
        console.warn("高画質画像取得エラー:", error);
        img.src = work.url;
      }


      $("status").textContent = "画像を読み込んでいます...";

    } catch (error) {
      $("status").textContent = "エラー：" + error.message;
    } finally {
      busy = false;
      $("next").disabled = false;
    }
  }

  button.addEventListener("click", () => {
    overlay.style.display = "block";
    nextWork();
  });

  $("close").addEventListener("click", () => {
    overlay.style.display = "none";
  });

  $("next").addEventListener("click", nextWork);

  // スワイプ操作
  let touchStartX = 0;
  let touchStartY = 0;

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

    // 横方向に60px以上スワイプした場合
    if (Math.abs(diffX) > 60 &&
        Math.abs(diffX) > Math.abs(diffY) * 1.3) {

      if (diffX < 0) {
        // 左スワイプ：次の作品
        nextWork();
      }
    }
  }, { passive: true });
  
})();
