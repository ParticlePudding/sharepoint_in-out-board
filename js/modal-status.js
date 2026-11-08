"use strict";

const StatusModal = {
  currentEditingId: null,
  deleteMode: false,          // 「よく使う備考」の選択削除モード
  deleteSelected: new Set(),  // 削除対象として選択中の添字
  savedNote: "",              // 保存済みの備考（備考欄がこれと違えば「未保存の下書き」）
  schedBaseline: null,        // 予約欄の表示直後の値 {date, status, note}（これと違えば「未保存の下書き」）

  /* 保存と画面を閉じるタイミング（ステータスと備考を続けて入力できるように）
   * - ステータスボタン … 押すとすぐ保存して閉じる。備考欄・予定予約に未保存の入力があれば一緒に保存
   * - 備考を保存（Enter）・削除 … すぐ保存するが閉じない（続けてステータスを選べる）
   * - 定型文 … 備考欄に入るだけ（下書き）。ステータスか「備考を保存」で保存
   * - 予約を保存・予約取消 … すぐ保存するが閉じない
   * - ×・背景・Esc … 未保存の備考・予定予約があれば確認してから閉じる
   *
   * サーバーへの送信は SaveQueue が裏で行う（画面は通信を待たない）。
   * この画面を開いている間の変更は、閉じた時にまとめて1回で送る。 */

  init() {
    document.getElementById("modalClose").addEventListener("click", () => this.requestClose());
    app.bindBackdropClose(document.getElementById("statusModal"), () => this.requestClose());
    // ステータスボタンは app.buildStatusUi() が CONFIG.STATUS_VIEW から生成する
    document.getElementById("statusButtonGroup").addEventListener("click", e => {
      const btn = e.target.closest(".status-select-btn");
      if (btn && !btn.disabled) this.saveIndividualStatus(btn.dataset.status);
    });

    const noteInput = document.getElementById("noteInput");
    noteInput.addEventListener("input", () => this.updateNoteCount());
    // Enter: 備考を保存してキーボードを閉じる（画面は閉じない。スマホで次の入力欄＝予約の備考へ移らないように、
    // キーボードのボタンは enterkeyhint="done"＝「完了」にして、「次へ」を出さない）
    noteInput.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) { // 229: Safari の IME 確定対策
        e.preventDefault();
        noteInput.blur();
        this.saveNoteOnly();
      }
    });
    // 予約の備考: Enter でキーボードを閉じるだけ（予約の保存は「予約を保存」ボタンで行う）
    const schedNoteInput = document.getElementById("schedNoteInput");
    // 予約欄の変更をオレンジ表示（未保存の下書き）に反映
    schedNoteInput.addEventListener("input", () => this.syncScheduleUi());
    const schedDateInput = document.getElementById("schedDateInput");
    schedDateInput.addEventListener("input", () => this.syncScheduleUi());
    schedDateInput.addEventListener("change", () => this.syncScheduleUi());
    schedNoteInput.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        schedNoteInput.blur();
      }
    });

    document.getElementById("noteSaveBtn").addEventListener("click", () => this.saveNoteOnly());
    document.getElementById("noteClearBtn").addEventListener("click", () => this.clearNote());
    document.getElementById("addQuickNoteBtn").addEventListener("click", () => this.addQuickNote());
    document.getElementById("toggleQuickDeleteBtn").addEventListener("click", () => this.setDeleteMode(!this.deleteMode));
    document.getElementById("execQuickDeleteBtn").addEventListener("click", () => this.deleteSelectedQuickNotes());
    document.getElementById("saveScheduleBtn").addEventListener("click", () => this.saveSchedule());
    this.initSchedStatusMenu();
    document.getElementById("clearScheduleBtn").addEventListener("click", () => this.clearSchedule());
    document.getElementById("copyDirectUrlBtn").addEventListener("click", () => this.copyDirectUrl());
    document.getElementById("unassignSeatBtn").addEventListener("click", () => this.unassignSeat());
  },

  isOpen() {
    return this.currentEditingId !== null;
  },

  open(id, name) {
    this.currentEditingId = Number(id);
    SaveQueue.hold(this.currentEditingId); // 閉じるまで、この人への送信をまとめる
    const item = app.items.find(i => Number(i.Id) === this.currentEditingId);
    const current = item ? (item.Status ?? STATUS.NONE) : STATUS.NONE;
    document.getElementById("modalTitle").textContent = `${name}さんのステータス`;
    this.renderSeatJumpLinks(item);
    MeScreen.syncStatusModalButton(this.currentEditingId);
    document.getElementById("modalError").textContent = "";
    this.savedNote = item ? String(item[CONFIG.FIELDS.NOTE] || "") : "";
    document.getElementById("noteInput").value = this.savedNote;
    this.updateNoteCount();
    this.setDeleteMode(false);
    this.renderSchedule(item);

    document.querySelectorAll(".status-select-btn").forEach(btn => {
      btn.classList.toggle("current", btn.dataset.status === current);
      btn.disabled = false;
    });
    document.getElementById("statusModal").classList.add("active");
  },

  /* ===== ステータス入力画面の席番号ジャンプ表示 ===== */
  renderSeatJumpLinks(item) {
    const seatEl = document.getElementById("modalSeat");
    if (!seatEl) return;
    seatEl.replaceChildren();

    const seats = item ? app.parseSeats(item.Seat) : [];
    // 席があって、席の割り当て機能が有効な時だけ「席を解除」を出す
    document.getElementById("unassignSeatBtn").hidden = !seats.length || !SeatAssign.isEnabled();
    if (!seats.length) {
      seatEl.textContent = "席未割当";
      return;
    }

    seats.forEach(seatNo => {
      seatEl.appendChild(app.createSeatLink(seatNo, { beforeJump: () => this.close() }));
    });
  },

  // ユーザー操作（×・背景・Esc）で閉じる。書きかけの備考は黙って捨てない
  requestClose() {
    const unsaved = [this.isNoteDirty() && "備考", this.isScheduleDirty() && "予定予約"].filter(Boolean);
    if (unsaved.length && !confirm(`入力中の${unsaved.join("・")}は保存されていません。保存せずに閉じますか？`)) return;
    this.close();
  },

  close() {
    if (this.currentEditingId !== null) SaveQueue.release(this.currentEditingId); // まとめた変更を送信
    this.currentEditingId = null;
    this.deleteMode = false;
    this.deleteSelected.clear();
    this.closeSchedStatusMenu(false);
    document.getElementById("statusModal").classList.remove("active");
  },

  updateNoteCount() {
    const len = [...document.getElementById("noteInput").value].length;
    document.getElementById("noteCount").textContent = `${len}/${CONFIG.NOTE_MAX}`;
    this.syncNoteUi();
  },

  isNoteDirty() {
    return this.currentEditingId !== null && document.getElementById("noteInput").value.trim() !== this.savedNote;
  },

  // 下書き表示（黄色＋「未保存」）と、備考の保存・削除ボタンの押せる／押せないを更新
  syncNoteUi() {
    const input = document.getElementById("noteInput");
    const dirty = this.isNoteDirty();
    input.classList.toggle("dirty", dirty);
    document.getElementById("noteDraftHint").hidden = !dirty;
    document.getElementById("noteSaveBtn").disabled = !dirty;
    // 削除: 欄が空で保存済みも空なら、消すものがない
    document.getElementById("noteClearBtn").disabled = input.value.trim() === "" && this.savedNote === "";
  },

  readNote() {
    const value = document.getElementById("noteInput").value.trim();
    if ([...value].length > CONFIG.NOTE_MAX) {
      document.getElementById("modalError").textContent = `備考は${CONFIG.NOTE_MAX}文字以内で入力してください。`;
      return null;
    }
    return value;
  },

  saveIndividualStatus(newStatus) {
    if (!isValidStatus(newStatus)) return;
    const fields = { Status: newStatus };
    const note = this.readNote();
    if (note === null) return;
    const noteField = CONFIG.FIELDS.NOTE;
    const item = app.items.find(i => Number(i.Id) === this.currentEditingId);
    if (note !== ((item && item[noteField]) || "")) fields[noteField] = note;
    // 予定予約を書き換えていれば一緒に保存（入力に不備があれば何も保存しない）
    const schedField = CONFIG.FIELDS.SCHEDULE;
    if (this.isScheduleDirty()) {
      const sched = this.readScheduleForm();
      if (sched.error) {
        document.getElementById("modalError").textContent = sched.error;
        return;
      }
      fields[schedField] = sched.payload;
    }
    const saved = ["ステータス", fields[noteField] !== undefined && "備考", fields[schedField] !== undefined && "予約"].filter(Boolean);
    this.submit(fields, {
      close: true,
      message: saved.length > 1 ? `${saved.join("・")}を保存しました` : "保存しました"
    });
  },

  saveNoteOnly() {
    const note = this.readNote();
    if (note === null || !this.isNoteDirty()) return;
    this.submit({ [CONFIG.FIELDS.NOTE]: note }, { close: false, message: note ? "備考を保存しました" : "備考を削除しました" });
  },

  // 備考をワンタップで消して保存（画面は閉じない。続けてステータスを選べる）
  clearNote() {
    const input = document.getElementById("noteInput");
    input.value = "";
    this.updateNoteCount();
    if (this.savedNote === "") return; // 保存済みも空なら、書きかけを消しただけ
    this.submit({ [CONFIG.FIELDS.NOTE]: "" }, { close: false, message: "備考を削除しました" });
  },

  // 保存（画面にはすぐ反映し、送信は SaveQueue が裏で行う＝通信を待たない）
  // close: 保存後に画面を閉じるか（ステータスボタンだけ true）
  submit(fields, { close = true, message = "保存しました" } = {}) {
    if (this.currentEditingId === null) return;
    const id = this.currentEditingId;
    document.getElementById("modalError").textContent = "";
    SaveQueue.enqueue(id, fields);
    const noteField = CONFIG.FIELDS.NOTE;
    if (fields[noteField] !== undefined) this.savedNote = fields[noteField];
    if (fields[CONFIG.FIELDS.SCHEDULE] !== undefined) {
      this.renderSchedule(app.items.find(i => Number(i.Id) === id));
    }
    if (close) this.close();
    else this.syncNoteUi();
    app.renderCurrentView();
    app.toast(message);
  },

  /* ===== ユーザー別「よく使う備考」 ===== */
  getUserQuickNotesList(item) {
    if (!item) return [...CONFIG.DEFAULT_QUICK_NOTES];
    const raw = item[CONFIG.FIELDS.QUICK_NOTES];
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      return [...CONFIG.DEFAULT_QUICK_NOTES];
    }
    if (Array.isArray(raw)) return raw.map(String);
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch (e) {
      return String(raw).split(",").map(t => t.trim()).filter(Boolean); // 旧形式（カンマ区切り）
    }
    return [...CONFIG.DEFAULT_QUICK_NOTES];
  },

  renderQuickNotes() {
    const list = document.getElementById("quickNotesList");
    if (!list) return;
    list.replaceChildren();
    const item = app.items.find(i => Number(i.Id) === this.currentEditingId);
    const notes = this.getUserQuickNotesList(item);

    notes.forEach((text, idx) => {
      const chip = document.createElement("div");
      chip.className = "quick-note-chip";
      if (this.deleteMode && this.deleteSelected.has(idx)) chip.classList.add("selected");

      const applyBtn = document.createElement("button");
      applyBtn.type = "button";
      applyBtn.className = "quick-note-apply";
      applyBtn.textContent = text;
      applyBtn.title = this.deleteMode ? "クリックで削除対象に選択／解除" : "クリックして備考欄に入力";
      applyBtn.addEventListener("click", () => {
        if (this.deleteMode) {
          if (this.deleteSelected.has(idx)) this.deleteSelected.delete(idx);
          else this.deleteSelected.add(idx);
          this.renderQuickNotes();
          return;
        }
        // 備考欄に入れるだけ（下書き）。ステータスを押せば一緒に、「備考を保存」なら備考だけ保存
        document.getElementById("noteInput").value = text;
        this.updateNoteCount();
      });

      chip.appendChild(applyBtn);
      list.appendChild(chip);
    });
    this.syncDeleteUi();
  },

  /* ===== 定型文の削除モード（「選択して削除」→ 複数選択 → まとめて削除） ===== */
  setDeleteMode(on) {
    this.deleteMode = on;
    this.deleteSelected.clear();
    this.renderQuickNotes();
  },

  syncDeleteUi() {
    const toggle = document.getElementById("toggleQuickDeleteBtn");
    const exec = document.getElementById("execQuickDeleteBtn");
    const add = document.getElementById("addQuickNoteBtn");
    const list = document.getElementById("quickNotesList");
    toggle.textContent = this.deleteMode ? "キャンセル" : "選択して削除";
    toggle.classList.toggle("btn-active-mode", this.deleteMode);
    exec.hidden = !this.deleteMode;
    exec.textContent = `選択した${this.deleteSelected.size}件を削除`;
    exec.disabled = this.deleteSelected.size === 0;
    add.disabled = this.deleteMode;
    list.classList.toggle("delete-mode", this.deleteMode);
  },

  deleteSelectedQuickNotes() {
    if (this.currentEditingId === null || !this.deleteSelected.size) return;
    const item = app.items.find(i => Number(i.Id) === this.currentEditingId);
    if (!item) return;
    const count = this.deleteSelected.size;
    const notes = this.getUserQuickNotesList(item).filter((_, idx) => !this.deleteSelected.has(idx));
    this.saveUserQuickNotes(this.currentEditingId, notes);
    this.setDeleteMode(false);
    app.toast(`${count}件の定型文を削除しました`);
  },

  addQuickNote() {
    if (this.currentEditingId === null) return;
    const val = this.readNote();
    if (!val) {
      document.getElementById("modalError").textContent = "登録する備考を入力してください。";
      return;
    }
    const item = app.items.find(i => Number(i.Id) === this.currentEditingId);
    if (!item) return;

    const notes = this.getUserQuickNotesList(item);
    if (notes.includes(val)) {
      document.getElementById("modalError").textContent = "すでに登録されています。";
      return;
    }
    if (notes.length >= CONFIG.QUICK_NOTES_MAX) {
      document.getElementById("modalError").textContent = `登録できる定型文は${CONFIG.QUICK_NOTES_MAX}件までです。不要なものを削除してください。`;
      return;
    }
    this.saveUserQuickNotes(this.currentEditingId, [...notes, val]);
    app.toast("定型文を登録しました");
  },

  // 定型文の保存（すぐ表示に反映し、送信は画面を閉じた時にステータス・備考とまとめて行う）
  saveUserQuickNotes(userId, notesArray) {
    document.getElementById("modalError").textContent = "";
    SaveQueue.enqueue(userId, { [CONFIG.FIELDS.QUICK_NOTES]: JSON.stringify(notesArray) });
    if (this.currentEditingId === userId) this.renderQuickNotes();
  },

  /* ===== 予定予約（1人1件） ===== */
  renderSchedule(item) {
    const box = document.getElementById("currentScheduleBox");
    const textEl = document.getElementById("currentScheduleText");
    const dateInput = document.getElementById("schedDateInput");
    const statusSelect = document.getElementById("schedStatusSelect");
    const noteInput = document.getElementById("schedNoteInput");

    const minDate = DateUtils.getTomorrowYmd();
    dateInput.min = minDate;

    const sched = item ? app.parseSchedule(item[CONFIG.FIELDS.SCHEDULE]) : null;
    if (sched) {
      box.classList.add("active");
      const statusLabel = sched.status || "未入力";
      // 「予約中: 日付 → ●ステータス（備考）」
      const statusEl = document.createElement("span");
      statusEl.className = "sched-status-label";
      Icons.setStatusLabel(statusEl, sched.status, statusLabel);
      textEl.replaceChildren(
        `予約中: ${DateUtils.formatYmd(sched.date)} → `,
        statusEl,
        sched.note ? `（${sched.note}）` : ""
      );
      dateInput.value = sched.date >= minDate ? sched.date : minDate;
      statusSelect.value = sched.status;
      noteInput.value = sched.note || "";
    } else {
      box.classList.remove("active");
      textEl.textContent = "";
      dateInput.value = minDate;
      statusSelect.value = STATUS.VACATION;
      noteInput.value = "";
    }
    this.syncSchedStatusUi();
    // 表示直後の値を基準にして、ここから変えたら「未保存」
    this.schedBaseline = this.currentScheduleValues();
    this.syncScheduleUi();
  },

  currentScheduleValues() {
    return {
      date: document.getElementById("schedDateInput").value,
      status: document.getElementById("schedStatusSelect").value,
      note: document.getElementById("schedNoteInput").value.trim()
    };
  },

  isScheduleDirty() {
    if (this.currentEditingId === null || !this.schedBaseline) return false;
    const now = this.currentScheduleValues();
    return ["date", "status", "note"].some(k => now[k] !== this.schedBaseline[k]);
  },

  // 変えた欄をオレンジ表示。「未保存・ステータスを押すと一緒に保存」を出す
  syncScheduleUi() {
    const base = this.schedBaseline;
    const now = this.currentScheduleValues();
    const mark = (el, key) => el.classList.toggle("dirty", !!base && now[key] !== base[key]);
    mark(document.getElementById("schedDateInput"), "date");
    mark(document.getElementById("schedStatusBtn"), "status");
    mark(document.getElementById("schedNoteInput"), "note");
    document.getElementById("schedDraftHint").hidden = !this.isScheduleDirty();
  },

  // 予約欄の入力を確認して保存用の値を作る。不備があれば { error }
  readScheduleForm() {
    const { date, status, note } = this.currentScheduleValues();
    if (!isValidStatus(status)) return { error: "予約するステータスを選択してください。" };
    if (!date || date <= DateUtils.getTodayYmd()) return { error: "予約日は明日以降の日付を指定してください。" };
    if ([...note].length > CONFIG.NOTE_MAX) return { error: `予約時の備考は${CONFIG.NOTE_MAX}文字以内で入力してください。` };
    return { payload: JSON.stringify({ date, status, note }) };
  },

  /* ===== 予約ステータスの選択メニュー（色の丸付き） =====
   * 値は非表示の #schedStatusSelect に入れる。ボタン＝現在の値、リスト＝選択肢 */
  initSchedStatusMenu() {
    const btn = document.getElementById("schedStatusBtn");
    const list = document.getElementById("schedStatusList");
    const select = document.getElementById("schedStatusSelect");

    btn.addEventListener("click", () => {
      if (list.hidden) this.openSchedStatusMenu(); else this.closeSchedStatusMenu(true);
    });
    btn.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        this.openSchedStatusMenu();
      }
    });

    list.addEventListener("click", e => {
      const li = e.target.closest('[role="option"]');
      if (!li) return;
      select.value = li.dataset.value;
      this.syncSchedStatusUi();
      this.closeSchedStatusMenu(true);
    });
    list.addEventListener("keydown", e => {
      const items = [...list.querySelectorAll('[role="option"]')];
      const idx = items.indexOf(document.activeElement);
      const move = to => { e.preventDefault(); items[(to + items.length) % items.length].focus(); };
      if (e.key === "ArrowDown") move(idx + 1);
      else if (e.key === "ArrowUp") move(idx - 1);
      else if (e.key === "Home") move(0);
      else if (e.key === "End") move(items.length - 1);
      else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (idx >= 0) items[idx].click();
      } else if (e.key === "Escape") {
        e.stopPropagation(); // ステータス画面ごと閉じないように、メニューだけ閉じる
        this.closeSchedStatusMenu(true);
      } else if (e.key === "Tab") {
        this.closeSchedStatusMenu(false);
      }
    });

    // メニューの外を押したら閉じる。画面のスクロール・サイズ変更で位置がずれるので、その時も閉じる
    document.addEventListener("pointerdown", e => {
      if (!list.hidden && !list.contains(e.target) && !btn.contains(e.target)) this.closeSchedStatusMenu(false);
    });
    document.querySelector("#statusModal .modal-content")
      .addEventListener("scroll", () => this.closeSchedStatusMenu(false));
    window.addEventListener("resize", () => this.closeSchedStatusMenu(false));
  },

  openSchedStatusMenu() {
    const btn = document.getElementById("schedStatusBtn");
    const list = document.getElementById("schedStatusList");
    const select = document.getElementById("schedStatusSelect");
    if (btn.disabled) return;

    list.replaceChildren();
    Object.keys(CONFIG.STATUS_VIEW).forEach(st => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.tabIndex = -1;
      li.dataset.value = st;
      li.setAttribute("aria-selected", String(st === select.value));
      Icons.setStatusLabel(li, st, CONFIG.STATUS_VIEW[st].menuLabel);
      list.appendChild(li);
    });

    // モーダルのスクロールで切れないよう、画面基準（fixed）で配置する。下に入らなければ上に開く
    list.style.top = "0px";
    list.style.bottom = "";
    list.style.maxHeight = "";
    list.hidden = false;
    const r = btn.getBoundingClientRect();
    const margin = 8;
    const below = window.innerHeight - r.bottom - margin;
    const above = r.top - margin;
    const openUp = below < list.scrollHeight && above > below;
    const width = Math.max(r.width, 150);
    list.style.left = `${Math.max(margin, Math.min(r.left, window.innerWidth - width - margin))}px`;
    list.style.minWidth = `${width}px`;
    list.style.maxHeight = `${Math.max(120, openUp ? above : below)}px`;
    list.style.top = openUp ? "" : `${r.bottom + 2}px`;
    list.style.bottom = openUp ? `${window.innerHeight - r.top + 2}px` : "";
    btn.setAttribute("aria-expanded", "true");

    const current = list.querySelector('[aria-selected="true"]') || list.firstElementChild;
    if (current) {
      current.focus({ preventScroll: true });
      current.scrollIntoView({ block: "nearest" });
    }
  },

  closeSchedStatusMenu(returnFocus) {
    const btn = document.getElementById("schedStatusBtn");
    const list = document.getElementById("schedStatusList");
    if (!list || list.hidden) return;
    list.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if (returnFocus) btn.focus();
  },

  // ボタンの表示（色の丸＋ステータス名）を、非表示の select の値に合わせる
  syncSchedStatusUi() {
    const btn = document.getElementById("schedStatusBtn");
    const select = document.getElementById("schedStatusSelect");
    if (!btn || !select) return;
    Icons.setStatusLabel(btn, select.value, getStatusView(select.value).menuLabel);
    this.syncScheduleUi();
  },

  saveSchedule() {
    if (this.currentEditingId === null) return;
    const sched = this.readScheduleForm();
    if (sched.error) {
      document.getElementById("modalError").textContent = sched.error;
      return;
    }
    this.submit({ [CONFIG.FIELDS.SCHEDULE]: sched.payload }, { close: false, message: "予約を保存しました" });
  },

  clearSchedule() {
    if (this.currentEditingId === null) return;
    this.submit({ [CONFIG.FIELDS.SCHEDULE]: "" }, { close: false, message: "予約を取り消しました" });
  },

  // 席の割り当て解除（フリーアドレスで席を立つ時など）。座席表ではその席が空席になる
  // 複数の席を持つ人は、どの席を解除するか選ぶ
  async unassignSeat() {
    if (this.currentEditingId === null) return;
    const id = this.currentEditingId;
    const item = app.items.find(i => Number(i.Id) === id);
    const seats = item ? app.parseSeats(item.Seat) : [];
    if (!seats.length) return;
    const name = item.Title || "名前未設定";

    const choices = seats.length === 1
      ? [{ value: seats, label: `${seats[0]} を解除する`, sub: "座席表では空席になります", danger: true }]
      : [
          ...seats.map(seatNo => ({
            value: [seatNo], label: `${seatNo} を解除する`,
            sub: `残り: ${seats.filter(s => s !== seatNo).join(", ")}`
          })),
          { value: seats, label: "すべて解除する", sub: `${seats.join(", ")} が空席になります`, danger: true }
        ];
    const removed = await app.choose({
      title: "席の割り当て解除",
      message: seats.length > 1 ? `${name}さんには ${seats.length} 席が割り当てられています。解除する席を選んでください。` : "",
      choices
    });
    if (!removed || this.currentEditingId !== id) return; // やめた／その間に画面が閉じられた

    const remaining = seats.filter(s => !removed.includes(s));
    this.submit({ Seat: remaining.join(", ") }, {
      close: false,
      message: remaining.length ? `${removed.join(", ")} の割り当てを解除しました` : "席の割り当てを解除しました"
    });
    this.renderSeatJumpLinks(app.items.find(i => Number(i.Id) === id));
  },

  async copyDirectUrl() {
    if (this.currentEditingId === null) return;
    const url = new URL(window.location.href);
    url.search = `?id=${this.currentEditingId}`;
    try {
      await navigator.clipboard.writeText(url.toString());
      // ボタン内は「長い表記／短い表記（スマホ）」の2つの span。表示を戻せるよう子要素ごと控えておく
      const btn = document.getElementById("copyDirectUrlBtn");
      const prev = [...btn.childNodes];
      Icons.setLabel(btn, "check", "コピー済");
      setTimeout(() => { btn.replaceChildren(...prev); }, 1800);
    } catch (e) {
      prompt("以下のURLをコピーしてブックマークしてください:", url.toString());
    }
  }
};