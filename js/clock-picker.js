"use strict";

/* ===================== 時刻選択（時計の文字盤） =====================
 * ClockPicker.open({ anchor, value: "HH:MM", onSelect(value) })
 *  - まず「時」を選ぶ。外側の輪＝1〜12、内側の輪＝13〜23・00（24時間制）
 *  - 時を選ぶと自動で「分」へ。分は 5分ごとに数字、あいだの分も針を合わせれば選べる
 *  - 上部の「時」「分」を押すと切り替え。「OK」で確定、「キャンセル」・背景・Esc で閉じる
 *  - キーボード：文字盤で ←↓ / →↑ で ±1、Enter で次へ（分なら確定）
 */
const ClockPicker = {
  SIZE: 260,          // 文字盤（SVG）の大きさ
  R_OUTER: 104,       // 外側の数字の半径
  R_INNER: 68,        // 内側の数字（13〜23・00）の半径
  R_KNOB: 18,         // 選択中の丸の半径

  el: null,
  mode: "hour",       // "hour" | "minute"
  hour: 0,
  minute: 0,
  onSelect: null,
  anchor: null,
  _dragging: false,

  isOpen() {
    return !!this.el && !this.el.hidden;
  },

  ensureDom() {
    if (this.el) return;
    const el = document.createElement("div");
    el.className = "picker-overlay";
    el.hidden = true;
    el.innerHTML = `
      <div class="picker-dialog clock-dialog" role="dialog" aria-modal="true" aria-label="時刻を選択">
        <div class="picker-head clock-head">
          <button type="button" class="clock-part" data-mode="hour" aria-label="時を選ぶ"></button>
          <span class="clock-colon">:</span>
          <button type="button" class="clock-part" data-mode="minute" aria-label="分を選ぶ"></button>
        </div>
        <div class="clock-dial" tabindex="0" role="slider"></div>
        <div class="picker-foot">
          <button type="button" class="picker-cancel">キャンセル</button>
          <button type="button" class="btn-primary picker-ok">OK</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    this.el = el;

    const dial = el.querySelector(".clock-dial");
    // 背景を押したら閉じる（文字盤のドラッグが外にはみ出して離した時は閉じない）
    el.addEventListener("pointerdown", e => { this._downOnBackdrop = e.target === el; });
    el.addEventListener("click", e => {
      if (e.target === el && this._downOnBackdrop) this.close();
    });
    el.querySelectorAll(".clock-part").forEach(btn => {
      btn.addEventListener("click", () => this.setMode(btn.dataset.mode, true));
    });
    el.querySelector(".picker-cancel").addEventListener("click", () => this.close());
    el.querySelector(".picker-ok").addEventListener("click", () => this.commit());

    dial.addEventListener("pointerdown", e => {
      e.preventDefault();
      this._dragging = true;
      dial.setPointerCapture(e.pointerId);
      dial.focus({ preventScroll: true });
      this.pickAt(e);
    });
    dial.addEventListener("pointermove", e => { if (this._dragging) this.pickAt(e); });
    const endDrag = e => {
      if (!this._dragging) return;
      this._dragging = false;
      if (e.type === "pointerup" && this.mode === "hour") this.setMode("minute", false);
    };
    dial.addEventListener("pointerup", endDrag);
    dial.addEventListener("pointercancel", endDrag);

    dial.addEventListener("keydown", e => {
      const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 }[e.key];
      if (step !== undefined) {
        e.preventDefault();
        if (this.mode === "hour") this.hour = (this.hour + Math.sign(step) + 24) % 24; // 時は PageUp/Down でも ±1
        else this.minute = (this.minute + step + 60) % 60;
        this.render();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (this.mode === "hour") this.setMode("minute", false);
        else this.commit();
      }
    });

    // ダイアログ内でフォーカスを回す（Tab で後ろのステータス画面へ抜けないように）
    el.addEventListener("keydown", e => {
      if (e.key !== "Tab") return;
      const els = [...el.querySelectorAll("button, .clock-dial")];
      const i = els.indexOf(document.activeElement);
      e.preventDefault();
      els[(i + (e.shiftKey ? -1 : 1) + els.length) % els.length].focus();
    });
  },

  open({ anchor = null, value = "", onSelect = null } = {}) {
    this.ensureDom();
    const m = /^(\d{2}):(\d{2})/.exec(value || "");
    this.hour = m ? Math.min(23, Number(m[1])) : 0;
    this.minute = m ? Math.min(59, Number(m[2])) : 0;
    this.anchor = anchor;
    this.onSelect = onSelect;
    this.el.hidden = false;
    if (anchor) anchor.setAttribute("aria-expanded", "true");
    this.setMode("hour", true);
  },

  close() {
    if (!this.isOpen()) return;
    this.el.hidden = true;
    this._dragging = false;
    const anchor = this.anchor;
    this.anchor = null;
    this.onSelect = null;
    if (anchor) {
      anchor.setAttribute("aria-expanded", "false");
      if (document.contains(anchor)) anchor.focus({ preventScroll: true });
    }
  },

  commit() {
    const value = `${String(this.hour).padStart(2, "0")}:${String(this.minute).padStart(2, "0")}`;
    const cb = this.onSelect;
    this.close();
    if (cb) cb(value);
  },

  setMode(mode, focusDial) {
    this.mode = mode;
    this.render();
    if (focusDial) this.el.querySelector(".clock-dial").focus({ preventScroll: true });
  },

  /* ----- 指（マウス）の位置から時・分を決める ----- */
  pickAt(e) {
    const dial = this.el.querySelector(".clock-dial");
    const r = dial.getBoundingClientRect();
    const scale = this.SIZE / r.width;
    const x = (e.clientX - r.left) * scale - this.SIZE / 2;
    const y = (e.clientY - r.top) * scale - this.SIZE / 2;
    const deg = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360; // 12時の方向＝0度、時計回り
    if (this.mode === "hour") {
      const idx = Math.round(deg / 30) % 12;
      const inner = Math.hypot(x, y) < (this.R_OUTER + this.R_INNER) / 2;
      this.hour = inner ? (idx === 0 ? 0 : idx + 12) : (idx === 0 ? 12 : idx);
    } else {
      this.minute = Math.round(deg / 6) % 60;
    }
    this.render();
  },

  /* ----- 描画 ----- */
  pos(deg, radius) {
    const rad = deg * Math.PI / 180;
    const c = this.SIZE / 2;
    return [c + radius * Math.sin(rad), c - radius * Math.cos(rad)];
  },

  render() {
    const pad = n => String(n).padStart(2, "0");
    const isHour = this.mode === "hour";
    this.el.querySelectorAll(".clock-part").forEach(btn => {
      const active = btn.dataset.mode === this.mode;
      btn.textContent = btn.dataset.mode === "hour" ? pad(this.hour) : pad(this.minute);
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });

    // 選択中の位置
    let selDeg, selR;
    if (isHour) {
      selDeg = (this.hour % 12) * 30;
      selR = (this.hour === 0 || this.hour > 12) ? this.R_INNER : this.R_OUTER;
    } else {
      selDeg = this.minute * 6;
      selR = this.R_OUTER;
    }
    const c = this.SIZE / 2;
    const [kx, ky] = this.pos(selDeg, selR);

    // 数字
    const labels = [];
    if (isHour) {
      for (let i = 0; i < 12; i++) {
        labels.push({ text: String(i === 0 ? 12 : i), deg: i * 30, r: this.R_OUTER, value: i === 0 ? 12 : i, inner: false });
        labels.push({ text: i === 0 ? "00" : String(i + 12), deg: i * 30, r: this.R_INNER, value: i === 0 ? 0 : i + 12, inner: true });
      }
    } else {
      for (let i = 0; i < 12; i++) labels.push({ text: pad(i * 5), deg: i * 30, r: this.R_OUTER, value: i * 5, inner: false });
    }
    const selected = isHour ? this.hour : this.minute;
    const text = labels.map(l => {
      const [x, y] = this.pos(l.deg, l.r);
      const cls = ["clock-num", l.inner ? "inner" : "", l.value === selected ? "selected" : ""].join(" ").trim();
      return `<text class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${l.text}</text>`;
    }).join("");
    // 5分刻みでない分は、丸の中に小さな点を出す
    const dot = !isHour && this.minute % 5 !== 0 ? `<circle class="clock-knob-dot" cx="${kx.toFixed(1)}" cy="${ky.toFixed(1)}" r="3"/>` : "";

    const dial = this.el.querySelector(".clock-dial");
    dial.innerHTML = `
      <svg viewBox="0 0 ${this.SIZE} ${this.SIZE}" aria-hidden="true">
        <circle class="clock-face" cx="${c}" cy="${c}" r="${c - 2}"/>
        <line class="clock-hand" x1="${c}" y1="${c}" x2="${kx.toFixed(1)}" y2="${ky.toFixed(1)}"/>
        <circle class="clock-center" cx="${c}" cy="${c}" r="4"/>
        <circle class="clock-knob" cx="${kx.toFixed(1)}" cy="${ky.toFixed(1)}" r="${this.R_KNOB}"/>
        ${text}${dot}
      </svg>`;
    dial.setAttribute("aria-label", isHour ? "時" : "分");
    dial.setAttribute("aria-valuemin", "0");
    dial.setAttribute("aria-valuemax", isHour ? "23" : "59");
    dial.setAttribute("aria-valuenow", String(selected));
    dial.setAttribute("aria-valuetext", isHour ? `${this.hour}時` : `${this.minute}分`);
  }
};
