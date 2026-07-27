
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

    const vacant = s.vacantPropsCount;
    if (vacant > 0) {
      this.alertEl.textContent = `⚠ Объектов без арендатора: ${vacant} — перейти к недвижимости`;
      this.alertEl.classList.remove("hidden");
    } else {
      this.alertEl.classList.add("hidden");
    }
  }

  /** Подсветка баланса при крупном пополнении (офлайн-доход) */
  flashBalance() {
    this.balanceEl.classList.remove("flash");
    void this.balanceEl.offsetWidth; // перезапуск CSS-анимации
    this.balanceEl.classList.add("flash");
  }
}
