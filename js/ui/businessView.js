/**
 * Вкладка «Бизнес»: карточки шести бизнесов с общей прокачкой (25 уровней,
 * ранги каждые 5) и индивидуальным блоком механики у каждого.
 * Паттерн как у недвижимости: build() на структурные события,
 * tickUpdate() — точечные обновления таймеров/баров/кнопок раз в секунду.
 */
class BusinessView {
  constructor(state) {
    this.state = state;
    this.refs = {};
  }

  render(container) {
    this.container = container;
    this.build();
    this.state.on("structural", ({ scope }) => {
      if (scope === "business" || scope === "all") this.build();
    });
    this.state.on("tick", () => this.tickUpdate());
  }

  build() {
    this.refs = {};
    const s = this.state;
    this.container.innerHTML = `
      <div class="summary-bar">
        <div class="sum-item"><div class="sum-label">Бизнесов</div><div class="sum-value" data-r="count">—</div></div>
        <div class="sum-item"><div class="sum-label">Доход бизнесов</div><div class="sum-value pos" data-r="income">—</div></div>
        <div class="sum-item"><div class="sum-label">Вложено</div><div class="sum-value" data-r="invested">—</div></div>
      </div>
      <div class="prop-grid biz-grid" data-r="grid"></div>
    `;
    const grid = this.container.querySelector('[data-r="grid"]');
    BUSINESS_DEFS.forEach((def) => {
      grid.appendChild(s.businesses[def.id] ? this._openedCard(def) : this._closedCard(def));
    });
    this.tickUpdate();
  }

  _closedCard(def) {
    const card = document.createElement("div");
    card.className = "prop-card";
    const paybackH = def.openCost / (def.base * 3600);
    card.innerHTML = `
      <div class="prop-head">
        <div class="prop-icon">${def.icon}</div>
        <div class="prop-name">${def.name}</div>
        <span class="chip">бизнес</span>
      </div>
      <div class="prop-desc">${def.desc}</div>
      <div class="prop-desc" style="color: var(--accent-gold)">${def.mechHint}</div>
      <div class="prop-meta">
        <span class="label">Открытие</span><span class="value">${Fmt.moneyShort(def.openCost)}</span>
        <span class="label">Базовый доход</span><span class="value income">+${Fmt.money(def.base)}/с</span>
        <span class="label">Окупаемость</span><span class="value">~${paybackH < 10 ? paybackH.toFixed(1) : Math.round(paybackH)} ч</span>
        <span class="label">Прокачка</span><span class="value">${CONFIG.BIZ_MAX_LV} уровней · 5 рангов</span>
      </div>
      <button class="buy-btn" data-r="open">Открыть за ${Fmt.moneyShort(def.openCost)}</button>
    `;
    const openBtn = card.querySelector('[data-r="open"]');
    openBtn.addEventListener("click", () => this.state.openBusiness(def.id));
    this.refs[def.id] = { openBtn, openCost: def.openCost };
    return card;
  }

  _openedCard(def) {
    const s = this.state;
    const b = s.businesses[def.id];
    const card = document.createElement("div");
    card.className = "prop-card owned";

    const rank = s.bizRank(b.lv);
    const nextRankAt = (rank + 1) * 5;
    const rankChip = rank > 0
      ? `<span class="chip rating">${def.ranks[rank - 1].name}</span>`
      : `<span class="chip">новичок</span>`;

    const upCost = b.lv < CONFIG.BIZ_MAX_LV ? s.bizUpgradeCost(def, b.lv) : 0;
    const nextRankHint = b.lv < CONFIG.BIZ_MAX_LV
      ? `<div class="biz-next-rank">До ранга «${def.ranks[rank].name}» (${def.ranks[rank].bonus}): ${nextRankAt - b.lv} ур.</div>`
      : `<div class="biz-next-rank">🏆 Максимальный уровень!</div>`;

    card.innerHTML = `
      <div class="prop-head">
        <div class="prop-icon">${def.icon}</div>
        <div class="prop-name">${def.name}</div>
        ${rankChip}
      </div>
      <div class="prop-meta">
        <span class="label">Уровень</span><span class="value">${b.lv} / ${CONFIG.BIZ_MAX_LV}</span>
        <span class="label">Доход</span><span class="value income" data-r="inc">—</span>
        <span class="label">Вложено</span><span class="value">${Fmt.moneyShort(b.invested)}</span>
      </div>
      ${b.lv < CONFIG.BIZ_MAX_LV
        ? `<button class="btn-sm gold" data-r="up">⬆ Уровень ${b.lv + 1} · ${Fmt.moneyShort(upCost)}</button>`
        : ""}
      ${nextRankHint}
      <div class="biz-mech" data-r="mech"></div>
    `;

    const refs = { inc: card.querySelector('[data-r="inc"]'), upBtn: card.querySelector('[data-r="up"]'), upCost };
    if (refs.upBtn) refs.upBtn.addEventListener("click", () => s.upgradeBusiness(def.id));
    this._buildMech(def, b, card.querySelector('[data-r="mech"]'), refs);
    this.refs[def.id] = refs;
    return card;
  }

