/* =====================================================================
 * 画面内アイコン（Lucide v1.70.0 / ISC License）
 * 外部CDNを使わず、このファイルにSVGを直接埋め込んでいます（SharePointの外部読込制限でも表示される）。
 * ライセンス表記: THIRD_PARTY_NOTICES.txt
 *
 * 使い方:
 *   HTML … <i class="ic" data-icon="map"></i> と書くと、読み込み時にSVGへ置き換わる
 *   JS   … Icons.setLabel(button, "map", "座席表") でアイコン＋文字に差し替える
 * 色は文字色（currentColor）、大きさは CSS の .ic（既定 1.15em）で変わります。
 * ===================================================================== */
const Icons = {
  paths: {
    map: '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"/><path d="M15 5.764v15"/><path d="M9 3.236v15"/>', // lucide: map
    list: '<path d="M3 5h.01"/><path d="M3 12h.01"/><path d="M3 19h.01"/><path d="M8 5h13"/><path d="M8 12h13"/><path d="M8 19h13"/>', // lucide: list
    chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>', // lucide: chart-column
    me: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>', // lucide: user-round
    settings: '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>', // lucide: settings
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>', // lucide: refresh-cw
    search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>', // lucide: search
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', // lucide: x
    calendar: '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>', // lucide: calendar
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>', // lucide: clock
    pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>', // lucide: map-pin
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>', // lucide: link
    group: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>', // lucide: users
    card: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>', // lucide: layout-grid
    bulk: '<path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/>', // lucide: list-checks
    width: '<path d="m18 8 4 4-4 4"/><path d="M2 12h20"/><path d="m6 8-4 4 4 4"/>', // lucide: move-horizontal
    save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>', // lucide: save
    warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>', // lucide: triangle-alert
    check: '<path d="M20 6 9 17l-5-5"/>', // lucide: check
    sidepanel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>', // lucide: panel-right
    logout: '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>', // lucide: log-out
  },

  // SVG要素を作る（未登録の名前は空のspan）
  create(name, extraClass) {
    const body = this.paths[name];
    if (!body) return document.createElement("span");
    const tpl = document.createElement("template");
    tpl.innerHTML = '<svg class="ic' + (extraClass ? " " + extraClass : "") + '" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + "</svg>";
    return tpl.content.firstChild;
  },

  // 要素の中身を「アイコン＋文字」にする（文字は textContent 扱いなので安全）
  setLabel(el, name, text) {
    if (!el) return;
    const parts = [this.create(name)];
    if (text != null && text !== "") {
      const span = document.createElement("span");
      span.className = "ic-text";
      span.textContent = text;
      parts.push(span);
    }
    el.replaceChildren(...parts);
  },

  // ステータスの色の丸（絵文字の代わり。OSによらず同じ色・形で表示される）
  statusDot(status) {
    const dot = document.createElement("span");
    dot.className = `status-dot dot-${getStatusView(status).pill}`;
    dot.setAttribute("aria-hidden", "true");
    return dot;
  },

  // 要素の中身を「色の丸＋ステータス名」にする
  setStatusLabel(el, status, text) {
    if (!el) return;
    const span = document.createElement("span");
    span.textContent = text ?? (status || "未入力");
    el.replaceChildren(this.statusDot(status), span);
  },

  // <i class="ic" data-icon="..."></i> をSVGに置き換える
  hydrate(root) {
    (root || document).querySelectorAll("i.ic[data-icon]").forEach(i => {
      const svg = this.create(i.dataset.icon, i.className.replace(/ic/, "").trim());
      i.replaceWith(svg);
    });
  }
};

// icons.js は body 末尾で読み込むため、この時点で HTML は解析済み
Icons.hydrate();
