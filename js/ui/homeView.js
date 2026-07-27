
/** Главная вкладка: баланс, пассивный доход, кнопка «сделки», алерты */
class HomeView {
  /** goto(tabId, sectionId) — навигация из алертов */
  constructor(state, goto) {
    this.state = state;
    this.goto = goto;
  }

  render(container) {
    container.innerHTML = `
      <div class="balance-hero">
        <div class="balance-label">Ваш капитал</div>
        <div class="balance-value" id="balance-value">0</div>
        <div class="income-line">
          <span id="income-value">+0,00 ₽</span>
          <span class="caption">/ сек пассивного дохода</span>
        </div>
        <div class="income-breakdown" id="income-breakdown"></div>
        <div class="networth-line">Собственный капитал: <b id="networth-value">—</b></div>
        <div class="networth-line hidden" id="gold-line"></div>
        <button class="deal-btn" id="deal-btn">🤝 Заключить сделку</button>
        <div class="alert-line hidden" id="vacant-alert"></div>
      </div>

      <!-- Ближайшие цели: главный ответ на вопрос «что делать дальше» -->
      <div class="goals-card hidden" id="goals-card">
        <div class="goals-head">
          <span>🎯 Текущие цели</span>
          <button class="btn-sm" id="goals-all">Все достижения</button>
        </div>
        <div id="goals-list"></div>
      </div>
    `;
    this.balanceEl = container.querySelector("#balance-value");
    this.headerBalanceEl = document.getElementById("header-balance");
    this.incomeEl = container.querySelector("#income-value");
    this.breakdownEl = container.querySelector("#income-breakdown");
    this.networthEl = container.querySelector("#networth-value");
    this.goldEl = container.querySelector("#gold-line");
    this.alertEl = container.querySelector("#vacant-alert");
    this.goldEl.style.cursor = "pointer";
    this.goldEl.addEventListener("click", () => this.goto("prestige"));

    const dealBtn = container.querySelector("#deal-btn");
    dealBtn.addEventListener("click", () => {
      const gain = this.state.clickDeal();
      const float = document.createElement("span");
      float.className = "deal-float";
      float.textContent = "+" + Fmt.money(gain);
      dealBtn.appendChild(float);
      setTimeout(() => float.remove(), 900);
    });
    this.alertEl.addEventListener("click", () => this.goto("investments", "realty"));

    this.goalsCard = container.querySelector("#goals-card");
    this.goalsList = container.querySelector("#goals-list");
    container.querySelector("#goals-all").addEventListener("click", () => this.goto("achievements"));
    this.state.on("structural", ({ scope }) => {
      if (scope === "achievements" || scope === "all") this._goalIds = null; // пересобрать подборку
    });

    this.state.on("tick", () => this.update());
    this.update();
  }

  update() {
    const s = this.state;
    this.balanceEl.textContent = Fmt.money(s.balance);
    this.headerBalanceEl.textContent = Fmt.moneyShort(s.balance);
    this.incomeEl.textContent = "+" + Fmt.money(s.incomePerSec);

    const parts = [];
    if (s.rentPerSec > 0) parts.push(`аренда ${Fmt.money(s.rentPerSec)}/с`);
    if (s.businessPerSec > 0) parts.push(`бизнес ${Fmt.money(s.businessPerSec)}/с`);
    if (s.couponPerSec > 0) parts.push(`купоны ${Fmt.money(s.couponPerSec)}/с`);
    if (s.divPerSec > 0) parts.push(`дивиденды ${Fmt.money(s.divPerSec)}/с`);
    if (s.depositPerSec > 0) parts.push(`вклад ${Fmt.money(s.depositPerSec)}/с`);
    this.breakdownEl.textContent = parts.join(" · ");
    this.networthEl.textContent = Fmt.moneyShort(s.netWorth);

    // Подсказка о престиже, когда есть монеты или доступно перерождение
    const pending = s.pendingCoins;
    if (s.gold > 0 || pending >= 1 || s.prestigeCount > 0) {
      this.goldEl.innerHTML = `🪙 <b>${s.gold}</b>` +
        (pending >= 1 ? ` · перерождение даст <b>+${pending} 🪙</b>` : "");
      this.goldEl.classList.remove("hidden");
    } else {
      this.goldEl.classList.add("hidden");
    }

    this.updateGoals();

    const vacant = s.vacantPropsCount;
    if (vacant > 0) {
      this.alertEl.textContent = `⚠ Объектов без арендатора: ${vacant} — перейти к недвижимости`;
      this.alertEl.classList.remove("hidden");
    } else {
      this.alertEl.classList.add("hidden");
    }
  }

  /**
   * Три ближайшие к выполнению цели. Подборка пересчитывается редко
   * (при получении достижения), а полосы обновляются каждый тик —
   * иначе карточки прыгали бы местами при каждом изменении баланса.
   */
  updateGoals() {
    const s = this.state;
    if (!this._goalIds) {
      const pending = ACHIEVEMENT_DEFS
        .filter((a) => !s.hasAch(a.id) && !a.secret)
        .map((a) => ({ a, p: s.achProgress(a) }))
        .sort((x, y) => y.p - x.p)
        .slice(0, 3);
      this._goalIds = pending.map((x) => x.a.id);

      if (!this._goalIds.length) {
        this.goalsCard.classList.add("hidden");
        return;
      }
      this.goalsCard.classList.remove("hidden");
      this.goalsList.innerHTML = "";
      this._goalRefs = pending.map(({ a }) => {
        const row = document.createElement("div");
        row.className = "goal-row";
        row.innerHTML = `
          <div class="goal-icon">${a.icon}</div>
          <div class="goal-body">
            <div class="goal-name">${a.name} <span class="chip">🪙 ${a.coins}</span></div>
            <div class="goal-desc">${a.desc}</div>
            <div class="cond-bar"><div class="cond-fill ach-fill" data-r="fill"></div></div>
          </div>
          <div class="goal-pct" data-r="text">—</div>
        `;
        this.goalsList.appendChild(row);
        return { def: a, fill: row.querySelector('[data-r="fill"]'), text: row.querySelector('[data-r="text"]') };
      });
    }

    (this._goalRefs || []).forEach(({ def, fill, text }) => {
      const p = s.achProgress(def);
      fill.style.width = (p * 100).toFixed(1) + "%";
      text.textContent = def.goal ? s.achProgressText(def) : Math.round(p * 100) + "%";
    });
  }

  /** Подсветка баланса при крупном пополнении (офлайн-доход) */
  flashBalance() {
    this.balanceEl.classList.remove("flash");
    void this.balanceEl.offsetWidth; // перезапуск CSS-анимации
    this.balanceEl.classList.add("flash");
  }
}
