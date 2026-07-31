
/** Вкладка «Статистика / Настройки» */
class StatsView {
  /** game — нужен блоку настроек для резервных копий и сброса */
  constructor(state, game) {
    this.state = state;
    this.game = game;
  }

  render(container) {
    container.innerHTML = `
      <div class="stats-grid" id="stats-grid"></div>
      <div class="settings-section">
        <h3>Настройки</h3>
        <div id="cloud-host"></div>
        <div id="settings-host"></div>
      </div>
    `;
    this.grid = container.querySelector("#stats-grid");
    new CloudSection(this.state, this.game).mount(container.querySelector("#cloud-host"));
    new SettingsSection(this.state, this.game).mount(container.querySelector("#settings-host"));
    this.state.on("tick", () => this.update());
    this.update();
  }

  update() {
    const s = this.state.stats;
    const state = this.state;
    const cards = [
      ["Собственный капитал", Fmt.moneyShort(state.netWorth)],
      ["Всего заработано", Fmt.moneyShort(s.totalEarned)],
      ["Аренда", Fmt.moneyShort(s.rentEarned)],
      ["Бизнесы", Fmt.moneyShort(s.businessEarned)],
      ["Купоны", Fmt.moneyShort(s.couponEarned)],
      ["Дивиденды", Fmt.moneyShort(s.divEarned)],
      ["Проценты по вкладам", Fmt.moneyShort(s.depositEarned)],
      ["Прибыль с торговли", (s.tradeProfit >= 0 ? "+" : "") + Fmt.moneyShort(s.tradeProfit), s.tradeProfit >= 0 ? "pos" : "neg"],
      ["Сделки (клики)", Fmt.moneyShort(s.clickEarned)],
      ["Комиссии брокера", Fmt.moneyShort(s.feesPaid)],
      ["Ремонт зданий", Fmt.moneyShort(s.repairSpent)],
      ["Улучшения", Fmt.moneyShort(s.upgradeSpent)],
      ["Управляющему", Fmt.moneyShort(s.managerPaid)],
      ["Объектов куплено", state.ownedPropsCount],
      ["Время в игре", Fmt.dur(s.playTimeSec)],
      ["Перерождений", state.prestigeCount],
      ["Золотых монет", `🪙 ${state.gold}`],
      ["Заработано за все жизни", Fmt.moneyShort(state.lifetime.earned + s.totalEarned)],
    ];
    this.grid.innerHTML = cards
      .map(([label, value, cls]) =>
        `<div class="stat-card"><div class="label">${label}</div><div class="value ${cls || ""}">${value}</div></div>`)
      .join("");
  }
}
