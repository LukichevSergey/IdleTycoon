
/**
 * Раздел «Недвижимость»: карточки 25 объектов, управляющий, аренда.
 * Структурные изменения (покупка, договор, оффер) перестраивают DOM,
 * таймеры и индикаторы обновляются точечно раз в секунду.
 */
class RealtySection {
  constructor(state) {
    this.state = state;
    this.refs = {}; // id -> ссылки на динамические элементы карточки
  }

  mount(container) {
    this.container = container;
    this.build();
    this.state.on("structural", ({ scope }) => {
      if (scope === "realty" || scope === "all") this.build();
    });
    this.state.on("tick", () => this.tickUpdate());
  }

  build() {
    this.refs = {};
    const s = this.state;
    this.container.innerHTML = `
      <div class="summary-bar">
        <div class="sum-item"><div class="sum-label">Объектов</div><div class="sum-value" data-r="count">—</div></div>
        <div class="sum-item"><div class="sum-label">Доход аренды</div><div class="sum-value pos" data-r="rent">—</div></div>
        <div class="sum-item"><div class="sum-label">Простаивает</div><div class="sum-value" data-r="vacant">—</div></div>
        <div class="sum-item"><div class="sum-label">Вложено</div><div class="sum-value" data-r="invested">—</div></div>
      </div>
      <div data-r="mgr"></div>
      <div class="prop-grid" data-r="grid"></div>
    `;
    this._buildManager(this.container.querySelector('[data-r="mgr"]'));
    const grid = this.container.querySelector('[data-r="grid"]');
    PROPERTY_DEFS.forEach((def) => {
      grid.appendChild(s.props[def.id] ? this._ownedCard(def) : this._buyCard(def));
    });
    this.tickUpdate();
  }

  _buildManager(el) {
    const s = this.state;
    if (s.managerHired) {
      el.innerHTML = `
        <div class="mgr-card">
          <div class="mgr-info">
            <div class="mgr-title">🤵 Управляющий работает</div>
            <div class="muted">Сам находит арендаторов за 1–3 мин. Комиссия ${CONFIG.MANAGER_CUT * 100}% от аренды.</div>
          </div>
          <button class="btn-sm red" data-r="fire">Уволить</button>
        </div>`;
      el.querySelector('[data-r="fire"]').addEventListener("click", () => s.fireManager());
    } else {
      el.innerHTML = `
        <div class="mgr-card">
          <div class="mgr-info">
            <div class="mgr-title">🤵 Нанять управляющего</div>
            <div class="muted">Автоматически подбирает арендаторов на все объекты. Разово ${Fmt.moneyShort(CONFIG.MANAGER_HIRE_COST)} + комиссия ${CONFIG.MANAGER_CUT * 100}%.</div>
          </div>
          <button class="buy-btn" data-r="hire">Нанять за ${Fmt.moneyShort(CONFIG.MANAGER_HIRE_COST)}</button>
        </div>`;
      const btn = el.querySelector('[data-r="hire"]');
      btn.addEventListener("click", () => s.hireManager());
      this.refs.__hireBtn = btn;
    }
  }

  /** Карточка непокупленного объекта */
  _buyCard(def) {
    const card = document.createElement("div");
    card.className = "prop-card";
    const paybackH = def.price / (def.rent * 3600);
    card.innerHTML = `
      <div class="prop-head">
        <div class="prop-icon">${def.icon}</div>
        <div class="prop-name">${def.name}</div>
        <span class="chip">${def.cls}</span>
      </div>
      <div class="prop-desc">${def.desc}</div>
      <div class="prop-meta">
        <span class="label">Цена</span><span class="value">${Fmt.moneyShort(def.price)}</span>
        <span class="label">Базовая аренда</span><span class="value income">+${Fmt.money(def.rent)}/с</span>
        <span class="label">Окупаемость</span><span class="value">~${paybackH < 10 ? paybackH.toFixed(1) : Math.round(paybackH)} ч</span>
      </div>
      <button class="buy-btn" data-r="buy">Купить за ${Fmt.moneyShort(def.price)}</button>
    `;
    const buyBtn = card.querySelector('[data-r="buy"]');
    buyBtn.addEventListener("click", () => this.state.buyProperty(def.id));
    this.refs[def.id] = { card, buyBtn, price: def.price };
    return card;
  }