  /** Индивидуальный блок механики бизнеса */
  _buildMech(def, b, el, refs) {
    const s = this.state;
    const now = Date.now();

    if (def.id === "coffee") {
      const cap = s.coffeeStockCap(b);
      el.innerHTML = `
        <div class="cond-row">
          <span class="muted">☕ Зерно</span>
          <div class="cond-bar"><div class="cond-fill" data-r="stockFill"></div></div>
          <span class="cond-pct" data-r="stockH">—</span>
        </div>
        <div class="row-btns">
          <button class="btn-sm" data-r="buy6">+6 ч · <span data-r="cost6">—</span></button>
          <button class="btn-sm" data-r="buyMax">Под завязку</button>
          ${b.lv >= 10 ? `<button class="btn-sm ${b.auto ? "green" : ""}" data-r="auto">${b.auto ? "🤖 Автозакупка вкл" : "Автозакупка выкл"}</button>` : ""}
        </div>
        ${b.stockH <= 0 ? `<div class="status-line muted">⚠ Зерно кончилось — доход 25%!</div>` : ""}
      `;
      el.querySelector('[data-r="buy6"]').addEventListener("click", () => s.buySupplies(6));
      el.querySelector('[data-r="buyMax"]').addEventListener("click", () => s.buySupplies(cap));
      const autoBtn = el.querySelector('[data-r="auto"]');
      if (autoBtn) autoBtn.addEventListener("click", () => {
        b.auto = !b.auto;
        s.structural("business");
      });
      Object.assign(refs, {
        stockFill: el.querySelector('[data-r="stockFill"]'),
        stockH: el.querySelector('[data-r="stockH"]'),
        cost6: el.querySelector('[data-r="cost6"]'),
        buy6: el.querySelector('[data-r="buy6"]'),
        buyMax: el.querySelector('[data-r="buyMax"]'),
        cap,
      });
    }

    if (def.id === "taxi") {
      const limit = s.taxiCarLimit(b);
      const broken = b.cars.filter((c) => c.broken).length;
      const carsIcons = b.cars.map((c) => (c.broken ? "🛠" : "🚕")).join(" ");
      el.innerHTML = `
        <div class="status-line">
          Машины (${b.cars.length}/${limit}): ${carsIcons || "—"}
          ${broken ? `<br><span class="muted">Сломано: ${broken}</span>` : ""}
        </div>
        <div class="row-btns">
          <button class="btn-sm gold" data-r="buyCar">🚕 Купить · ${Fmt.moneyShort(s.taxiCarCost(b))}</button>
          ${broken ? `<button class="btn-sm red" data-r="repair">🔧 Починить все · ${Fmt.moneyShort(s.taxiRepairCost(b))}</button>` : ""}
        </div>
      `;
      const buyBtn = el.querySelector('[data-r="buyCar"]');
      buyBtn.addEventListener("click", () => s.buyCar());
      if (b.cars.length >= limit) buyBtn.disabled = true;
      const repBtn = el.querySelector('[data-r="repair"]');
      if (repBtn) repBtn.addEventListener("click", () => s.repairCars());
      Object.assign(refs, { carBuy: buyBtn, carCost: s.taxiCarCost(b), carLimit: limit, carCount: b.cars.length,
        carRepair: repBtn, repairCost: s.taxiRepairCost(b) });
    }

    if (def.id === "shop") {
      if (b.boost && now < b.boost.until) {
        el.innerHTML = `
          <div class="status-line green">📣 «${b.boost.name}»: доход ×${b.boost.mult.toFixed(2)}
            · осталось <span data-r="boostLeft">—</span></div>
        `;
        refs.boostLeft = el.querySelector('[data-r="boostLeft"]');
      } else {
        const onCd = b.lv < 10 && now < b.cooldownUntil;
        el.innerHTML = `
          ${onCd ? `<div class="status-line muted">⏳ Перерыв: <span data-r="cdLeft">—</span></div>` : ""}
          <div class="row-btns" data-r="camps"></div>
        `;
        refs.cdLeft = el.querySelector('[data-r="cdLeft"]');
        const box = el.querySelector('[data-r="camps"]');
        refs.campBtns = [];
        def.campaigns.forEach((c) => {
          const btn = document.createElement("button");
          btn.className = "btn-sm";
          const price = s.shopCampaignPrice(c);
          btn.textContent = `${c.name} ×${c.mult} · ${Fmt.moneyShort(price)}`;
          btn.title = `${c.durH} ч буста`;
          btn.addEventListener("click", () => s.runCampaign(c.id));
          if (onCd) btn.disabled = true;
          box.appendChild(btn);
          refs.campBtns.push({ btn, price, onCd });
        });
      }
    }

    if (def.id === "factory") {
      if (b.contract) {
        el.innerHTML = `
          <div class="status-line green">📝 ${b.contract.client} · ×${b.contract.mult}
            · осталось <span data-r="contractLeft">—</span></div>
        `;
        refs.contractLeft = el.querySelector('[data-r="contractLeft"]');
      } else if (b.offer) {
        el.innerHTML = `
          <div class="offer-box">
            📋 <b>${b.offer.client}</b>: ставка <b>×${b.offer.mult}</b> на <b>${b.offer.hours} ч</b><br>
            <span class="muted">решение через <span data-r="offerLeft">—</span></span>
            <div class="row-btns">
              <button class="btn-sm green" data-r="accept">Подписать</button>
              <button class="btn-sm red" data-r="decline">Ждать лучший</button>
            </div>
          </div>
        `;
        el.querySelector('[data-r="accept"]').addEventListener("click", () => s.acceptContract());
        el.querySelector('[data-r="decline"]').addEventListener("click", () => s.declineContract());
        refs.offerLeft = el.querySelector('[data-r="offerLeft"]');
      } else {
        el.innerHTML = `<div class="status-line muted">🏭 Работаем на склад (${(s.bizMechMult("factory") * 100).toFixed(0)}%)… ждём заказов</div>`;
      }
    }

    if (def.id === "startup") {
      const capReached = b.rndMult >= def.rnd.cap;
      if (b.project) {
        el.innerHTML = `
          <div class="status-line">🧪 R&D «${b.project.name}» · готов через <span data-r="projLeft">—</span>
            <br><span class="muted">Текущий множитель R&D: ×${b.rndMult.toFixed(2)}</span></div>
        `;
        refs.projLeft = el.querySelector('[data-r="projLeft"]');
      } else {
        el.innerHTML = `
          <div class="status-line"><span class="green">R&D ×${b.rndMult.toFixed(2)}</span>
            <span class="muted">(макс ×${def.rnd.cap})</span></div>
          ${capReached ? "" : `<div class="row-btns" data-r="projects"></div>`}
        `;
        if (!capReached) {
          const box = el.querySelector('[data-r="projects"]');
          refs.projBtns = [];
          def.rnd.projects.forEach((p) => {
            const chance = Math.min(1, p.chance + (b.lv >= 10 ? 0.10 : 0));
            const price = s.startupProjectPrice(p);
            const btn = document.createElement("button");
            btn.className = "btn-sm";
            btn.textContent = `${p.name} +${(p.gain * 100).toFixed(0)}% (${(chance * 100).toFixed(0)}%) · ${Fmt.moneyShort(price)}`;
            btn.title = `Длительность ${b.lv >= 20 ? p.durH / 2 : p.durH} ч; при неудаче ${p.failGain >= 0 ? "+" : ""}${(p.failGain * 100).toFixed(0)}%`;
            btn.addEventListener("click", () => s.startProject(p.id));
            box.appendChild(btn);
            refs.projBtns.push({ btn, price });
          });
        }
      }
    }

    if (def.id === "studio") {
      const catalog = `Каталог: ${b.films} фильмов (+${(s.bizMechMult("studio") * 100 - 100).toFixed(0)}% к доходу)`
        + (b.lastBox ? ` · прошлые сборы ×${b.lastBox.toFixed(2)}` : "");
      if (b.film) {
        el.innerHTML = `
          <div class="status-line">🎥 Съёмки: бюджет ${Fmt.moneyShort(b.film.budget)}
            · премьера через <span data-r="filmLeft">—</span>
            <br><span class="muted">${catalog}</span></div>
        `;
        refs.filmLeft = el.querySelector('[data-r="filmLeft"]');
      } else {
        const perHour = s.bizHourlyFull("studio");
        const min = Math.ceil(perHour * def.film.budgetMinH);
        const max = Math.floor(perHour * def.film.budgetMaxH);
        el.innerHTML = `
          <div class="status-line muted">${catalog}</div>
          <div class="dep-form">
            <input type="number" class="num-input" data-r="budget" placeholder="Бюджет" min="${min}" value="${min}">
            <button class="btn-sm" data-r="bmin">Мин</button>
            <button class="btn-sm" data-r="bmax">Макс</button>
            <button class="btn-sm gold" data-r="shoot">🎬 Снимать</button>
          </div>
          <div class="fee-note">Бюджет ${Fmt.moneyShort(min)} – ${Fmt.moneyShort(max)} · сборы ×0.4–×4</div>
        `;
        const input = el.querySelector('[data-r="budget"]');
        el.querySelector('[data-r="bmin"]').addEventListener("click", () => (input.value = min));
        el.querySelector('[data-r="bmax"]').addEventListener("click", () =>
          (input.value = Math.min(max, Math.floor(this.state.balance))));
        el.querySelector('[data-r="shoot"]').addEventListener("click", () =>
          s.startFilm(parseFloat(input.value) || 0));
        refs.shootBtn = el.querySelector('[data-r="shoot"]');
        refs.budgetInput = input;
        refs.budgetMin = min;
      }
    }
  }

