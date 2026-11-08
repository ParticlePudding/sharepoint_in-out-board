"use strict";

const StatsScreen = {
  groups: [],
  editingGroups: [],
  selectedGroupId: null,
  dirty: false,
  saving: false,

  // AppSettings から読み込んだ状態（ETag 付き：保存時の楽観ロックに使う）
  setting: { id: null, value: null, etag: null },
  groupsLoadedAt: 0,
  groupsLoadError: null,
  _loadingPromise: null,

  init() {
    this.bindEvents();
  },

  bindEvents() {
    document.getElementById("groupMembersClose").addEventListener("click", () => this.closeMembersPopup());
    // メンバー一覧の見出し（No.／名前／部署／状態／備考）で並び替え
    document.getElementById("groupMembersList").addEventListener("click", e => {
      const btn = e.target.closest("[data-member-sort]");
      if (!btn) return;
      const key = btn.dataset.memberSort;
      this.membersSort = SortUtil.next(this.membersSort, key);
      this.renderMembersPopup();
      const list = document.getElementById("groupMembersList");
      list.scrollTop = 0;
      // 見出しは作り直すので、押したボタンにフォーカスを戻す（キーボード操作用）
      list.querySelector(`[data-member-sort="${key}"]`)?.focus({ preventScroll: true });
    });
    app.bindBackdropClose(document.getElementById("groupMembersModal"), () => this.closeMembersPopup());

    document.getElementById("openStatsGroupModalBtn").addEventListener("click", () => this.openGroupModal());
    document.getElementById("statsGroupModalClose").addEventListener("click", () => this.closeGroupModal());
    document.getElementById("statsGroupDoneBtn").addEventListener("click", () => this.closeGroupModal());
    app.bindBackdropClose(document.getElementById("statsGroupModal"), () => this.closeGroupModal());

    document.getElementById("addStatsGroupBtn").addEventListener("click", () => this.addGroup());
    document.getElementById("newStatsGroupName").addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) { // 229: Safari の IME 確定対策
        e.preventDefault();
        this.addGroup();
      }
    });

    document.getElementById("editStatsGroupName").maxLength = 32;
    document.getElementById("editStatsGroupName").addEventListener("input", e => {
      this.renameSelectedGroup(e.target.value);
    });

    document.getElementById("statsGroupMemberSearch").addEventListener("input", () => {
      this.renderGroupMemberList();
    });

    document.getElementById("statsGroupCheckFilteredBtn").addEventListener("click", () => {
      this.setFilteredMembersChecked(true);
    });

    document.getElementById("statsGroupUncheckFilteredBtn").addEventListener("click", () => {
      this.setFilteredMembersChecked(false);
    });

    document.getElementById("saveStatsGroupsBtn").addEventListener("click", () => {
      this.saveGroupsToServer();
    });
  },

  isGroupModalOpen() {
    return document.getElementById("statsGroupModal").classList.contains("active");
  },

  /* ===== グループ情報の読み込み（SharePoint列から全ユーザー共通データを取得） ===== */
  normalizeGroups(rawArray) {
    if (!Array.isArray(rawArray)) return [];
    return rawArray
      .filter(g => g && typeof g === "object" && String(g.name ?? "").trim() !== "")
      .map((g, idx) => ({
        id: String(g.id || `grp_${idx + 1}_${Date.now()}`),
        name: String(g.name).trim().slice(0, 32),
        memberIds: Array.isArray(g.memberIds)
          ? [...new Set(g.memberIds.map(Number).filter(n => Number.isFinite(n) && n > 0))]
          : []
      }));
  },

  // AppSettings リストから読み込む。同時呼び出しは1回の通信にまとめる
  loadGroups(force = false) {
    const fresh = Date.now() - this.groupsLoadedAt < CONFIG.STATS_GROUPS_CACHE_MS;
    if (!force && this.groupsLoadedAt && fresh) return Promise.resolve();
    if (this._loadingPromise) return this._loadingPromise;

    this._loadingPromise = (async () => {
      try {
        const current = await spApi.getSetting(CONFIG.SETTINGS_KEYS.STATS_GROUPS);
        let parsed = [];
        if (current.value && String(current.value).trim()) {
          try { parsed = JSON.parse(current.value); } catch (e) { console.warn("グループ設定JSONの解析スキップ:", e); }
        }
        this.setting = current;
        this.groups = this.normalizeGroups(parsed);
        this.groupsLoadedAt = Date.now();
        this.groupsLoadError = null;
      } catch (err) {
        console.error("グループ設定の取得エラー:", err);
        this.groupsLoadError = err;
        throw err;
      } finally {
        this._loadingPromise = null;
      }
    })();
    return this._loadingPromise;
  },

  // 人数表画面を表示する（必要なら設定を取り直してから描画）
  async show() {
    this.render();
    try {
      const before = this.groupsLoadedAt;
      await this.loadGroups();
      if (this.groupsLoadedAt !== before && app.currentView === "stats") this.render();
    } catch (e) {
      if (app.currentView === "stats") this.render();
    }
  },

  /* ===== 人数表テーブルの描画（グループ別集計のみ・合計行および上部サマリーなし） ===== */
  render() {
    const tbody = document.getElementById("statsTableBody");
    if (!tbody) return;

    const itemMap = new Map(app.items.map(i => [Number(i.Id), i]));
    const makeBucket = (id, name) => ({
      id, name, in: 0, meeting: 0, site: 0, trip: 0, home: 0, out: 0, vacation: 0, amHalf: 0, pmHalf: 0, none: 0
    });

    const buckets = this.groups.map(grp => {
      const b = makeBucket(grp.id, grp.name);
      grp.memberIds.forEach(memberId => {
        const item = itemMap.get(Number(memberId));
        if (!item) return;
        switch (item.Status ?? "") {
          case STATUS.PRESENT:  b.in++; break;
          case STATUS.MEETING:  b.meeting++; break;
          case STATUS.SITE:     b.site++; break;
          case STATUS.TRIP:     b.trip++; break;
          case STATUS.HOME:     b.home++; break;
          case STATUS.VACATION: b.vacation++; break;
          case STATUS.AM_HALF:  b.amHalf++; break;
          case STATUS.PM_HALF:  b.pmHalf++; break;
          case STATUS.OFF:      b.out++; break;
          default:              b.none++; // 未入力・想定外の値も「未入力」として数える（合計と必ず一致）
        }
      });
      return b;
    });

    tbody.replaceChildren();

    if (!buckets.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 12;
      td.className = "empty-list";
      td.textContent = this.groupsLoadError && !this.groupsLoadedAt
        ? "グループ設定を読み込めませんでした。通信状況と「AppSettings」リストの有無を確認してください。"
        : "グループが登録されていません。右上の「グループ設定」からグループを作成し、人員を登録してください。";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    buckets.forEach(g => {
      const tr = document.createElement("tr");

      // グループ名だけがタップ可能（メンバー一覧を表示）。他のセルは反応しない
      const nameTd = document.createElement("td");
      const nameBtn = document.createElement("button");
      nameBtn.type = "button";
      nameBtn.className = "stats-group-name-btn";
      nameBtn.textContent = g.name;
      nameBtn.title = "タップでメンバーと状態を表示";
      nameBtn.addEventListener("click", () => this.openMembersPopup(g.id));
      nameTd.appendChild(nameBtn);
      tr.appendChild(nameTd);

      [
        `${g.in}名`,
        `${g.meeting}名`,
        `${g.site}名`,
        `${g.trip}名`,
        `${g.home}名`,
        `${g.out}名`,
        `${g.vacation}名`,
        `${g.amHalf}名`,
        `${g.pmHalf}名`,
        `${g.none}名`,
        `${g.in + g.meeting + g.site + g.trip + g.home + g.out + g.vacation + g.amHalf + g.pmHalf + g.none}名`
      ].forEach(txt => {
        const td = document.createElement("td");
        td.textContent = txt;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    // 自動更新で人数が変わったら、開いているメンバー一覧も最新にする
    if (this.isMembersPopupOpen()) this.renderMembersPopup();
  },

  /* ===== グループのメンバー一覧ポップアップ（人数表のグループ名をタップ） ===== */
  membersPopupGroupId: null,
  membersSort: { key: "Status", order: "asc" }, // メンバー一覧の並び（初期は状態順。画面を閉じても保持）

  isMembersPopupOpen() {
    return document.getElementById("groupMembersModal").classList.contains("active");
  },

  openMembersPopup(groupId) {
    this.membersPopupGroupId = groupId;
    if (!this.renderMembersPopup()) return;
    document.getElementById("groupMembersModal").classList.add("active");
  },

  closeMembersPopup() {
    document.getElementById("groupMembersModal").classList.remove("active");
    this.membersPopupGroupId = null;
  },

  // 戻り値: 表示できたか（グループが削除済みなら閉じて false）
  renderMembersPopup() {
    const grp = this.groups.find(g => g.id === this.membersPopupGroupId);
    if (!grp) {
      this.closeMembersPopup();
      return false;
    }
    const { NOTE, SORT_NO } = CONFIG.FIELDS;
    const itemMap = new Map(app.items.map(i => [Number(i.Id), i]));
    const { key: sortKey, order: sortOrder } = this.membersSort;
    const members = grp.memberIds
      .map(id => itemMap.get(Number(id)))
      .filter(Boolean)
      .sort((a, b) => app.compareItemsBy(a, b, sortKey, sortOrder));

    Icons.setLabel(document.getElementById("groupMembersTitle"), "group", `${grp.name}（${members.length}名）`);

    // 状態ごとの人数
    const summary = document.getElementById("groupMembersSummary");
    summary.replaceChildren();
    StatusFilterUtil.allStatuses().forEach(st => {
      const count = members.filter(m => StatusFilterUtil.normalizeStatus(m.Status) === st).length;
      if (!count) return;
      const pill = document.createElement("span");
      pill.className = `status-pill ${getStatusView(st).pill}`;
      pill.textContent = `${st || "未入力"} ${count}`;
      summary.appendChild(pill);
    });

    const list = document.getElementById("groupMembersList");
    list.replaceChildren();
    if (!members.length) {
      const empty = document.createElement("div");
      empty.className = "empty-list";
      empty.textContent = "このグループにはメンバーが登録されていません。";
      list.appendChild(empty);
      return true;
    }
    list.appendChild(this.createMembersHeader());
    members.forEach(item => {
      const row = document.createElement("div");
      row.className = "group-member-row";

      const no = document.createElement("div");
      no.className = "group-member-no";
      const hasNo = item[SORT_NO] !== undefined && item[SORT_NO] !== null && String(item[SORT_NO]).trim() !== "";
      no.textContent = hasNo ? item[SORT_NO] : "—";

      const who = document.createElement("div");
      who.className = "group-member-who";
      const name = document.createElement("div");
      name.className = "list-name";
      name.textContent = item.Title || "（名前未設定）";
      const dept = document.createElement("div");
      dept.className = "list-dept";
      dept.textContent = item.Dept || "—";
      who.append(name, dept);

      const status = item.Status ?? "";
      const pill = document.createElement("span");
      pill.className = `status-pill ${getStatusView(status).pill}`;
      pill.textContent = status || "未入力";

      const note = document.createElement("div");
      note.className = "group-member-note";
      note.textContent = item[NOTE] || "";

      row.append(no, who, pill, note);
      list.appendChild(row);
    });
    return true;
  },

  // メンバー一覧の見出し行（スクロールしても上に固定）。押すと昇順→降順と切り替わる
  createMembersHeader() {
    const head = document.createElement("div");
    head.className = "group-member-row group-member-head";
    head.setAttribute("role", "group");
    head.setAttribute("aria-label", "並び替え");
    const mk = (key, text) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "th-sort-btn";
      b.dataset.memberSort = key;
      const ind = document.createElement("span");
      ind.className = "sort-indicator";
      b.append(text, ind);
      return b;
    };
    const cell = (...children) => {
      const d = document.createElement("div");
      d.append(...children);
      return d;
    };
    const sep = document.createElement("span");
    sep.className = "th-sep";
    sep.textContent = "/";
    head.append(
      cell(mk("SortNo", "No.")),
      cell(mk("Title", "名前"), sep, mk("Dept", "部署")),
      cell(mk("Status", "状態")),
      cell(mk("Remarks", "備考"))
    );
    const buttons = [...head.querySelectorAll("[data-member-sort]")];
    SortUtil.paint(buttons, b => b.dataset.memberSort, this.membersSort);
    buttons.forEach(b => {
      b.classList.toggle("active", b.dataset.memberSort === this.membersSort.key);
      b.removeAttribute("aria-sort");
      b.setAttribute("aria-pressed", String(b.dataset.memberSort === this.membersSort.key));
    });
    return head;
  },

  /* ===== グループ設定モーダル制御 ===== */
  async openGroupModal() {
    const openBtn = document.getElementById("openStatsGroupModalBtn");
    if (openBtn.disabled) return;
    openBtn.disabled = true;
    try {
      // 編集開始前に必ず最新の設定（とETag）を取り直す
      await this.loadGroups(true);
    } catch (err) {
      alert("グループ設定を読み込めませんでした。通信状況と「AppSettings」リストの有無を確認してください。");
      return;
    } finally {
      openBtn.disabled = false;
    }
    this.editingGroups = JSON.parse(JSON.stringify(this.groups));
    this.selectedGroupId = this.editingGroups.length ? this.editingGroups[0].id : null;
    this.dirty = false;
    document.getElementById("newStatsGroupName").value = "";
    document.getElementById("statsGroupMemberSearch").value = "";
    this.setSaveStatusText("");
    this.renderGroupModal();
    document.getElementById("statsGroupModal").classList.add("active");
  },

  closeGroupModal() {
    if (!this.isGroupModalOpen()) return;
    if (this.dirty && !confirm("保存されていない変更があります。閉じてもよろしいですか？")) {
      return;
    }
    this.dirty = false;
    document.getElementById("statsGroupModal").classList.remove("active");
  },

  setSaveStatusText(msg, isError = false) {
    const el = document.getElementById("statsGroupSaveStatus");
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? "#b91c1c" : "#15803d";
  },

  markDirty() {
    this.dirty = true;
    this.setSaveStatusText("※未保存の変更があります（「変更を保存」を押すと確定します）");
  },

  getSelectedGroup() {
    return this.editingGroups.find(g => g.id === this.selectedGroupId) || null;
  },

  addGroup() {
    const input = document.getElementById("newStatsGroupName");
    const name = input.value.trim();
    if (!name) {
      alert("新しいグループ名を入力してください。");
      input.focus();
      return;
    }
    const newGrp = {
      id: `grp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: name.slice(0, 32),
      memberIds: []
    };
    this.editingGroups.push(newGrp);
    this.selectedGroupId = newGrp.id;
    input.value = "";
    this.markDirty();
    this.renderGroupModal();
  },

  deleteGroup(groupId) {
    const idx = this.editingGroups.findIndex(g => g.id === groupId);
    if (idx === -1) return;
    const grp = this.editingGroups[idx];
    if (!confirm(`グループ「${grp.name}」を削除しますか？`)) return;

    this.editingGroups.splice(idx, 1);
    if (this.selectedGroupId === groupId) {
      this.selectedGroupId = this.editingGroups[idx]?.id || this.editingGroups[idx - 1]?.id || null;
    }
    this.markDirty();
    this.renderGroupModal();
  },

  moveGroup(groupId, dir) {
    const idx = this.editingGroups.findIndex(g => g.id === groupId);
    const targetIdx = idx + dir;
    if (idx < 0 || targetIdx < 0 || targetIdx >= this.editingGroups.length) return;
    const [removed] = this.editingGroups.splice(idx, 1);
    this.editingGroups.splice(targetIdx, 0, removed);
    this.markDirty();
    this.renderGroupList();
  },

  renameSelectedGroup(newName) {
    const grp = this.getSelectedGroup();
    if (!grp) return;
    grp.name = newName.trim().slice(0, 32) || "名称未設定";
    this.markDirty();
    this.renderGroupList();
  },

  renderGroupModal() {
    this.renderGroupList();
    this.renderGroupEditorPane();
  },

  renderGroupList() {
    const listEl = document.getElementById("statsGroupList");
    if (!listEl) return;
    listEl.replaceChildren();

    if (!this.editingGroups.length) {
      const empty = document.createElement("div");
      empty.style.color = "#64748b";
      empty.style.fontSize = "13px";
      empty.style.padding = "12px 4px";
      empty.textContent = "グループがありません。上の入力欄から作成してください。";
      listEl.appendChild(empty);
      return;
    }

    const validItemIds = new Set(app.items.map(i => Number(i.Id)));

    this.editingGroups.forEach((grp, idx) => {
      const row = document.createElement("div");
      row.className = `stats-group-item${grp.id === this.selectedGroupId ? " active" : ""}`;
      row.addEventListener("click", () => {
        this.selectedGroupId = grp.id;
        this.renderGroupModal();
      });

      const count = grp.memberIds.filter(id => validItemIds.has(Number(id))).length;
      const title = document.createElement("div");
      title.className = "stats-group-item-title";
      title.textContent = `${grp.name} (${count}名)`;

      const actions = document.createElement("div");
      actions.className = "stats-group-item-actions";

      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.textContent = "▲";
      upBtn.title = "上へ移動";
      upBtn.disabled = idx === 0;
      upBtn.addEventListener("click", e => {
        e.stopPropagation();
        this.moveGroup(grp.id, -1);
      });

      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.textContent = "▼";
      downBtn.title = "下へ移動";
      downBtn.disabled = idx === this.editingGroups.length - 1;
      downBtn.addEventListener("click", e => {
        e.stopPropagation();
        this.moveGroup(grp.id, 1);
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn-danger";
      delBtn.textContent = "削除";
      delBtn.addEventListener("click", e => {
        e.stopPropagation();
        this.deleteGroup(grp.id);
      });

      actions.append(upBtn, downBtn, delBtn);
      row.append(title, actions);
      listEl.appendChild(row);
    });
  },

  renderGroupEditorPane() {
    const grp = this.getSelectedGroup();
    const nameInput = document.getElementById("editStatsGroupName");
    const searchInput = document.getElementById("statsGroupMemberSearch");
    const checkAllBtn = document.getElementById("statsGroupCheckFilteredBtn");
    const uncheckAllBtn = document.getElementById("statsGroupUncheckFilteredBtn");
    const countEl = document.getElementById("statsGroupMemberCount");

    const disabled = !grp;
    nameInput.disabled = disabled;
    searchInput.disabled = disabled;
    checkAllBtn.disabled = disabled;
    uncheckAllBtn.disabled = disabled;

    if (!grp) {
      nameInput.value = "";
      if (countEl) countEl.textContent = "";
      const memberListEl = document.getElementById("statsGroupMemberList");
      if (memberListEl) {
        memberListEl.replaceChildren();
        const msg = document.createElement("div");
        msg.style.color = "#64748b";
        msg.style.padding = "12px";
        msg.textContent = "左側からグループを選択するか、新しいグループを作成してください。";
        memberListEl.appendChild(msg);
      }
      return;
    }

    if (document.activeElement !== nameInput) {
      nameInput.value = grp.name;
    }
    this.renderGroupMemberList();
  },

  getFilteredItemsForModal() {
    const query = (document.getElementById("statsGroupMemberSearch")?.value || "").trim().toLocaleLowerCase();
    const sortNoField = CONFIG.FIELDS.SORT_NO;
    return app.items
      .filter(item => {
        if (!query) return true;
        return [item[sortNoField], item.Title, item.Dept, item.Seat]
          .some(v => String(v ?? "").toLocaleLowerCase().includes(query));
      })
      .sort((a, b) => app.compareItemsBy(a, b, "SortNo", "asc"));
  },

  renderGroupMemberList() {
    const grp = this.getSelectedGroup();
    const memberListEl = document.getElementById("statsGroupMemberList");
    const countEl = document.getElementById("statsGroupMemberCount");
    if (!grp || !memberListEl) return;

    const validItemIds = new Set(app.items.map(i => Number(i.Id)));
    const memberSet = new Set(grp.memberIds.map(Number).filter(id => validItemIds.has(id)));
    if (countEl) countEl.textContent = `登録人数: ${memberSet.size}名`;

    const filtered = this.getFilteredItemsForModal();
    memberListEl.replaceChildren();

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.style.color = "#64748b";
      empty.style.padding = "12px";
      empty.textContent = "条件に一致する人員がいません。";
      memberListEl.appendChild(empty);
      return;
    }

    filtered.forEach(item => {
      const id = Number(item.Id);
      const isChecked = memberSet.has(id);

      const label = document.createElement("label");
      label.className = `member-pick-item${isChecked ? " checked" : ""}`;

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = isChecked;
      cb.addEventListener("change", () => {
        if (cb.checked) {
          if (!grp.memberIds.includes(id)) grp.memberIds.push(id);
        } else {
          grp.memberIds = grp.memberIds.filter(mId => Number(mId) !== id);
        }
        this.markDirty();
        this.renderGroupList();
        this.renderGroupMemberList();
      });

      const span = document.createElement("span");
      const deptStr = item.Dept ? `[${item.Dept}] ` : "";
      const seatStr = item.Seat ? `(${item.Seat})` : "";
      span.textContent = `${deptStr}${item.Title || "名前未設定"} ${seatStr}`.trim();

      label.append(cb, span);
      memberListEl.appendChild(label);
    });
  },

  setFilteredMembersChecked(checked) {
    const grp = this.getSelectedGroup();
    if (!grp) return;
    const filteredIds = this.getFilteredItemsForModal().map(i => Number(i.Id));
    const currentSet = new Set(grp.memberIds.map(Number));

    filteredIds.forEach(id => {
      if (checked) currentSet.add(id);
      else currentSet.delete(id);
    });

    grp.memberIds = [...currentSet];
    this.markDirty();
    this.renderGroupList();
    this.renderGroupMemberList();
  },

  async saveGroupsToServer() {
    if (this.saving) return;

    // 存在しなくなった社員IDは保存時に取り除く（社員データが取得できている場合のみ）
    const valid = app.items.length ? new Set(app.items.map(i => Number(i.Id))) : null;
    const cleaned = this.normalizeGroups(this.editingGroups).map(g => ({
      ...g,
      memberIds: valid ? g.memberIds.filter(id => valid.has(id)) : g.memberIds
    }));

    this.saving = true;
    const saveBtn = document.getElementById("saveStatsGroupsBtn");
    saveBtn.disabled = true;
    this.setSaveStatusText("保存中...");

    try {
      // 取得時の ETag を If-Match に付けて保存。他の人が先に保存していれば 412 になる
      this.setting = await spApi.saveSetting(
        CONFIG.SETTINGS_KEYS.STATS_GROUPS, JSON.stringify(cleaned), this.setting
      );
      this.groups = JSON.parse(JSON.stringify(cleaned));
      this.groupsLoadedAt = Date.now();
      this.dirty = false;
      this.setSaveStatusText("✓ 保存しました（全ユーザーに反映されました）");
      if (app.currentView === "stats") this.render();
    } catch (err) {
      console.error("グループ設定保存エラー:", err);
      if (err && err.status === 412) {
        this.setSaveStatusText(
          "他のユーザーが先に設定を更新していました。この内容は保存していません。いったん閉じて開き直し、最新の設定に対してやり直してください。", true);
        this.groupsLoadedAt = 0; // 次回表示時に最新を取り直す
      } else {
        this.setSaveStatusText("保存に失敗しました。「AppSettings」リストの存在と編集権限を確認してください。", true);
      }
    } finally {
      this.saving = false;
      saveBtn.disabled = false;
    }
  }
};
