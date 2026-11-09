"use strict";

const UNASSIGNED_FLOOR_KEY = "__UNASSIGNED__";

const MapScreen = {
  viewport: null,
  map: null,
  scale: 1,
  tx: 0,
  ty: 0,
  fitScale: 1,
  autoFit: true,
  pointers: new Map(),
  gesture: null,

  currentFloorId: CONFIG.FLOORS[0].id,
  isBulkMode: false,
  selectedIds: new Set(),
  bulkSelectedStatus: STATUS.PRESENT,
  highlightTimer: null,

  // サイドリスト状態
  isSideListOpen: false,
  sideListViewMode: "list", // "list" | "card"
  sideListSortKey: "SortNo",
  sideListSortOrder: "asc",
  sideListSearch: "",
  sideListStatusFilter: new Set(), // 表示する状態（複数選択）。loadCache で復元
  sideStatusFilterUi: null,
  sideListFloors: new Set(),

  init() {
    this.loadCache();
    this.initViewport();
    this.renderFloorButtons();
    this.renderSideListFloorCheckboxes();
    this.updateBulkStatusButtonsUI();
    this.bindEvents();
  },

  /* ===== 現在のフロアのマップ解像度を取得（フロア別解像度対応） ===== */
  getCurrentMapSize() {
    const floor = CONFIG.FLOORS.find(f => f.id === this.currentFloorId) || CONFIG.FLOORS[0];
    return {
      width: Number(floor?.width) > 0 ? Number(floor.width) : CONFIG.MAP_W,
      height: Number(floor?.height) > 0 ? Number(floor.height) : CONFIG.MAP_H
    };
  },

  getAllFloorOptionKeys() {
    return [...CONFIG.FLOORS.map(f => f.id), UNASSIGNED_FLOOR_KEY];
  },

  loadCache() {
    const keys = CONFIG.CACHE_KEYS;
    const savedFloor = app.loadCache(keys.floor);
    const savedBulkStatus = app.loadCache(keys.bulkStatus);
    const savedSideOpen = app.loadCache(keys.sideListOpen);
    const savedViewMode = app.loadCache(keys.sideListViewMode);
    const savedSortKey = app.loadCache(keys.sideListSortKey);
    const savedSortOrder = app.loadCache(keys.sideListSortOrder);
    const savedSearch = app.loadCache(keys.sideListSearch);
    const savedSideFloors = app.loadCache(keys.sideListFloors, true);

    if (savedFloor && CONFIG.FLOORS.some(f => f.id === savedFloor)) {
      this.currentFloorId = savedFloor;
    }
    if (isValidStatus(savedBulkStatus)) {
      this.bulkSelectedStatus = savedBulkStatus;
    }
    if (savedSideOpen === "1" || savedSideOpen === true) {
      this.isSideListOpen = true;
    }
    if (savedViewMode === "list" || savedViewMode === "card") {
      this.sideListViewMode = savedViewMode;
    }
    if (CONFIG.SIDE_SORT_KEYS.includes(savedSortKey)) {
      this.sideListSortKey = savedSortKey;
    }
    if (savedSortOrder === "asc" || savedSortOrder === "desc") {
      this.sideListSortOrder = savedSortOrder;
    }
    if (savedSearch !== null) {
      this.sideListSearch = String(savedSearch).slice(0, 100);
    }
    this.sideListStatusFilter = StatusFilterUtil.restoreFromCache(keys.sideListStatusFilter);

    const validFloorKeys = new Set(this.getAllFloorOptionKeys());
    if (Array.isArray(savedSideFloors)) {
      this.sideListFloors = new Set(savedSideFloors.filter(k => validFloorKeys.has(k)));
    } else {
      this.sideListFloors = new Set(validFloorKeys);
    }
  },

  bindEvents() {
    document.getElementById("bulkModeBtn").addEventListener("click", () => this.toggleBulkMode());
    document.getElementById("bulkCancelBtn").addEventListener("click", () => this.toggleBulkMode(false));
    document.querySelectorAll(".bulk-status-btn").forEach(btn => {
      btn.addEventListener("click", () => this.selectBulkStatus(btn.dataset.bulkStatus));
    });

    const bulkNoteCheck = document.getElementById("bulkNoteCheck");
    const bulkNoteInput = document.getElementById("bulkNoteInput");
    bulkNoteCheck.addEventListener("change", () => {
      bulkNoteInput.disabled = !bulkNoteCheck.checked;
      if (bulkNoteCheck.checked) bulkNoteInput.focus();
    });
    document.getElementById("bulkExecuteBtn").addEventListener("click", () => this.executeBulkUpdate());

    // サイドリスト開閉・表示形式切替
    document.getElementById("toggleSideListBtn").addEventListener("click", () => this.toggleSideList());
    document.getElementById("sideViewListBtn").addEventListener("click", () => this.setSideListViewMode("list"));
    document.getElementById("sideViewCardBtn").addEventListener("click", () => this.setSideListViewMode("card"));

    // サイドリストの表示フロア設定パネル（「状態」とは同時に開かない）
    const settingsPanel = document.getElementById("sideListSettingsPanel");
    document.getElementById("sideListFloorBtn").addEventListener("click", () => {
      this.setSideFloorPanelOpen(settingsPanel.hidden);
    });
    document.getElementById("sideListStatusFilterBtn").addEventListener("click", () => {
      this.setSideFloorPanelOpen(false);
    });
    document.getElementById("sideListSettingsCloseBtn").addEventListener("click", () => {
      this.setSideFloorPanelOpen(false);
    });
    document.getElementById("sideFloorsAllBtn").addEventListener("click", () => {
      this.setAllSideListFloors(true);
    });
    document.getElementById("sideFloorsNoneBtn").addEventListener("click", () => {
      this.setAllSideListFloors(false);
    });

    // サイドリスト検索・ステータス絞り込み
    const searchInput = document.getElementById("sideListSearch");
    searchInput.value = this.sideListSearch;
    searchInput.addEventListener("input", () => {
      this.sideListSearch = searchInput.value;
      app.saveCache(CONFIG.CACHE_KEYS.sideListSearch, this.sideListSearch);
      this.renderSideList();
    });

    this.sideStatusFilterUi = StatusFilterUtil.mount({
      button: document.getElementById("sideListStatusFilterBtn"),
      panel: document.getElementById("sideListStatusFilterPanel"),
      selected: this.sideListStatusFilter,
      onChange: selected => {
        this.sideListStatusFilter = selected;
        app.saveCache(CONFIG.CACHE_KEYS.sideListStatusFilter, [...selected]);
        this.renderSideList();
      }
    });

    // 横幅が狭くフロア切替ボタンが収まらない時は横スクロール。マウスホイール（縦）でも横に送れるようにする
    const floorSwitch = document.getElementById("floorSwitch");
    floorSwitch.addEventListener("wheel", e => {
      if (floorSwitch.scrollWidth <= floorSwitch.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      floorSwitch.scrollLeft += e.deltaY;
    }, { passive: false });

    // サイドリストのソート（テーブルヘッダー ＆ カード用ソートチップ）
    document.querySelectorAll("[data-side-sort]").forEach(el => {
      el.addEventListener("click", () => this.setSideListSort(el.dataset.sideSort));
    });

    this.syncSideListUI();
  },

  /* ===== サイドリスト制御 ===== */
  // persist=false: URLパラメータ指定など、保存設定(localStorage)を上書きしたくない場合
  toggleSideList(force, persist = true) {
    this.isSideListOpen = typeof force === "boolean" ? force : !this.isSideListOpen;
    if (persist) app.saveCache(CONFIG.CACHE_KEYS.sideListOpen, this.isSideListOpen ? "1" : "0");
    this.syncSideListUI();
    this.renderSideList();
    requestAnimationFrame(() => {
      this.recalcFit();
      if (this.autoFit) this.fit(); else this.applyTransform();
    });
  },

  setSideListViewMode(mode) {
    if (mode !== "list" && mode !== "card") return;
    this.sideListViewMode = mode;
    app.saveCache(CONFIG.CACHE_KEYS.sideListViewMode, mode);
    this.syncSideListUI();
    this.renderSideList();
    requestAnimationFrame(() => {
      this.recalcFit();
      if (this.autoFit) this.fit(); else this.applyTransform();
    });
  },

  setSideListSort(key) {
    if (!CONFIG.SIDE_SORT_KEYS.includes(key)) return;
    const next = SortUtil.next({ key: this.sideListSortKey, order: this.sideListSortOrder }, key);
    this.sideListSortKey = next.key;
    this.sideListSortOrder = next.order;
    app.saveCache(CONFIG.CACHE_KEYS.sideListSortKey, this.sideListSortKey);
    app.saveCache(CONFIG.CACHE_KEYS.sideListSortOrder, this.sideListSortOrder);
    this.updateSideListSortUI();
    this.renderSideList();
  },

  updateSideListSortUI() {
    SortUtil.paint(
      document.querySelectorAll("#sideListTable th[data-side-sort]"),
      th => th.dataset.sideSort,
      { key: this.sideListSortKey, order: this.sideListSortOrder }
    );

    document.querySelectorAll("#sideCardSortBar .side-sort-chip").forEach(btn => {
      const isCurrent = btn.dataset.sideSort === this.sideListSortKey;
      btn.classList.toggle("active", isCurrent);
      const indicator = btn.querySelector(".sort-indicator");
      if (indicator) {
        indicator.textContent = isCurrent ? (this.sideListSortOrder === "asc" ? "▲" : "▼") : "⇅";
      }
    });
  },

  setSideFloorPanelOpen(open) {
    const panel = document.getElementById("sideListSettingsPanel");
    const btn = document.getElementById("sideListFloorBtn");
    if (open) this.sideStatusFilterUi?.close();
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    btn.classList.toggle("open", open);
  },

  // フロア選択ボタンの表記（リスト画面と共用）：すべて／未選択／1つならフロア名（未割当は短く）／複数なら件数
  floorFilterText(floors) {
    const all = this.getAllFloorOptionKeys();
    if (all.every(k => floors.has(k))) return "すべて";
    if (!floors.size) return "未選択";
    if (floors.size === 1) {
      const [only] = floors;
      return only === UNASSIGNED_FLOOR_KEY ? "未割当" : only;
    }
    return `${floors.size}件`;
  },

  renderSideListFloorCheckboxes() {
    const container = document.getElementById("sideListFloorCheckboxes");
    if (!container) return;
    container.replaceChildren();

    this.getFloorGroups().forEach(opt => {
      const label = document.createElement("label");
      label.className = "status-filter-check floor-filter-check";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.floorKey = opt.key;
      cb.addEventListener("change", () => {
        if (cb.checked) this.sideListFloors.add(opt.key);
        else this.sideListFloors.delete(opt.key);
        app.saveCache(CONFIG.CACHE_KEYS.sideListFloors, [...this.sideListFloors]);
        this.syncSideFloorUi();
        this.renderSideList();
      });
      const span = document.createElement("span");
      span.textContent = opt.label;
      label.append(cb, span);
      container.appendChild(label);
    });
    this.syncSideFloorUi();
  },

  syncSideFloorUi() {
    document.querySelectorAll("#sideListFloorCheckboxes input[data-floor-key]").forEach(cb => {
      cb.checked = this.sideListFloors.has(cb.dataset.floorKey);
      cb.closest("label").classList.toggle("checked", cb.checked);
    });
    const text = this.floorFilterText(this.sideListFloors);
    const btn = document.getElementById("sideListFloorBtn");
    if (!btn) return;
    btn.textContent = `フロア: ${text}`;
    btn.title = `表示するフロアの設定（現在: ${text}）`;
    btn.classList.toggle("filtered", text !== "すべて");
  },

  setAllSideListFloors(checked) {
    if (checked) {
      this.sideListFloors = new Set(this.getAllFloorOptionKeys());
    } else {
      this.sideListFloors.clear();
    }
    app.saveCache(CONFIG.CACHE_KEYS.sideListFloors, [...this.sideListFloors]);
    this.renderSideListFloorCheckboxes();
    this.renderSideList();
  },

  syncSideListUI() {
    const panel = document.getElementById("mapSideList");
    const btn = document.getElementById("toggleSideListBtn");
    const isCard = this.sideListViewMode === "card";

    if (panel) {
      panel.classList.toggle("active", this.isSideListOpen);
      panel.classList.toggle("card-mode", isCard);
    }
    if (btn) {
      btn.classList.toggle("btn-active-mode", this.isSideListOpen);
      Icons.setLabel(btn, "sidepanel", this.isSideListOpen ? "サイドリストを閉じる" : "サイドリスト表示");
    }

    document.getElementById("sideViewListBtn")?.classList.toggle("active", !isCard);
    document.getElementById("sideViewCardBtn")?.classList.toggle("active", isCard);

    const tableEl = document.getElementById("sideListTable");
    const cardContainerEl = document.getElementById("mapSideCardContainer");
    const cardSortBarEl = document.getElementById("sideCardSortBar");

    if (tableEl) tableEl.hidden = isCard;
    if (cardContainerEl) cardContainerEl.hidden = !isCard;
    if (cardSortBarEl) cardSortBarEl.hidden = !isCard;

    this.updateSideListSortUI();
  },

  // フロア別グループ（カード表示・フロア選択で共用）
  getFloorGroups() {
    return [
      ...CONFIG.FLOORS.map(f => ({ key: f.id, label: f.name })),
      { key: UNASSIGNED_FLOOR_KEY, label: "座席未割当・未登録" }
    ];
  },

  getItemFloorKeys(item) {
    const seats = app.parseSeats(item.Seat);
    if (!seats.length) return [UNASSIGNED_FLOOR_KEY];

    const keys = new Set();
    seats.forEach(s => {
      const info = ALL_SEATS_MAP[s];
      if (info && info.floorId) keys.add(info.floorId);
      else keys.add(UNASSIGNED_FLOOR_KEY);
    });
    return [...keys];
  },

  matchesSideListSearchAndStatus(item) {
    const { NOTE, SORT_NO } = CONFIG.FIELDS;
    const status = item.Status ?? "";

    if (!StatusFilterUtil.matches(this.sideListStatusFilter, status)) return false;

    const q = (this.sideListSearch || "").trim().toLocaleLowerCase();
    if (!q) return true;

    const statusStr = status || "未入力";
    return [item[SORT_NO], item.Title, item.Dept, statusStr, item[NOTE]]
      .some(v => String(v ?? "").toLocaleLowerCase().includes(q));
  },

  renderSideList() {
    if (!this.isSideListOpen || app.isPhone()) return; // スマホではサイドリストを表示しない
    this.updateSideListSortUI();

    const { NOTE, SORT_NO } = CONFIG.FIELDS;

    // フロア選択＋検索＋ステータスでフィルタ
    const filteredItems = app.items
      .filter(item => {
        const floorKeys = this.getItemFloorKeys(item);
        const matchesFloor = floorKeys.some(k => this.sideListFloors.has(k));
        if (!matchesFloor) return false;
        return this.matchesSideListSearchAndStatus(item);
      })
      .sort((a, b) => app.compareItemsBy(a, b, this.sideListSortKey, this.sideListSortOrder));

    if (this.sideListViewMode === "card") {
      MemberCardView.render(document.getElementById("mapSideCardContainer"), filteredItems, {
        groups: this.getFloorGroups().filter(g => this.sideListFloors.has(g.key)),
        getGroupKeys: item => this.getItemFloorKeys(item)
      });
    } else {
      this.renderSideListTable(filteredItems, SORT_NO, NOTE);
    }
  },

  renderSideListTable(rows, sortNoField, noteField) {
    const tbody = document.getElementById("mapSideListBody");
    if (!tbody) return;
    tbody.replaceChildren();

    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 4;
      td.style.textAlign = "center";
      td.style.color = "#64748b";
      td.style.padding = "18px 8px";
      td.textContent = "条件に一致するメンバーはいません";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    rows.forEach(item => {
      const tr = document.createElement("tr");
      tr.title = "クリックしてステータスを編集";
      tr.tabIndex = 0;
      const openModal = () => StatusModal.open(Number(item.Id), item.Title || "名前未設定");
      tr.addEventListener("click", openModal);
      tr.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openModal(); }
      });

      const noTd = document.createElement("td");
      const hasNo = item[sortNoField] !== undefined && item[sortNoField] !== null && String(item[sortNoField]).trim() !== "";
      noTd.textContent = hasNo ? item[sortNoField] : "—";

      const nameTd = document.createElement("td");
      const nameDiv = document.createElement("div");
      nameDiv.className = "side-list-name";
      nameDiv.textContent = item.Title || "（未設定）";
      nameTd.appendChild(nameDiv);
      if (item.Dept) {
        const deptDiv = document.createElement("div");
        deptDiv.className = "side-list-dept";
        deptDiv.textContent = item.Dept;
        nameTd.appendChild(deptDiv);
      }

      const statusTd = document.createElement("td");
      const status = item.Status ?? "";
      const stInfo = getStatusView(status);
      const pill = document.createElement("span");
      pill.className = `status-pill ${stInfo.pill}`;
      pill.textContent = status || "未入力";
      statusTd.appendChild(pill);

      const noteTd = document.createElement("td");
      noteTd.textContent = item[noteField] || "—";

      tr.append(noTd, nameTd, statusTd, noteTd);
      tbody.appendChild(tr);
    });
  },

  /* ===== ズーム・パン制御（フロア別解像度対応） ===== */
  initViewport() {
    this.viewport = document.getElementById("viewport");
    this.map = document.getElementById("floorMap");

    this.recalcFit();
    this.fit();

    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => {
        // 非表示(display:none)中はサイズ0で計算してしまうのでスキップ
        if (!this.viewport.clientWidth || !this.viewport.clientHeight) return;
        this.recalcFit();
        if (this.autoFit) this.fit(); else this.applyTransform();
      }).observe(this.viewport);
    }

    const vp = this.viewport;
    vp.addEventListener("pointerdown", e => this.onDown(e));
    vp.addEventListener("pointermove", e => this.onMove(e));
    vp.addEventListener("pointerup", e => this.onUp(e));
    vp.addEventListener("pointercancel", e => this.onUp(e, true));
    vp.addEventListener("wheel", e => this.onWheel(e), { passive: false });
    vp.addEventListener("keydown", e => this.onCardKeydown(e));
    // タッチのタップは、この click の時点でモーダルを開く（queueTapActivation）
    vp.addEventListener("click", () => { if (this.pendingTapCard) this.flushTapActivation(); });

    const fitBtn = document.getElementById("zoomFit");
    fitBtn.addEventListener("click", () => this.fit());
    fitBtn.addEventListener("pointerdown", e => e.stopPropagation());
    fitBtn.addEventListener("wheel", e => e.stopPropagation());
  },

  get minScale() { return this.fitScale; },
  get maxScale() { return Math.max(3, this.fitScale); },

  recalcFit() {
    const w = this.viewport.clientWidth;
    const h = this.viewport.clientHeight;
    const { width: mapW, height: mapH } = this.getCurrentMapSize();
    this.fitScale = Math.min(w / mapW, h / mapH) || 1;
  },

  fit() {
    this.autoFit = true;
    this.scale = this.fitScale;
    const { width: mapW, height: mapH } = this.getCurrentMapSize();
    this.tx = (this.viewport.clientWidth - mapW * this.scale) / 2;
    this.ty = (this.viewport.clientHeight - mapH * this.scale) / 2;
    this.applyTransform();
  },

  clampPan() {
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    const { width: mapW, height: mapH } = this.getCurrentMapSize();
    const mw = mapW * this.scale;
    const mh = mapH * this.scale;
    this.tx = mw <= vw ? (vw - mw) / 2 : Math.min(0, Math.max(vw - mw, this.tx));
    this.ty = mh <= vh ? (vh - mh) / 2 : Math.min(0, Math.max(vh - mh, this.ty));
  },

  applyTransform() {
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale));
    this.clampPan();
    this.map.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    document.getElementById("zoomFit").hidden = this.scale <= this.fitScale * 1.01;
  },

  zoomAt(newScale, px, py) {
    newScale = Math.min(this.maxScale, Math.max(this.minScale, newScale));
    const k = newScale / this.scale;
    this.tx = px - (px - this.tx) * k;
    this.ty = py - (py - this.ty) * k;
    this.scale = newScale;
    this.autoFit = false;
    this.applyTransform();
  },

  localPoint(e) {
    const r = this.viewport.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  },

  onWheel(e) {
    e.preventDefault();
    const p = this.localPoint(e);
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    this.zoomAt(this.scale * factor, p.x, p.y);
  },

  onDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    this.viewport.setPointerCapture(e.pointerId);
    const p = this.localPoint(e);
    this.pointers.set(e.pointerId, p);

    if (this.pointers.size === 1) {
      this.gesture = {
        type: "drag",
        startX: p.x, startY: p.y,
        tx0: this.tx, ty0: this.ty,
        moved: false,
        target: e.target
      };
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      this.gesture = {
        type: "pinch",
        dist0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        scale0: this.scale,
        mapX: (cx - this.tx) / this.scale,
        mapY: (cy - this.ty) / this.scale
      };
      this.autoFit = false;
    }
  },

  onMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.localPoint(e);
    this.pointers.set(e.pointerId, p);
    const g = this.gesture;
    if (!g) return;

    if (g.type === "pinch" && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      this.scale = Math.min(this.maxScale, Math.max(this.minScale, g.scale0 * dist / g.dist0));
      this.tx = cx - g.mapX * this.scale;
      this.ty = cy - g.mapY * this.scale;
      this.applyTransform();
    } else if (g.type === "drag") {
      const dx = p.x - g.startX;
      const dy = p.y - g.startY;
      const threshold = e.pointerType === "mouse" ? 4 : 10;
      if (!g.moved && Math.hypot(dx, dy) > threshold) {
        g.moved = true;
        this.autoFit = false;
        this.viewport.classList.add("dragging");
      }
      if (g.moved) {
        this.tx = g.tx0 + dx;
        this.ty = g.ty0 + dy;
        this.applyTransform();
      }
    }
  },

  onUp(e, canceled = false) {
    if (!this.pointers.has(e.pointerId)) return;
    const g = this.gesture;
    this.pointers.delete(e.pointerId);
    this.viewport.classList.remove("dragging");

    if (!canceled && g && g.type === "drag" && !g.moved && this.pointers.size === 0) {
      const card = g.target && g.target.closest && g.target.closest(".seat-card[data-id], .seat-card[data-empty-seat]");
      if (card) {
        if (e.pointerType === "mouse") {
          this.activateCard(card);
        } else {
          // タッチ：指を離した直後にブラウザが送る click が、開いたモーダル（背景やステータスボタン）に
          // 当たってしまうため、その click を待ってから開く（click が来ない端末向けに時間切れでも開く）
          this.queueTapActivation(card);
        }
      }
    }

    if (this.pointers.size === 0) {
      this.gesture = null;
    } else if (this.pointers.size === 1) {
      const [rest] = [...this.pointers.values()];
      this.gesture = {
        type: "drag",
        startX: rest.x, startY: rest.y,
        tx0: this.tx, ty0: this.ty,
        moved: true,
        target: null
      };
    }
  },

  queueTapActivation(card) {
    clearTimeout(this.pendingTapTimer);
    this.pendingTapCard = card;
    this.pendingTapTimer = setTimeout(() => this.flushTapActivation(), 450);
  },

  flushTapActivation() {
    clearTimeout(this.pendingTapTimer);
    const card = this.pendingTapCard;
    this.pendingTapCard = null;
    if (card && card.isConnected) this.activateCard(card);
  },

  activateCard(card) {
    if (card.dataset.emptySeat) { // 空席 → 席の割り当て（一括変更中は無視）
      if (!this.isBulkMode) SeatAssign.open(card.dataset.emptySeat);
      return;
    }
    const id = Number(card.dataset.id);
    if (this.isBulkMode) this.toggleCardSelect(id);
    else StatusModal.open(id, card.dataset.name);
  },

  onShow() {
    requestAnimationFrame(() => {
      this.recalcFit();
      if (this.autoFit) this.fit(); else this.applyTransform();
    });
  },

  /* ===== カードサイズ解決 ＆ 部署シンボル生成 ===== */
  resolveCardSize(pos) {
    const presets = CONFIG.CARD_SIZES || {};
    const defaultSize = presets.standard || { width: 150, height: 80 };
    const sizeKey = pos.size || pos.type || "standard";
    const preset = presets[sizeKey] || defaultSize;

    const width = Number(pos.width) > 0 ? Number(pos.width) : preset.width;
    const height = Number(pos.height) > 0 ? Number(pos.height) : preset.height;
    const isVertical = String(sizeKey).startsWith("vertical") || height > width;
    return { width, height, isVertical };
  },

  createDeptSymbolElement(deptName) {
    const dept = String(deptName || "").trim();
    if (!dept || !CONFIG.DEPT_SYMBOLS) return null;
    const def = CONFIG.DEPT_SYMBOLS[dept];
    if (!def) return null;

    const wrap = document.createElement("span");
    wrap.className = "seat-dept-symbol";
    wrap.title = `部署: ${dept}`;

    const isImgObj = typeof def === "object" && (def.type === "image" || def.image || (def.value && /\.(png|svg|jpe?g|gif|webp)$/i.test(def.value)));
    const isImgStr = typeof def === "string" && /\.(png|svg|jpe?g|gif|webp)$/i.test(def);

    if (isImgObj || isImgStr) {
      const src = typeof def === "string" ? def : (def.value || def.image || def.src || "");
      if (!src) return null;
      const img = document.createElement("img");
      img.className = "seat-dept-symbol-img";
      img.src = src;
      img.width = 16;
      img.height = 16;
      img.alt = dept;
      wrap.appendChild(img);
      return wrap;
    }

    const rawChar = typeof def === "string" ? def : (def.value || def.char || def.text || "");
    const firstChar = [...String(rawChar).trim()][0];
    if (!firstChar) return null;

    wrap.classList.add("seat-dept-symbol-char");
    if (typeof def === "object") {
      if (def.bg) wrap.style.backgroundColor = def.bg;
      if (def.color) wrap.style.color = def.color;
    }
    wrap.textContent = firstChar;
    return wrap;
  },

  /* ===== フロア切替・座席描画 ===== */
  renderFloorButtons() {
    const container = document.getElementById("floorSwitch");
    container.replaceChildren();
    CONFIG.FLOORS.forEach(floor => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = floor.name;
      btn.className = floor.id === this.currentFloorId ? "active" : "";
      btn.addEventListener("click", () => this.switchFloor(floor.id));
      container.appendChild(btn);
    });
    // 横スクロールで隠れている場合も、選択中のフロアが見える位置へ
    const active = container.querySelector("button.active");
    if (active && container.scrollWidth > container.clientWidth) {
      const left = active.offsetLeft - container.offsetLeft;
      if (left < container.scrollLeft || left + active.offsetWidth > container.scrollLeft + container.clientWidth) {
        container.scrollLeft = left - 8;
      }
    }
  },

  // 状態だけ更新（描画しない）。他画面表示中でも安全に呼べる
  setFloor(floorId) {
    const floor = CONFIG.FLOORS.find(f => f.id === floorId);
    if (!floor) return false;
    this.currentFloorId = floorId;
    app.saveCache(CONFIG.CACHE_KEYS.floor, floorId);
    this.renderFloorButtons();
    return true;
  },

  switchFloor(floorId) {
    if (!this.setFloor(floorId)) return;
    if (app.currentView !== "map") return; // 他画面表示中は描画しない（マップ表示時に反映される）
    this.render();
    this.recalcFit();
    if (this.autoFit) this.fit(); else this.applyTransform();
  },

  render() {
    const container = document.getElementById("floorMap");
    // 再描画でフォーカスが失われないよう、描画前にフォーカス中の座席を覚えておく
    const focusedSeat = container.contains(document.activeElement)
      ? document.activeElement.dataset.seat : null;
    const currentFloor = CONFIG.FLOORS.find(f => f.id === this.currentFloorId) || CONFIG.FLOORS[0];
    const { width: mapW, height: mapH } = this.getCurrentMapSize();

    container.style.width = `${mapW}px`;
    container.style.height = `${mapH}px`;
    container.style.backgroundImage = `url("${String(currentFloor.image).replace(/["\\]/g, "\\$&")}")`;

    const seatMap = {};
    app.items.forEach(item => {
      app.parseSeats(item.Seat).forEach(seatNo => {
        seatMap[seatNo] = item;
      });
    });

    const frag = document.createDocumentFragment();
    const floorSeats = currentFloor.seats || {};
    const { NOTE, SCHEDULE } = CONFIG.FIELDS;

    Object.keys(floorSeats).forEach(seatNo => {
      const pos = floorSeats[seatNo];
      const user = seatMap[seatNo];
      const { width, height, isVertical } = this.resolveCardSize(pos);

      const card = document.createElement("div");
      card.style.left = `${pos.left}px`;
      card.style.top = `${pos.top}px`;
      card.style.width = `${width}px`;
      card.style.height = `${height}px`;
      card.dataset.seat = seatNo;

      const header = document.createElement("div");
      header.className = "seat-header";
      const no = document.createElement("span");
      no.className = "seat-no";
      no.textContent = seatNo;
      header.appendChild(no);

      const name = document.createElement("div");
      name.className = "seat-name";

      if (!user) {
        card.className = "seat-card seat-empty";
        if (isVertical) card.classList.add("seat-card-vertical");
        name.textContent = "(空席)";
        name.style.color = "#aaa";
        name.style.fontSize = "13px";
        if (SeatAssign.isEnabled() && !this.isBulkMode) {
          card.classList.add("seat-assignable");
          card.dataset.emptySeat = seatNo;
          card.tabIndex = 0;
          card.setAttribute("role", "button");
          card.title = `${seatNo}：空席（クリックして席を割り当て）`;
        }
        card.append(header, name);
      } else {
        const statusKey = user.Status ?? "";
        const viewInfo = getStatusView(statusKey);
        card.className = `seat-card ${viewInfo.cls}`;
        card.tabIndex = 0;
        card.setAttribute("role", "button");
        if (isVertical) card.classList.add("seat-card-vertical");
        if (this.isBulkMode) card.classList.add("selecting");
        const isSelected = this.selectedIds.has(Number(user.Id));
        if (isSelected) card.classList.add("selected");
        if (this.isBulkMode) card.setAttribute("aria-pressed", String(isSelected));
        card.dataset.id = user.Id;
        card.dataset.name = user.Title || "";

        const allUserSeats = app.parseSeats(user.Seat);
        const seatLabel = allUserSeats.length > 1 ? `${seatNo} (他: ${allUserSeats.filter(s => s !== seatNo).join(", ")})` : seatNo;
        const sched = app.parseSchedule(user[SCHEDULE]);
        const schedStatusName = sched ? (sched.status || "未入力") : "";
        const schedText = sched ? ` ／ 次回予約: ${DateUtils.formatSchedule(sched)} ${schedStatusName}${sched.note ? `(${sched.note})` : ""}` : "";
        const deptLabel = user.Dept ? ` [${user.Dept}]` : "";
        card.title = `${seatLabel}${deptLabel}：クリックして編集${schedText}`;

        const deptSymbolEl = this.createDeptSymbolElement(user.Dept);
        if (deptSymbolEl) card.appendChild(deptSymbolEl);

        if (sched && !this.isBulkMode) {
          const mark = document.createElement("span");
          mark.className = "seat-sched-mark";
          mark.appendChild(Icons.create("calendar"));
          card.appendChild(mark);
        }

        name.textContent = user.Title || "";
        const note = document.createElement("div");
        note.className = "seat-note";
        note.textContent = user[NOTE] || "";

        const top = document.createElement("div");
        top.className = "seat-top-group";
        top.append(name, note);

        const st = document.createElement("div");
        st.className = "seat-status";
        if (viewInfo.label) Icons.setStatusLabel(st, statusKey, viewInfo.label);

        card.append(top, st);
      }
      frag.appendChild(card);
    });

    container.replaceChildren(frag);
    this.fitAllNotes(container.querySelectorAll(".seat-note"));
    if (focusedSeat) {
      const again = container.querySelector(`.seat-card[data-seat="${CSS.escape(focusedSeat)}"]`);
      if (again) again.focus({ preventScroll: true });
    }
    this.renderSideList();
  },

  // 備考の文字サイズ自動調整。
  // 1要素ごとに「書く→読む」を繰り返すと強制リフローが連発するため、
  // 全要素を「まとめて書く → まとめて読む → まとめて書く」の形にする。
  fitAllNotes(nodeList, base = 11, min = 6) {
    let pending = [...nodeList].filter(el => el.textContent);
    pending.forEach(el => { el.style.fontSize = `${base}px`; });   // 書く
    let size = base;
    while (pending.length && size > min) {
      pending = pending.filter(el => el.scrollWidth > el.clientWidth); // 読む（まとめて）
      size -= 0.5;
      pending.forEach(el => { el.style.fontSize = `${size}px`; });     // 書く（まとめて）
    }
  },

  // 現在のマップ上でキー操作された座席カードの処理
  onCardKeydown(e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest && e.target.closest(".seat-card[data-id], .seat-card[data-empty-seat]");
    if (!card || card !== e.target) return;
    e.preventDefault();
    this.activateCard(card);
  },

  jumpToSeat(seatNo) {
    const info = ALL_SEATS_MAP[seatNo];
    if (!info) return;
    this.setFloor(info.floorId);
    app.switchView("map"); // マップ表示時に1回だけ描画される

    requestAnimationFrame(() => {
      this.fit();
      const card = document.querySelector(`.seat-card[data-seat="${CSS.escape(seatNo)}"]`);
      if (!card) return;
      document.querySelectorAll(".seat-card.highlight-jump").forEach(el => el.classList.remove("highlight-jump"));
      card.classList.add("highlight-jump");
      if (this.highlightTimer) clearTimeout(this.highlightTimer);
      this.highlightTimer = setTimeout(() => card.classList.remove("highlight-jump"), 1800);
    });
  },

  /* ===== 一括ステータス・備考変更制御 ===== */
  selectBulkStatus(status) {
    if (!isValidStatus(status)) return;
    this.bulkSelectedStatus = status;
    app.saveCache(CONFIG.CACHE_KEYS.bulkStatus, status);
    this.updateBulkStatusButtonsUI();
  },

  updateBulkStatusButtonsUI() {
    document.querySelectorAll(".bulk-status-btn").forEach(btn => {
      const on = btn.dataset.bulkStatus === this.bulkSelectedStatus;
      btn.classList.toggle("selected", on);
      btn.setAttribute("aria-pressed", String(on));
    });
  },

  toggleBulkMode(force) {
    this.isBulkMode = typeof force === "boolean" ? force : !this.isBulkMode;
    this.selectedIds.clear();
    document.getElementById("bulkActionBar").classList.toggle("active", this.isBulkMode);
    const btn = document.getElementById("bulkModeBtn");
    Icons.setLabel(btn, this.isBulkMode ? "close" : "bulk", this.isBulkMode ? "一括モード終了" : "一括ステータス変更");
    btn.classList.toggle("btn-active-mode", this.isBulkMode);
    this.updateBulkStatusButtonsUI();
    this.updateBulkSelectionCount();
    this.render();
  },

  toggleCardSelect(id) {
    id = Number(id);
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
    document.querySelectorAll(`.seat-card[data-id="${id}"]`).forEach(card => {
      const on = this.selectedIds.has(id);
      card.classList.toggle("selected", on);
      card.setAttribute("aria-pressed", String(on));
    });
    this.updateBulkSelectionCount();
  },

  updateBulkSelectionCount() {
    document.getElementById("bulkSelectionCount").textContent =
      this.selectedIds.size ? `${this.selectedIds.size}名を選択中` : "座席カードをクリックして対象者を選択してください";
  },

  async executeBulkUpdate() {
    if (!this.selectedIds.size) {
      alert("座席カードをクリックして対象のメンバーを選択してください。");
      return;
    }
    const newStatus = this.bulkSelectedStatus;
    if (!isValidStatus(newStatus)) {
      alert("変更先のステータスを選択してください。");
      return;
    }

    const includeNote = document.getElementById("bulkNoteCheck").checked;
    const noteText = document.getElementById("bulkNoteInput").value.trim();
    if (includeNote && [...noteText].length > CONFIG.NOTE_MAX) {
      alert(`備考は${CONFIG.NOTE_MAX}文字以内で入力してください。`);
      return;
    }

    const fields = { Status: newStatus };
    if (includeNote) fields[CONFIG.FIELDS.NOTE] = noteText;

    const ids = [...this.selectedIds];
    const statusLabel = newStatus === STATUS.NONE ? "未入力" : newStatus;
    const msg = includeNote
      ? `選択した ${ids.length} 名を「${statusLabel}」（備考: ${noteText || "空欄クリア"}）に変更しますか？`
      : `選択した ${ids.length} 名のステータスを「${statusLabel}」に変更しますか？`;

    if (!confirm(msg)) return;

    // 画面にはすぐ反映し、送信は SaveQueue が裏で行う（同時5件まで・失敗時は自動再送のうえ通知）
    ids.forEach(id => SaveQueue.enqueue(id, fields));
    this.toggleBulkMode(false); // 中で再描画される
    app.toast(`${ids.length}名のステータスを変更しました`);
  }
};