  /** Точечные обновления раз в секунду */
  tickUpdate() {
    const s = this.state;
    const now = Date.now();
    const q = (name) => this.container.querySelector(`[data-r="${name}"]`);
    const count = q("count");
    if (count) {
      count.textContent = `${BUSINESS_DEFS.filter((d) => s.businesses[d.id]).length} / ${BUSINESS_DEFS.length}`;
      q("income").textContent = "+" + Fmt.money(s.businessPerSec) + "/с";
      q("invested").textContent = Fmt.moneyShort(s.bizInvested);
    }

    BUSINESS_DEFS.forEach((def) => {
      const refs = this.refs[def.id];
      if (!refs) return;
      const b = s.businesses[def.id];

      if (!b) {
        refs.openBtn.disabled = s.balance < refs.openCost;
        return;
      }
      if (refs.inc) refs.inc.textContent = "+" + Fmt.money(s.bizIncome(def.id, false, now)) + "/с";
      if (refs.upBtn) refs.upBtn.disabled = s.balance < refs.upCost;

      // Механики
      if (refs.stockFill) {
        refs.stockFill.style.width = U.clamp((b.stockH / refs.cap) * 100, 0, 100) + "%";
        refs.stockFill.className = "cond-fill" + (b.stockH < 2 ? " bad" : b.stockH < 5 ? " warn" : "");
        refs.stockH.textContent = b.stockH.toFixed(1) + " ч";
        const cost6 = s.coffeeSupplyCost(Math.min(6, refs.cap - b.stockH));
        refs.cost6.textContent = Fmt.moneyShort(cost6);
        refs.buy6.disabled = b.stockH >= refs.cap - 0.1 || s.balance < cost6;
        refs.buyMax.disabled = b.stockH >= refs.cap - 0.1;
      }
      if (refs.carBuy) {
        refs.carBuy.disabled = refs.carCount >= refs.carLimit || s.balance < refs.carCost;
        if (refs.carRepair) refs.carRepair.disabled = s.balance < refs.repairCost;
      }
      if (refs.boostLeft && b.boost) refs.boostLeft.textContent = Fmt.durShort((b.boost.until - now) / 1000);
      if (refs.cdLeft) refs.cdLeft.textContent = Fmt.durShort((b.cooldownUntil - now) / 1000);
      if (refs.campBtns) refs.campBtns.forEach(({ btn, price, onCd }) => {
        btn.disabled = onCd || s.balance < price;
      });
      if (refs.contractLeft && b.contract) refs.contractLeft.textContent = Fmt.durShort((b.contract.end - now) / 1000);
      if (refs.offerLeft && b.offer) refs.offerLeft.textContent = Fmt.durShort((b.offer.expires - now) / 1000);
      if (refs.projLeft && b.project) refs.projLeft.textContent = Fmt.durShort((b.project.done - now) / 1000);
      if (refs.projBtns) refs.projBtns.forEach(({ btn, price }) => (btn.disabled = s.balance < price));
      if (refs.filmLeft && b.film) refs.filmLeft.textContent = Fmt.durShort((b.film.done - now) / 1000);
      if (refs.shootBtn) {
        const v = parseFloat(refs.budgetInput.value) || 0;
        refs.shootBtn.disabled = v < refs.budgetMin * 0.99 || s.balance < v;
      }
    });
  }
}
