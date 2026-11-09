"use strict";

/* ===================== 日付ユーティリティ（JST固定） ===================== */
const DateUtils = {
  _formatter: null,

  get formatter() {
    if (!this._formatter) {
      this._formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: CONFIG.TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23"
      });
    }
    return this._formatter;
  },

  // CONFIG.TIMEZONE での現在の { ymd: "YYYY-MM-DD", hm: "HH:MM" }
  nowParts() {
    const parts = {};
    this.formatter.formatToParts(new Date()).forEach(p => { parts[p.type] = p.value; });
    const hour = parts.hour === "24" ? "00" : parts.hour; // 古いブラウザの h24 表記対策
    return { ymd: `${parts.year}-${parts.month}-${parts.day}`, hm: `${hour}:${parts.minute}` };
  },

  // 端末のタイムゾーン設定に依存せず、CONFIG.TIMEZONE での今日の日付 (YYYY-MM-DD) を返す
  getTodayYmd() {
    return this.nowParts().ymd;
  },

  // CONFIG.TIMEZONE での現在日時 "YYYY-MM-DDTHH:MM"（予約日時との比較・datetime-local 用）
  getNowYmdHm() {
    const { ymd, hm } = this.nowParts();
    return `${ymd}T${hm}`;
  },

  // "2026-11-07T09:05" に minutes 分を足す（CONFIG.TIMEZONE の壁時計として計算）
  addMinutes(ymdHm, minutes) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(ymdHm);
    if (!m) return ymdHm;
    const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5] + minutes));
    return t.toISOString().slice(0, 16);
  },

  // 予約の日付＋時刻 → "2026/11/7 09:05"（画面表示用）
  formatSchedule(sched) {
    return sched ? `${this.formatYmd(sched.date)} ${sched.time}` : "";
  },

  addDays(ymd, days) {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  },

  // "2026-11-07" → "2026/11/7"（画面表示用）
  formatYmd(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
    return m ? `${m[1]}/${Number(m[2])}/${Number(m[3])}` : String(ymd ?? "");
  },

  // "2026-11-07" → "2026/11/7(土)"（予約日のボタン表示用。西暦固定）
  formatYmdWithWeekday(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
    if (!m) return String(ymd ?? "");
    const dow = "日月火水木金土"[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
    return `${this.formatYmd(ymd)}(${dow})`;
  },

  getTomorrowYmd() {
    return this.addDays(this.getTodayYmd(), 1);
  }
};

/* ===================== ソート共通ユーティリティ ===================== */
const SortUtil = {
  next(state, key) {
    if (state.key === key) return { key, order: state.order === "asc" ? "desc" : "asc" };
    return { key, order: "asc" };
  },

  // ヘッダー(th)の aria-sort と ▲▼⇅ 表示を更新
  paint(headers, getKey, state) {
    headers.forEach(th => {
      const isCurrent = getKey(th) === state.key;
      const indicator = th.querySelector(".sort-indicator");
      if (isCurrent) {
        th.setAttribute("aria-sort", state.order === "asc" ? "ascending" : "descending");
        if (indicator) indicator.textContent = state.order === "asc" ? "▲" : "▼";
      } else {
        th.setAttribute("aria-sort", "none");
        if (indicator) indicator.textContent = "⇅";
      }
    });
  }
};

/* ===================== 状態（ステータス）の絞り込み：チェックボックス式・複数選択 =====================
 * リスト画面とサイドリストで共用。選択状態は Set（未入力は ""）で持つ。
 */
