/**
 * Вкладка «Престиж»: перерождение и магазин постоянных улучшений.
 * Монеты и перки переживают перерождение; полный сброс в настройках
 * стирает всё, включая престиж.
 */
class PrestigeView {
  constructor(state) {
    this.state = state;
  }

  render(container) {
    this.container = container;
    this.build();
    this.state.on("structural", ({ scope }) => {
      if (scope === "prestige" || scope === "all") this.build();
    });
    this.state.on("tick", () => this.tickUpdate());
  }

  build() {
    const s = this.state;
    this.container.innerHTML = `
      <div class="summary-bar">
        <div class="sum-item"><div class="sum-label">Золотые монеты</div><div class="sum-value gold-text" data-r="gold">—</div></div>
        <div class="sum-item"><div class="sum-label">Перерождений</div><div class="sum-value" data-r="count">—</div></div>
        <div class="sum-item"><div class="sum-label">Множитель дохода</div><div class="sum-value pos" data-r="mult">—</div></div>
      </div>

      <div class="prestige-card">
        <div class="prestige-head">👑 Перерождение</div>
        <div class="prop-desc">
          Начните путь заново, сохранив <b>золотые монеты</b> и все покупки магазина.
          Сбросятся: баланс, недвижимость, портфель, вклады и управляющий.
          Монеты за перерождение: <b>√(капитал / 1 млн ₽)</b>.
        </div>
        <div class="prop-meta" style="margin-top:6px">
          <span class="label">Сейчас дадут</span><span class="value gold-text" data-r="pending">—</span>
          <span class="label">Следующая монета при</span><span class="value" data-r="nextAt">—</span>
        </div>
        <div class="cond-row">
          <div class="cond-bar"><div class="cond-fill" data-r="progress" style="background: var(--accent-gold)"></div></div>
          <span class="cond-pct" data-r="progressPct">—</span>
        </div>
        <button class="buy-btn" data-r="prestigeBtn">Переродиться</button>
      </div>

      <div class="section-title">Магазин улучшений</div>
      <div class="prop-grid" data-r="shop"></div>
    `;

    this.container.querySelector('[data-r="prestigeBtn"]').addEventListener("click", () => {
      const coins = s.pendingCoins;
      if (coins < 1) return;
      if (confirm(`Переродиться и получить ${coins} 🪙?\n\nВесь текущий прогресс (кроме монет и перков) будет сброшен.`)) {
        s.doPrestige();
      }
    });

    const shop = this.container.querySelector('[data-r="shop"]');
    this.buyBtns = {};
    PRESTIGE_DEFS.forEach((def) => {
      const lv = s.perkLv(def.id);
      const maxed = lv >= def.costs.length;
      const card = document.createElement("div");
      card.className = "prop-card" + (lv > 0 ? " owned" : "");

      const levelInfo = def.type === "level"
        ? `<span class="chip ${lv > 0 ? "rating" : ""}">ур. ${lv} / ${def.costs.length}</span>`
        : (maxed ? `<span class="chip rating">Куплено ✓</span>` : "");

      card.innerHTML = `
        <div class="prop-head">
          <div class="prop-icon">${def.icon}</div>
          <div class="prop-name">${def.name}</div>
          ${levelInfo}
        </div>
        <div class="prop-desc">${def.effect}</div>
        ${maxed
          ? `<div class="status-line muted">${def.type === "level" ? "Максимальный уровень" : "Эффект действует"}</div>`
          : `<button class="buy-btn" data-perk="${def.id}">Купить за ${def.costs[lv]} 🪙</button>`}
      `;
      const btn = card.querySelector("[data-perk]");
      if (btn) {
        btn.addEventListener("click", () => s.buyPerk(def.id));
        this.buyBtns[def.id] = { btn, cost: def.costs[lv] };
      }
      shop.appendChild(card);
    });
    this.tickUpdate();
  }

  tickUpdate() {
    const s = this.state;
    const q = (name) => this.container.querySelector(`[data-r="${name}"]`);
    if (!q("gold")) return;

    q("gold").textContent = `🪙 ${s.gold}`;
    q("count").textContent = s.prestigeCount;
    q("mult").textContent = "×" + (s.incomeMult * s.rentMult).toFixed(2).replace(".", ",");

    const pending = s.pendingCoins;
    q("pending").textContent = `+${pending} 🪙`;
    q("nextAt").textContent = Fmt.moneyShort(s.nextCoinAt);

    // Прогресс до следующей монеты (от предыдущего порога)
    const prevAt = Math.pow(pending, 2) * CONFIG.PRESTIGE_BASE_NW;
    const frac = U.clamp((s.netWorth - prevAt) / (s.nextCoinAt - prevAt), 0, 1);
    q("progress").style.width = (frac * 100).toFixed(1) + "%";
    q("progressPct").textContent = Math.floor(frac * 100) + "%";

    const btn = q("prestigeBtn");
    btn.disabled = pending < 1;
    btn.textContent = pending >= 1
      ? `👑 Переродиться (+${pending} 🪙)`
      : `Нужен капитал от ${Fmt.moneyShort(CONFIG.PRESTIGE_BASE_NW)}`;

    // Доступность покупок в магазине
    Object.values(this.buyBtns).forEach(({ btn: b, cost }) => {
      b.disabled = s.gold < cost;
    });
  }
}
