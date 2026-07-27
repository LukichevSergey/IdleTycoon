
/** Вкладка «Статистика / Настройки» */
class StatsView {
  /** onReset — колбэк полного сброса (реализован в main.js) */
  constructor(state, onReset) {
    this.state = state;
    this.onReset = onReset;
  }

  render(container) {
    container.innerHTML = `
      <div class="stats-grid" id="stats-grid"></div>
      <div class="settings-section">
        <h3>Настройки</h3>
        <div class="settings-placeholder">
          Здесь появятся: переключение темы, экспорт/импорт сейва, звук,
          график роста капитала.
          <!-- TODO: переключатель темы — менять data-theme на <html> -->
          <!-- TODO: экспорт/импорт сейва JSON через StorageManager -->
          <!-- TODO: график капитала (canvas по истории stats) -->
          <br>
          <button class="danger-btn" id="reset-btn">⚠ Сбросить прогресс</button>
        </div>
      </div>
    `;
    this.grid = container.querySelector("#stats-grid");
    container.querySelector("#reset-btn").addEventListener("click", () => {
      if (confirm("Точно сбросить весь прогресс? Это действие необратимо.")) {
        this.onReset();
      }
    });
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
