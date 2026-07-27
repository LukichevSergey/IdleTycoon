/**
 * Вкладка «Достижения»: полный список целей по категориям.
 * Полученные показываются заполненными, невыполненные — с полосой прогресса,
 * секретные скрыты до выполнения.
 */
class AchievementsView {
  constructor(state) {
    this.state = state;
    this.refs = {};
  }

  render(container) {
    this.container = container;
    this.build();
    this.state.on("structural", ({ scope }) => {
      if (scope === "achievements" || scope === "all") this.build();
    });
    this.state.on("tick", () => this.tickUpdate());
  }

  build() {
    this.refs = {};
    const s = this.state;
    const total = ACHIEVEMENT_DEFS.length;
    const earned = s.achCount;
    const coinsLeft = ACHIEVEMENT_DEFS
      .filter((a) => !s.hasAch(a.id))
      .reduce((sum, a) => sum + a.coins, 0);

    this.container.innerHTML = `
      <div class="summary-bar">
        <div class="sum-item"><div class="sum-label">Получено</div><div class="sum-value" data-r="count">${earned} / ${total}</div></div>
        <div class="sum-item"><div class="sum-label">Прогресс</div><div class="sum-value pos" data-r="pct">${Math.round((earned / total) * 100)}%</div></div>
        <div class="sum-item"><div class="sum-label">Осталось наград</div><div class="sum-value gold-text">🪙 ${coinsLeft}</div></div>
      </div>
      <div class="mgr-card">
        <div class="mgr-info muted">
          🏅 За каждое достижение начисляются <b>золотые монеты</b> — их можно тратить
          в магазине на вкладке «Престиж». Достижения сохраняются при перерождении.
        </div>
      </div>
      <div data-r="list"></div>
    `;

    const list = this.container.querySelector('[data-r="list"]');
    ACH_CATEGORIES.forEach((cat) => {
      const defs = ACHIEVEMENT_DEFS.filter((a) => a.cat === cat);
      if (!defs.length) return;
      const done = defs.filter((a) => s.hasAch(a.id)).length;

      const title = document.createElement("div");
      title.className = "section-title";
      title.innerHTML = `${cat} <span class="muted">${done} / ${defs.length}</span>`;
      list.appendChild(title);

      const grid = document.createElement("div");
      grid.className = "prop-grid ach-grid";
      defs.forEach((def) => grid.appendChild(this._card(def)));
      list.appendChild(grid);
    });
    this.tickUpdate();
  }

  _card(def) {
    const s = this.state;
    const got = s.hasAch(def.id);
    // Секретные не раскрываем заранее — иначе теряется сюрприз
    const hidden = def.secret && !got;
    const card = document.createElement("div");
    card.className = "prop-card ach-card" + (got ? " ach-done" : "");

    card.innerHTML = `
      <div class="prop-head">
        <div class="prop-icon">${hidden ? "❓" : def.icon}</div>
        <div class="prop-name">${hidden ? "Секретное достижение" : def.name}</div>
        <span class="chip ${got ? "rating" : ""}">🪙 ${def.coins}</span>
      </div>
      <div class="prop-desc">${hidden ? "Условие раскроется, когда вы его выполните" : def.desc}</div>
      ${got
        ? `<div class="status-line green">✅ Получено</div>`
        : `<div class="cond-row">
             <div class="cond-bar"><div class="cond-fill ach-fill" data-r="fill"></div></div>
             <span class="cond-pct ach-pct" data-r="text">—</span>
           </div>`}
    `;
    if (!got) {
      this.refs[def.id] = {
        def,
        fill: card.querySelector('[data-r="fill"]'),
        text: card.querySelector('[data-r="text"]'),
      };
    }
    return card;
  }

  /** Обновляем только полосы невыполненных — выполненные статичны */
  tickUpdate() {
    const s = this.state;
    Object.values(this.refs).forEach(({ def, fill, text }) => {
      const p = s.achProgress(def);
      fill.style.width = (p * 100).toFixed(1) + "%";
      text.textContent = def.goal ? s.achProgressText(def) : Math.round(p * 100) + "%";
    });
  }
}
