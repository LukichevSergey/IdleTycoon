/**
 * Окно открытия валютной позиции: сторона сделки, объём в лотах,
 * плечо, стоп-лосс и тейк-профит. Считает залог и цену пункта до нажатия,
 * чтобы игрок видел риск заранее.
 */
class ForexModal {
  constructor(state) {
    this.state = state;
    this.id = null;
    this.dir = 1;
    this.lev = 10;
    this.overlay = document.getElementById("fx-modal");

    this.lotsInput = document.getElementById("fx-lots");
    this.slInput = document.getElementById("fx-sl");
    this.tpInput = document.getElementById("fx-tp");

    document.getElementById("fx-close").addEventListener("click", () => this.close());
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.close();
    });

    document.getElementById("fx-dir-buy").addEventListener("click", () => this.setDir(1));
    document.getElementById("fx-dir-sell").addEventListener("click", () => this.setDir(-1));

    // Быстрый набор объёма: доля свободных средств с учётом плеча
    document.querySelectorAll("#fx-modal [data-lots]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const frac = parseFloat(btn.dataset.lots);
        const affordable = (this.state.balance * frac * this.lev) / CONFIG.FX_LOT;
        this.lotsInput.value = Math.max(CONFIG.FX_MIN_LOTS, Math.floor(affordable * 100) / 100);
        this.refresh();
      });
    });

    // Стоп-лосс/тейк-профит в процентах от цены входа
    document.querySelectorAll("#fx-modal [data-sl]").forEach((btn) => {
      btn.addEventListener("click", () => this.setProtection(parseFloat(btn.dataset.sl), null));
    });
    document.querySelectorAll("#fx-modal [data-tp]").forEach((btn) => {
      btn.addEventListener("click", () => this.setProtection(null, parseFloat(btn.dataset.tp)));
    });
    document.getElementById("fx-clear-protect").addEventListener("click", () => {
      this.slInput.value = "";
      this.tpInput.value = "";
      this.refresh();
    });

    document.getElementById("fx-submit").addEventListener("click", () => {
      const ok = this.state.openFxPosition(
        this.id, this.dir,
        parseFloat(this.lotsInput.value) || 0,
        this.lev,
        parseFloat(this.slInput.value) || 0,
        parseFloat(this.tpInput.value) || 0
      );
      if (ok) this.close();
    });

    [this.lotsInput, this.slInput, this.tpInput].forEach((el) =>
      el.addEventListener("input", () => this.refresh()));

    state.on("market", () => this.refresh());
  }

  setDir(dir) {
    this.dir = dir;
    document.getElementById("fx-dir-buy").classList.toggle("active", dir > 0);
    document.getElementById("fx-dir-sell").classList.toggle("active", dir < 0);
    // Защитные ордера привязаны к стороне сделки — сбрасываем, чтобы не путать
    this.slInput.value = "";
    this.tpInput.value = "";
    this.refresh();
  }

  /** Выставить стоп/тейк на заданном отклонении от текущей цены входа */
  setProtection(slPct, tpPct) {
    const def = FX_BY_ID[this.id];
    const entry = this.dir > 0 ? this.state.fxAsk(this.id) : this.state.fxBid(this.id);
    if (slPct != null) {
      this.slInput.value = (entry * (1 - (slPct / 100) * this.dir)).toFixed(def.digits);
    }
    if (tpPct != null) {
      this.tpInput.value = (entry * (1 + (tpPct / 100) * this.dir)).toFixed(def.digits);
    }
    this.refresh();
  }

  open(pairId, dir = 1) {
    this.id = pairId;
    const def = FX_BY_ID[pairId];
    document.getElementById("fx-title").textContent =
      `${def.ticker} ${def.nick || ""}`.trim();
    document.getElementById("fx-desc").textContent = def.desc;

    // Плечи зависят от пары: по экзотике брокер даёт меньше
    const levs = this.state.fxLeverages(pairId);
    if (!levs.includes(this.lev)) this.lev = levs[Math.min(2, levs.length - 1)];
    const box = document.getElementById("fx-levs");
    box.innerHTML = "";
    levs.forEach((l) => {
      const btn = document.createElement("button");
      btn.className = "btn-sm fx-lev" + (l === this.lev ? " active" : "");
      btn.textContent = `1:${l}`;
      btn.addEventListener("click", () => {
        this.lev = l;
        box.querySelectorAll(".fx-lev").forEach((b) => b.classList.toggle("active", b === btn));
        this.refresh();
      });
      box.appendChild(btn);
    });

    this.lotsInput.value = "0.1";
    this.slInput.value = "";
    this.tpInput.value = "";
    this.overlay.classList.add("visible");
    this.setDir(dir);
  }

  close() {
    this.overlay.classList.remove("visible");
    this.id = null;
  }

  refresh() {
    if (!this.id || !this.overlay.classList.contains("visible")) return;
    const s = this.state;
    const def = FX_BY_ID[this.id];
    const bid = s.fxBid(this.id);
    const ask = s.fxAsk(this.id);
    const entry = this.dir > 0 ? ask : bid;
    const lots = parseFloat(this.lotsInput.value) || 0;
    const notional = lots * CONFIG.FX_LOT;
    const margin = notional / this.lev;

    document.getElementById("fx-bid").textContent = bid.toFixed(def.digits);
    document.getElementById("fx-ask").textContent = ask.toFixed(def.digits);
    document.getElementById("fx-spread").textContent =
      ((s.fxSpreadFrac(this.id) * s.market.price(this.id)) / def.pip).toFixed(1) + " п.";

    const swapRate = this.dir > 0 ? def.swapLong : def.swapShort;
    const swapEl = document.getElementById("fx-swap-info");
    swapEl.textContent = `${swapRate >= 0 ? "+" : ""}${swapRate}% в час (${Fmt.money(notional * (swapRate / 100))}/ч)`;
    swapEl.className = swapRate >= 0 ? "pos" : "neg";

    document.getElementById("fx-notional").textContent = Fmt.moneyShort(notional);
    document.getElementById("fx-margin").textContent = Fmt.moneyShort(margin);
    // Насколько цена должна пойти против позиции, чтобы сработал стоп-аут
    document.getElementById("fx-liq").textContent =
      `${(CONFIG.FX_STOPOUT * 100 / this.lev).toFixed(2)}% против позиции`;

    // Потенциальный результат по защитным ордерам
    const sl = parseFloat(this.slInput.value) || 0;
    const tp = parseFloat(this.tpInput.value) || 0;
    const calc = (target) => notional * ((target - entry) / entry) * this.dir;
    const slEl = document.getElementById("fx-sl-res");
    const tpEl = document.getElementById("fx-tp-res");
    slEl.textContent = sl > 0 ? Fmt.money(calc(sl)) : "—";
    slEl.className = sl > 0 ? "neg" : "muted";
    tpEl.textContent = tp > 0 ? "+" + Fmt.money(calc(tp)) : "—";
    tpEl.className = tp > 0 ? "pos" : "muted";

    const btn = document.getElementById("fx-submit");
    const enough = s.balance >= margin;
    const slots = s.fxPositions.length < CONFIG.FX_MAX_POSITIONS;
    btn.disabled = !(lots >= CONFIG.FX_MIN_LOTS) || !enough || !slots;
    btn.className = "buy-btn " + (this.dir > 0 ? "fx-go-long" : "fx-go-short");
    btn.textContent = !slots ? "Достигнут лимит позиций"
      : !enough ? `Не хватает ${Fmt.moneyShort(margin - s.balance)}`
      : `${this.dir > 0 ? "▲ Купить" : "▼ Продать"} ${lots} лот · залог ${Fmt.moneyShort(margin)}`;
  }
}