const StatusFilterUtil = {
  allStatuses() {
    return Object.keys(CONFIG.STATUS_VIEW);
  },

  // 想定外の値は「未入力」として扱う（座席カード・人数表と同じ扱い）
  normalizeStatus(status) {
    const s = status ?? "";
    return isValidStatus(s) ? s : STATUS.NONE;
  },

  // localStorage から復元。旧形式（"ALL" / "NON_PRESENT" / "EMPTY" / ステータス名の文字列）も読み替える
  restoreFromCache(key) {
    const all = this.allStatuses();
    const raw = app.loadCache(key);
    if (raw === null) return new Set(all);
    let saved = raw;
    try { saved = JSON.parse(raw); } catch (e) { /* 旧形式の素の文字列 */ }
    if (Array.isArray(saved)) return new Set(saved.filter(v => typeof v === "string" && all.includes(v)));
    if (saved === "NON_PRESENT") return new Set(all.filter(st => st !== STATUS.PRESENT));
    if (saved === "EMPTY") return new Set([STATUS.NONE]);
    if (typeof saved === "string" && saved !== "" && saved !== "ALL" && isValidStatus(saved)) return new Set([saved]);
    return new Set(all);
  },

  matches(selected, status) {
    return selected.has(this.normalizeStatus(status));
  },

  isAll(selected) {
    return this.allStatuses().every(st => selected.has(st));
  },

  label(selected) {
    if (this.isAll(selected)) return "状態: すべて";
    if (!selected.size) return "状態: 未選択";
    const nonPresent = this.allStatuses().filter(st => st !== STATUS.PRESENT);
    if (selected.size === nonPresent.length && nonPresent.every(st => selected.has(st))) return "状態: 出勤以外";
    if (selected.size === 1) {
      const [only] = selected;
      return `状態: ${only === STATUS.NONE ? "未入力" : only}`;
    }
    return `状態: ${selected.size}件選択`;
  },

  /* 開閉ボタンとパネル（チェックボックス群）を結び付ける。
   * onChange(selectedSet) は選択が変わるたびに呼ばれる（保存・再描画は呼び出し側で行う） */
  mount({ button, panel, selected, onChange }) {
    const all = this.allStatuses();
    let current = new Set(selected);
    const checkboxes = new Map();

    const setOpen = open => {
      panel.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
      button.classList.toggle("open", open);
    };
    const syncUi = () => {
      checkboxes.forEach((cb, st) => {
        cb.checked = current.has(st);
        cb.closest("label").classList.toggle("checked", cb.checked);
      });
      button.textContent = this.label(current);
      button.classList.toggle("filtered", !this.isAll(current));
    };
    const commit = () => {
      syncUi();
      onChange(new Set(current));
    };

    panel.replaceChildren();
    const actions = document.createElement("div");
    actions.className = "status-filter-actions";
    [
      ["すべて", () => { current = new Set(all); }],
      ["すべて解除", () => { current = new Set(); }]
    ].forEach(([text, fn]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn-xs";
      b.textContent = text;
      b.addEventListener("click", () => { fn(); commit(); });
      actions.appendChild(b);
    });
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "btn-xs status-filter-close";
    closeBtn.textContent = "閉じる";
    closeBtn.addEventListener("click", () => setOpen(false));
    actions.appendChild(closeBtn);

    const checks = document.createElement("div");
    checks.className = "status-filter-checks";
    all.forEach(st => {
      const label = document.createElement("label");
      label.className = `status-filter-check pill-${getStatusView(st).pill}`;
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.addEventListener("change", () => {
        if (cb.checked) current.add(st); else current.delete(st);
        commit();
      });
      const span = document.createElement("span");
      span.textContent = CONFIG.STATUS_VIEW[st].menuLabel;
      label.append(cb, Icons.statusDot(st), span);
      checks.appendChild(label);
      checkboxes.set(st, cb);
    });
    panel.append(actions, checks);

    button.addEventListener("click", () => setOpen(panel.hidden));
    setOpen(false);
    syncUi();
    return { close: () => setOpen(false) };
  }
};

/* ===================== メンバーのミニカード表示（サイドリスト・リスト画面で共用） ===================== */
const MemberCardView = {
  // groups: [{ key, label }]。getGroupKeys(item) が返すキーのグループにカードを並べる
  render(container, items, { groups, getGroupKeys, emptyText = "条件に一致するメンバーはいません" }) {
    container.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "member-card-empty";
      empty.textContent = emptyText;
      container.appendChild(empty);
      return;
    }

    const { NOTE } = CONFIG.FIELDS;
    const frag = document.createDocumentFragment();
    groups.forEach(group => {
      const groupItems = items.filter(item => getGroupKeys(item).includes(group.key));
      if (!groupItems.length) return;

      const section = document.createElement("div");
      section.className = "side-card-group";

      const header = document.createElement("div");
      header.className = "side-card-group-header";
      const titleSpan = document.createElement("span");
      titleSpan.textContent = group.label;
      const countSpan = document.createElement("span");
      countSpan.textContent = `${groupItems.length}名`;
      header.append(titleSpan, countSpan);

      const grid = document.createElement("div");
      grid.className = "side-card-grid";

      groupItems.forEach(item => {
        const status = item.Status ?? "";
        const viewInfo = getStatusView(status);
        const card = document.createElement("div");
        card.className = `side-mini-card ${viewInfo.cls}`;
        card.tabIndex = 0;
        card.setAttribute("role", "button");
        card.title = `${item.Title || "名前未設定"}${item.Dept ? ` [${item.Dept}]` : ""} (${status || "未入力"}) ${item[NOTE] || ""}`.trim();
        const openModal = () => StatusModal.open(Number(item.Id), item.Title || "名前未設定");
        card.addEventListener("click", openModal);
        card.addEventListener("keydown", e => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openModal(); }
        });

        const topRow = document.createElement("div");
        topRow.className = "side-mini-card-top";
        const nameEl = document.createElement("div");
        nameEl.className = "side-mini-name";
        nameEl.textContent = item.Title || "未設定";
        const statusEl = document.createElement("div");
        statusEl.className = "side-mini-status";
        statusEl.textContent = status || "未入力";
        topRow.append(nameEl, statusEl);

        const noteEl = document.createElement("div");
        noteEl.className = "side-mini-note";
        noteEl.textContent = item[NOTE] || "";

        card.append(topRow, noteEl);
        grid.appendChild(card);
      });

      section.append(header, grid);
      frag.appendChild(section);
    });
    container.appendChild(frag);
  }
};

