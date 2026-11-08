"use strict";

const SettingsModal = {
  sortKey: "SortNo",
  sortOrder: "asc",

  // 保存前の編集内容（id → {no, seat, name, dept}）。
  // 自動更新などで表が再描画されても、入力途中の内容が消えないようにする。
  drafts: new Map(),

  init() {
    document.getElementById("settingsBtn").addEventListener("click", () => this.open());
    document.getElementById("settingsClose").addEventListener("click", () => this.close());
    document.getElementById("settingsDoneBtn").addEventListener("click", () => this.close());
    app.bindBackdropClose(document.getElementById("settingsModal"), () => this.close());
    document.getElementById("addMemberBtn").addEventListener("click", e => {
      app.withBusy(e.currentTarget, () => this.addMember());
    });
    document.getElementById("settingsSearch").addEventListener("input", () => this.render());

    document.querySelectorAll("[data-settings-sort]").forEach(th => {
      th.addEventListener("click", () => this.setSort(th.dataset.settingsSort));
    });
  },

  isOpen() {
    return document.getElementById("settingsModal").classList.contains("active");
  },

  open() {
    this.render();
    document.getElementById("settingsModal").classList.add("active");
  },

  close() {
    if (!this.isOpen()) return;
    if (this.drafts.size && !confirm("保存していない変更があります。閉じてもよろしいですか？")) return;
    this.drafts.clear();
    document.getElementById("settingsModal").classList.remove("active");
  },

  setSort(key) {
    if (!key) return;
    const next = SortUtil.next({ key: this.sortKey, order: this.sortOrder }, key);
    this.sortKey = next.key;
    this.sortOrder = next.order;
    this.render();
  },

  updateSortHeaders() {
    SortUtil.paint(
      document.querySelectorAll("[data-settings-sort]"),
      th => th.dataset.settingsSort,
      { key: this.sortKey, order: this.sortOrder }
    );
  },

  /* ===== 下書き管理 ===== */
  itemToForm(item) {
    const v = item[CONFIG.FIELDS.SORT_NO];
    return {
      no: v === undefined || v === null ? "" : String(v),
      seat: item.Seat || "",
      name: item.Title || "",
      dept: item.Dept || ""
    };
  },

  isSameAsItem(form, item) {
    const base = this.itemToForm(item);
    return form.no === base.no && form.seat === base.seat && form.name === base.name && form.dept === base.dept;
  },

  render() {
    const tbody = document.getElementById("settingsTableBody");
    if (!tbody) return;
    this.updateSortHeaders();
    const sortNoField = CONFIG.FIELDS.SORT_NO;
    const query = (document.getElementById("settingsSearch")?.value || "").trim().toLocaleLowerCase();

    // 削除済みメンバーの下書きは捨てる
    const liveIds = new Set(app.items.map(i => Number(i.Id)));
    [...this.drafts.keys()].forEach(id => { if (!liveIds.has(id)) this.drafts.delete(id); });

    const rows = app.items
      .filter(item => [item[sortNoField], item.Seat, item.Title, item.Dept]
        .some(val => String(val ?? "").toLocaleLowerCase().includes(query)))
      .sort((a, b) => app.compareItemsBy(a, b, this.sortKey, this.sortOrder));

    // 全何名 ／ 座席未割当・配置未登録あり ／ 検索結果 の表示更新
    const unassignedCount = app.items.filter(item => {
      const seats = app.parseSeats(item.Seat);
      return !seats.length || seats.some(s => !ALL_SEATS_MAP[s]);
    }).length;
    const summaryEl = document.getElementById("settingsSummary");
    if (summaryEl) {
      summaryEl.textContent =
        `全${app.items.length}名 ／ 座席未割当・配置未登録あり ${unassignedCount}名 ／ 検索結果 ${rows.length}名`;
    }

    tbody.replaceChildren();
    rows.forEach(item => {
      const id = Number(item.Id);
      const form = this.drafts.get(id) || this.itemToForm(item);

      const tr = document.createElement("tr");
      if (this.drafts.has(id)) tr.classList.add("row-dirty");

      const makeInput = (field, label, extra = {}) => {
        const input = document.createElement("input");
        input.id = `edit-${field}-${id}`;
        input.setAttribute("aria-label", label);
        input.value = form[field];
        Object.assign(input, extra);
        input.addEventListener("input", () => {
          const draft = { ...(this.drafts.get(id) || this.itemToForm(item)), [field]: input.value };
          if (this.isSameAsItem(draft, item)) this.drafts.delete(id);
          else this.drafts.set(id, draft);
          tr.classList.toggle("row-dirty", this.drafts.has(id));
        });
        return input;
      };

      const noInput = makeInput("no", "表示順", { type: "number", step: "1" });
      const seatInput = makeInput("seat", "席番号", { maxLength: 255 });
      const nameInput = makeInput("name", "名前", { maxLength: 255 });
      const deptInput = makeInput("dept", "部署", { maxLength: 255 });

      const cells = [noInput, seatInput, nameInput, deptInput].map(input => {
        const td = document.createElement("td");
        td.appendChild(input);
        return td;
      });

      const actionsTd = document.createElement("td");
      const actions = document.createElement("div");
      actions.className = "settings-actions";
      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "btn-success";
      saveBtn.textContent = "保存";
      saveBtn.addEventListener("click", () => app.withBusy(saveBtn, () => this.saveMember(id)));
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn-danger";
      deleteBtn.textContent = "削除";
      deleteBtn.addEventListener("click", () => app.withBusy(deleteBtn, () => this.deleteMember(id)));
      actions.append(saveBtn, deleteBtn);
      actionsTd.appendChild(actions);

      tr.append(...cells, actionsTd);
      tbody.appendChild(tr);
    });

    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
      td.className = "empty-list";
      td.textContent = query ? "一致するメンバーがいません。" : "登録データがありません。";
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  },

  /* ===== 入力チェック ===== */
  // 席番号を正規化（全角/半角・大小の揺れを統一）し、問題があれば警告文を返す
  checkSeats(rawSeat, ownId) {
    const seats = app.parseSeats(rawSeat);
    const warnings = [];

    const unknown = seats.filter(s => !ALL_SEATS_MAP[s]);
    if (unknown.length) warnings.push(`座席表に存在しない席: ${unknown.join(", ")}`);

    const taken = [];
    seats.forEach(s => {
      const other = app.items.find(i => Number(i.Id) !== Number(ownId) && app.parseSeats(i.Seat).includes(s));
      if (other) taken.push(`${s}（${other.Title || "名前未設定"}さんと重複）`);
    });
    if (taken.length) warnings.push(`他のメンバーと重複する席: ${taken.join(", ")}`);

    return { seats, normalized: seats.join(", "), warnings };
  },

  parseSortNo(raw) {
    const text = String(raw).trim();
    if (text === "") return { ok: true, value: null };
    const num = Number(text);
    if (!Number.isFinite(num)) return { ok: false };
    return { ok: true, value: num };
  },

  /* ===== 更新系 ===== */
  async saveMember(id) {
    const item = app.items.find(i => Number(i.Id) === Number(id));
    if (!item) return;
    const form = this.drafts.get(Number(id)) || this.itemToForm(item);

    const sortNo = this.parseSortNo(form.no);
    if (!sortNo.ok) { alert("表示順は数値で入力してください。"); return; }
    const Title = form.name.trim();
    if (!Title) { alert("名前は必須です。"); return; }
    const Dept = form.dept.trim();

    const seatCheck = this.checkSeats(form.seat, id);
    if (seatCheck.warnings.length &&
        !confirm(`席番号について確認してください。\n\n${seatCheck.warnings.join("\n")}\n\nこのまま保存しますか？`)) {
      return;
    }

    try {
      await spApi.update(id, { [CONFIG.FIELDS.SORT_NO]: sortNo.value, Seat: seatCheck.normalized, Title, Dept });
      this.drafts.delete(Number(id));
      await app.refreshAll();
      app.toast("変更を保存しました");
    } catch (err) {
      console.error("メンバー更新エラー:", err);
      app.toast(err && err.status === 404 ? "このメンバーは既に削除されています" : "保存に失敗しました", true);
    }
  },

  async addMember() {
    const sortNo = this.parseSortNo(document.getElementById("newSortNo").value);
    if (!sortNo.ok) { alert("表示順は数値で入力してください。"); return; }
    const Title = document.getElementById("newName").value.trim();
    const Dept = document.getElementById("newDept").value.trim();
    if (!Title) { alert("名前を入力してください。"); return; }

    const seatCheck = this.checkSeats(document.getElementById("newSeat").value, null);
    if (seatCheck.warnings.length &&
        !confirm(`席番号について確認してください。\n\n${seatCheck.warnings.join("\n")}\n\nこのまま登録しますか？`)) {
      return;
    }

    const { SORT_NO, NOTE, QUICK_NOTES, SCHEDULE } = CONFIG.FIELDS;
    try {
      await spApi.create({
        [SORT_NO]: sortNo.value,
        Seat: seatCheck.normalized,
        Title,
        Dept,
        Status: STATUS.OFF,
        [NOTE]: "",
        [QUICK_NOTES]: JSON.stringify(CONFIG.DEFAULT_QUICK_NOTES),
        [SCHEDULE]: ""
      });
      ["newSortNo", "newSeat", "newName", "newDept"].forEach(elId => { document.getElementById(elId).value = ""; });
      await app.refreshAll();
      app.toast("メンバーを登録しました");
    } catch (err) {
      console.error("メンバー登録エラー:", err);
      app.toast("登録に失敗しました", true);
    }
  },

  // ※削除・編集の可否は SharePoint 側の権限で制御してください（画面側の制限はあくまで操作ミス防止）
  async deleteMember(id) {
    const item = app.items.find(x => Number(x.Id) === Number(id));
    const label = item ? `${item.Title || "名前未設定"}（${item.Seat || "席未設定"}）` : "このメンバー";
    if (!confirm(`${label}のデータを削除しますか？この操作は元に戻せません。`)) return;
    try {
      await spApi.remove(id);
      this.drafts.delete(Number(id));
      await app.refreshAll();
      app.toast("削除しました");
    } catch (err) {
      console.error("メンバー削除エラー:", err);
      app.toast(err && err.status === 404 ? "既に削除されています" : "削除に失敗しました", true);
      await app.refreshAll();
    }
  }
};
