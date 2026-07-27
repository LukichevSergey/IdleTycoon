
/**
 * Универсальный раздел биржевых активов: акции / облигации / крипта.
 * Разница между видами — только в подписи строки и сводке (kind).
 */
class MarketSection {
  /**
   * @param {GameState} state
   * @param {'stock'|'bond'|'crypto'} kind
   * @param {Array} defs — определения активов раздела
   * @param {TradeModal} tradeModal
   * @param {string} [notice] — предупреждение вверху раздела
   */
  constructor(state, kind, defs, tradeModal, notice = "") {
    this.state = state;
    this.kind = kind;
    this.defs = defs;
    this.tradeModal = tradeModal;
    this.notice = notice;
    this.rows = {};
  }

  mount(container) {
    this.container = container;
    this.build();
    this.state.on("structural", ({ scope }) => {
      if (scope === "portfolio" || scope === "all") this.build();
    });
    this.state.on("market", () => this.marketUpdate());
  }

  _flowLabel() {
    if (this.kind === "stock") return "Дивиденды";
    if (this.kind === "bond") return "Купоны";
    return null;
  }
  _flowValue() {
    if (this.kind === "stock") return this.state.divPerSec;
    if (this.kind === "bond") return this.state.couponPerSec;
    return 0;
  }

  build() {
    this.rows = {};
    const flowLabel = this._flowLabel();
    this.container.innerHTML = `
      ${this.notice ? `<div class="mgr-card"><div class="mgr-info muted">${this.notice}</div></div>` : ""}
      <div class="summary-bar">
        <div class="sum-item"><div class="sum-label">Стоимость</div><div class="sum-value" data-r="value">—</div></div>
        <div class="sum-item"><div class="sum-label">Вложено</div><div class="sum-value" data-r="invested">—</div></div>
        <div class="sum-item"><div class="sum-label">P&amp;L</div><div class="sum-value" data-r="pl">—</div></div>
        ${flowLabel ? `<div class="sum-item"><div class="sum-label">${flowLabel}</div><div class="sum-value pos" data-r="flow">—</div></div>` : ""}
      </div>
      <div class="market-list" data-r="list"></div>
    `;
    const list = this.container.querySelector('[data-r="list"]');

    this.defs.forEach((def) => {
      const row = document.createElement("div");
      row.className = "m-row";

      let sub = def.sector || "";
      if (this.kind === "bond") {
        sub = `купон ${(def.coupon * def.face).toFixed(0)} ₽/ч за шт`;
      } else if (def.div) {
        sub += ` · див. ${(def.div * 100).toFixed(1)}%/ч`;
      }

      row.innerHTML = `
        <div class="m-c-name">
          <div class="m-name">${def.name}${def.ticker ? `<span class="ticker">${def.ticker}</span>` : ""}</div>
          <div class="m-sub" data-r="sub">${sub}</div>
        </div>
        <div class="m-c-spark" data-r="spark"></div>
        <div class="m-c-price">
          <div class="m-price" data-r="price">—</div>
          <div class="m-chg" data-r="chg">—</div>
        </div>
        <div class="m-pos m-c-pos" data-r="pos">—</div>
        <div class="m-c-act"><button class="btn-sm gold" data-r="trade">Торговать</button></div>
      `;
      row.querySelector('[data-r="trade"]').addEventListener("click", () => this.tradeModal.open(def.id));
      list.appendChild(row);

      const r = (name) => row.querySelector(`[data-r="${name}"]`);
      this.rows[def.id] = { def, sub: r("sub"), spark: r("spark"), price: r("price"), chg: r("chg"), pos: r("pos"), baseSub: sub };
    });
    this.marketUpdate();
  }

  marketUpdate() {
    const s = this.state;
    const now = Date.now();

    // сводка
    const q = (name) => this.container.querySelector(`[data-r="${name}"]`);
    const value = s.portfolioValue(this.kind);
    const invested = s.portfolioInvested(this.kind);
    const pl = value - invested;
    if (q("value")) {
      q("value").textContent = Fmt.moneyShort(value);
      q("invested").textContent = Fmt.moneyShort(invested);
      const plEl = q("pl");
      plEl.textContent = (pl >= 0 ? "+" : "") + Fmt.moneyShort(pl);
      plEl.className = "sum-value " + (pl >= 0 ? "pos" : "neg");
      if (q("flow")) q("flow").textContent = "+" + Fmt.money(this._flowValue()) + "/с";
    }

    // строки
    this.defs.forEach((def) => {
      const row = this.rows[def.id];
      if (!row) return;
      const price = s.market.price(def.id);
      const chg = s.market.changePct(def.id);
      row.price.textContent = Fmt.money(price);
      row.chg.textContent = Fmt.signPct(chg);
      row.chg.className = "m-chg " + (chg >= 0 ? "pos" : "neg");
      row.spark.innerHTML = sparkSVG(s.market.history(def.id));

      // Перк «Инсайдер»: подсказка, дешевле или дороже бумага «справедливой» цены
      let insiderBadge = "";
      if (s.hasInsider) {
        const mood = s.market.mood(def.id);
        if (mood < 0.92) insiderBadge = ` <span class="chip insider-cheap">недооценена</span>`;
        else if (mood > 1.15) insiderBadge = ` <span class="chip insider-dear">переоценена</span>`;
      }

      // бейджи облигаций: остаток размещения / дефолт
      if (this.kind === "bond") {
        const defaulted = s.bondDefault[def.id] > now;
        row.sub.innerHTML = `${row.baseSub} · осталось ${Fmt.qty(s.bondsRemaining[def.id])} шт`
          + (defaulted ? ` <span class="chip defaulted">ДЕФОЛТ</span>` : "")
          + (def.risky && !defaulted ? ` <span class="chip defaulted">риск</span>` : "")
          + insiderBadge;
      } else if (s.hasInsider) {
        row.sub.innerHTML = row.baseSub + insiderBadge;
      }

      const pos = s.portfolio[def.id];
      if (pos && pos.qty > 0) {
        const posValue = pos.qty * price;
        const posPl = posValue - pos.qty * pos.avg;
        row.pos.innerHTML =
          `<b>${Fmt.qty(pos.qty)} шт</b> · ${Fmt.moneyShort(posValue)}<br>` +
          `<span class="${posPl >= 0 ? "pos" : "neg"}">${(posPl >= 0 ? "+" : "")}${Fmt.moneyShort(posPl)}</span>`;
      } else {
        row.pos.innerHTML = `<span class="muted">нет позиции</span>`;
      }
    });
  }
}
