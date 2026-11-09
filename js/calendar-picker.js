"use strict";

/* ===================== 日付選択（カレンダー・西暦） =====================
 * 標準の <input type="date"> は OS・ブラウザの設定で和暦（令和）表示になることがあるため、
 * 西暦固定の独自カレンダーを使う。見た目と操作は時計（clock-picker.js）とそろえている。
 *
 * CalendarPicker.open({ anchor, value: "YYYY-MM-DD", min: "YYYY-MM-DD", onSelect(value) })
 *  - 日付を押して選び、「OK」で確定（日付のダブルクリック・Enter でも確定）
 *  - ‹ › で月を移動。「今日」で今日を選ぶ。「キャンセル」・背景・Esc で閉じる
 *  - キーボード：←→ で ±1日、↑↓ で ±1週、PageUp / PageDown で ±1か月
 */
const CalendarPicker = {
  WEEKDAYS: ["日", "月", "火", "水", "木", "金", "土"],

  el: null,
  selected: "",       // 選択中の日付 "YYYY-MM-DD"
  viewYear: 0,        // 表示中の年月
  viewMonth: 0,       // 1〜12
  min: "",
  onSelect: null,
  anchor: null,

  isOpen() {
    return !!this.el && !this.el.hidden;
  },

  /* ----- 日付計算（UTC で計算してタイムゾーンの影響を受けないようにする） ----- */
  parse(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
    return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
  },
  ymd(y, m, d) {
    return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
  },
  addMonths(ymd, n) {
    const p = this.parse(ymd);
    const last = new Date(Date.UTC(p.y, p.m - 1 + n + 1, 0)).getUTCDate(); // 移動先の月末（1/31 → 2/28 など）
    return this.ymd(p.y, p.m + n, Math.min(p.d, last));
  },
  weekday(ymd) {
    const p = this.parse(ymd);
    return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  },

  ensureDom() {
    if (this.el) return;
    const el = document.createElement("div");
    el.className = "picker-overlay";
    el.hidden = true;
    el.innerHTML = `
      <div class="picker-dialog cal-dialog" role="dialog" aria-modal="true" aria-label="日付を選択">
        <div class="picker-head cal-head">
          <div class="cal-head-year"></div>
          <div class="cal-head-date"></div>
        </div>
        <div class="cal-nav">
          <button type="button" class="cal-nav-btn" data-step="-1" aria-label="前の月">‹</button>
          <div class="cal-month" aria-live="polite"></div>
          <button type="button" class="cal-nav-btn" data-step="1" aria-label="次の月">›</button>
        </div>
        <div class="cal-grid" role="grid"></div>
        <div class="picker-foot">
          <button type="button" class="cal-today">今日</button>
          <span class="picker-foot-gap"></span>
          <button type="button" class="picker-cancel">キャンセル</button>
          <button type="button" class="btn-primary picker-ok">OK</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    this.el = el;

    el.addEventListener("pointerdown", e => { this._downOnBackdrop = e.target === el; });
    el.addEventListener("click", e => {
      if (e.target === el && this._downOnBackdrop) this.close();
    });
    el.querySelectorAll(".cal-nav-btn").forEach(btn => {
      btn.addEventListener("click", () => this.moveView(Number(btn.dataset.step)));
    });
    el.querySelector(".cal-today").addEventListener("click", () => this.select(DateUtils.getTodayYmd(), true));
    el.querySelector(".picker-cancel").addEventListener("click", () => this.close());
    el.querySelector(".picker-ok").addEventListener("click", () => this.commit());

    const grid = el.querySelector(".cal-grid");
    grid.addEventListener("click", e => {
      const btn = e.target.closest(".cal-day");
      if (btn && !btn.disabled) this.select(btn.dataset.date, true);
    });
    grid.addEventListener("dblclick", e => {
      const btn = e.target.closest(".cal-day");
      if (btn && !btn.disabled) this.commit();
    });
    grid.addEventListener("keydown", e => {
      const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (move !== undefined) {
        e.preventDefault();
        const p = this.parse(this.selected);
        this.select(this.ymd(p.y, p.m, p.d + move), true);
      } else if (e.key === "PageUp" || e.key === "PageDown") {
        e.preventDefault();
        this.select(this.addMonths(this.selected, e.key === "PageUp" ? -1 : 1), true);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.commit();
      }
    });

    // ダイアログ内でフォーカスを回す（Tab で後ろのステータス画面へ抜けないように）
    el.addEventListener("keydown", e => {
      if (e.key !== "Tab") return;
      const els = [...el.querySelectorAll("button:not([disabled])")].filter(b => !b.classList.contains("cal-day") || b.tabIndex === 0);
      const i = els.indexOf(document.activeElement);
      e.preventDefault();
      els[(i + (e.shiftKey ? -1 : 1) + els.length) % els.length].focus();
    });
  },

  open({ anchor = null, value = "", min = "", onSelect = null } = {}) {
    this.ensureDom();
    this.min = this.parse(min) ? min : "";
    let start = this.parse(value) ? value : DateUtils.getTodayYmd();
    if (this.min && start < this.min) start = this.min;
    this.anchor = anchor;
    this.onSelect = onSelect;
    this.el.hidden = false;
    if (anchor) anchor.setAttribute("aria-expanded", "true");
    this.select(start, true);
  },

  close() {
    if (!this.isOpen()) return;
    this.el.hidden = true;
    const anchor = this.anchor;
    this.anchor = null;
    this.onSelect = null;
    if (anchor) {
      anchor.setAttribute("aria-expanded", "false");
      if (document.contains(anchor)) anchor.focus({ preventScroll: true });
    }
  },

  commit() {
    const value = this.selected;
    const cb = this.onSelect;
    this.close();
    if (cb) cb(value);
  },

  // 日付を選ぶ（min より前は選ばない）。表示月も合わせる
  select(ymd, focus) {
    if (this.min && ymd < this.min) ymd = this.min;
    this.selected = ymd;
    const p = this.parse(ymd);
    this.viewYear = p.y;
    this.viewMonth = p.m;
    this.render();
    if (focus) {
      const btn = this.el.querySelector(`.cal-day[data-date="${ymd}"]`);
      if (btn) btn.focus({ preventScroll: true });
    }
  },

  // ‹ › で表示月だけ動かす（選択中の日付は変えない）
  moveView(step) {
    const next = this.addMonths(this.ymd(this.viewYear, this.viewMonth, 1), step);
    const p = this.parse(next);
    this.viewYear = p.y;
    this.viewMonth = p.m;
    this.render();
  },

  render() {
    const sel = this.parse(this.selected);
    this.el.querySelector(".cal-head-year").textContent = `${sel.y}年`;
    this.el.querySelector(".cal-head-date").textContent = `${sel.m}月${sel.d}日（${this.WEEKDAYS[this.weekday(this.selected)]}）`;
    this.el.querySelector(".cal-month").textContent = `${this.viewYear}年${this.viewMonth}月`;

    // 前の月へは、min の月より前には戻れない
    const firstOfView = this.ymd(this.viewYear, this.viewMonth, 1);
    const prevBtn = this.el.querySelector('.cal-nav-btn[data-step="-1"]');
    prevBtn.disabled = !!this.min && firstOfView <= this.min.slice(0, 8) + "01";

    const today = DateUtils.getTodayYmd();
    const startDow = this.weekday(firstOfView);
    const daysInMonth = new Date(Date.UTC(this.viewYear, this.viewMonth, 0)).getUTCDate();
    const selectedInView = sel.y === this.viewYear && sel.m === this.viewMonth;

    const grid = this.el.querySelector(".cal-grid");
    grid.replaceChildren();
    this.WEEKDAYS.forEach((w, i) => {
      const h = document.createElement("div");
      h.className = "cal-dow" + (i === 0 ? " sun" : i === 6 ? " sat" : "");
      h.setAttribute("role", "columnheader");
      h.textContent = w;
      grid.appendChild(h);
    });
    for (let i = 0; i < startDow; i++) grid.appendChild(document.createElement("span"));
    for (let d = 1; d <= daysInMonth; d++) {
      const date = this.ymd(this.viewYear, this.viewMonth, d);
      const dow = (startDow + d - 1) % 7;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-day" + (dow === 0 ? " sun" : dow === 6 ? " sat" : "") +
        (date === today ? " today" : "") + (date === this.selected ? " selected" : "");
      btn.dataset.date = date;
      btn.textContent = String(d);
      btn.disabled = !!this.min && date < this.min;
      btn.setAttribute("role", "gridcell");
      btn.setAttribute("aria-label", `${this.viewYear}年${this.viewMonth}月${d}日（${this.WEEKDAYS[dow]}）`);
      btn.setAttribute("aria-selected", String(date === this.selected));
      // Tab で入れるのは1日だけ（選択中の日。別の月を表示中ならその月の最初の選べる日）
      btn.tabIndex = -1;
      grid.appendChild(btn);
    }
    const focusable = selectedInView
      ? grid.querySelector(".cal-day.selected")
      : grid.querySelector(".cal-day:not([disabled])");
    if (focusable) focusable.tabIndex = 0;
  }
};
