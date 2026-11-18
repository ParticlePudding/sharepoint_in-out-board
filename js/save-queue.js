"use strict";

/* =====================================================================
 * 裏で送る保存キュー（画面を通信待ちで止めない）
 *
 * - 画面の操作はすぐ手元のデータ（app.items）に反映し、サーバーへの送信は裏で行う（楽観的更新）。
 * - 同じ人への変更は1回の送信にまとめる。
 *   ステータス画面を開いている人の変更は、画面を閉じるまで送信を待ってまとめる
 *   （例: 備考を保存 → 定型文を登録 → ステータスを押して閉じる ＝ 送信は1回）。
 *   ただし開いたまま SAVE_HOLD_MAX_MS 経つと、その時点の内容を送る。
 * - 送信中に同じ人の変更が来たら、送信が終わってから続けて送る（順番どおり＝最後の操作が勝つ）。
 * - 定期更新（ポーリング）で取り直したデータには、まだ届いていない変更を上書きし直す（表示が一瞬戻るのを防ぐ）。
 * - 失敗したら少し待って自動で再送。
 *   通信できない失敗（通信断・タイムアウト・5xx）は変更を捨てずに送り直し続け、「未保存の変更あり」を表示する。
 *   通信が戻れば（online イベント）すぐ送る。
 *   送り直しても通らない失敗（権限など 4xx）と削除済みは、通知してサーバーの内容を取り直す。
 * - 未送信のままページを閉じようとしたら、すぐ送信して、ブラウザの確認を出す。
 * ===================================================================== */
