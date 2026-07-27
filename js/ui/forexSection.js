/**
 * Раздел «Форекс»: список валютных пар и открытые маржинальные позиции.
 * Структурные события (открытие/закрытие позиции) перестраивают DOM,
 * котировки и плавающий результат обновляются на каждом рыночном тике.
 */
class ForexSection {
  constructor(state, forexModal) {
    this.state = state;
    this.modal = forexModal;
    this.rows = {};
    this.posRefs = {};
  }

  mount(container) {
    this.container = container;
    this.build();
    this.state.on("structural", ({ scope }) => {
      if (scope === "forex" || scope === "all") this.build();
    });
    // Плавающий P&L должен «дышать» вместе с котировками
    this.state.on("market", () => this.liveUpdate());
    this.state.on("tick", () => this.liveUpdate());
  }

  /** Цена в формате пары (у иеновых пар меньше знаков) */
  _fmtPrice(def, price) { return price.toFixed(def.digits); }

  build() {
    this.rows = {};
    this.posRefs = {};
    const s = this.state;

    this.container.innerHTML = `
      <div class="mgr-card">
        <div class="mgr-info muted">
          💱 Форекс — торговля валютными парами <b>в обе стороны</b>: покупайте пару, если ждёте
          роста первой валюты, продавайте — если ждёте падения. Кредитное плечо увеличивает и
          прибыль, и убыток: под позицию блокируется залог, и если убыток съедает
          ${CONFIG.FX_STOPOUT * 100}% залога, брокер закрывает сделку принудительно.
          Больше залога потерять нельзя. Стоп-лосс и тейк-профит срабатывают даже офлайн.
        </div>
      </div>

      <div class="summary-bar">
        <div class="sum-item"><div class="sum-label">Свободно</div><div class="sum-value" data-r="free">—</div></div>
        <div class="sum-item"><div class="sum-label">В залоге</div><div class="sum-value" data-r="margin">—</div></div>
        <div class="sum-item"><div class="sum-label">Плавающий P&amp;L</div><div class="sum-value" data-r="float">—</div></div>
        <div class="sum-item"><div class="sum-label">Позиций</div><div class="sum-value" data-r="count">—</div></div>
      </div>

      <div data-r="positions"></div>

      <div class="section-title">Валютные пары</div>
      <div class="market-list" data-r="list"></div>
    `;

    this._buildPositions(this.container.querySelector('[data-r="positions"]'));

    const list = this.container.querySelector('[data-r="list"]');
    FOREX_DEFS.forEach((def) => {
      const row = document.createElement("div");
      row.className = "m-row fx-row";
      row.innerHTML = `
        <div class="m-c-name">
          <div class="m-name">${def.ticker}
            ${def.nick ? `<span class="ticker">${def.nick}</span>` : ""}</div>
          <div class="m-sub">${def.cls} · спред <span data-r="spread">—</span> п. · плечо до 1:${def.maxLev}</div>
          <div class="m-sub fx-swap">своп: лонг <span data-r="swapL"></span> · шорт <span data-r="swapS"></span> в час</div>
        </div>
        <div class="m-c-spark" data-r="spark"></div>
        <div class="m-c-price">
          <div class="m-price" data-r="price">—</div>
          <div class="m-chg" data-r="chg">—</div>
        </div>
        <div class="m-pos m-c-pos fx-quotes">
          <div>Bid <b data-r="bid">—</b></div>
          <div>Ask <b data-r="ask">—</b></div>
        </div>
        <div class="m-c-act fx-actions">
          <button class="btn-sm green" data-r="buy">▲ Купить</button>
          <button class="btn-sm red" data-r="sell">▼ Продать</button>
        </div>
      `;
      row.querySelector('[data-r="buy"]').addEventListener("click", () => this.modal.open(def.id, 1));
      row.querySelector('[data-r="sell"]').addEventListener("click", () => this.modal.open(def.id, -1));
      list.appendChild(row);

      const r = (n) => row.querySelector(`[data-r="${n}"]`);
      // Свопы статичны — заполняем один раз
      const swapL = r("swapL"), swapS = r("swapS");
      swapL.textContent = (def.swapLong >= 0 ? "+" : "") + def.swapLong + "%";
      swapL.className = def.swapLong >= 0 ? "pos" : "neg";
      swapS.textContent = (def.swapShort >= 0 ? "+" : "") + def.swapShort + "%";
      swapS.className = def.swapShort >= 0 ? "pos" : "neg";

      this.rows[def.id] = { def, spread: r("spread"), spark: r("spark"), price: r("price"),
        chg: r("chg"), bid: r("bid"), ask: r("ask") };
    });

    this.liveUpdate();
  }