/* ===================== アプリ全体制御 ===================== */
const app = {
  items: [],
  timerId: null,
  signageTimerId: null,
  isSignageMode: false,
  currentView: "map",
  initialUrlHandled: false,

  // 更新制御
  _busy: false,
  _queued: null,
  _dateRefreshTimer: null,
  _processingSchedules: false,
  lastOkAt: 0,
  lastFullDate: "",

  // パース結果キャッシュ（ソート・描画で同じ文字列を何度もパースしない）
  _schedCache: new Map(),
  _seatCache: new Map(),

  // サイネージ判定は初回の全件取得(予約反映)より前に行う
  detectSignageMode() {
    const params = new URLSearchParams(window.location.search || window.location.hash.replace(/^#/, "?"));
    const signageParam = (params.get("signage") || "").toLowerCase();
    const modeParam = (params.get("mode") || "").toLowerCase();
    this.isSignageMode = signageParam === "1" || signageParam === "true" || modeParam === "signage";
  },

  // スマホ判定（CONFIG.PHONE_MEDIA_QUERY）。各画面の init より前に用意する
  phoneMedia: window.matchMedia ? window.matchMedia(CONFIG.PHONE_MEDIA_QUERY) : null,
  isPhone() {
    return !!(this.phoneMedia && this.phoneMedia.matches);
  },

  // モーダルの背景（外側）を押したら閉じる。
  // 押し始め(pointerdown)も背景だった時だけ閉じるので、
  // ・タップで開いた直後に届く click（スマホのゴーストクリック）
  // ・モーダル内で文字を選択して背景で指を離した場合
  // では閉じない。
  bindBackdropClose(modalEl, onClose) {
    let downOnBackdrop = false;
    modalEl.addEventListener("pointerdown", e => { downOnBackdrop = e.target === modalEl; });
    modalEl.addEventListener("click", e => {
      const ok = downOnBackdrop && e.target === modalEl;
      downOnBackdrop = false;
      if (ok) onClose();
    });
  },

  /* ===== 選択ダイアログ =====
   * confirm() は「はい／いいえ」しか出せないため、3つ以上の選択肢が必要な時に使う。
   * choices: [{ value, label, sub?, primary?, danger? }]。「やめる」・×・背景・Esc は null を返す。 */
  _choiceResolve: null,

  choose({ title, message = "", choices }) {
    if (this._choiceResolve) this.finishChoice(null);
    document.getElementById("choiceTitle").textContent = title;
    const msg = document.getElementById("choiceMessage");
    msg.textContent = message;
    msg.hidden = !message;

    const box = document.getElementById("choiceButtons");
    box.replaceChildren();
    const addButton = (c, extraClass) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `choice-btn ${extraClass || ""}`.trim();
      const main = document.createElement("span");
      main.className = "choice-label";
      main.textContent = c.label;
      b.appendChild(main);
      if (c.sub) {
        const sub = document.createElement("span");
        sub.className = "choice-sub";
        sub.textContent = c.sub;
        b.appendChild(sub);
      }
      b.addEventListener("click", () => this.finishChoice(c.value));
      box.appendChild(b);
      return b;
    };
    choices.forEach(c => addButton(c, c.primary ? "btn-success" : c.danger ? "btn-outline-danger" : ""));
    addButton({ value: null, label: "やめる" }, "choice-cancel");

    document.getElementById("choiceModal").classList.add("active");
    const first = box.querySelector("button");
    if (first) first.focus({ preventScroll: true });
    return new Promise(resolve => { this._choiceResolve = resolve; });
  },

  isChoiceOpen() {
    return document.getElementById("choiceModal").classList.contains("active");
  },

  finishChoice(value) {
    document.getElementById("choiceModal").classList.remove("active");
    const resolve = this._choiceResolve;
    this._choiceResolve = null;
    if (resolve) resolve(value);
  },

  // テストデータで動いている時は、画面の上に表示する（入力しても保存されないことが分かるように）
  showMockBadge() {
    if (!CONFIG.USE_MOCK_DATA) return;
    const el = document.createElement("div");
    el.className = "mock-badge";
    el.textContent = "テストデータで動作中（保存されません）";
    el.title = "URL に ?mock=1 があるため、ブラウザ内のテストデータで動いています。再読み込みすると元に戻ります。" +
      "SharePoint（またはモックサーバー）のデータを使うには、URL から ?mock=1 を外してください。";
    document.body.appendChild(el);
  },

  async init() {
    this.detectSignageMode();
    this.showMockBadge();
    this.buildStatusUi();
    SaveQueue.init();
    document.getElementById("choiceClose").addEventListener("click", () => this.finishChoice(null));
    this.bindBackdropClose(document.getElementById("choiceModal"), () => this.finishChoice(null));

    // 1モジュールの初期化失敗（localStorage破損など）でアプリ全体が止まらないようにする
    [["MapScreen", MapScreen], ["ListScreen", ListScreen], ["StatsScreen", StatsScreen],
     ["StatusModal", StatusModal], ["SettingsModal", SettingsModal], ["MeScreen", MeScreen],
     ["SeatAssign", SeatAssign]].forEach(([name, mod]) => {
      try { mod.init(); } catch (e) { console.error(`${name} 初期化エラー:`, e); }
    });

    document.getElementById("navMapBtn").addEventListener("click", () => this.switchView("map"));
    document.getElementById("navListBtn").addEventListener("click", () => this.switchView("list"));
    document.getElementById("navStatsBtn").addEventListener("click", () => this.switchView("stats"));
    document.getElementById("refreshBtn").addEventListener("click", () => this.handleManualRefresh());

    // 検索欄で Enter を押したらフォーカスを外す（タッチ端末ではソフトウェアキーボードが閉じる）
    document.addEventListener("keydown", e => {
      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return; // 229: IME 確定中
      const el = e.target;
      if (el && el.matches && el.matches('input[type="search"]')) {
        e.preventDefault();
        el.blur();
      }
    });

    // スマホ表示に切り替わったら（回転など）、スマホで使わない一括変更モードを終了する
    if (this.phoneMedia) {
      const onPhoneChange = () => {
        if (this.isPhone() && MapScreen.isBulkMode) MapScreen.toggleBulkMode(false);
        if (this.currentView === "map") MapScreen.onShow();
      };
      if (this.phoneMedia.addEventListener) this.phoneMedia.addEventListener("change", onPhoneChange);
      else if (this.phoneMedia.addListener) this.phoneMedia.addListener(onPhoneChange);
    }

    // Escape: 一番手前のモーダルだけを閉じる
    document.addEventListener("keydown", e => {
      if (e.key !== "Escape") return;
      if (this.isChoiceOpen()) { this.finishChoice(null); return; }
      if (ClockPicker.isOpen()) { ClockPicker.close(); return; }
      if (CalendarPicker.isOpen()) { CalendarPicker.close(); return; }
      if (MeScreen.isPickerOpen()) { MeScreen.closePicker(); return; }
      if (SeatAssign.isOpen()) { SeatAssign.close(); return; }
      if (StatsScreen.isMembersPopupOpen()) { StatsScreen.closeMembersPopup(); return; }
      if (StatsScreen.isGroupModalOpen()) { StatsScreen.closeGroupModal(); return; }
      if (SettingsModal.isOpen()) { SettingsModal.close(); return; }
      if (StatusModal.isOpen()) StatusModal.requestClose();
    });

    // タブ復帰・スリープ復帰時に、前回更新から1分以上経っていれば即更新
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      if (Date.now() - this.lastOkAt > CONFIG.POLLING_INTERVAL_MS && this.canBackgroundRefresh()) {
        this.refreshFrequent();
      }
    });

    this.initModalA11y();
    this.initOverflowTooltips();

    await this.refreshAll();
    this.handleUrlParams();
    this.startAutoRefresh();
  },

  /* ===== ステータスのボタン・選択肢を CONFIG.STATUS_VIEW から生成（HTMLとの二重管理を排除） ===== */
  buildStatusUi() {
    const statuses = Object.keys(CONFIG.STATUS_VIEW);

    const modalGroup = document.getElementById("statusButtonGroup");
    if (modalGroup) {
      modalGroup.replaceChildren();
      // 「未入力」は最後の行に1つだけ残る時だけ横いっぱいにする（2列で隙間が出ないように）
      const wideNone = (statuses.length - 1) % 2 === 0;
      statuses.forEach(st => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "status-select-btn" + (st === STATUS.NONE && wideNone ? " status-select-btn-wide" : "");
        btn.dataset.status = st;
        Icons.setStatusLabel(btn, st, CONFIG.STATUS_VIEW[st].menuLabel);
        modalGroup.appendChild(btn);
      });
    }

    const bulkGroup = document.getElementById("bulkStatusGroup");
    if (bulkGroup) {
      bulkGroup.querySelectorAll(".bulk-status-btn").forEach(el => el.remove());
      statuses.forEach(st => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "bulk-status-btn";
        btn.dataset.bulkStatus = st;
        Icons.setStatusLabel(btn, st, CONFIG.STATUS_VIEW[st].menuLabel);
        bulkGroup.appendChild(btn);
      });
    }

    const schedSelect = document.getElementById("schedStatusSelect");
    if (schedSelect) {
      schedSelect.replaceChildren();
      // 並びはステータスボタンと同じ（出勤→…→未入力）。初期選択は「休暇」（StatusModal.renderSchedule）
      statuses.forEach(st => {
        const opt = document.createElement("option");
        opt.value = st;
        opt.textContent = CONFIG.STATUS_VIEW[st].menuLabel;
        schedSelect.appendChild(opt);
      });
    }

  },

  /* ===== モーダルのアクセシビリティ（フォーカス移動・Tab循環・閉じた時のフォーカス復帰） ===== */
  /* ===== 見切れた文字をマウスオーバーで全文表示 =====
   * 「…」で省略された（または幅で切れた）文字にマウスを乗せた時だけ、その要素に title（ツールチップ）を付ける。
   * 画面ごとに title を書かなくても、名前・部署・備考・ボタン・入力欄の案内文など全体に効く。
   * 自分で付けた title には data-auto-title の印を付け、見切れなくなったら外す（元からある title は触らない） */
  initOverflowTooltips() {
    const MAX_DEPTH = 4; // マウスの下の要素から何階層上まで調べるか
    const isClipped = el => {
      if (el.scrollWidth <= el.clientWidth + 1) return false;
      const cs = getComputedStyle(el);
      // 横スクロールする枠（表の外枠など）は対象外。省略表示・はみ出し非表示の1行テキストだけ
      return cs.textOverflow === "ellipsis" || (cs.overflowX === "hidden" && cs.whiteSpace === "nowrap");
    };
    // 入力欄の文字幅は scrollWidth で測れない（placeholder など）ので、同じフォントで実測する
    const ctx = document.createElement("canvas").getContext("2d");
    const measureText = (el, text) => {
      const cs = getComputedStyle(el);
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      return ctx.measureText(text).width;
    };
    const innerWidthOf = el => {
      const cs = getComputedStyle(el);
      return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    };
    const setAuto = (el, text) => {
      if (el.hasAttribute("title") && !el.hasAttribute("data-auto-title")) return; // 元からある title を優先
      if (text) {
        el.title = text;
        el.setAttribute("data-auto-title", "");
      } else if (el.hasAttribute("data-auto-title")) {
        el.removeAttribute("title");
        el.removeAttribute("data-auto-title");
      }
    };

    document.addEventListener("mouseover", e => {
      const target = e.target;
      if (!(target instanceof Element)) return;

      // 入力欄: 入力した文字、または空欄なら案内文（placeholder）が欄に収まらない時に全文を表示
      if (target.matches('input[type="text"], input[type="search"]')) {
        const text = target.value || target.placeholder || "";
        setAuto(target, text && measureText(target, text) > innerWidthOf(target) ? text : "");
        return;
      }

      let el = target;
      for (let depth = 0; el && depth < MAX_DEPTH; depth++, el = el.parentElement) {
        if (el === document.body) break;
        if (isClipped(el)) {
          const text = el.textContent.replace(/\s+/g, " ").trim();
          if (text && text.length <= 300) setAuto(el, text);
          return;
        }
        if (el.hasAttribute("data-auto-title")) setAuto(el, ""); // もう見切れていない
      }
    });
  },

  initModalA11y() {
    const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    document.querySelectorAll(".modal-overlay").forEach(overlay => {
      const dialog = overlay.querySelector(".modal-content");
      if (!dialog) return;
      dialog.setAttribute("tabindex", "-1");
      let wasActive = false;
      let opener = null;

      new MutationObserver(() => {
        const active = overlay.classList.contains("active");
        if (active && !wasActive) {
          opener = document.activeElement;
          dialog.focus({ preventScroll: true }); // 入力欄に直接フォーカスしない（タッチ端末のキーボード誤表示防止）
        } else if (!active && wasActive) {
          if (opener && opener !== document.body && document.contains(opener) && typeof opener.focus === "function") {
            opener.focus({ preventScroll: true });
          }
          opener = null;
        }
        wasActive = active;
      }).observe(overlay, { attributes: true, attributeFilter: ["class"] });

      overlay.addEventListener("keydown", e => {
        if (e.key !== "Tab") return;
        const els = [...dialog.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
        if (!els.length) { e.preventDefault(); return; }
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      });
    });
  },

  /* ===== 手動更新ボタン（1秒グレーアウト・連打防止） ===== */
  async handleManualRefresh() {
    const refreshBtn = document.getElementById("refreshBtn");
    if (refreshBtn.disabled) return;
    refreshBtn.disabled = true;
    try {
      this.refreshAll();
      await AsyncUtil.sleep(1000);
    } finally {
      refreshBtn.disabled = false;
    }
  },

  /* ===== 保存完了などの短い通知（トースト） ===== */
  _toastTimer: null,
  toast(message, isError = false) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("error", isError);
    el.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 4500 : 2200);
  },

  /* ===== 二重送信防止つきの非同期ボタン処理 ===== */
  async withBusy(btn, fn) {
    if (!btn || btn.disabled) return undefined;
    btn.disabled = true;
    try {
      return await fn();
    } finally {
      btn.disabled = false;
    }
  },

  /* ===== 席番号文字列を配列に分解 =====
   * 全角/半角・大文字小文字の表記ゆれを吸収（NFKC正規化＋大文字化）。
   * 区切り: カンマ・読点・スラッシュ・空白
   */
  parseSeats(seatStr) {
    if (!seatStr) return [];
    const raw = String(seatStr);
    let seats = this._seatCache.get(raw);
    if (!seats) {
      seats = [...new Set(
        raw.normalize("NFKC")
          .split(/[,、/\s]+/)
          .map(s => s.trim().toUpperCase())
          .filter(Boolean)
      )];
      if (this._seatCache.size > 2000) this._seatCache.clear();
      this._seatCache.set(raw, seats);
    }
    return seats.slice();
  },

  /* ===== 席ジャンプボタン（リスト画面・ステータス画面で共用） ===== */
  createSeatLink(seatNo, { beforeJump = null, stopPropagation = false } = {}) {
    const seatInfo = ALL_SEATS_MAP[seatNo];
    if (!seatInfo) {
      const unmapped = document.createElement("span");
      unmapped.className = "unassigned";
      unmapped.textContent = `${seatNo}(未登録)`;
      return unmapped;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "seat-jump-link";
    // 席番号にフロア名が含まれている（1F-A05 など）ときは、フロア名を重ねて書かない
    const label = seatNo.toUpperCase().startsWith(String(seatInfo.floorId).toUpperCase())
      ? seatNo : `${seatInfo.floorId}: ${seatNo}`;
    Icons.setLabel(btn, "pin", label);
    btn.title = `${seatNo} の場所を座席表で表示`;
    btn.addEventListener("click", e => {
      if (stopPropagation) e.stopPropagation();
      if (beforeJump) beforeJump();
      MapScreen.jumpToSeat(seatNo);
    });
    return btn;
  },

  /* ===== 共通キャッシュ読み書き ===== */
  loadCache(key, asJson = false) {
    try {
      const val = localStorage.getItem(key);
      if (val === null) return null;
      return asJson ? JSON.parse(val) : val;
    } catch (e) {
      console.warn("キャッシュ読み込みスキップ:", e);
      return null;
    }
  },

  saveCache(key, value) {
    try {
      localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    } catch (e) {
      console.warn("キャッシュ保存失敗:", e);
    }
  },

  /* ===== 画面切替（ルーティング）。表示中の画面だけ描画する ===== */
  switchView(mode) {
    this.currentView = mode;
    const isMap = mode === "map";
    const isList = mode === "list";
    const isStats = mode === "stats";

    document.getElementById("mapStage").style.display = isMap ? "flex" : "none";
    document.getElementById("listViewport").style.display = isList ? "flex" : "none";
    document.getElementById("statsViewport").style.display = isStats ? "block" : "none";

    document.getElementById("navMapBtn").classList.toggle("active", isMap);
    document.getElementById("navListBtn").classList.toggle("active", isList);
    document.getElementById("navStatsBtn").classList.toggle("active", isStats);

    document.getElementById("floorSwitch").style.display = isMap ? "flex" : "none";
    document.getElementById("mapHeaderActions").style.display = isMap ? "flex" : "none";
    // スマホは見出しを出さないので、座席表以外ではヘッダー行ごと隠す（styles.css）
    document.querySelector(".header-row").classList.toggle("is-map", isMap);
    Icons.setLabel(document.getElementById("viewTitle"),
      isMap ? "map" : isList ? "list" : "chart",
      isMap ? "フロアマップ座席表" : isList ? "社員リスト" : "ステータス人数表");

    if (!isMap && MapScreen.isBulkMode) MapScreen.toggleBulkMode(false);

    // 表示状態にしてから描画する（非表示中は備考の文字サイズ自動調整が効かないため）
    if (isMap) {
      MapScreen.render();
      MapScreen.onShow();
    } else if (isList) {
      ListScreen.render();
    } else {
      StatsScreen.show();
    }
  },

  renderCurrentView() {
    if (this.currentView === "map") MapScreen.render();
    else if (this.currentView === "list") ListScreen.render();
    else StatsScreen.show();
  },

  /* ===== URLパラメータ制御（指定ユーザー直行 ＆ サイネージ判定） ===== */
  handleUrlParams() {
    if (this.initialUrlHandled) return;
    this.initialUrlHandled = true;

    const searchStr = window.location.search || window.location.hash.replace(/^#/, "?");
    const params = new URLSearchParams(searchStr);

    const sideListParam = (params.get("sidelist") || "").toLowerCase();
    if (sideListParam === "1" || sideListParam === "true") {
      MapScreen.toggleSideList(true, false); // URL指定は保存設定(localStorage)を上書きしない
    }

    const floorParam = params.get("floor");
    if (floorParam && CONFIG.FLOORS.some(f => f.id === floorParam)) {
      MapScreen.switchFloor(floorParam);
    }

    const idParam = params.get("id");
    const userParam = params.get("user") || params.get("name");
    const seatParam = params.get("seat");

    let target = null;
    let targetSeatNo = null;

    if (idParam) {
      target = this.items.find(i => Number(i.Id) === Number(idParam));
    } else if (seatParam) {
      const qSeat = this.parseSeats(seatParam)[0];
      if (qSeat) {
        target = this.items.find(i => this.parseSeats(i.Seat).includes(qSeat));
        if (target) targetSeatNo = qSeat;
      }
    } else if (userParam) {
      const q = userParam.trim().toLowerCase();
      target = this.items.find(i => String(i.Title || "").toLowerCase() === q) ||
               this.items.find(i => String(i.Title || "").toLowerCase().includes(q));
    }

    if (target) {
      const seats = this.parseSeats(target.Seat);
      const firstMappedSeat = targetSeatNo || seats.find(s => ALL_SEATS_MAP[s]);
      if (firstMappedSeat && ALL_SEATS_MAP[firstMappedSeat]) {
        MapScreen.switchFloor(ALL_SEATS_MAP[firstMappedSeat].floorId);
      }
      StatusModal.open(Number(target.Id), target.Title || "名前未設定");
    }
  },

  /* ===== 予定予約データのパース（不正なステータス・サロゲートペア対応・結果キャッシュ） ===== */
  parseSchedule(raw) {
    if (!raw || typeof raw !== "string") return null;
    if (this._schedCache.has(raw)) return this._schedCache.get(raw);

    let result = null;
    const text = raw.trim();
    if (text) {
      try {
        const obj = JSON.parse(text);
        // time は省略可（時刻のない旧形式は "00:00"＝その日の始まりに反映）
        const time = obj && obj.time !== undefined && obj.time !== "" ? obj.time : "00:00";
        if (obj && typeof obj.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.date) &&
            typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) && isValidStatus(obj.status)) {
          result = {
            date: obj.date,
            time,
            at: `${obj.date}T${time}`, // 比較用 "YYYY-MM-DDTHH:MM"
            status: obj.status,
            note: obj.note ? [...String(obj.note)].slice(0, CONFIG.NOTE_MAX).join("") : ""
          };
        }
      } catch (e) {
        result = null;
      }
    }
    if (this._schedCache.size > 1000) this._schedCache.clear();
    this._schedCache.set(raw, result);
    return result;
  },

  /* ===== 予約の自動反映（予約日時になったら。サイネージPCのみ実行） =====
   * 一般クライアント(100人規模)が同時に書き込むと競合・負荷が大きいため、
   * ?signage=1 で開いたPC（3〜4台）だけが担当する。
   *  - 開始前にランダム待機して、複数のサイネージが同時に書き込む確率を下げる
   *  - 書き込む直前に対象1件の最新の予約をサーバーから再取得し、他PCが反映済みなら何もしない
   *  - 同一内容の上書きなので、万一重なっても結果は変わらない
   */
  async processDueSchedules() {
    if (!this.isSignageMode || this._processingSchedules) return;
    const { NOTE, SCHEDULE } = CONFIG.FIELDS;
    const isDue = sched => sched && sched.at <= DateUtils.getNowYmdHm();

    const due = this.items.filter(item => isDue(this.parseSchedule(item[SCHEDULE])));
    if (!due.length) return;

    this._processingSchedules = true;
    let applied = false;
    let needReload = false;
    try {
      await AsyncUtil.sleep(Math.random() * CONFIG.SCHEDULE_PROCESS_JITTER_MS);

      const results = await AsyncUtil.runLimited(due, async item => {
        const latest = await spApi.getItemSchedule(item.Id);
        const latestRaw = latest ? latest[SCHEDULE] : null;
        const sched = this.parseSchedule(latestRaw);

        // 他のサイネージが反映済み／本人が変更・取消済み／削除済み → こちらは何もしない（再読込で追従）
        if (!isDue(sched)) return "stale";

        // 当日の予約は反映。前日以前の予約（サイネージが止まっていた日など）は反映せず消すだけ
        if (sched.date === DateUtils.getTodayYmd()) {
          await spApi.update(item.Id, { Status: sched.status, [NOTE]: sched.note, [SCHEDULE]: "" });
          item.Status = sched.status;
          item[NOTE] = sched.note;
          item[SCHEDULE] = "";
        } else {
          await spApi.update(item.Id, { [SCHEDULE]: "" });
          item[SCHEDULE] = "";
        }
        return "applied";
      }, CONFIG.WRITE_CONCURRENCY);

      results.forEach(r => {
        if (r.status === "rejected") console.error("予約反映エラー:", r.reason);
        else if (r.value === "applied") applied = true;
        else if (r.value === "stale") needReload = true;
      });
    } finally {
      this._processingSchedules = false;
    }

    if (needReload) this.refreshAll();
    else if (applied) this.renderCurrentView();
  },

  /* ===== 共通ソート比較（リスト画面・サイドリスト・設定画面で共用） ===== */
  statusOrderOf(status) {
    const key = status ?? "";
    return hasOwn(CONFIG.STATUS_ORDER, key) ? CONFIG.STATUS_ORDER[key] : 99;
  },

  compareItemsBy(a, b, sortKey, sortOrder) {
    const dir = sortOrder === "asc" ? 1 : -1;
    const { NOTE, SORT_NO, SCHEDULE } = CONFIG.FIELDS;
    const key = sortKey === "Remarks" ? NOTE : sortKey === "SortNo" ? SORT_NO : sortKey;

    if (key === SORT_NO) {
      const rawA = a[SORT_NO];
      const rawB = b[SORT_NO];
      const emptyA = rawA === undefined || rawA === null || String(rawA).trim() === "";
      const emptyB = rawB === undefined || rawB === null || String(rawB).trim() === "";
      if (emptyA && !emptyB) return 1;
      if (!emptyA && emptyB) return -1;
      if (!emptyA && !emptyB) {
        const numA = Number(rawA);
        const numB = Number(rawB);
        if (numA !== numB) return (numA - numB) * dir;
      }
    } else if (key === "Status") {
      const ordA = this.statusOrderOf(a.Status);
      const ordB = this.statusOrderOf(b.Status);
      if (ordA !== ordB) return (ordA - ordB) * dir;
    } else if (key === "NextSchedule") {
      const sA = this.parseSchedule(a[SCHEDULE]);
      const sB = this.parseSchedule(b[SCHEDULE]);
      if (!sA && sB) return 1;
      if (sA && !sB) return -1;
      if (sA && sB) {
        const dCmp = sA.at.localeCompare(sB.at);
        if (dCmp !== 0) return dCmp * dir;
        const stCmp = this.statusOrderOf(sA.status) - this.statusOrderOf(sB.status);
        if (stCmp !== 0) return stCmp * dir;
      }
    } else if (key === "Seat") {
      const seatsA = this.parseSeats(a.Seat).join(", ");
      const seatsB = this.parseSeats(b.Seat).join(", ");
      if (!seatsA && seatsB) return 1;
      if (seatsA && !seatsB) return -1;
      if (seatsA && seatsB) {
        const cmp = seatsA.localeCompare(seatsB, "ja", { numeric: true });
        if (cmp !== 0) return cmp * dir;
      }
    } else {
      const valA = String(a[key] ?? "").trim();
      const valB = String(b[key] ?? "").trim();
      const emptyA = valA === "";
      const emptyB = valB === "";
      if (emptyA && !emptyB) return 1;
      if (!emptyA && emptyB) return -1;
      if (!emptyA && !emptyB) {
        const cmp = valA.localeCompare(valB, "ja", { numeric: true });
        if (cmp !== 0) return cmp * dir;
      }
    }

    const nameCmp = String(a.Title || "").localeCompare(String(b.Title || ""), "ja", { numeric: true });
    if (nameCmp !== 0) return nameCmp;
    return Number(a.Id || 0) - Number(b.Id || 0);
  },

  /* ===== 通信状態の表示 ===== */
  setLastUpdatedTooltip(label) {
    const refreshBtn = document.getElementById("refreshBtn");
    refreshBtn.setAttribute("data-tooltip", label);
    refreshBtn.setAttribute("title", label);
  },

  // 通信エラー時だけ画面上部にバナーを出す（古い在席情報が表示され続けることへの気付きのため）
  setStale(isStale) {
    const el = document.getElementById("staleBanner");
    if (!el) return;
    el.hidden = !isStale;
    if (isStale) {
      const last = this.lastOkAt ? new Date(this.lastOkAt).toLocaleTimeString("ja-JP") : "未取得";
      Icons.setLabel(el, "warn", `通信エラー：表示が古い可能性があります（最終更新 ${last}）`);
    }
  },

  markOk(label) {
    this.lastOkAt = Date.now();
    this.setStale(false);
    this.setLastUpdatedTooltip(`最終更新(${label}): ${new Date().toLocaleTimeString("ja-JP")}`);
  },

  markError() {
    this.setStale(true);
    this.setLastUpdatedTooltip("通信エラー");
  },

  /* ===== データ取得 =====
   * 同時に複数回走らないよう直列化。実行中に要求が来た場合は完了後にもう一度実行する
   * （保存直後の更新要求が、ポーリングと重なって取りこぼされるのを防ぐ）。
   */
  refreshAll() {
    return this.runRefresh("all");
  },

  refreshFrequent() {
    // 日付が変わっていたら全件更新へ（サイネージは即時、一般クライアントは負荷分散のため少し遅らせる）
    if (this.items.length && DateUtils.getTodayYmd() !== this.lastFullDate) {
      if (this.isSignageMode) return this.runRefresh("all");
      this.scheduleDateChangeRefresh();
    }
    return this.runRefresh("frequent");
  },

  scheduleDateChangeRefresh() {
    if (this._dateRefreshTimer) return;
    this._dateRefreshTimer = setTimeout(() => {
      this._dateRefreshTimer = null;
      this.refreshAll();
    }, Math.random() * CONFIG.DATE_CHANGE_REFRESH_JITTER_MS);
  },

  async runRefresh(kind) {
    if (this._busy) {
      this._queued = (this._queued === "all" || kind === "all") ? "all" : "frequent";
      return;
    }
    this._busy = true;
    try {
      if (kind === "frequent" && !this.items.length) kind = "all";

      if (kind === "all") {
        const today = DateUtils.getTodayYmd();
        this.items = await spApi.getAllFull();
        SaveQueue.overlay(this.items); // まだサーバーに届いていない自分の変更で上書き（表示が一瞬戻らないように）
        this.lastFullDate = today;
        this.renderCurrentView();
        if (SettingsModal.isOpen()) SettingsModal.render();
        MeScreen.syncNavButton(); // 名前の変更・削除を「自分」ボタンに反映
        this.markOk("全件");
        // 予約反映はサイネージのみ。描画をブロックしないよう待たない
        this.processDueSchedules().catch(e => console.error("予約反映エラー:", e));
      } else {
        const { NOTE, SCHEDULE } = CONFIG.FIELDS;
        const partialList = await spApi.getFrequentOnly();
        const partialMap = new Map(partialList.map(p => [Number(p.Id), p]));
        this.items.forEach(item => {
          const updated = partialMap.get(Number(item.Id));
          if (updated) {
            item.Status = updated.Status;
            item[NOTE] = updated[NOTE];
            if (SCHEDULE in updated) item[SCHEDULE] = updated[SCHEDULE];
            if ("Seat" in updated) item.Seat = updated.Seat; // 席替え（フリーアドレス）も1分以内に反映
          }
        });
        SaveQueue.overlay(this.items);
        this.renderCurrentView();
        this.markOk("軽量");
        // 予約は分単位なので、軽量更新（1分ごと）のたびにも反映を確認する（サイネージのみ。期限の来た予約がなければ通信しない）
        this.processDueSchedules().catch(e => console.error("予約反映エラー:", e));
      }
    } catch (err) {
      console.error(kind === "all" ? "全件データ取得エラー:" : "差分データ取得エラー:", err);
      this.markError();
    } finally {
      this._busy = false;
      const queued = this._queued;
      this._queued = null;
      if (queued) this.runRefresh(queued);
    }
  },

  canBackgroundRefresh() {
    return !document.hidden &&
           !StatusModal.isOpen() &&
           !SettingsModal.isOpen() &&
           !StatsScreen.isGroupModalOpen() &&
           !MapScreen.isBulkMode;
  },

  startAutoRefresh() {
    if (this.timerId) clearInterval(this.timerId);
    if (this.signageTimerId) clearInterval(this.signageTimerId);

    this.timerId = setInterval(() => {
      if (this.canBackgroundRefresh()) this.refreshFrequent();
    }, CONFIG.POLLING_INTERVAL_MS);

    // サイネージ: 15分ごとに全件更新（予約の反映は全件・軽量どちらの更新の後にも確認する）
    if (this.isSignageMode) {
      this.signageTimerId = setInterval(() => {
        if (this.canBackgroundRefresh()) this.refreshAll();
      }, CONFIG.SIGNAGE_FULL_REFRESH_MS);
    }
  }
};

app.init();
