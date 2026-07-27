
/** Раздел «Вклады» */
class DepositsSection {
  constructor(state) {
    this.state = state;
    this.refs = {};
  }

  mount(container) {
    this.container = container;
    this.build();
    this.state.on("structural", ({ scope }) => {
      if (scope === "deposits" || scope === "all") this.build();
    });
    this.state.on("tick", () => this.tickUpdate());
  }

  build() {
    this.refs = {};
    this.container.innerHTML = `
      <div class="summary-bar">
        <div class="sum-item"><div class="sum-label">Во вкладах</div><div class="sum-value" data-r="total">—</div></div>
        <div class="sum-item"><div class="sum-label">Доход «Копилки»</div><div class="sum-value pos" data-r="flow">—</div></div>
      </div>
      <div class="deposit-grid" data-r="grid"></div>
    `;
    const grid = this.container.querySelector('[data-r="grid"]');

    DEPOSIT_DEFS.forEach((d) => {
      const dep = this.state.deposits[d.id];
      const card = document.createElement("div");
      card.className = "deposit-card";
      const termLabel = d.termH === 0 ? "до востребования" : `срок ${d.termH} ч`;

      let body;
      if (!dep) {
        body = `
          <div class="dep-form">
            <input type="number" class="num-input" data-r="amount" placeholder="Сумма" min="${CONFIG.DEPOSIT_MIN}">
            <button class="btn-sm" data-r="q25">25%</button>
            <button class="btn-sm" data-r="q50">50%</button>
            <button class="btn-sm" data-r="qmax">Макс</button>
          </div>
          <button class="buy-btn" data-r="open">Открыть вклад</button>
        `;
      } else if (d.termH === 0) {
        body = `
          <div class="prop-meta">
            <span class="label">Внесено</span><span class="value" data-r="principal">—</span>
            <span class="label">Накоплено %</span><span class="value income" data-r="accrued">—</span>
          </div>
          <div class="dep-form">
            <input type="number" class="num-input" data-r="amount" placeholder="Пополнить" min="${CONFIG.DEPOSIT_MIN}">
            <button class="btn-sm gold" data-r="add">Внести</button>
            <button class="btn-sm" data-r="close">Снять всё</button>
          </div>
        `;
      } else {
        const interest = dep.principal * this.state.depositRate(d) * d.termH * this.state.incomeMult;
        body = `
          <div class="prop-meta">
            <span class="label">Внесено</span><span class="value" data-r="principal">${Fmt.money(dep.principal)}</span>
            <span class="label">К выплате</span><span class="value income">${Fmt.money(dep.principal + interest)}</span>
            <span class="label">До закрытия</span><span class="value" data-r="left">—</span>
          </div>
          <button class="btn-sm red" data-r="close">Закрыть досрочно (потеря %)</button>
        `;
      }

      card.innerHTML = `
        <div class="prop-head">
          <div class="prop-icon">🏦</div>
          <div class="prop-name">${d.name}</div>
          <span class="chip">${termLabel}</span>
        </div>
        <div class="rate">${(this.state.depositRate(d) * 100).toFixed(0)}% <span class="per">в час · лимит ${Fmt.moneyShort(this.state.depositMax(d))}</span></div>
        <div class="prop-desc">${d.desc}</div>
        ${body}
      `;
      grid.appendChild(card);

      const r = (name) => card.querySelector(`[data-r="${name}"]`);
      const amountInput = r("amount");
      const fillPct = (pct) => {
        const room = Math.min(this.state.balance,
          this.state.depositMax(d) - (dep && d.termH === 0 ? dep.principal : 0));
        amountInput.value = Math.max(0, Math.floor(room * pct));
      };
      if (r("q25")) r("q25").addEventListener("click", () => fillPct(0.25));
      if (r("q50")) r("q50").addEventListener("click", () => fillPct(0.5));
      if (r("qmax")) r("qmax").addEventListener("click", () => fillPct(1));
      if (r("open")) r("open").addEventListener("click", () =>
        this.state.openDeposit(d.id, parseFloat(amountInput.value) || 0));
      if (r("add")) r("add").addEventListener("click", () =>
        this.state.openDeposit(d.id, parseFloat(amountInput.value) || 0));
      if (r("close")) r("close").addEventListener("click", () => this.state.closeDeposit(d.id));

      this.refs[d.id] = { principal: r("principal"), accrued: r("accrued"), left: r("left") };
    });
    this.tickUpdate();
  }

  tickUpdate() {
    const total = this.container.querySelector('[data-r="total"]');
    const flow = this.container.querySelector('[data-r="flow"]');
    if (total) total.textContent = Fmt.moneyShort(this.state.depositsTotal);
    if (flow) flow.textContent = "+" + Fmt.money(this.state.depositPerSec) + "/с";

    const now = Date.now();
    DEPOSIT_DEFS.forEach((d) => {
      const dep = this.state.deposits[d.id];
      const refs = this.refs[d.id];
      if (!dep || !refs) return;
      if (refs.principal) refs.principal.textContent = Fmt.money(dep.principal);
      if (refs.accrued) refs.accrued.textContent = "+" + Fmt.money(dep.accrued);
      if (refs.left) refs.left.textContent = Fmt.durShort((dep.maturesAt - now) / 1000);
    });
  }
}