  /** Карточка купленного объекта: уровень, состояние, аренда */
  _ownedCard(def) {
    const s = this.state;
    const p = s.props[def.id];
    const card = document.createElement("div");
    card.className = "prop-card owned";

    const stars = [1, 2, 3]
      .map((i) => `<span class="${i <= p.lv ? "" : "off"}">★</span>`)
      .join("");

    // --- блок статуса аренды (форма зависит от состояния) ---
    let statusHTML;
    if (p.lease) {
      statusHTML = `
        <div class="status-line">
          🧾 <b>${p.lease.tenant}</b> · ставка ×${p.lease.mult}<br>
          <span class="green">+<span data-r="rentNow">—</span>/с</span>
          <span class="muted">· осталось <span data-r="leaseLeft">—</span></span>
        </div>`;
    } else if (p.offer) {
      const o = p.offer;
      const offerRent = def.rent * CONFIG.UPGRADE_MULTS[p.lv] * condMult(p.cond) * o.mult;
      statusHTML = `
        <div class="status-line">
          <div class="offer-box">
            💡 <b>${o.tenant}</b> предлагает ставку <b>×${o.mult}</b> на <b>${o.hours} ч</b><br>
            <span class="green">≈ +${Fmt.money(offerRent)}/с</span>
            <span class="muted">· решение через <span data-r="offerLeft">—</span></span>
            <div class="row-btns">
              <button class="btn-sm green" data-r="accept">Принять</button>
              <button class="btn-sm red" data-r="decline">Искать другого</button>
            </div>
          </div>
        </div>`;
    } else if (s.managerHired) {
      statusHTML = `<div class="status-line muted">🤵 Управляющий подбирает арендатора…</div>`;
    } else {
      statusHTML = `<div class="status-line muted">🔍 Идёт поиск арендатора…</div>`;
    }

    const upCost = p.lv < 3 ? def.price * CONFIG.UPGRADE_COSTS[p.lv] : 0;
    const partCost = def.price * CONFIG.REPAIR_PARTIAL_COST;
    const fullCost = def.price * CONFIG.REPAIR_FULL_COST;

    card.innerHTML = `
      <div class="prop-head">
        <div class="prop-icon">${def.icon}</div>
        <div class="prop-name">${def.name}</div>
        <span class="chip">${def.cls}</span>
      </div>
      <div class="prop-meta">
        <span class="label">Уровень</span><span class="value stars">${stars}</span>
        <span class="label">Вложено</span><span class="value">${Fmt.moneyShort(p.invested)}</span>
      </div>
      <div class="cond-row">
        <span class="muted">Состояние</span>
        <div class="cond-bar"><div class="cond-fill" data-r="condFill"></div></div>
        <span class="cond-pct" data-r="condPct">—</span>
      </div>
      <div class="row-btns">
        ${p.lv < 3
          ? `<button class="btn-sm gold" data-r="upgrade" title="Аренда ×${CONFIG.UPGRADE_MULTS[p.lv + 1]}">⬆ ${CONFIG.UPGRADE_NAMES[p.lv + 1]} · ${Fmt.moneyShort(upCost)}</button>`
          : `<span class="chip rating">Макс. уровень</span>`}
        <button class="btn-sm" data-r="repairPart" title="+${CONFIG.REPAIR_PARTIAL_GAIN} к состоянию">🔧 ${Fmt.moneyShort(partCost)}</button>
        <button class="btn-sm" data-r="repairFull" title="Состояние до 100%">🛠 ${Fmt.moneyShort(fullCost)}</button>
      </div>
      ${statusHTML}
    `;

    const r = (name) => card.querySelector(`[data-r="${name}"]`);
    if (r("upgrade")) r("upgrade").addEventListener("click", () => s.upgradeProperty(def.id));
    r("repairPart").addEventListener("click", () => s.repairProperty(def.id, false));
    r("repairFull").addEventListener("click", () => s.repairProperty(def.id, true));
    if (r("accept")) r("accept").addEventListener("click", () => s.acceptOffer(def.id));
    if (r("decline")) r("decline").addEventListener("click", () => s.declineOffer(def.id));

    this.refs[def.id] = {
      card, owned: true,
      condFill: r("condFill"), condPct: r("condPct"),
      rentNow: r("rentNow"), leaseLeft: r("leaseLeft"), offerLeft: r("offerLeft"),
      upgradeBtn: r("upgrade"), repairPart: r("repairPart"), repairFull: r("repairFull"),
      upCost, partCost, fullCost,
    };
    return card;
  }

  /** Точечные обновления раз в секунду: таймеры, износ, доступность кнопок */
  tickUpdate() {
    const s = this.state;
    const now = Date.now();

    const q = (name) => this.container.querySelector(`[data-r="${name}"]`);
    const count = q("count");
    if (count) {
      count.textContent = `${s.ownedPropsCount} / ${PROPERTY_DEFS.length}`;
      q("rent").textContent = "+" + Fmt.money(s.rentPerSec) + "/с";
      q("vacant").textContent = s.vacantPropsCount;
      q("invested").textContent = Fmt.moneyShort(s.propsInvested);
    }
    if (this.refs.__hireBtn) this.refs.__hireBtn.disabled = s.balance < CONFIG.MANAGER_HIRE_COST;

    PROPERTY_DEFS.forEach((def) => {
      const refs = this.refs[def.id];
      if (!refs) return;
      const p = s.props[def.id];

      if (!p) {
        refs.buyBtn.disabled = s.balance < refs.price;
        return;
      }
      // состояние
      if (refs.condFill) {
        refs.condFill.style.width = p.cond + "%";
        refs.condFill.className =
          "cond-fill" + (p.cond < 40 ? " bad" : p.cond < 70 ? " warn" : "");
        refs.condPct.textContent = Math.round(p.cond) + "%";
      }
      // таймеры
      if (refs.rentNow && p.lease) {
        refs.rentNow.textContent = Fmt.money(s.propNetRent(def.id));
        refs.leaseLeft.textContent = Fmt.durShort((p.lease.end - now) / 1000);
      }
      if (refs.offerLeft && p.offer) {
        refs.offerLeft.textContent = Fmt.durShort((p.offer.expires - now) / 1000);
      }
      // доступность кнопок
      if (refs.upgradeBtn) refs.upgradeBtn.disabled = s.balance < refs.upCost;
      refs.repairPart.disabled = s.balance < refs.partCost || p.cond >= 99.5;
      refs.repairFull.disabled = s.balance < refs.fullCost || p.cond >= 99.5;
    });
  }
}
