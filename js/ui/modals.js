
const TRADE_ASSETS = Object.fromEntries(MARKET_ASSETS.map((d) => [d.id, d]));

/** Индикатор «сохранено» в шапке */
const SaveIndicator = {
  _timer: null,
  blink() {
    const el = document.getElementById("save-indicator");
    if (!el) return;
    el.classList.add("visible");
    clearTimeout(this._timer);
    this._timer = setTimeout(() => el.classList.remove("visible"), 1500);
  },
};

/** Модалка офлайн-дохода с разбивкой по источникам */
const OfflineModal = {
  init() {
    document.getElementById("offline-collect-btn").addEventListener("click", () => this.hide());
  },
  show(rep) {
    document.getElementById("offline-sum").textContent = "+" + Fmt.money(rep.total);
    document.getElementById("offline-time").textContent =
      "Вы отсутствовали " + Fmt.dur(rep.seconds);
    const rows = [
      ["🏠 Аренда", rep.rent],
      ["📜 Купоны облигаций", rep.coupons],
      ["📈 Дивиденды", rep.divs],
      ["🏦 Выплаты по вкладам", rep.deposits],
    ].filter(([, v]) => v > 0.005);
    document.getElementById("offline-rows").innerHTML = rows
      .map(([label, v]) => `<div class="r"><span>${label}</span><span>+${Fmt.money(v)}</span></div>`)
      .join("");
    document.getElementById("offline-modal").classList.add("visible");
  },
  hide() {
    document.getElementById("offline-modal").classList.remove("visible");
  },
};

/**
 * Модалка покупки/продажи биржевых активов.
 * Живёт поверх любого раздела; цена обновляется на каждом рыночном тике.
 */
class TradeModal {
  constructor(state) {
    this.state = state;
    this.id = null;
    this.overlay = document.getElementById("trade-modal");
    this.qtyInput = document.getElementById("trade-qty");

    document.getElementById("trade-close").addEventListener("click", () => this.close());
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.close();
    });
    document.getElementById("trade-max-buy").addEventListener("click", () => {
      const def = TRADE_ASSETS[this.id];
      const price = this.state.market.price(this.id);
      let max = this.state.balance / (price * (1 + this.state.tradeFee));
      if (def.kind === "bond") max = Math.min(max, this.state.bondsRemaining[this.id]);
      this.qtyInput.value = def.kind === "crypto" ? (Math.floor(max * 1e4) / 1e4) : Math.floor(max);
      this.refresh();
    });
    document.getElementById("trade-all-sell").addEventListener("click", () => {
      const pos = this.state.portfolio[this.id];
      this.qtyInput.value = pos ? pos.qty : 0;
      this.refresh();
    });
    document.getElementById("trade-buy").addEventListener("click", () => {
      if (this.state.trade(this.id, this._qty(), true)) this.refresh();
    });
    document.getElementById("trade-sell").addEventListener("click", () => {
      if (this.state.trade(this.id, this._qty(), false)) this.refresh();
    });
    this.qtyInput.addEventListener("input", () => this.refresh());

    state.on("market", () => this.refresh());
    state.on("structural", () => this.refresh());
  }

  _qty() {
    const def = TRADE_ASSETS[this.id];
    const v = parseFloat(this.qtyInput.value);
    if (!isFinite(v) || v <= 0) return 0;
    return def.kind === "crypto" ? Math.floor(v * 1e4) / 1e4 : Math.floor(v);
  }

  open(id) {
    this.id = id;
    const def = TRADE_ASSETS[id];
    document.getElementById("trade-title").textContent =
      def.ticker ? `${def.name} (${def.ticker})` : def.name;
    document.getElementById("trade-sub").textContent =
      def.kind === "bond" ? `Облигация · рейтинг ${def.rating} · купон ${(def.coupon * 100).toFixed(1)}%/ч от номинала`
      : def.div ? `${def.sector} · дивиденды ${(def.div * 100).toFixed(1)}%/ч`
      : def.sector;
    this.qtyInput.value = def.kind === "crypto" ? "0.1" : "1";
    this.qtyInput.step = def.kind === "crypto" ? "0.0001" : "1";
    this.overlay.classList.add("visible");
    this.refresh();
  }

  close() {
    this.overlay.classList.remove("visible");
    this.id = null;
  }

  refresh() {
    if (!this.id || !this.overlay.classList.contains("visible")) return;
    const def = TRADE_ASSETS[this.id];
    const price = this.state.market.price(this.id);
    const chg = this.state.market.changePct(this.id);
    const pos = this.state.portfolio[this.id];
    const qty = this._qty();

    document.getElementById("trade-price").textContent = Fmt.money(price);
    const chgEl = document.getElementById("trade-chg");
    chgEl.textContent = Fmt.signPct(chg);
    chgEl.className = chg >= 0 ? "pos" : "neg";

    document.getElementById("trade-pos").innerHTML = pos
      ? `В портфеле: <b>${Fmt.qty(pos.qty)} шт</b> · средняя <b>${Fmt.money(pos.avg)}</b> · сейчас <b>${Fmt.money(pos.qty * price)}</b>`
      : "В портфеле: нет позиции";

    document.getElementById("trade-extra").textContent =
      def.kind === "bond" ? `Осталось в размещении: ${Fmt.qty(this.state.bondsRemaining[this.id])} шт` : "";

    const cost = qty * price * (1 + this.state.tradeFee);
    const proceeds = qty * price * (1 - this.state.tradeFee);
    document.querySelector("#trade-modal .fee-note").textContent =
      `Комиссия брокера ${(this.state.tradeFee * 100).toFixed(1).replace(".", ",")}% на покупку и продажу`;
    const buyBtn = document.getElementById("trade-buy");
    const sellBtn = document.getElementById("trade-sell");
    buyBtn.textContent = qty > 0 ? `Купить за ${Fmt.moneyShort(cost)}` : "Купить";
    sellBtn.textContent = qty > 0 ? `Продать за ${Fmt.moneyShort(proceeds)}` : "Продать";
    buyBtn.disabled = !(qty > 0) || this.state.balance < cost ||
      (def.kind === "bond" && qty > this.state.bondsRemaining[this.id]);
    sellBtn.disabled = !(qty > 0) || !pos || pos.qty < qty - 1e-9;
  }
}
