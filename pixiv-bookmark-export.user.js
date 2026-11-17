
// ==UserScript==
// @name         Pixiv Bookmark Exporter
// @namespace    pixiv-random-gallery
// @version      1.0.0
// @description  Export public and private Pixiv bookmarks to JSON
// @match        https://www.pixiv.net/users/*/bookmarks/artworks*
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const LIMIT = 48;
  const WAIT = 800;

  const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

  function addButton() {
    if (document.getElementById("prg-export-button")) return;

    const button = document.createElement("button");
    button.id = "prg-export-button";
    button.textContent = "ブックマークをJSONに書き出す";
    button.style.cssText = `
      position:fixed;
      z-index:999999;
      bottom:25px;
      left:50%;
      transform:translateX(-50%);
      padding:15px 20px;
      border:0;
      border-radius:12px;
      background:#8068df;
      color:white;
      font-size:15px;
      font-weight:bold;
      box-shadow:0 3px 12px #0006;
    `;

    button.addEventListener("click", exportBookmarks);
    document.body.appendChild(button);
  }

  async function exportBookmarks() {
    const button = document.getElementById("prg-export-button");

    const match = location.pathname.match(
      /\/users\/(\d+)\/bookmarks\/artworks/
    );

    if (!match) {
      alert("自分のブックマークページを開いてください");
      return;
    }

    const userId = match[1];

    if (!confirm(
      "公開・非公開のブックマークを取得します。\n" +
      "取得には時間がかかる場合があります。開始しますか？"
    )) return;

    button.disabled = true;

    const allWorks = new Map();

    try {
      for (const rest of ["show", "hide"]) {
        let offset = 0;
        let total = null;

        while (true) {
          button.textContent =
            (rest === "show" ? "公開" : "非公開") +
            "取得中：" + offset + "件";

          const params = new URLSearchParams({
            tag: "",
            offset: String(offset),
            limit: String(LIMIT),
            rest,
            lang: "ja"
          });

          const response = await fetch(
            `/ajax/user/${userId}/illusts/bookmarks?${params}`,
            {
              credentials: "same-origin",
              headers: { "Accept": "application/json" }
            }
          );

          if (!response.ok) {
            throw new Error("通信エラー：" + response.status);
          }

          const json = await response.json();

          if (json.error || !json.body) {
            throw new Error(
              json.message || "Pixiv APIからデータを取得できませんでした"
            );
          }

          const works = json.body.works || [];
          total = json.body.total ?? total;

          for (const work of works) {
            const id = String(work.id);

            allWorks.set(id, {
              id,
              title: work.title || "",
              author: work.userName || "",
              authorId: String(work.userId || ""),
              image: work.url || "",
              url: `https://www.pixiv.net/artworks/${id}`,
              tags: work.tags || [],
              private: rest === "hide"
            });
          }

          offset += works.length;

          if (
            works.length === 0 ||
            (total !== null && offset >= total) ||
            works.length < LIMIT
          ) break;

          await sleep(WAIT);
        }
      }

      const result = {
        exportedAt: new Date().toISOString(),
        userId,
        count: allWorks.size,
        works: Array.from(allWorks.values())
      };

      const blob = new Blob(
        [JSON.stringify(result, null, 2)],
        { type: "application/json" }
      );

      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = blobUrl;
      link.download = "pixiv-bookmarks.json";
      document.body.appendChild(link);
      link.click();
      link.remove();

      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);

      button.textContent = "取得完了：" + allWorks.size + "件";
      alert(
        "取得が完了しました！\n" +
        allWorks.size + "件の作品をJSONに書き出しました。"
      );

    } catch (error) {
      console.error(error);
      button.textContent = "取得に失敗しました";
      alert("エラーが発生しました。\n" + error.message);
    } finally {
      button.disabled = false;
      if (button.textContent === "ブックマークをJSONに書き出す") {
        button.textContent = "もう一度取得する";
      }
    }
  }

  addButton();
})();
