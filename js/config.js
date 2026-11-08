"use strict";

/* ===================== 共通ユーティリティ ===================== */
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/* ===================== 接続先サイトURLの解決 =====================
 * SharePoint の「サイトURL」を自動判定する。
 *  1) SITE_URL_OVERRIDE に値があればそれを使う（確実に固定したい場合はここに記入）
 *  2) _spPageContextInfo があればその webAbsoluteUrl
 *  3) ページのパスから /SiteAssets/ 等より前を切り出す
 */
const SITE_URL_OVERRIDE = ""; // 例: "https://contoso.sharepoint.com/sites/team"
function resolveSiteUrl() {
  if (SITE_URL_OVERRIDE) return SITE_URL_OVERRIDE.replace(/\/$/, "");
  try {
    if (typeof _spPageContextInfo !== "undefined" && _spPageContextInfo.webAbsoluteUrl) {
      return String(_spPageContextInfo.webAbsoluteUrl).replace(/\/$/, "");
    }
  } catch (e) { /* 無視 */ }
  let path = location.pathname;
  try { path = decodeURIComponent(path); } catch (e) { /* 無視 */ }
  const m = path.match(/^(.*?)\/(?:SiteAssets|SitePages|Shared Documents|Style Library|Lists)\//i);
  return location.origin + (m ? m[1] : "");
}

/* ===================== ステータス定義 ===================== */
const STATUS = Object.freeze({
  PRESENT: "出勤",
  MEETING: "会議",
  SITE: "現場",
  TRIP: "出張",
  HOME: "在宅",
  OFF: "退勤",
  VACATION: "休暇",
  AM_HALF: "午前半休",
  PM_HALF: "午後半休",
  NONE: ""
});

const CONFIG = {
  SITE_URL: resolveSiteUrl(),
  LIST_NAME: "社員名簿",

  // URL に ?mock=1 がある時だけ、ブラウザ内のテストデータ(sample-data.js)で動く（保存はされない）
  // それ以外は、localhost でも file:// でも本物の通信をする（SharePoint、または開発用の SharePointモックサーバー）
  USE_MOCK_DATA: /[?&]mock=1(&|$)/.test(location.search),

  // 全ユーザー共通設定の保存先リスト（人数表グループ設定など）
  // 列: Title(1行テキスト＝キー) / Value(複数行テキスト・「プレーンテキスト」形式)
  SETTINGS_LIST_NAME: "AppSettings",
  SETTINGS_KEYS: { STATS_GROUPS: "StatsGroups" },

  TIMEZONE: "Asia/Tokyo",                  // 日付判定に使うタイムゾーン（端末の設定に依存しない）

  POLLING_INTERVAL_MS: 60 * 1000,          // 通常ポーリング（軽量差分更新）: 1分
  SIGNAGE_FULL_REFRESH_MS: 15 * 60 * 1000, // サイネージ用全件更新＋予約反映: 15分
  DATE_CHANGE_REFRESH_JITTER_MS: 30 * 1000,// 日付が変わった際、一般クライアントの全件更新をばらつかせる幅
  SCHEDULE_PROCESS_JITTER_MS: 20 * 1000,   // サイネージ間の予約反映の衝突を避けるための待ち時間の幅
  STATS_GROUPS_CACHE_MS: 60 * 1000,        // 人数表グループ設定の再取得間隔

  HTTP_TIMEOUT_MS: 15 * 1000,              // 通信タイムアウト
  HTTP_MAX_RETRY: 2,                       // 429/503 の再試行回数
  WRITE_CONCURRENCY: 5,                    // 一括更新・予約反映・保存キューの同時リクエスト数
  SAVE_HOLD_MAX_MS: 20 * 1000,             // ステータス画面を開いている間、変更をまとめて待つ最大時間
  SAVE_RETRY_MAX: 2,                       // 保存に失敗した時の自動再送回数（2秒後・4秒後）

  // SharePointリストの内部列名
  // ※ QuickNotes / NextSchedule は「複数行テキスト（プレーンテキスト）」列にしてください（255文字制限回避）
  FIELDS: {
    NOTE: "Remarks",            // 備考（1行テキスト）
    SORT_NO: "SortNo",          // 並び順No.（数値）
    QUICK_NOTES: "QuickNotes",  // よく使う備考（JSON配列）
    SCHEDULE: "NextSchedule"    // 次回予定予約（1件分のJSON文字列）
  },

  // 席の割り当て（フリーアドレス向け）: 座席表の空席を押して人を割り当てる／ステータス画面の「席を解除」
  // 固定席で、利用者に席を変えさせたくない場合は false（席の変更は「設定」画面だけになる）
  SEAT_ASSIGN_ENABLED: true,

  NOTE_MAX: 16,
  QUICK_NOTES_MAX: 20,          // 1人あたりの「よく使う備考」登録上限

  // 画面ごとに許可するソートキー（localStorage の不正値対策）
  LIST_SORT_KEYS: ["SortNo", "Title", "Dept", "Seat", "Status", "Remarks", "NextSchedule"],
  SIDE_SORT_KEYS: ["SortNo", "Title", "Status", "Remarks"],

  // localStorageのキャッシュキー
  CACHE_KEYS: {
    sortKey: "seatmap_sort_key",
    sortOrder: "seatmap_sort_order",
    search: "seatmap_search_query",
    floor: "seatmap_current_floor",
    colWidths: "seatmap_list_col_widths",
    bulkStatus: "seatmap_bulk_status",
    sideListOpen: "seatmap_side_list_open",
    sideListViewMode: "seatmap_side_list_view_mode",
    sideListSortKey: "seatmap_side_list_sort_key",
    sideListSortOrder: "seatmap_side_list_sort_order",
    sideListSearch: "seatmap_side_list_search",
    sideListStatusFilter: "seatmap_side_list_status_filter",
    sideListFloors: "seatmap_side_list_floors",
    listViewMode: "seatmap_list_view_mode",
    listStatusFilter: "seatmap_list_status_filter",
    listFloors: "seatmap_list_floors",
    myId: "seatmap_my_id"           // 「自分」ボタンで開く社員のId（端末ごと）
  },

  // スマホ判定（styles.css の「スマホ向けレイアウト」の @media と同じ条件にすること）
  // タッチ操作が主で、画面幅が狭い（縦持ち）か高さが低い（横持ち）端末。PCのウィンドウを狭めても該当しない
  PHONE_MEDIA_QUERY: "(pointer: coarse) and (max-width: 767px), (pointer: coarse) and (max-height: 500px)",

  DEFAULT_QUICK_NOTES: ["外出中", "15時戻り", "直帰", "会議室", "研修", "来客対応"],

  // フロア側で width / height を省略した際のデフォルト解像度
  MAP_W: 1920,
  MAP_H: 1080,

  // 座席カードのサイズ種類定義
  CARD_SIZES: {
    standard: { width: 150, height: 80 }, // 標準（横長）
    vertical: { width: 86,  height: 150 } // 縦長
  },

  // 部署シンボル定義（カード左上に16x16で表示）
  // 文字:  { type: "char", value: "総", bg: "背景色", color: "文字色" }（1文字目だけ表示）
  // 画像:  { type: "image", value: "img/dept/xxx.svg" }（index.html からの相対パス。png・svg など）
  DEPT_SYMBOLS: {
    "経営企画部":           { type: "char", value: "企", bg: "#0f766e", color: "#ffffff" },
    "総務部":               { type: "char", value: "総", bg: "#64748b", color: "#ffffff" },
    "人事部":               { type: "char", value: "人", bg: "#db2777", color: "#ffffff" },
    "経理部":               { type: "char", value: "経", bg: "#ca8a04", color: "#ffffff" },
    "広報部":               { type: "char", value: "広", bg: "#e11d48", color: "#ffffff" },
    "情報システム部":       { type: "image", value: "img/dept/it.svg" },
    "営業一部":             { type: "image", value: "img/dept/sales-1.svg" },
    "営業二部":             { type: "image", value: "img/dept/sales-2.svg" },
    "マーケティング部":     { type: "char", value: "M",  bg: "#9333ea", color: "#ffffff" },
    "カスタマーサポート部": { type: "image", value: "img/dept/support.svg" },
    "開発部":               { type: "image", value: "img/dept/dev.svg" },
    "品質保証部":           { type: "image", value: "img/dept/qa.svg" },
    "設計部":               { type: "char", value: "設", bg: "#0284c7", color: "#ffffff" },
    "製造技術部":           { type: "char", value: "製", bg: "#b45309", color: "#ffffff" }
  },

  // 3フロア構成（1F: 36席 / 2F: 36席 / 3F: 36席 ＝ 計108席）
  FLOORS: [
    {
      id: "1F",
      name: "1F 管理部門",
      image: "img/floor/1f.svg",
      width: 1920,
      height: 1080,
      seats: {
        // Aブロック（経営企画部: 大型席＋標準席）
        "1F-A01": { left: 80,   top: 90,  size: "free", width: 160, height: 90 },
        "1F-A02": { left: 255,  top: 90,  size: "free", width: 160, height: 90 },
        "1F-A03": { left: 430,  top: 90,  size: "free", width: 160, height: 90 },
        "1F-A04": { left: 80,   top: 210, size: "standard" },
        "1F-A05": { left: 255,  top: 210, size: "standard" },
        "1F-A06": { left: 430,  top: 210, size: "standard" },
        // Bブロック（総務部）
        "1F-B01": { left: 700,  top: 90,  size: "standard" },
        "1F-B02": { left: 870,  top: 90,  size: "standard" },
        "1F-B03": { left: 1040, top: 90,  size: "standard" },
        "1F-B04": { left: 700,  top: 210, size: "standard" },
        "1F-B05": { left: 870,  top: 210, size: "standard" },
        "1F-B06": { left: 1040, top: 210, size: "standard" },
        // Cブロック（人事部）
        "1F-C01": { left: 1320, top: 90,  size: "standard" },
        "1F-C02": { left: 1490, top: 90,  size: "standard" },
        "1F-C03": { left: 1660, top: 90,  size: "standard" },
        "1F-C04": { left: 1320, top: 210, size: "standard" },
        "1F-C05": { left: 1490, top: 210, size: "standard" },
        "1F-C06": { left: 1660, top: 210, size: "standard" },
        // Dブロック（経理部）
        "1F-D01": { left: 80,   top: 460, size: "standard" },
        "1F-D02": { left: 255,  top: 460, size: "standard" },
        "1F-D03": { left: 430,  top: 460, size: "standard" },
        "1F-D04": { left: 80,   top: 580, size: "standard" },
        "1F-D05": { left: 255,  top: 580, size: "standard" },
        "1F-D06": { left: 430,  top: 580, size: "standard" },
        // Eブロック（広報部: 縦長カード席の島）
        "1F-E01": { left: 700,  top: 460, size: "vertical" },
        "1F-E02": { left: 800,  top: 460, size: "vertical" },
        "1F-E03": { left: 900,  top: 460, size: "vertical" },
        "1F-E04": { left: 700,  top: 630, size: "vertical" },
        "1F-E05": { left: 800,  top: 630, size: "vertical" },
        "1F-E06": { left: 900,  top: 630, size: "vertical" },
        // Fブロック（情報システム部）
        "1F-F01": { left: 1320, top: 460, size: "standard" },
        "1F-F02": { left: 1490, top: 460, size: "standard" },
        "1F-F03": { left: 1660, top: 460, size: "standard" },
        "1F-F04": { left: 1320, top: 580, size: "standard" },
        "1F-F05": { left: 1490, top: 580, size: "free", width: 155, height: 95 },
        "1F-F06": { left: 1660, top: 580, size: "free", width: 155, height: 95 }
      }
    },
    {
      id: "2F",
      name: "2F 営業部門",
      image: "img/floor/2f.svg",
      width: 1920,
      height: 1080,
      seats: {
        // Aブロック（営業一部）
        "2F-A01": { left: 80,   top: 90,  size: "free", width: 160, height: 90 },
        "2F-A02": { left: 255,  top: 90,  size: "standard" },
        "2F-A03": { left: 430,  top: 90,  size: "standard" },
        "2F-A04": { left: 80,   top: 210, size: "standard" },
        "2F-A05": { left: 255,  top: 210, size: "free", width: 160, height: 90 },
        "2F-A06": { left: 430,  top: 210, size: "standard" },
        // Bブロック（営業一部）
        "2F-B01": { left: 700,  top: 90,  size: "standard" },
        "2F-B02": { left: 870,  top: 90,  size: "standard" },
        "2F-B03": { left: 1040, top: 90,  size: "standard" },
        "2F-B04": { left: 700,  top: 210, size: "standard" },
        "2F-B05": { left: 870,  top: 210, size: "standard" },
        "2F-B06": { left: 1040, top: 210, size: "standard" },
        // Cブロック（営業二部）
        "2F-C01": { left: 1320, top: 90,  size: "standard" },
        "2F-C02": { left: 1490, top: 90,  size: "standard" },
        "2F-C03": { left: 1660, top: 90,  size: "standard" },
        "2F-C04": { left: 1320, top: 210, size: "standard" },
        "2F-C05": { left: 1490, top: 210, size: "standard" },
        "2F-C06": { left: 1660, top: 210, size: "standard" },
        // Dブロック（営業二部）
        "2F-D01": { left: 80,   top: 480, size: "standard" },
        "2F-D02": { left: 255,  top: 480, size: "standard" },
        "2F-D03": { left: 430,  top: 480, size: "standard" },
        "2F-D04": { left: 80,   top: 600, size: "standard" },
        "2F-D05": { left: 255,  top: 600, size: "standard" },
        "2F-D06": { left: 430,  top: 600, size: "standard" },
        // Eブロック（マーケティング部）
        "2F-E01": { left: 700,  top: 480, size: "standard" },
        "2F-E02": { left: 870,  top: 480, size: "standard" },
        "2F-E03": { left: 1040, top: 480, size: "standard" },
        "2F-E04": { left: 700,  top: 600, size: "standard" },
        "2F-E05": { left: 870,  top: 600, size: "standard" },
        "2F-E06": { left: 1040, top: 600, size: "standard" },
        // Fブロック（カスタマーサポート部: 縦長席）
        "2F-F01": { left: 1320, top: 460, size: "vertical" },
        "2F-F02": { left: 1420, top: 460, size: "vertical" },
        "2F-F03": { left: 1520, top: 460, size: "vertical" },
        "2F-F04": { left: 1320, top: 630, size: "vertical" },
        "2F-F05": { left: 1420, top: 630, size: "vertical" },
        "2F-F06": { left: 1520, top: 630, size: "vertical" }
      }
    },
    {
      id: "3F",
      name: "3F 技術部門",
      image: "img/floor/3f.svg",
      width: 1680,
      height: 960,
      seats: {
        // Aブロック（開発部）
        "3F-A01": { left: 60,   top: 80,  size: "free", width: 155, height: 85 },
        "3F-A02": { left: 230,  top: 80,  size: "standard" },
        "3F-A03": { left: 395,  top: 80,  size: "standard" },
        "3F-A04": { left: 60,   top: 190, size: "standard" },
        "3F-A05": { left: 230,  top: 190, size: "standard" },
        "3F-A06": { left: 395,  top: 190, size: "standard" },
        // Bブロック（開発部）
        "3F-B01": { left: 610,  top: 80,  size: "standard" },
        "3F-B02": { left: 775,  top: 80,  size: "standard" },
        "3F-B03": { left: 940,  top: 80,  size: "standard" },
        "3F-B04": { left: 610,  top: 190, size: "standard" },
        "3F-B05": { left: 775,  top: 190, size: "standard" },
        "3F-B06": { left: 940,  top: 190, size: "standard" },
        // Cブロック（開発部）
        "3F-C01": { left: 1155, top: 80,  size: "standard" },
        "3F-C02": { left: 1320, top: 80,  size: "standard" },
        "3F-C03": { left: 1485, top: 80,  size: "standard" },
        "3F-C04": { left: 1155, top: 190, size: "standard" },
        "3F-C05": { left: 1320, top: 190, size: "standard" },
        "3F-C06": { left: 1485, top: 190, size: "standard" },
        // Dブロック（品質保証部）
        "3F-D01": { left: 60,   top: 430, size: "standard" },
        "3F-D02": { left: 230,  top: 430, size: "standard" },
        "3F-D03": { left: 395,  top: 430, size: "standard" },
        "3F-D04": { left: 60,   top: 540, size: "standard" },
        "3F-D05": { left: 230,  top: 540, size: "free", width: 155, height: 85 },
        "3F-D06": { left: 395,  top: 540, size: "standard" },
        // Eブロック（設計部）
        "3F-E01": { left: 610,  top: 430, size: "standard" },
        "3F-E02": { left: 775,  top: 430, size: "standard" },
        "3F-E03": { left: 940,  top: 430, size: "standard" },
        "3F-E04": { left: 610,  top: 540, size: "standard" },
        "3F-E05": { left: 775,  top: 540, size: "free", width: 155, height: 85 },
        "3F-E06": { left: 940,  top: 540, size: "standard" },
        // Fブロック（製造技術部: 縦長席）
        "3F-F01": { left: 1155, top: 430, size: "vertical" },
        "3F-F02": { left: 1255, top: 430, size: "vertical" },
        "3F-F03": { left: 1355, top: 430, size: "vertical" },
        "3F-F04": { left: 1155, top: 600, size: "vertical" },
        "3F-F05": { left: 1255, top: 600, size: "vertical" },
        "3F-F06": { left: 1355, top: 600, size: "vertical" }
      }
    }
  ],

  // 勤怠ステータスの配色・ラベル定義（"": 未入力は白カード）
  // ※ キーの並び順がそのまま各画面のボタン・選択肢の並び順になる
  STATUS_VIEW: {
    // pill は色の丸（.status-dot.dot-○○）・バッジの色。label は座席カード、menuLabel はボタン・選択肢の文字
    [STATUS.PRESENT]:  { cls: "seat-green",  pill: "green",  label: "出勤",     menuLabel: "出勤" },
    [STATUS.MEETING]:  { cls: "seat-blue",   pill: "blue",   label: "会議",     menuLabel: "会議" },
    [STATUS.SITE]:     { cls: "seat-blue",   pill: "blue",   label: "現場",     menuLabel: "現場" },
    [STATUS.TRIP]:     { cls: "seat-yellow", pill: "yellow", label: "出張",     menuLabel: "出張" },
    [STATUS.HOME]:     { cls: "seat-yellow", pill: "yellow", label: "在宅",     menuLabel: "在宅" },
    [STATUS.OFF]:      { cls: "seat-red",    pill: "red",    label: "退勤",     menuLabel: "退勤" },
    [STATUS.VACATION]: { cls: "seat-red",    pill: "red",    label: "休暇",     menuLabel: "休暇" },
    [STATUS.AM_HALF]:  { cls: "seat-red",    pill: "red",    label: "午前半休", menuLabel: "午前半休" },
    [STATUS.PM_HALF]:  { cls: "seat-red",    pill: "red",    label: "午後半休", menuLabel: "午後半休" },
    [STATUS.NONE]:     { cls: "seat-white",  pill: "white",  label: "",         menuLabel: "未入力" }
  },

  STATUS_ORDER: {
    [STATUS.PRESENT]: 1,
    [STATUS.MEETING]: 2,
    [STATUS.SITE]: 3,
    [STATUS.TRIP]: 4,
    [STATUS.HOME]: 5,
    [STATUS.AM_HALF]: 6,
    [STATUS.PM_HALF]: 7,
    [STATUS.VACATION]: 8,
    [STATUS.OFF]: 9,
    [STATUS.NONE]: 10
  }
};

// 未知・不正なステータス値でも安全に表示設定を返す（prototype上のキーを拾わない）
function getStatusView(status) {
  const key = status ?? "";
  return hasOwn(CONFIG.STATUS_VIEW, key) ? CONFIG.STATUS_VIEW[key] : CONFIG.STATUS_VIEW[STATUS.NONE];
}
function isValidStatus(status) {
  return typeof status === "string" && hasOwn(CONFIG.STATUS_VIEW, status);
}

// 全フロアの席番号から所属フロアと座標・サイズ設定を逆引きする辞書を自動生成
const ALL_SEATS_MAP = {};
CONFIG.FLOORS.forEach(floor => {
  Object.keys(floor.seats).forEach(seatNo => {
    ALL_SEATS_MAP[seatNo] = {
      floorId: floor.id,
      floorName: floor.name,
      ...floor.seats[seatNo]
    };
  });
});
