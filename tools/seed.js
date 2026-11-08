"use strict";
/* =====================================================================
 * 【開発用・任意】SharePoint 実リストへサンプルデータを投入するヘルパー
 * 使い方: index.html に <script src="tools/seed.js"></script> を一時的に追加し、
 *         ブラウザのコンソールで  await spSeeder.run()  を実行。
 * 本番配置には含めないでください（誤実行・二重登録防止のため）。
 * ===================================================================== */
const spSeeder = {
  async run() {
    if (CONFIG.USE_MOCK_DATA) {
      console.warn("モック動作中です。?mock=1 を外して SharePoint 接続で実行してください。");
      return;
    }
    if (typeof SAMPLE_ITEMS === "undefined") {
      console.warn("sample-data.js が読み込まれていません。");
      return;
    }
    const existing = await spApi.getAllFull();
    if (existing.length > 0 &&
        !confirm(`リストには既に ${existing.length} 件あります。続けると重複登録されます。実行しますか？`)) {
      return;
    }

    const { SORT_NO, NOTE, QUICK_NOTES, SCHEDULE } = CONFIG.FIELDS;
    let done = 0;
    for (const sample of SAMPLE_ITEMS) {            // ID順を保つため直列で登録
      await spApi.create({
        [SORT_NO]: sample.SortNo,
        Seat: sample.Seat,
        Title: sample.Title,
        Dept: sample.Dept,
        Status: sample.Status,
        [NOTE]: sample[NOTE] ?? sample.Remarks ?? "",
        [QUICK_NOTES]: JSON.stringify(CONFIG.DEFAULT_QUICK_NOTES),
        [SCHEDULE]: sample[SCHEDULE] || ""
      });
      done++;
    }
    console.log(`${done}件のサンプルデータを登録しました。`);

    // グループ設定の初期値（AppSettings に未登録の場合のみ）
    const key = CONFIG.SETTINGS_KEYS.STATS_GROUPS;
    const cur = await spApi.getSetting(key);
    if (!cur.id && typeof SAMPLE_STATS_GROUPS !== "undefined") {
      await spApi.saveSetting(key, JSON.stringify(SAMPLE_STATS_GROUPS), cur);
      console.log("人数表グループの初期設定を登録しました。（※メンバーIDは登録順に依存します）");
    }
  }
};
