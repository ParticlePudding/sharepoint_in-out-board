"use strict";

/* ===================== 非同期ユーティリティ ===================== */
const AsyncUtil = {
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  // items を最大 limit 並列で worker に渡す。Promise.allSettled と同形式の配列を返す
  async runLimited(items, worker, limit = 5) {
    const results = new Array(items.length);
    let next = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        try {
          results[i] = { status: "fulfilled", value: await worker(items[i], i) };
        } catch (reason) {
          results[i] = { status: "rejected", reason };
        }
      }
    });
    await Promise.all(runners);
    return results;
  }
};

/* ===================== SharePoint REST ラッパー ===================== */
const spApi = {
  mockItems: null,
  mockSettings: null,
  _digest: null,
  _digestExpiresAt: 0,
  _digestPromise: null,   // 取得中の Digest（同時に何件保存しても contextinfo は1回だけ）

  get baseUrl() {
    return `${CONFIG.SITE_URL}/_api/web/lists/getbytitle('${encodeURIComponent(CONFIG.LIST_NAME)}')/items`;
  },

  get settingsUrl() {
    return `${CONFIG.SITE_URL}/_api/web/lists/getbytitle('${encodeURIComponent(CONFIG.SETTINGS_LIST_NAME)}')/items`;
  },

  /* ----- モックデータ ----- */
  ensureMockData() {
    if (!this.mockItems) {
      const { QUICK_NOTES } = CONFIG.FIELDS;
      const samples = typeof SAMPLE_ITEMS !== "undefined" ? SAMPLE_ITEMS : [];
      this.mockItems = JSON.parse(JSON.stringify(samples)).map(item => ({
        ...item,
        [QUICK_NOTES]: item[QUICK_NOTES] || JSON.stringify(CONFIG.DEFAULT_QUICK_NOTES)
      }));
    }
    return this.mockItems;
  },

  ensureMockSettings() {
    if (!this.mockSettings) {
      const groups = typeof SAMPLE_STATS_GROUPS !== "undefined" ? SAMPLE_STATS_GROUPS : [];
      this.mockSettings = {
        [CONFIG.SETTINGS_KEYS.STATS_GROUPS]: { id: 1, value: JSON.stringify(groups), version: 1 }
      };
    }
    return this.mockSettings;
  },

  /* ----- 通信共通処理 ----- */
  async fetchWithTimeout(url, options) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.HTTP_TIMEOUT_MS);
    try {
      return await fetch(url, { ...options, signal: ctrl.signal });
    } catch (err) {
      if (err && err.name === "AbortError") throw new Error(`通信タイムアウト: ${url}`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  },

  // 429/503（SharePointのスロットリング）は Retry-After に従って少し待って再試行
  async request(url, options = {}, attempt = 0) {
    const res = await this.fetchWithTimeout(url, options);
    if ((res.status === 429 || res.status === 503) && attempt < CONFIG.HTTP_MAX_RETRY) {
      const retryAfter = Number(res.headers.get("Retry-After"));
      const base = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
      await AsyncUtil.sleep(Math.min(base, 15000) + Math.random() * 500);
      return this.request(url, options, attempt + 1);
    }
    return res;
  },

  async buildError(res, label, url) {
    let body = "";
    try { body = (await res.text()).slice(0, 200); } catch (e) { /* 無視 */ }
    const err = new Error(`${label}失敗 (${res.status}): ${url} ${body}`.trim());
    err.status = res.status;
    return err;
  },

  async fetchJson(url, accept = "application/json;odata=nometadata") {
    const res = await this.request(url, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Accept": accept }
    });
    if (!res.ok) throw await this.buildError(res, "GET", url);
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("json")) {
      // セッション切れ時はログインページ(HTML)が返ることがある
      const err = new Error("JSON以外の応答です（認証切れの可能性）。ページを再読み込みしてください。");
      err.status = 401;
      throw err;
    }
    return await res.json();
  },

  // FormDigestValue（有効期限まで再利用して通信量を半減）
  async getDigest(force = false) {
    if (!force && this._digest && Date.now() < this._digestExpiresAt) return this._digest;
    if (!force && this._digestPromise) return this._digestPromise;
    this._digestPromise = this.fetchDigest().finally(() => { this._digestPromise = null; });
    return this._digestPromise;
  },

  async fetchDigest() {
    const res = await this.request(`${CONFIG.SITE_URL}/_api/contextinfo`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Accept": "application/json;odata=nometadata" }
    });
    if (!res.ok) throw await this.buildError(res, "contextinfo取得", `${CONFIG.SITE_URL}/_api/contextinfo`);
    const data = await res.json();
    const ttl = Number(data.FormDigestTimeoutSeconds) || 1800;
    this._digest = data.FormDigestValue;
    this._digestExpiresAt = Date.now() + Math.max(30, ttl - 60) * 1000;
    return this._digest;
  },

  // 更新系リクエスト（POST / MERGE / DELETE）共通ヘルパー。Digest失効(403)時は1回だけ取り直して再試行
  // keepalive: ページを閉じる直前の送信でも途中で止められないようにする
  async sendWithDigest(url, extraHeaders = {}, bodyObj = null, { keepalive = false } = {}) {
    const send = async forceDigest => {
      const headers = {
        "Accept": "application/json;odata=nometadata",
        "X-RequestDigest": await this.getDigest(forceDigest),
        ...extraHeaders
      };
      const options = { method: "POST", credentials: "same-origin", headers, keepalive };
      if (bodyObj !== null) {
        headers["Content-Type"] = "application/json;odata=nometadata";
        options.body = JSON.stringify(bodyObj);
      }
      return this.request(url, options);
    };

    let res = await send(false);
    if (res.status === 403) {
      this._digest = null;
      res = await send(true);
    }
    if (!res.ok) throw await this.buildError(res, "更新", url);
    return res;
  },

  /* ----- 一覧取得（Id でページングし、501件目以降の欠落を防ぐ） ----- */
  async fetchAllPaged(selectFields) {
    const PAGE_SIZE = 500;
    const MAX_PAGES = 100;
    const all = [];
    let lastId = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      let query = `$filter=Id gt ${lastId}&$orderby=Id&$top=${PAGE_SIZE}`;
      if (selectFields) query += `&$select=${selectFields}`;
      const data = await this.fetchJson(`${this.baseUrl}?${query}`);
      const rows = data.value || [];
      for (const row of rows) all.push(row);
      if (rows.length < PAGE_SIZE) break;
      lastId = rows.reduce((max, r) => Math.max(max, Number(r.Id) || 0), lastId);
    }
    return all;
  },

  // 【起動時・手動更新・サイネージ周期用】全列データを取得
  async getAllFull() {
    if (CONFIG.USE_MOCK_DATA) {
      await this.mockDelay();
      return JSON.parse(JSON.stringify(this.ensureMockData()));
    }
    return await this.fetchAllPaged(null);
  },

  // 【定周期更新用（通信量節約）】ID・ステータス・備考・予定予約のみを軽量取得
  // （予定予約も含める：他の人が入れた予約がリストの「次回予約」に出ないままにならないように）
  async getFrequentOnly() {
    const { NOTE, SCHEDULE } = CONFIG.FIELDS;
    if (CONFIG.USE_MOCK_DATA) {
      await this.mockDelay();
      return this.ensureMockData().map(i => ({ Id: i.Id, Status: i.Status, [NOTE]: i[NOTE], [SCHEDULE]: i[SCHEDULE], Seat: i.Seat }));
    }
    return await this.fetchAllPaged(`Id,Status,${NOTE},${SCHEDULE},Seat`);
  },

  // 【開発用】モックでも通信の遅さを再現する（?mockdelay=ミリ秒）。本番では使われない
  mockDelay() {
    const m = /[?&]mockdelay=(\d+)/.exec(location.search);
    return m ? AsyncUtil.sleep(Math.min(Number(m[1]), 30000)) : Promise.resolve();
  },

  // 【予約反映用】指定ユーザーの最新の予約のみを取得（複数サイネージの二重反映防止）
  async getItemSchedule(id) {
    const field = CONFIG.FIELDS.SCHEDULE;
    if (CONFIG.USE_MOCK_DATA) {
      const item = this.ensureMockData().find(i => Number(i.Id) === Number(id));
      return item ? { Id: item.Id, [field]: item[field] } : null;
    }
    try {
      return await this.fetchJson(`${this.baseUrl}(${id})?$select=Id,${field}`);
    } catch (err) {
      if (err.status === 404) return null; // 既に削除済み
      throw err;
    }
  },

  /* ----- メンバー CRUD ----- */
  async create(item) {
    if (CONFIG.USE_MOCK_DATA) {
      const list = this.ensureMockData();
      const nextId = list.reduce((max, x) => Math.max(max, Number(x.Id) || 0), 0) + 1;
      list.push({ Id: nextId, ...item });
      return;
    }
    await this.sendWithDigest(this.baseUrl, {}, item);
  },

  async update(id, fields, { keepalive = false } = {}) {
    if (CONFIG.USE_MOCK_DATA) {
      await this.mockDelay();
      if (/[?&]mockfail=1(&|$)/.test(location.search)) {
        const err = new Error("モック: 保存失敗のテスト");
        err.status = 500;
        throw err;
      }
      const target = this.ensureMockData().find(i => Number(i.Id) === Number(id));
      if (!target) {
        const err = new Error(`対象が存在しません (Id=${id})`);
        err.status = 404;
        throw err;
      }
      Object.assign(target, fields);
      return;
    }
    await this.sendWithDigest(
      `${this.baseUrl}(${id})`,
      { "IF-Match": "*", "X-HTTP-Method": "MERGE" },
      fields,
      { keepalive }
    );
  },

  async remove(id) {
    if (CONFIG.USE_MOCK_DATA) {
      this.mockItems = this.ensureMockData().filter(i => Number(i.Id) !== Number(id));
      return;
    }
    await this.sendWithDigest(
      `${this.baseUrl}(${id})`,
      { "IF-Match": "*", "X-HTTP-Method": "DELETE" }
    );
  },

  /* ===================== 全ユーザー共通設定（AppSettings リスト） =====================
   * 1キー=1行。社員レコードとは独立しているため、メンバー削除の影響を受けない。
   * 楽観ロック: 取得時の ETag を If-Match に付けて更新し、他ユーザーが先に保存していれば 412 になる。
   */
  async getSetting(key) {
    if (CONFIG.USE_MOCK_DATA) {
      const s = this.ensureMockSettings()[key];
      return s ? { id: s.id, value: s.value, etag: String(s.version) } : { id: null, value: null, etag: null };
    }
    const safeKey = String(key).replace(/'/g, "''");
    const url = `${this.settingsUrl}?$filter=${encodeURIComponent(`Title eq '${safeKey}'`)}&$select=Id,Title,Value&$top=1`;
    // etag を得るため minimalmetadata で取得する
    const data = await this.fetchJson(url, "application/json;odata=minimalmetadata");
    const row = (data.value || [])[0];
    if (!row) return { id: null, value: null, etag: null };
    return { id: row.Id, value: row.Value ?? null, etag: row["odata.etag"] || row["@odata.etag"] || null };
  },

  // current: getSetting の戻り値。保存後の最新状態を返す
  async saveSetting(key, value, current) {
    if (CONFIG.USE_MOCK_DATA) {
      const store = this.ensureMockSettings();
      const s = store[key];
      if (s && current && current.etag !== null && String(s.version) !== String(current.etag)) {
        const err = new Error("他のユーザーが先に更新しました");
        err.status = 412;
        throw err;
      }
      if (s) { s.value = value; s.version += 1; }
      else store[key] = { id: Object.keys(store).length + 1, value, version: 1 };
      return await this.getSetting(key);
    }
    if (current && current.id) {
      await this.sendWithDigest(
        `${this.settingsUrl}(${current.id})`,
        { "IF-Match": current.etag || "*", "X-HTTP-Method": "MERGE" },
        { Value: value }
      );
    } else {
      await this.sendWithDigest(this.settingsUrl, {}, { Title: key, Value: value });
    }
    return await this.getSetting(key);
  }
};
