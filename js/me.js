"use strict";

/* ===================== 「自分」ボタン =====================
 * 端末（ブラウザ）ごとに「自分」の社員Idを localStorage に保存し、
 * サイドバー（スマホはボトムバー）の「自分」ボタンから自分のステータス変更画面を直接開く。
 * ※本人確認（認証）ではない。共用PC・サイネージでは設定しない運用を想定（サイネージではボタン非表示）。
 */
const MeScreen = {
  myId: null,

  init() {
    this.myId = this.readSavedId();

    const navBtn = document.getElementById("navMeBtn");
    navBtn.hidden = app.isSignageMode;
    navBtn.addEventListener("click", () => this.openMine());

    document.getElementById("setMeBtn").addEventListener("click", () => this.toggleCurrentAsMe());

    document.getElementById("mePickerClose").addEventListener("click", () => this.closePicker());
    app.bindBackdropClose(document.getElementById("mePickerModal"), () => this.closePicker());
    document.getElementById("mePickerSearch").addEventListener("input", () => this.renderPicker());

    this.syncNavButton();
  },

  readSavedId() {
    const raw = app.loadCache(CONFIG.CACHE_KEYS.myId);
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  },

  // 登録済みでも、社員データから削除されていれば未登録として扱う
  getMyItem() {
    if (this.myId === null) return null;
    return app.items.find(i => Number(i.Id) === this.myId) || null;
  },

  isMe(id) {
    return this.myId !== null && Number(id) === this.myId;
  },

  setMe(id) {
    this.myId = Number(id);
    app.saveCache(CONFIG.CACHE_KEYS.myId, String(this.myId));
    this.syncNavButton();
  },

  clearMe() {
    this.myId = null;
    try { localStorage.removeItem(CONFIG.CACHE_KEYS.myId); } catch (e) { /* 無視 */ }
    this.syncNavButton();
  },

  syncNavButton() {
    const btn = document.getElementById("navMeBtn");
    if (!btn) return;
    const me = this.getMyItem();
    btn.classList.toggle("unset", !me);
    btn.title = me
      ? `自分（${me.Title || "名前未設定"}）のステータスを変更`
      : "自分を登録すると、ここから自分のステータスをすぐ変更できます";
  },

  /* ===== 「自分」ボタン ===== */
  openMine() {
    const me = this.getMyItem();
    if (me) {
      StatusModal.open(Number(me.Id), me.Title || "名前未設定");
      return;
    }
    if (!app.items.length) {
      app.toast("社員データを読み込み中です。少し待ってからもう一度押してください。", true);
      return;
    }
    this.openPicker(this.myId !== null);
  },

  /* ===== ステータス変更画面の「自分に設定／解除」 ===== */
  syncStatusModalButton(id) {
    const btn = document.getElementById("setMeBtn");
    if (!btn) return;
    const mine = this.isMe(id);
    btn.hidden = app.isSignageMode;
    // スマホでは短い表記にして、ステータス画面の上部を1行に収める
    const long = document.createElement("span");
    long.className = "label-long";
    long.textContent = mine ? "自分（解除する）" : "自分に設定";
    const short = document.createElement("span");
    short.className = "label-short";
    short.textContent = mine ? "自分（解除）" : "自分に設定";
    btn.replaceChildren(Icons.create("me"), long, short);
    btn.classList.toggle("is-me", mine);
    btn.title = mine
      ? "この端末の「自分」の設定を解除します"
      : "この端末の「自分」ボタンで、この人の入力画面を開くようにします";
  },

  toggleCurrentAsMe() {
    const id = StatusModal.currentEditingId;
    if (id === null) return;
    const item = app.items.find(i => Number(i.Id) === id);
    const name = item?.Title || "名前未設定";
    if (this.isMe(id)) {
      this.clearMe();
      app.toast("「自分」の設定を解除しました");
    } else {
      this.setMe(id);
      app.toast(`${name}さんを「自分」に設定しました`);
    }
    this.syncStatusModalButton(id);
  },

  /* ===== 自分を選択（初回） ===== */
  isPickerOpen() {
    return document.getElementById("mePickerModal").classList.contains("active");
  },

  openPicker(wasDeleted = false) {
    const search = document.getElementById("mePickerSearch");
    search.value = "";
    document.getElementById("mePickerHelp").firstChild.textContent = wasDeleted
      ? "登録していた「自分」が社員データに見つかりません。もう一度、あなたの名前を選んでください。"
      : "あなたの名前を選んでください。次回からは「自分」ボタンを押すだけで、自分のステータス変更画面が開きます。";
    this.renderPicker();
    document.getElementById("mePickerModal").classList.add("active");
  },

  closePicker() {
    document.getElementById("mePickerModal").classList.remove("active");
  },

  renderPicker() {
    const list = document.getElementById("mePickerList");
    const query = document.getElementById("mePickerSearch").value.trim().toLocaleLowerCase();
    const { SORT_NO } = CONFIG.FIELDS;
    const rows = app.items
      .filter(item => !query || [item[SORT_NO], item.Title, item.Dept]
        .some(v => String(v ?? "").toLocaleLowerCase().includes(query)))
      .sort((a, b) => app.compareItemsBy(a, b, "SortNo", "asc"));

    list.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "empty-list";
      empty.textContent = "該当するメンバーがいません。";
      list.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    rows.forEach(item => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "me-picker-item";
      btn.setAttribute("role", "option");

      const who = document.createElement("span");
      who.className = "me-picker-who";
      const name = document.createElement("span");
      name.className = "list-name";
      name.textContent = item.Title || "（名前未設定）";
      const dept = document.createElement("span");
      dept.className = "list-dept";
      dept.textContent = item.Dept || "—";
      who.append(name, dept);

      const pill = document.createElement("span");
      pill.className = `status-pill ${getStatusView(item.Status).pill}`;
      pill.textContent = item.Status || "未入力";

      btn.append(who, pill);
      btn.addEventListener("click", () => {
        this.setMe(item.Id);
        this.closePicker();
        app.toast(`${item.Title || "名前未設定"}さんを「自分」に設定しました`);
        StatusModal.open(Number(item.Id), item.Title || "名前未設定");
      });
      frag.appendChild(btn);
    });
    list.appendChild(frag);
  }
};