  _buildPositions(host) {
    const s = this.state;
    const positions = s.fxPositions;
    if (!positions.length) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML = `
      <div class="section-title">Открытые позиции
        <button class="btn-sm red" data-r="closeAll" style="margin-left:10px">Закрыть все</button>
      </div>
      <div class="market-list" data-r="poslist"></div>
    `;
    host.querySelector('[data-r="closeAll"]').addEventListener("click", () => s.closeAllFxPositions());
    const list = host.querySelector('[data-r="poslist"]');

    positions.forEach((pos) => {
      const def = FX_BY_ID[pos.pair];
      const row = document.createElement("div");
      row.className = "m-row fx-pos-row " + (pos.dir > 0 ? "long" : "short");
      row.innerHTML = `
        <div class="m-c-name">
          <div class="m-name">${def.ticker}
            <span class="chip ${pos.dir > 0 ? "insider-cheap" : "insider-dear"}">${pos.dir > 0 ? "ЛОНГ" : "ШОРТ"}</span>
          </div>
          <div class="m-sub">${pos.lots} лот · плечо 1:${pos.lev} · залог ${Fmt.moneyShort(pos.margin)}</div>
          <div class="m-sub">вход ${this._fmtPrice(def, pos.entry)}
            ${pos.sl ? `· 🛑 ${this._fmtPrice(def, pos.sl)}` : ""}
            ${pos.tp ? `· 🎯 ${this._fmtPrice(def, pos.tp)}` : ""}</div>
        </div>
        <div class="m-c-spark"></div>
        <div class="m-c-price">
          <div class="m-price" data-r="cur">—</div>
          <div class="m-chg muted">текущая</div>
        </div>
        <div class="m-pos m-c-pos">
          <div><b data-r="pnl">—</b></div>
          <div class="muted">своп <span data-r="swap">—</span></div>
          <div class="fx-margin-bar"><div class="fx-margin-fill" data-r="risk"></div></div>
        </div>
        <div class="m-c-act"><button class="btn-sm" data-r="close">Закрыть</button></div>
      `;
      row.querySelector('[data-r="close"]').addEventListener("click", () => s.closeFxPosition(pos.id));
      list.appendChild(row);
      const r = (n) => row.querySelector(`[data-r="${n}"]`);
      this.posRefs[pos.id] = { pos, def, cur: r("cur"), pnl: r("pnl"), swap: r("swap"), risk: r("risk") };
    });
  }

  /** Котировки, плавающий результат и риск-бары — без перестройки DOM */
  liveUpdate() {
    const s = this.state;
    const q = (n) => this.container.querySelector(`[data-r="${n}"]`);
    if (!q("free")) return;

    q("free").textContent = Fmt.moneyShort(s.balance);
    q("margin").textContent = Fmt.moneyShort(s.fxMarginUsed);
    const fl = s.fxFloating;
    const flEl = q("float");
    flEl.textContent = (fl >= 0 ? "+" : "") + Fmt.money(fl);
    flEl.className = "sum-value " + (fl >= 0 ? "pos" : "neg");
    q("count").textContent = `${s.fxPositions.length} / ${CONFIG.FX_MAX_POSITIONS}`;

    // Котировки пар
    FOREX_DEFS.forEach((def) => {
      const row = this.rows[def.id];
      if (!row) return;
      const chg = s.market.changePct(def.id);
      row.price.textContent = this._fmtPrice(def, s.market.price(def.id));
      row.chg.textContent = Fmt.signPct(chg);
      row.chg.className = "m-chg " + (chg >= 0 ? "pos" : "neg");
      row.bid.textContent = this._fmtPrice(def, s.fxBid(def.id));
      row.ask.textContent = this._fmtPrice(def, s.fxAsk(def.id));
      // Спред в пунктах: перк «Валютный дилер» его сужает, поэтому считаем от цены
      const pips = (s.fxSpreadFrac(def.id) * s.market.price(def.id)) / def.pip;
      row.spread.textContent = pips.toFixed(1);
      row.spark.innerHTML = sparkSVG(s.market.history(def.id));
    });

    // Открытые позиции
    Object.values(this.posRefs).forEach(({ pos, def, cur, pnl, swap, risk }) => {
      if (!s.fx[pos.id]) return; // уже закрыта, ждём перестройки
      const close = pos.dir > 0 ? s.fxBid(pos.pair) : s.fxAsk(pos.pair);
      cur.textContent = this._fmtPrice(def, close);
      const total = s.fxTotal(pos);
      pnl.textContent = (total >= 0 ? "+" : "") + Fmt.money(total);
      pnl.className = total >= 0 ? "pos" : "neg";
      swap.textContent = (pos.swap >= 0 ? "+" : "") + Fmt.money(pos.swap);
      // Полоса риска: сколько залога уже съедено убытком
      const used = U.clamp((-total / (pos.margin * CONFIG.FX_STOPOUT)) * 100, 0, 100);
      risk.style.width = used + "%";
      risk.className = "fx-margin-fill" + (used > 66 ? " bad" : used > 33 ? " warn" : "");
    });
  }
}
