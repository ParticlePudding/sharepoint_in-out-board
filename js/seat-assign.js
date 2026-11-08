"use strict";

/* ===================== 席の割り当て（フリーアドレス向け） =====================
 * 座席表の空席を押すと「席を割り当て」画面を開き、選んだ人をその席に座らせる。
 * すでに席がある人は、その席から「移動」するか、席を「追加」するかを選ぶ。
 * 割り当て後は、その人のステータス画面を開く（そのまま「出勤」などを押せるように）。
 * 解除はステータス画面上部の「席を解除」ボタン（modal-status.js）。
 * CONFIG.SEAT_ASSIGN_ENABLED が false なら、空席は押せない。
 */
const SeatAssign = {
  seatNo: null,

  init() {
    document.getElementById("seatAssignClose").addEventListener("click", () => this.close());
    app.bindBackdropClose(document.getElementById("seatAssignModal"), () => this.close());
    document.getElementById("seatAssignSearch").addEventListener("input", () => this.render());
  },

  isEnabled() {
    return CONFIG.SEAT_ASSIGN_ENABLED !== false;
  },

  isOpen() {
    return document.getElementById("seatAssignModal").classList.contains("active");
  },

  open(seatNo) {
    if (!this.isEnabled()) return;
    if (!app.items.length) {
      app.toast("社員データを読み込み中です。少し待ってからもう一度押してください。", true);
      return;
    }
    this.seatNo = seatNo;
    document.getElementById("seatAssignTitleText").textContent = `${seatNo} に席を割り当て`;
    const search = document.getElementById("seatAssignSearch");
    search.value = "";
    this.render();
    document.getElementById("seatAssignModal").classList.add("active");
  },

  close() {
    this.seatNo = null;
    document.getElementById("seatAssignModal").classList.remove("active");
  },

  // 今その席に座っている人（いなければ null）
  occupantOf(seatNo) {
    return app.items.find(i => app.parseSeats(i.Seat).includes(seatNo)) || null;
  },

  render() {
    const list = document.getElementById("seatAssignList");
    const query = document.getElementById("seatAssignSearch").value.trim().toLocaleLowerCase();
    const { SORT_NO } = CONFIG.FIELDS;
    const rows = app.items
      .filter(item => !query || [item[SORT_NO], item.Title, item.Dept, item.Seat]
        .some(v => String(v ?? "").toLocaleLowerCase().includes(query)))
      .sort((a, b) => {
        // 「自分」を一番上に出す（フリーアドレスで自分の席を選ぶ時に探さなくてよいように）
        const am = MeScreen.isMe(a.Id), bm = MeScreen.isMe(b.Id);
        if (am !== bm) return am ? -1 : 1;
        return app.compareItemsBy(a, b, "SortNo", "asc");
      });

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
      if (MeScreen.isMe(item.Id)) {
        const badge = document.createElement("span");
        badge.className = "seat-assign-me-badge";
        badge.textContent = "自分";
        name.appendChild(badge);
      }
      const sub = document.createElement("span");
      sub.className = "list-dept";
      const seats = app.parseSeats(item.Seat);
      sub.textContent = `${item.Dept || "—"} ／ ${seats.length ? `席: ${seats.join(", ")}` : "席なし"}`;
      who.append(name, sub);

      const pill = document.createElement("span");
      pill.className = `status-pill ${getStatusView(item.Status).pill}`;
      pill.textContent = item.Status || "未入力";

      btn.append(who, pill);
      btn.addEventListener("click", () => this.assign(item));
      frag.appendChild(btn);
    });
    list.appendChild(frag);
  },

  async assign(item) {
    const seatNo = this.seatNo;
    if (!seatNo) return;
    const id = Number(item.Id);
    const name = item.Title || "名前未設定";

    // 画面を開いている間に、自動更新で他の人がこの席に入っていた場合
    const occupant = this.occupantOf(seatNo);
    if (occupant && Number(occupant.Id) !== id) {
      alert(`${seatNo} には、すでに ${occupant.Title || "名前未設定"}さんが割り当てられています。`);
      this.close();
      app.renderCurrentView();
      return;
    }

    const current = app.parseSeats(item.Seat);
    // すでに席がある人は「移動」か「追加」かを選ぶ（複数の席を持つ人もいるため）
    let seats = [seatNo];
    let mode = "assign";
    if (current.length && !current.includes(seatNo)) {
      mode = await app.choose({
        title: `${name}さんの席`,
        message: `${name}さんには、すでに ${current.join(", ")} が割り当てられています。`,
        choices: [
          { value: "move", label: `${seatNo} に移動する`, sub: `${current.join(", ")} は空席になります`, primary: true },
          { value: "add", label: `${seatNo} を追加する`, sub: `${[...current, seatNo].join(", ")} の${current.length + 1}席になります` }
        ]
      });
      if (!mode) return;                       // やめる → 割り当て画面に戻る
      if (this.seatNo !== seatNo) return;      // 選んでいる間に割り当て画面が閉じられた
      if (mode === "add") seats = [...current, seatNo];
    } else if (current.includes(seatNo)) {
      seats = current;                         // すでにこの席を持っている（変更なし）
    }

    // 画面にはすぐ反映し、送信は SaveQueue が裏で行う。
    // 直後に開くステータス画面の「まとめ送信」を待たずにすぐ送る（他の人が同じ席を選ばないように）
    SaveQueue.enqueue(id, { Seat: seats.join(", ") });
    SaveQueue.flush();
    this.close();
    app.renderCurrentView();
    app.toast(mode === "move" ? `${name}さんを ${seatNo} に移動しました`
      : mode === "add" ? `${name}さんに ${seatNo} を追加しました`
      : `${name}さんを ${seatNo} に割り当てました`);
    StatusModal.open(id, name);
  }
};
