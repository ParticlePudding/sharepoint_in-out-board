"use strict";

const ListScreen = {
  sortKey: "SortNo",
  sortOrder: "asc",
  colWidths: {},
  defaultColWidths: {},       // index.html の初期幅（「初期の幅に戻す」用）
  viewMode: "table",          // "table" | "card"
  statusFilter: new Set(),    // 表示する状態（複数選択）
  statusFilterUi: null,
  floors: new Set(),          // 表示するフロア（MapScreen.getFloorGroups() の key。未割当は UNASSIGNED_FLOOR_KEY）
  isColAdjustMode: false,

  COL_MIN: 55,
  COL_MAX: 1200,

  init() {
    this.captureDefaultColumnWidths();
    this.loadCache();
    this.initColumnResize();
    this.bindEvents();
    this.syncViewModeUI();
  },

  captureDefaultColumnWidths() {
    document.querySelectorAll("#employeeTable colgroup col[data-col]").forEach(col => {
      this.defaultColWidths[col.dataset.col] = parseInt(col.style.width, 10) || 120;
    });
  },

  loadCache() {
    const keys = CONFIG.CACHE_KEYS;
    const savedSortKey = app.loadCache(keys.sortKey);
    const savedSortOrder = app.loadCache(keys.sortOrder);
    const savedSearch = app.loadCache(keys.search);
    const savedColWidths = app.loadCache(keys.colWidths, true);
    const savedViewMode = app.loadCache(keys.listViewMode);

    if (CONFIG.LIST_SORT_KEYS.includes(savedSortKey)) this.sortKey = savedSortKey;
    if (savedSortOrder === "asc" || savedSortOrder === "desc") this.sortOrder = savedSortOrder;
    if (savedSearch !== null) document.getElementById("employeeSearch").value = String(savedSearch).slice(0, 100);
    if (savedViewMode === "table" || savedViewMode === "card") this.viewMode = savedViewMode;
    this.statusFilter = StatusFilterUtil.restoreFromCache(keys.listStatusFilter);

    // 表示フロア（サイドリストとは別に保存）。存在しないフロアは捨てる。未保存なら全フロア
    const validFloorKeys = new Set(MapScreen.getAllFloorOptionKeys());
    const savedFloors = app.loadCache(keys.listFloors, true);
    this.floors = Array.isArray(savedFloors)
      ? new Set(savedFloors.filter(k => validFloorKeys.has(k)))
      : new Set(validFloorKeys);

    // 保存値は信用せず、数値の列幅だけを取り込む（キー・値のホワイトリスト化）
    if (savedColWidths && typeof savedColWidths === "object" && !Array.isArray(savedColWidths)) {
      Object.entries(savedColWidths).forEach(([colKey, w]) => {
        const num = Number(w);
        if (hasOwn(this.defaultColWidths, colKey) && Number.isFinite(num) && num >= 50 && num <= this.COL_MAX) {
          this.colWidths[colKey] = Math.round(num);
        }
      });
      this.applySavedColumnWidths();
    }
  },

  bindEvents() {
    const searchEl = document.getElementById("employeeSearch");
    searchEl.addEventListener("input", () => {
      app.saveCache(CONFIG.CACHE_KEYS.search, searchEl.value);
      this.render();
    });

    // 並び替え（単独列は th、「名前／部署」列は見出し内の各ボタン）
    document.querySelectorAll("#employeeTable th.sortable").forEach(th => {
      th.addEventListener("click", e => {
        if (this.isColAdjustMode || e.target.closest(".col-resizer")) return;
        this.setSort(th.dataset.sort);
      });
    });
    document.querySelectorAll("#employeeTable .th-sort-btn").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        if (this.isColAdjustMode) return;
        this.setSort(btn.dataset.sort);
      });
    });
    document.querySelectorAll("#listCardSortBar [data-list-sort]").forEach(btn => {
      btn.addEventListener("click", () => this.setSort(btn.dataset.listSort));
    });

    // 表示形式（リスト／カード）
    document.getElementById("listViewTableBtn").addEventListener("click", () => this.setViewMode("table"));
    document.getElementById("listViewCardBtn").addEventListener("click", () => this.setViewMode("card"));

    // 状態の絞り込み
    this.statusFilterUi = StatusFilterUtil.mount({
      button: document.getElementById("listStatusFilterBtn"),
      panel: document.getElementById("listStatusFilterPanel"),
      selected: this.statusFilter,
      onChange: selected => {
        this.statusFilter = selected;
        app.saveCache(CONFIG.CACHE_KEYS.listStatusFilter, [...selected]);
        this.render();
      }
    });

    // 表示フロアの設定（「状態」とは同時に開かない）
    const floorBtn = document.getElementById("listFloorFilterBtn");
    floorBtn.addEventListener("click", () => this.setFloorPanelOpen(document.getElementById("listFloorFilterPanel").hidden));
    document.getElementById("listStatusFilterBtn").addEventListener("click", () => this.setFloorPanelOpen(false));
    document.getElementById("listFloorsCloseBtn").addEventListener("click", () => this.setFloorPanelOpen(false));
    document.getElementById("listFloorsAllBtn").addEventListener("click", () => this.setFloors(MapScreen.getAllFloorOptionKeys()));
    document.getElementById("listFloorsNoneBtn").addEventListener("click", () => this.setFloors([]));
    this.renderFloorChecks();

    // 列幅調整モード
    document.getElementById("colAdjustBtn").addEventListener("click", () => this.setColAdjustMode(!this.isColAdjustMode));
    document.getElementById("colAdjustDoneBtn").addEventListener("click", () => this.setColAdjustMode(false));
    document.getElementById("colAdjustResetBtn").addEventListener("click", () => this.resetColumnWidths());
  },

  /* ===== 表示フロア ===== */
  setFloorPanelOpen(open) {
    const panel = document.getElementById("listFloorFilterPanel");
    const btn = document.getElementById("listFloorFilterBtn");
    if (open) this.statusFilterUi?.close();
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    btn.classList.toggle("open", open);
  },

  setFloors(keys) {
    this.floors = new Set(keys);
    app.saveCache(CONFIG.CACHE_KEYS.listFloors, [...this.floors]);
    this.syncFloorUi();
    this.render();
  },

  isAllFloors() {
    return MapScreen.getAllFloorOptionKeys().every(k => this.floors.has(k));
  },

  renderFloorChecks() {
    const container = document.getElementById("listFloorCheckboxes");
    container.replaceChildren();
    MapScreen.getFloorGroups().forEach(opt => {
      const label = document.createElement("label");
      label.className = "status-filter-check floor-filter-check";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.floorKey = opt.key;
      cb.addEventListener("change", () => {
        const next = new Set(this.floors);
        if (cb.checked) next.add(opt.key); else next.delete(opt.key);
        this.setFloors([...next]);
      });
      const span = document.createElement("span");
      span.textContent = opt.label;
      label.append(cb, span);
      container.appendChild(label);
    });
    this.syncFloorUi();
  },

  syncFloorUi() {
    document.querySelectorAll("#listFloorCheckboxes input[data-floor-key]").forEach(cb => {
      cb.checked = this.floors.has(cb.dataset.floorKey);
      cb.closest("label").classList.toggle("checked", cb.checked);
    });
    const text = MapScreen.floorFilterText(this.floors);
    const btn = document.getElementById("listFloorFilterBtn");
    // スマホは横幅が足りないので「フロア」だけ表示（絞り込み中は色で分かる）
    const long = document.createElement("span");
    long.className = "label-long";
    long.textContent = `フロア: ${text}`;
    const short = document.createElement("span");
    short.className = "label-short";
    short.textContent = "フロア";
    btn.replaceChildren(long, short);
    btn.title = `表示するフロアの設定（現在: ${text}）`;
    btn.classList.toggle("filtered", !this.isAllFloors());
  },

  /* ===== 表示形式 ===== */
  setViewMode(mode) {
    if (mode !== "table" && mode !== "card") return;
    this.viewMode = mode;
    app.saveCache(CONFIG.CACHE_KEYS.listViewMode, mode);
    if (mode === "card") this.setColAdjustMode(false);
    this.syncViewModeUI();
    this.render();
  },

  syncViewModeUI() {
    const isCard = this.viewMode === "card";
    document.getElementById("listViewTableBtn").classList.toggle("active", !isCard);
    document.getElementById("listViewCardBtn").classList.toggle("active", isCard);
    document.getElementById("listTableWrap").hidden = isCard;
    document.getElementById("listCardContainer").hidden = !isCard;
    document.getElementById("listCardSortBar").hidden = !isCard;
    document.getElementById("colAdjustBtn").hidden = isCard; // 列幅はリスト形式のときだけ
  },

  /* ===== 列幅 ===== */
  getColEl(colKey) {
    return document.querySelector(`#employeeTable colgroup col[data-col="${CSS.escape(colKey)}"]`);
  },

  setColWidth(colKey, widthPx, persist = true) {
    const colEl = this.getColEl(colKey);
    if (!colEl) return;
    const w = Math.min(this.COL_MAX, Math.max(this.COL_MIN, Math.round(widthPx)));
    colEl.style.width = `${w}px`;
    this.colWidths[colKey] = w;
    if (persist) app.saveCache(CONFIG.CACHE_KEYS.colWidths, this.colWidths);
  },

  applySavedColumnWidths() {
    Object.entries(this.colWidths).forEach(([colKey, widthPx]) => {
      const colEl = this.getColEl(colKey);
      if (colEl && widthPx >= 50) colEl.style.width = `${widthPx}px`;
    });
  },

  resetColumnWidths() {
    this.colWidths = {};
    Object.entries(this.defaultColWidths).forEach(([colKey, w]) => {
      const colEl = this.getColEl(colKey);
      if (colEl) colEl.style.width = `${w}px`;
    });
    app.saveCache(CONFIG.CACHE_KEYS.colWidths, this.colWidths);
  },

  // 見出し右端のドラッグ（マウス。タッチは列幅調整モード中のみ。touch-action は styles.css）
  initColumnResize() {
    const table = document.getElementById("employeeTable");
    if (!table) return;

    table.querySelectorAll("th[data-col] .col-resizer").forEach(resizer => {
      resizer.addEventListener("click", e => e.stopPropagation());
      resizer.addEventListener("pointerdown", e => {
        if (e.pointerType !== "mouse" && !this.isColAdjustMode) return; // タッチの通常時は横スクロールを優先
        e.stopPropagation();
        e.preventDefault();
        const th = resizer.closest("th[data-col]");
        if (!th) return;
        const colKey = th.dataset.col;

        const startX = e.clientX;
        const startWidth = th.getBoundingClientRect().width;
        resizer.classList.add("resizing");
        resizer.setPointerCapture(e.pointerId);

        const onMove = moveEv => this.setColWidth(colKey, startWidth + (moveEv.clientX - startX), false);
        const onUp = () => {
          resizer.classList.remove("resizing");
          resizer.removeEventListener("pointermove", onMove);
          resizer.removeEventListener("pointerup", onUp);
          resizer.removeEventListener("pointercancel", onUp);
          app.saveCache(CONFIG.CACHE_KEYS.colWidths, this.colWidths);
        };

        resizer.addEventListener("pointermove", onMove);
        resizer.addEventListener("pointerup", onUp);
        resizer.addEventListener("pointercancel", onUp);
      });
    });
  },

  // 列幅調整モード：見出し右端のつまみを太く表示し、タッチでもドラッグしやすくする（styles.css）
  setColAdjustMode(on) {
    this.isColAdjustMode = !!on;
    document.getElementById("employeeTable").classList.toggle("col-adjusting", this.isColAdjustMode);
    document.getElementById("colAdjustBar").hidden = !this.isColAdjustMode;
    const btn = document.getElementById("colAdjustBtn");
    btn.classList.toggle("btn-active-mode", this.isColAdjustMode);
    Icons.setLabel(btn, this.isColAdjustMode ? "check" : "width", this.isColAdjustMode ? "列幅調整を終了" : "列幅調整");
  },

  /* ===== 並び替え ===== */
  setSort(key) {
    if (!CONFIG.LIST_SORT_KEYS.includes(key)) return;
    const next = SortUtil.next({ key: this.sortKey, order: this.sortOrder }, key);
    this.sortKey = next.key;
    this.sortOrder = next.order;
    app.saveCache(CONFIG.CACHE_KEYS.sortKey, this.sortKey);
    app.saveCache(CONFIG.CACHE_KEYS.sortOrder, this.sortOrder);
    this.render();
  },

  updateSortHeaders() {
    const state = { key: this.sortKey, order: this.sortOrder };
    SortUtil.paint(document.querySelectorAll("#employeeTable th.sortable"), th => th.dataset.sort, state);

    // 「名前／部署」列とカード表示の並び替えボタン
    const arrow = this.sortOrder === "asc" ? "▲" : "▼";
    const paintBtn = (btn, key) => {
      const isCurrent = key === this.sortKey;
      btn.classList.toggle("active", isCurrent);
      const indicator = btn.querySelector(".sort-indicator");
      if (indicator) indicator.textContent = isCurrent ? arrow : "⇅";
    };
    document.querySelectorAll("#employeeTable .th-sort-btn").forEach(btn => paintBtn(btn, btn.dataset.sort));
    const multiTh = document.querySelector("#employeeTable th.multi-sort");
    if (multiTh) {
      const active = ["Title", "Dept"].includes(this.sortKey);
      multiTh.setAttribute("aria-sort", active ? (this.sortOrder === "asc" ? "ascending" : "descending") : "none");
    }
    document.querySelectorAll("#listCardSortBar [data-list-sort]").forEach(btn => paintBtn(btn, btn.dataset.listSort));
  },

  /* ===== 描画 ===== */
  getFilteredRows() {
    const { NOTE, SORT_NO, SCHEDULE } = CONFIG.FIELDS;
    const query = (document.getElementById("employeeSearch")?.value || "").trim().toLocaleLowerCase();

    return app.items
      .filter(item => {
        if (!StatusFilterUtil.matches(this.statusFilter, item.Status)) return false;
        if (!MapScreen.getItemFloorKeys(item).some(k => this.floors.has(k))) return false;
        if (!query) return true;
        const sched = app.parseSchedule(item[SCHEDULE]);
        const schedStr = sched ? `${sched.date} ${DateUtils.formatSchedule(sched)} ${sched.status || "未入力"} ${sched.note}` : "";
        const statusStr = item.Status || "未入力";
        return [item[SORT_NO], item.Title, item.Dept, item.Seat, statusStr, item[NOTE], schedStr]
          .some(value => String(value ?? "").toLocaleLowerCase().includes(query));
      })
      .sort((a, b) => app.compareItemsBy(a, b, this.sortKey, this.sortOrder));
  },

  emptyMessage() {
    const query = (document.getElementById("employeeSearch")?.value || "").trim();
    if (!this.floors.size) return "表示するフロアが選択されていません（「フロア」から選択してください）。";
    if (!this.statusFilter.size) return "表示する状態が選択されていません（「状態」から選択してください）。";
    if (query || !StatusFilterUtil.isAll(this.statusFilter) || !this.isAllFloors()) return "条件に一致する社員はいません。";
    return "登録されている社員はいません。";
  },

  render() {
    this.updateSortHeaders();
    const rows = this.getFilteredRows();
    if (this.viewMode === "card") {
      MemberCardView.render(document.getElementById("listCardContainer"), rows, {
        groups: MapScreen.getFloorGroups().filter(g => this.floors.has(g.key)),
        getGroupKeys: item => MapScreen.getItemFloorKeys(item),
        emptyText: this.emptyMessage()
      });
    } else {
      this.renderTable(rows);
    }
  },

  renderTable(rows) {
    const tbody = document.getElementById("employeeTableBody");
    if (!tbody) return;
    const { NOTE, SORT_NO, SCHEDULE } = CONFIG.FIELDS;
    const colCount = document.querySelectorAll("#employeeTable colgroup col").length;

    tbody.replaceChildren();
    const frag = document.createDocumentFragment();

    rows.forEach(item => {
      const tr = document.createElement("tr");
      tr.title = "クリックしてステータス・備考・予定予約を編集";
      tr.tabIndex = 0;
      const openModal = () => StatusModal.open(Number(item.Id), item.Title || "名前未設定");
      tr.addEventListener("click", openModal);
      tr.addEventListener("keydown", e => {
        if (e.target === tr && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openModal(); }
      });

      const noTd = document.createElement("td");
      const hasNo = item[SORT_NO] !== undefined && item[SORT_NO] !== null && String(item[SORT_NO]).trim() !== "";
      noTd.textContent = hasNo ? item[SORT_NO] : "—";

      // 名前／部署（サイドリストと同じ2段表示）
      const nameTd = document.createElement("td");
      const nameDiv = document.createElement("div");
      nameDiv.className = "list-name";
      nameDiv.textContent = item.Title || "（名前未設定）";
      const deptDiv = document.createElement("div");
      deptDiv.className = "list-dept";
      deptDiv.textContent = item.Dept || "—";
      nameTd.append(nameDiv, deptDiv);

      const statusTd = document.createElement("td");
      const status = item.Status ?? "";
      const pill = document.createElement("span");
      pill.className = `status-pill ${getStatusView(status).pill}`;
      pill.textContent = status || "未入力";
      statusTd.appendChild(pill);

      const noteTd = document.createElement("td");
      noteTd.textContent = item[NOTE] || "—";

      const schedTd = document.createElement("td");
      const sched = app.parseSchedule(item[SCHEDULE]);
      if (sched) {
        const badge = document.createElement("span");
        badge.className = "sched-badge";
        Icons.setLabel(badge, "calendar", `${DateUtils.formatSchedule(sched)} `);
        badge.append(Icons.statusDot(sched.status), `${sched.status || "未入力"}${sched.note ? `(${sched.note})` : ""}`);
        schedTd.appendChild(badge);
      } else {
        schedTd.textContent = "—";
      }

      // 席番号（参照頻度が低いため一番右）
      const seatTd = document.createElement("td");
      const seats = app.parseSeats(item.Seat);
      if (!seats.length) {
        seatTd.textContent = "座席未割当";
        seatTd.className = "unassigned";
      } else {
        const wrap = document.createElement("div");
        wrap.className = "seat-link-wrap";
        seats.forEach(seatNo => wrap.appendChild(app.createSeatLink(seatNo, { stopPropagation: true })));
        seatTd.appendChild(wrap);
      }

      tr.append(noTd, nameTd, statusTd, noteTd, schedTd, seatTd);
      frag.appendChild(tr);
    });

    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = colCount;
      td.className = "empty-list";
      td.textContent = this.emptyMessage();
      tr.appendChild(td);
      frag.appendChild(tr);
    }
    tbody.appendChild(frag);
  }
};