const SaveQueue = {
  pending: new Map(),   // Id → まだ送っていない変更 { 列名: 値 }（後から来た値で上書き＝まとめて1回）
  inflight: new Map(),  // Id → 送信中の変更
  retries: new Map(),   // Id → 再送回数
  holdId: null,         // ステータス画面で開いている人の Id（閉じるまで送信を待つ）
  _holdTimer: null,
  _flushTimer: null,
  _indicatorTimer: null,
  _failedNames: [],
  _failToastTimer: null,

  init() {
    // 通信が戻ったら、送れずに残っている変更をすぐ送る
    window.addEventListener("online", () => this.flush({ includeHeld: true }));
    // ページを閉じる・再読み込みする時: 未送信があればすぐ送り、ブラウザの確認を出す
    window.addEventListener("beforeunload", e => {
      if (!this.hasUnsent()) return;
      this.flush({ includeHeld: true, keepalive: true });
      e.preventDefault();
      e.returnValue = "";
    });
    // スマホでアプリを切り替えた時などは、待たずに送る（そのまま閉じられることがあるため）
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.flush({ includeHeld: true });
    });
  },

  // 変更を登録（画面にはすぐ反映）。戻り値なし：結果は待たない
  enqueue(id, fields) {
    id = Number(id);
    this.pending.set(id, { ...(this.pending.get(id) || {}), ...fields });
    this.applyLocal(id, fields);
    if (id === this.holdId) this.armHoldTimer();
    else this.scheduleFlush();
    this.updateIndicator();
  },

  applyLocal(id, fields) {
    const item = app.items.find(i => Number(i.Id) === id);
    if (item) Object.assign(item, fields);
  },

  // サーバーから取り直したデータに、まだ届いていない変更（送信中→未送信の順）を重ねる
  overlay(items) {
    if (!this.hasUnsent()) return;
    const byId = new Map(items.map(i => [Number(i.Id), i]));
    [this.inflight, this.pending].forEach(map => {
      map.forEach((fields, id) => {
        const item = byId.get(id);
        if (item) Object.assign(item, fields);
      });
    });
  },

  hasUnsent() {
    return this.pending.size > 0 || this.inflight.size > 0;
  },

  /* ----- ステータス画面との連携（開いている間はまとめる） ----- */
  hold(id) {
    if (this.holdId !== null && this.holdId !== Number(id)) this.release(this.holdId);
    this.holdId = Number(id);
  },

  release(id) {
    if (this.holdId !== Number(id)) return;
    this.holdId = null;
    clearTimeout(this._holdTimer);
    this._holdTimer = null;
    this.scheduleFlush();
  },

  // 開いたまま放置されても、一定時間で送る（他の人の画面に反映されないままにならないように）
  armHoldTimer() {
    if (this._holdTimer) return;
    this._holdTimer = setTimeout(() => {
      this._holdTimer = null;
      this.flush({ includeHeld: true });
    }, CONFIG.SAVE_HOLD_MAX_MS);
  },

  /* ----- 送信 ----- */
  scheduleFlush(delay = 0) {
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this.flush();
    }, delay);
  },

  async flush({ includeHeld = false, keepalive = false } = {}) {
    const ids = [...this.pending.keys()].filter(id =>
      !this.inflight.has(id) && (includeHeld || id !== this.holdId));
    if (!ids.length) return;
    // SharePoint のスロットリング対策で同時送信数を絞る
    await AsyncUtil.runLimited(ids, id => this.send(id, keepalive), CONFIG.WRITE_CONCURRENCY);
  },

  async send(id, keepalive) {
    const fields = this.pending.get(id);
    if (!fields || this.inflight.has(id)) return;
    this.pending.delete(id);
    this.inflight.set(id, fields);
    this.updateIndicator();
    let retryDelay = 0;
    try {
      await spApi.update(id, fields, { keepalive });
      const wasWaiting = this.isWaitingForNetwork(id);
      this.retries.delete(id);
      if (wasWaiting && !this.hasWaitingForNetwork()) app.toast("通信が戻り、未送信だった変更を保存しました");
    } catch (err) {
      console.error("保存エラー:", id, err);
      const name = this.nameOf(id);
      if (err && err.status === 404) {
        this.retries.delete(id);
        this.reportFailure(name, "deleted");
      } else if (this.isRetryable(err)) {
        // 通信できない・サーバーが一時的に応答しない → 変更を捨てずに送り直し続ける
        // （その後に入力された変更のほうを優先）
        const n = (this.retries.get(id) || 0) + 1;
        this.retries.set(id, n);
        this.pending.set(id, { ...fields, ...(this.pending.get(id) || {}) });
        retryDelay = Math.min(CONFIG.SAVE_RETRY_INTERVAL_MAX_MS, 2000 * 2 ** (n - 1));
        if (n === CONFIG.SAVE_RETRY_MAX + 1) this.reportFailure(name, "waiting");
      } else {
        // 権限がない・入力が受け付けられないなど、送り直しても通らない失敗
        this.retries.delete(id);
        this.reportFailure(name, "rejected");
      }
    } finally {
      this.inflight.delete(id);
      this.updateIndicator();
      if (retryDelay) {
        setTimeout(() => this.flush({ includeHeld: true }), retryDelay);
      } else if (this.pending.has(id) && id !== this.holdId) {
        this.scheduleFlush(); // 送信中に入った変更を続けて送る
      }
    }
  },

  // 時間をおけば通る見込みのある失敗か（通信断・タイムアウト・サーバーの一時的なエラー）
  isRetryable(err) {
    const status = err && err.status;
    return !status || status === 408 || status === 429 || status >= 500;
  },

  // 自動再送を使い切っても通信できず、通信の回復を待っている変更か
  isWaitingForNetwork(id) {
    return (this.retries.get(id) || 0) > CONFIG.SAVE_RETRY_MAX;
  },

  hasWaitingForNetwork() {
    return [...this.retries.keys()].some(id => this.isWaitingForNetwork(id));
  },

  nameOf(id) {
    const item = app.items.find(i => Number(i.Id) === Number(id));
    return item && item.Title ? `${item.Title}さん` : `Id ${id}`;
  },

  /* 失敗は少しまとめて1回だけ通知する。kind:
   *  - "waiting"  … 通信できない。変更は残して自動で送り直す（表示は入力した内容のまま）
   *  - "deleted"  … その人は削除されている。変更は捨てて取り直す
   *  - "rejected" … 送り直しても通らない（権限など）。変更は捨てて、サーバーの内容に戻す */
  reportFailure(name, kind) {
    this._failedNames.push({ name, kind });
    clearTimeout(this._failToastTimer);
    this._failToastTimer = setTimeout(() => {
      const entries = this._failedNames;
      this._failedNames = [];
      const whoOf = list => {
        const names = list.map(e => e.name);
        return names.length > 2 ? `${names.slice(0, 2).join("・")} ほか${names.length - 2}名` : names.join("・");
      };
      const waiting = entries.filter(e => e.kind === "waiting");
      const deleted = entries.filter(e => e.kind === "deleted");
      const rejected = entries.filter(e => e.kind === "rejected");
      const messages = [];
      if (waiting.length) messages.push(`通信できないため、まだ保存されていません（${whoOf(waiting)}）。通信が戻ると自動で保存します。ページは閉じないでください。`);
      if (deleted.length) messages.push(`削除されたメンバーのため保存できませんでした（${whoOf(deleted)}）。`);
      if (rejected.length) messages.push(`保存できませんでした（${whoOf(rejected)}）。権限がないか、受け付けられない内容です。表示を最新の状態に戻しました。`);
      app.toast(messages.join(" "), true);
      if (deleted.length || rejected.length) app.refreshAll();
    }, 300);
  },

  // 送信が少し長引いた時だけ「送信中…」を表示（すぐ終わる時はチラつかせない）。
  // 通信の回復を待っている変更がある間は「未保存」をずっと表示する
  updateIndicator() {
    const el = document.getElementById("syncIndicator");
    if (!el) return;
    clearTimeout(this._indicatorTimer);
    if (this.hasWaitingForNetwork() && this.hasUnsent()) {
      el.textContent = "未保存の変更あり（通信が戻ると自動で保存）";
      el.classList.add("waiting");
      el.hidden = false;
      return;
    }
    el.textContent = "送信中…";
    el.classList.remove("waiting");
    const sending = this.inflight.size > 0 ||
      [...this.pending.keys()].some(id => id !== this.holdId);
    if (sending) {
      this._indicatorTimer = setTimeout(() => { el.hidden = false; }, 600);
    } else {
      el.hidden = true;
    }
  }
};
