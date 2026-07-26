
const PROP_BY_ID = Object.fromEntries(PROPERTY_DEFS.map((d) => [d.id, d]));
const ASSET_BY_ID = Object.fromEntries(MARKET_ASSETS.map((d) => [d.id, d]));
const DEP_BY_ID = Object.fromEntries(DEPOSIT_DEFS.map((d) => [d.id, d]));

function freshStats() {
  return {
    totalEarned: 0,   // всё заработанное (аренда, купоны, дивиденды, % по вкладам, сделки, трейдинг)
    rentEarned: 0,
    couponEarned: 0,
    divEarned: 0,
    depositEarned: 0,
    clickEarned: 0,
    tradeProfit: 0,   // реализованный P&L трейдинга (может быть отрицательным)
    feesPaid: 0,
    repairSpent: 0,
    upgradeSpent: 0,
    managerPaid: 0,
    totalSpent: 0,    // потрачено на покупку активов
    playTimeSec: 0,
    startedAt: Date.now(),
  };
}

/**
 * Центральное состояние игры. Все мутации — только через методы,
 * каждая значимая мутация порождает события:
 *  'tick'       — раз в секунду (обновить числа в UI)
 *  'market'     — раз в рыночный тик (обновить котировки)
 *  'structural' — {scope} изменилась структура (перестроить карточки)
 *  'toast'      — {type, msg} показать уведомление
 *  'dirty'      — состояние стоит сохранить
 */
class GameState extends EventEmitter {
  constructor() {
    super();
    this.balance = CONFIG.STARTING_BALANCE;
    this.stats = freshStats();

    // Недвижимость: id -> null (не куплено) | состояние объекта
    this.props = {};
    PROPERTY_DEFS.forEach((d) => (this.props[d.id] = null));

    // Биржевой портфель: assetId -> { qty, avg (средняя цена входа с комиссией) }
    this.portfolio = {};

    // Остаток первичного размещения облигаций
    this.bondsRemaining = {};
    BOND_DEFS.forEach((b) => (this.bondsRemaining[b.id] = b.issue));
    this.bondDefault = {}; // bondId -> timestamp, до которого купоны заморожены

    // Вклады: prodId -> null | { principal, openedAt, maturesAt, accrued }
    this.deposits = {};
    DEPOSIT_DEFS.forEach((d) => (this.deposits[d.id] = null));

    this.managerHired = false;
    this.market = new MarketSim(MARKET_ASSETS);

    // TODO: достижения (this.achievements), бусты (this.boosts)
  }

  // ======================= ВСПОМОГАТЕЛЬНОЕ =======================
  toast(type, msg) { this.emit("toast", { type, msg }); }
  dirty() { this.emit("dirty"); }
  structural(scope) { this.emit("structural", { scope }); }

  _tenantFor(def) {
    if (def.pool === "res") return U.choice(TENANTS_RES);
    if (def.pool === "com") return U.choice(TENANTS_COM);
    return U.choice(Math.random() < 0.5 ? TENANTS_RES : TENANTS_COM);
  }

  // ======================= ДОХОДЫ (₽/сек) =======================
  /** Грязная аренда объекта (до комиссии управляющего) */
  propGrossRent(id) {
    const p = this.props[id];
    if (!p || !p.lease) return 0;
    const def = PROP_BY_ID[id];
    return def.rent * CONFIG.UPGRADE_MULTS[p.lv] * condMult(p.cond) * p.lease.mult;
  }
  /** Чистая аренда объекта (после комиссии) */
  propNetRent(id) {
    return this.propGrossRent(id) * (this.managerHired ? 1 - CONFIG.MANAGER_CUT : 1);
  }
  get rentPerSec() {
    return PROPERTY_DEFS.reduce((s, d) => s + this.propNetRent(d.id), 0);
  }
  get couponPerSec() {
    const now = Date.now();
    return BOND_DEFS.reduce((s, b) => {
      const pos = this.portfolio[b.id];
      if (!pos || !pos.qty || this.bondDefault[b.id] > now) return s;
      return s + (pos.qty * b.face * b.coupon) / 3600;
    }, 0);
  }
  get divPerSec() {
    return STOCK_DEFS.reduce((s, d) => {
      const pos = this.portfolio[d.id];
      if (!pos || !pos.qty || !d.div) return s;
      return s + (pos.qty * this.market.price(d.id) * d.div) / 3600;
    }, 0);
  }
  get depositPerSec() {
    return DEPOSIT_DEFS.reduce((s, d) => {
      const dep = this.deposits[d.id];
      if (!dep || d.termH !== 0) return s; // срочные платят в конце срока
      return s + (dep.principal * d.rate) / 3600;
    }, 0);
  }
  get incomePerSec() {
    return this.rentPerSec + this.couponPerSec + this.divPerSec + this.depositPerSec;
  }

  portfolioValue(kind = null) {
    return MARKET_ASSETS.reduce((s, d) => {
      if (kind && d.kind !== kind) return s;
      const pos = this.portfolio[d.id];
      return pos ? s + pos.qty * this.market.price(d.id) : s;
    }, 0);
  }
  portfolioInvested(kind = null) {
    return MARKET_ASSETS.reduce((s, d) => {
      if (kind && d.kind !== kind) return s;
      const pos = this.portfolio[d.id];
      return pos ? s + pos.qty * pos.avg : s;
    }, 0);
  }
  get propsInvested() {
    return PROPERTY_DEFS.reduce((s, d) => s + (this.props[d.id]?.invested || 0), 0);
  }
  get depositsTotal() {
    return DEPOSIT_DEFS.reduce((s, d) => {
      const dep = this.deposits[d.id];
      return dep ? s + dep.principal + (dep.accrued || 0) : s;
    }, 0);
  }
  get netWorth() {
    return this.balance + this.propsInvested + this.portfolioValue() + this.depositsTotal;
  }
  get ownedPropsCount() {
    return PROPERTY_DEFS.filter((d) => this.props[d.id]).length;
  }
  get vacantPropsCount() {
    return PROPERTY_DEFS.filter((d) => this.props[d.id] && !this.props[d.id].lease).length;
  }

  // ======================= ИГРОВОЙ ТИК (1 сек) =======================
  tick(dt, now = Date.now()) {
    let structuralRealty = false;
    let structuralDeposits = false;

    // --- Недвижимость: аренда, износ, окончание договоров, кандидаты ---
    for (const def of PROPERTY_DEFS) {
      const p = this.props[def.id];
      if (!p) continue;

      if (p.lease) {
        const gross = this.propGrossRent(def.id);
        const cut = this.managerHired ? gross * CONFIG.MANAGER_CUT : 0;
        const inc = (gross - cut) * dt;
        this.balance += inc;
        this.stats.rentEarned += inc;
        this.stats.totalEarned += inc;
        this.stats.managerPaid += cut * dt;

        const wear = (CONFIG.WEAR_LEASED_PER_HOUR * (1 - CONFIG.WEAR_LEVEL_DISCOUNT * p.lv)) / 3600;
        p.cond = Math.max(0, p.cond - wear * dt);

        if (now >= p.lease.end) {
          this.toast("warn", `${p.lease.tenant}: договор аренды «${def.name}» истёк`);
          p.lease = null;
          this._startVacancy(p, now);
          structuralRealty = true;
          this.dirty();
        }
      } else {
        p.cond = Math.max(0, p.cond - (CONFIG.WEAR_VACANT_PER_HOUR / 3600) * dt);

        if (this.managerHired) {
          if (p.autoLeaseAt && now >= p.autoLeaseAt) {
            this._managerLease(def, p, now);
            structuralRealty = true;
          }
        } else if (p.searching) {
          if (p.offer) {
            if (now >= p.offer.expires) {
              p.offer = null;
              p.nextOfferAt = now + U.rand(...CONFIG.OFFER_DELAY) * 1000;
              structuralRealty = true;
            }
          } else if (now >= p.nextOfferAt) {
            p.offer = this._makeOffer(def, now);
            structuralRealty = true;
          }
        }
      }
    }

    // --- Купоны облигаций (непрерывное начисление; дефолт замораживает) ---
    for (const b of BOND_DEFS) {
      const pos = this.portfolio[b.id];
      if (!pos || !pos.qty || this.bondDefault[b.id] > now) continue;
      const inc = ((pos.qty * b.face * b.coupon) / 3600) * dt;
      this.balance += inc;
      this.stats.couponEarned += inc;
      this.stats.totalEarned += inc;
    }

    // --- Дивиденды акций ---
    for (const d of STOCK_DEFS) {
      if (!d.div) continue;
      const pos = this.portfolio[d.id];
      if (!pos || !pos.qty) continue;
      const inc = ((pos.qty * this.market.price(d.id) * d.div) / 3600) * dt;
      this.balance += inc;
      this.stats.divEarned += inc;
      this.stats.totalEarned += inc;
    }

    // --- Вклады: начисление «Копилки», выплата срочных ---
    for (const d of DEPOSIT_DEFS) {
      const dep = this.deposits[d.id];
      if (!dep) continue;
      if (d.termH === 0) {
        dep.accrued += ((dep.principal * d.rate) / 3600) * dt;
      } else if (now >= dep.maturesAt) {
        const interest = dep.principal * d.rate * d.termH;
        this.balance += dep.principal + interest;
        this.stats.depositEarned += interest;
        this.stats.totalEarned += interest;
        this.deposits[d.id] = null;
        this.toast("success", `Вклад ${d.name} закрыт: +${Fmt.money(dep.principal + interest)}`);
        structuralDeposits = true;
        this.dirty();
      }
    }

    this.stats.playTimeSec += dt;
    if (structuralRealty) this.structural("realty");
    if (structuralDeposits) this.structural("deposits");
    this.emit("tick", { dt });
  }

  /** Рыночный тик (каждые 3 сек) */
  marketTick() {
    this.market.tick();
    this.emit("market");
  }

  // ======================= АРЕНДА: внутренняя логика =======================
  _startVacancy(p, now) {
    p.offer = null;
    if (this.managerHired) {
      p.searching = false;
      p.autoLeaseAt = now + U.rand(...CONFIG.MANAGER_LEASE_DELAY) * 1000;
    } else {
      p.searching = true;
      p.autoLeaseAt = 0;
      p.nextOfferAt = now + U.rand(...CONFIG.OFFER_DELAY) * 1000;
    }
  }

  _makeOffer(def, now) {
    return {
      tenant: this._tenantFor(def),
      mult: Math.round(U.rand(...CONFIG.RATE_RANGE) * 100) / 100,
      hours: Math.round(U.rand(...CONFIG.LEASE_HOURS) * 2) / 2,
      expires: now + CONFIG.OFFER_TTL * 1000,
    };
  }

  _managerLease(def, p, now) {
    const mult = Math.round(U.rand(...CONFIG.MANAGER_RATE) * 100) / 100;
    p.lease = {
      tenant: this._tenantFor(def),
      mult,
      end: now + U.rand(...CONFIG.LEASE_HOURS) * 3600 * 1000,
    };
    p.autoLeaseAt = 0;
    this.toast("success", `Управляющий сдал «${def.name}» (ставка ×${mult})`);
    this.dirty();
  }

  // ======================= ДЕЙСТВИЯ: НЕДВИЖИМОСТЬ =======================
  buyProperty(id) {
    const def = PROP_BY_ID[id];
    if (!def || this.props[id] || this.balance < def.price) return false;
    this.balance -= def.price;
    this.stats.totalSpent += def.price;
    this.props[id] = {
      lv: 0, cond: 100, lease: null,
      searching: false, offer: null, nextOfferAt: 0, autoLeaseAt: 0,
      invested: def.price,
    };
    this._startVacancy(this.props[id], Date.now());
    this.toast("success", `Куплено: «${def.name}». Ищем арендатора!`);
    this.structural("realty");
    this.dirty();
    return true;
  }

  upgradeProperty(id) {
    const def = PROP_BY_ID[id];
    const p = this.props[id];
    if (!def || !p || p.lv >= 3) return false;
    const cost = def.price * CONFIG.UPGRADE_COSTS[p.lv];
    if (this.balance < cost) return false;
    this.balance -= cost;
    p.lv += 1;
    p.invested += cost;
    this.stats.upgradeSpent += cost;
    this.toast("success", `«${def.name}» улучшен: ${CONFIG.UPGRADE_NAMES[p.lv]} (аренда ×${CONFIG.UPGRADE_MULTS[p.lv]})`);
    this.structural("realty");
    this.dirty();
    return true;
  }

  repairProperty(id, full) {
    const def = PROP_BY_ID[id];
    const p = this.props[id];
    if (!def || !p) return false;
    const cost = def.price * (full ? CONFIG.REPAIR_FULL_COST : CONFIG.REPAIR_PARTIAL_COST);
    if (this.balance < cost) return false;
    this.balance -= cost;
    this.stats.repairSpent += cost;
    p.cond = full ? 100 : Math.min(100, p.cond + CONFIG.REPAIR_PARTIAL_GAIN);
    this.structural("realty");
    this.dirty();
    return true;
  }

  acceptOffer(id) {
    const def = PROP_BY_ID[id];
    const p = this.props[id];
    if (!def || !p || !p.offer) return false;
    const o = p.offer;
    p.lease = { tenant: o.tenant, mult: o.mult, end: Date.now() + o.hours * 3600 * 1000 };
    p.offer = null;
    p.searching = false;
    this.toast("success", `«${def.name}» сдан: ${o.tenant}, ставка ×${o.mult} на ${o.hours} ч`);
    this.structural("realty");
    this.dirty();
    return true;
  }

  declineOffer(id) {
    const p = this.props[id];
    if (!p || !p.offer) return false;
    p.offer = null;
    p.nextOfferAt = Date.now() + U.rand(...CONFIG.OFFER_DELAY) * 1000;
    this.structural("realty");
    return true;
  }

  hireManager() {
    if (this.managerHired || this.balance < CONFIG.MANAGER_HIRE_COST) return false;
    this.balance -= CONFIG.MANAGER_HIRE_COST;
    this.stats.managerPaid += CONFIG.MANAGER_HIRE_COST;
    this.managerHired = true;
    const now = Date.now();
    PROPERTY_DEFS.forEach((d) => {
      const p = this.props[d.id];
      if (p && !p.lease) this._startVacancy(p, now);
    });
    this.toast("success", "Управляющий нанят: арендаторы теперь находятся сами");
    this.structural("realty");
    this.dirty();
    return true;
  }

  fireManager() {
    if (!this.managerHired) return false;
    this.managerHired = false;
    const now = Date.now();
    PROPERTY_DEFS.forEach((d) => {
      const p = this.props[d.id];
      if (p && !p.lease) this._startVacancy(p, now);
    });
    this.toast("warn", "Управляющий уволен: подбирайте арендаторов сами");
    this.structural("realty");
    this.dirty();
    return true;
  }

  // ======================= ДЕЙСТВИЯ: БИРЖА =======================
  /** Покупка/продажа акций, облигаций и крипты. qty > 0. */
  trade(id, qty, isBuy) {
    const def = ASSET_BY_ID[id];
    if (!def || !(qty > 0)) return false;
    const price = this.market.price(id);

    if (isBuy) {
      if (def.kind === "bond" && qty > this.bondsRemaining[id]) {
        this.toast("warn", "Недостаточно бумаг в размещении");
        return false;
      }
      const cost = qty * price;
      const fee = cost * CONFIG.TRADE_FEE;
      if (this.balance < cost + fee) return false;
      this.balance -= cost + fee;
      this.stats.feesPaid += fee;
      this.stats.totalSpent += cost;
      const pos = this.portfolio[id] || { qty: 0, avg: 0 };
      pos.avg = (pos.avg * pos.qty + cost + fee) / (pos.qty + qty);
      pos.qty += qty;
      this.portfolio[id] = pos;
      if (def.kind === "bond") this.bondsRemaining[id] -= qty;
      this.toast("success", `Куплено: ${def.name} × ${Fmt.qty(qty)}`);
    } else {
      const pos = this.portfolio[id];
      if (!pos || pos.qty < qty - 1e-9) return false;
      const proceeds = qty * price;
      const fee = proceeds * CONFIG.TRADE_FEE;
      const net = proceeds - fee;
      this.balance += net;
      this.stats.feesPaid += fee;
      const profit = net - pos.avg * qty;
      this.stats.tradeProfit += profit;
      if (profit > 0) this.stats.totalEarned += profit;
      pos.qty -= qty;
      if (pos.qty <= 1e-9) delete this.portfolio[id];
      this.toast(profit >= 0 ? "success" : "warn",
        `Продано: ${def.name} × ${Fmt.qty(qty)} (${profit >= 0 ? "+" : ""}${Fmt.money(profit)})`);
    }
    this.structural("portfolio");
    this.dirty();
    return true;
  }

  // ======================= ДЕЙСТВИЯ: ВКЛАДЫ =======================
  openDeposit(prodId, amount) {
    const d = DEP_BY_ID[prodId];
    if (!d || !(amount >= CONFIG.DEPOSIT_MIN) || this.balance < amount) return false;
    const dep = this.deposits[prodId];

    if (d.termH === 0) {
      const cur = dep ? dep.principal : 0;
      if (cur + amount > d.max) {
        this.toast("warn", `Лимит вклада — ${Fmt.moneyShort(d.max)}`);
        return false;
      }
      this.balance -= amount;
      if (dep) dep.principal += amount;
      else this.deposits[prodId] = { principal: amount, openedAt: Date.now(), maturesAt: 0, accrued: 0 };
    } else {
      if (dep) {
        this.toast("warn", "Этот вклад уже открыт");
        return false;
      }
      if (amount > d.max) {
        this.toast("warn", `Лимит вклада — ${Fmt.moneyShort(d.max)}`);
        return false;
      }
      this.balance -= amount;
      this.deposits[prodId] = {
        principal: amount,
        openedAt: Date.now(),
        maturesAt: Date.now() + d.termH * 3600 * 1000,
        accrued: 0,
      };
    }
    this.toast("success", `Вклад ${d.name}: внесено ${Fmt.money(amount)}`);
    this.structural("deposits");
    this.dirty();
    return true;
  }

  closeDeposit(prodId) {
    const d = DEP_BY_ID[prodId];
    const dep = this.deposits[prodId];
    if (!d || !dep) return false;
    if (d.termH === 0) {
      const interest = dep.accrued;
      this.balance += dep.principal + interest;
      this.stats.depositEarned += interest;
      this.stats.totalEarned += interest;
      this.toast("success", `«Копилка»: снято ${Fmt.money(dep.principal + interest)}`);
    } else {
      // Досрочное закрытие: проценты сгорают — как в жизни
      this.balance += dep.principal;
      this.toast("warn", `Вклад ${d.name} закрыт досрочно: проценты потеряны`);
    }
    this.deposits[prodId] = null;
    this.structural("deposits");
    this.dirty();
    return true;
  }

  // ======================= «СДЕЛКА» НА ГЛАВНОЙ =======================
  clickDeal() {
    const gain = CONFIG.CLICK_BASE + this.incomePerSec * CONFIG.CLICK_INCOME_SECONDS;
    this.balance += gain;
    this.stats.clickEarned += gain;
    this.stats.totalEarned += gain;
    this.emit("tick", { dt: 0 });
    return gain;
  }

  // ======================= СЛУЧАЙНЫЕ СОБЫТИЯ =======================
  /** Вызывается планировщиком из main.js раз в 15–40 минут */
  randomEvent(now = Date.now()) {
    const stockIds = STOCK_DEFS.map((d) => d.id);
    const cryptoIds = CRYPTO_DEFS.map((d) => d.id);
    const ownedDefs = PROPERTY_DEFS.filter((d) => this.props[d.id]);

    const events = [
      { w: 3, run: () => { stockIds.forEach((id) => this.market.shock(id, U.rand(1.05, 1.18))); this.toast("success", "📈 Бычий рынок: акции дорожают!"); } },
      { w: 3, run: () => { stockIds.forEach((id) => this.market.shock(id, U.rand(0.82, 0.94))); this.toast("warn", "📉 Коррекция на рынке акций"); } },
      { w: 2, run: () => { cryptoIds.forEach((id) => this.market.shock(id, U.rand(1.25, 1.6))); this.toast("success", "🚀 Крипто-ралли!"); } },
      { w: 2, run: () => { cryptoIds.forEach((id) => this.market.shock(id, U.rand(0.45, 0.7))); this.toast("danger", "💥 Обвал крипторынка"); } },
      { w: 3, run: () => { const d = U.choice(STOCK_DEFS); this.market.shock(d.id, U.rand(1.2, 1.5)); this.toast("success", `💡 Прорыв: ${d.name} растёт`); } },
      { w: 3, run: () => { const d = U.choice(STOCK_DEFS); this.market.shock(d.id, U.rand(0.6, 0.85)); this.toast("warn", `🗞 Скандал вокруг ${d.name}`); } },
      { w: 0.7, run: () => {
          const b = BOND_DEFS.find((x) => x.risky);
          this.bondDefault[b.id] = now + 2 * 3600 * 1000;
          this.market.shock(b.id, 0.45);
          this.toast("danger", `⚠ Технический дефолт: ${b.name}! Купоны заморожены на 2 ч`);
          this.structural("portfolio");
        } },
    ];
    if (ownedDefs.length) {
      events.push({ w: 2, run: () => {
        const d = U.choice(ownedDefs);
        const p = this.props[d.id];
        p.cond = Math.max(5, p.cond - U.rand(15, 30));
        this.toast("warn", `🔧 Авария в «${d.name}»: срочно нужен ремонт`);
        this.structural("realty");
      } });
    }
    // TODO: новые события — добавить в массив (шанс w — относительный вес)

    const total = events.reduce((s, e) => s + e.w, 0);
    let r = Math.random() * total;
    for (const e of events) {
      r -= e.w;
      if (r <= 0) { e.run(); break; }
    }
    this.emit("market");
    this.dirty();
  }

  // ======================= ОФЛАЙН-ПРОГРЕСС =======================
  /**
   * Начисляет доход за отсутствие и возвращает отчёт для модалки.
   * Аренда моделируется по-настоящему: договоры истекают, здания
   * изнашиваются; с управляющим объекты пересдаются, без него — простаивают.
   */
  applyOffline(seconds, now = Date.now()) {
    const T = Math.min(seconds, CONFIG.OFFLINE_CAP_HOURS * 3600);
    const rep = { seconds: T, rent: 0, coupons: 0, divs: 0, deposits: 0, total: 0 };
    const start = now - T * 1000;

    this.market.advance(T);

    // --- аренда ---
    for (const def of PROPERTY_DEFS) {
      const p = this.props[def.id];
      if (!p) continue;
      let t = 0;
      let guard = 0;
      while (t < T && guard++ < 400) {
        const simNow = start + t * 1000;
        if (p.lease) {
          const leaseLeft = (p.lease.end - simNow) / 1000;
          if (leaseLeft <= 0) {
            p.lease = null;
            this._offlineVacancy(p, simNow);
            continue;
          }
          const seg = Math.min(leaseLeft, T - t, 1800); // интегрируем кусками по 30 мин
          const gross = def.rent * CONFIG.UPGRADE_MULTS[p.lv] * condMult(p.cond) * p.lease.mult;
          const cut = this.managerHired ? gross * CONFIG.MANAGER_CUT : 0;
          rep.rent += (gross - cut) * seg;
          this.stats.managerPaid += cut * seg;
          const wear = (CONFIG.WEAR_LEASED_PER_HOUR * (1 - CONFIG.WEAR_LEVEL_DISCOUNT * p.lv)) / 3600;
          p.cond = Math.max(0, p.cond - wear * seg);
          t += seg;
        } else if (this.managerHired && p.autoLeaseAt) {
          const wait = Math.max(0, (p.autoLeaseAt - simNow) / 1000);
          if (wait > T - t) break;
          t += wait;
          this._managerLeaseSilent(def, p, start + t * 1000);
        } else {
          // Без менеджера объект простаивает до возвращения игрока
          p.cond = Math.max(0, p.cond - (CONFIG.WEAR_VACANT_PER_HOUR / 3600) * (T - t));
          break;
        }
      }
      if (!p.lease && !this.managerHired) {
        p.searching = true;
        p.offer = null;
        p.nextOfferAt = now + U.rand(...CONFIG.OFFER_DELAY) * 1000;
      }
    }

    // --- купоны и дивиденды (аппроксимация по текущим ценам) ---
    for (const b of BOND_DEFS) {
      const pos = this.portfolio[b.id];
      if (!pos || !pos.qty || this.bondDefault[b.id] > now) continue;
      rep.coupons += ((pos.qty * b.face * b.coupon) / 3600) * T;
    }
    for (const d of STOCK_DEFS) {
      const pos = this.portfolio[d.id];
      if (!pos || !pos.qty || !d.div) continue;
      rep.divs += ((pos.qty * this.market.price(d.id) * d.div) / 3600) * T;
    }

    // --- вклады ---
    let depositInterest = 0;
    for (const d of DEPOSIT_DEFS) {
      const dep = this.deposits[d.id];
      if (!dep) continue;
      if (d.termH === 0) {
        dep.accrued += ((dep.principal * d.rate) / 3600) * T;
      } else if (now >= dep.maturesAt) {
        const interest = dep.principal * d.rate * d.termH;
        depositInterest += interest;
        rep.deposits += dep.principal + interest;
        this.deposits[d.id] = null;
      }
    }

    rep.total = rep.rent + rep.coupons + rep.divs + rep.deposits;
    this.balance += rep.total;
    this.stats.rentEarned += rep.rent;
    this.stats.couponEarned += rep.coupons;
    this.stats.divEarned += rep.divs;
    this.stats.depositEarned += depositInterest;
    this.stats.totalEarned += rep.rent + rep.coupons + rep.divs + depositInterest;

    this.structural("realty");
    this.structural("deposits");
    this.structural("portfolio");
    this.emit("market");
    this.emit("tick", { dt: 0 });
    return rep;
  }

  _offlineVacancy(p, simNowMs) {
    p.offer = null;
    if (this.managerHired) {
      p.searching = false;
      p.autoLeaseAt = simNowMs + U.rand(...CONFIG.MANAGER_LEASE_DELAY) * 1000;
    } else {
      p.searching = true;
    }
  }

  _managerLeaseSilent(def, p, simNowMs) {
    p.lease = {
      tenant: this._tenantFor(def),
      mult: Math.round(U.rand(...CONFIG.MANAGER_RATE) * 100) / 100,
      end: simNowMs + U.rand(...CONFIG.LEASE_HOURS) * 3600 * 1000,
    };
    p.autoLeaseAt = 0;
  }

  // ======================= СЕРИАЛИЗАЦИЯ =======================
  serialize() {
    const props = {};
    PROPERTY_DEFS.forEach((d) => {
      if (this.props[d.id]) props[d.id] = this.props[d.id];
    });
    return {
      balance: this.balance,
      stats: this.stats,
      props,
      portfolio: this.portfolio,
      bondsRemaining: this.bondsRemaining,
      bondDefault: this.bondDefault,
      deposits: this.deposits,
      managerHired: this.managerHired,
      market: this.market.serialize(),
    };
  }

  hydrate(data) {
    if (typeof data.balance === "number") this.balance = data.balance;
    this.stats = { ...freshStats(), ...(data.stats || {}) };
    if (data.props) {
      PROPERTY_DEFS.forEach((d) => {
        const saved = data.props[d.id];
        if (!saved) return;
        this.props[d.id] = {
          lv: saved.lv || 0,
          cond: typeof saved.cond === "number" ? saved.cond : 100,
          lease: saved.lease || null,
          searching: !!saved.searching,
          offer: null, // офферы не переживают перезагрузку — появятся новые
          nextOfferAt: 0,
          autoLeaseAt: saved.autoLeaseAt || 0,
          invested: saved.invested || PROP_BY_ID[d.id].price,
        };
      });
    }
    this.portfolio = data.portfolio || {};
    this.bondsRemaining = { ...this.bondsRemaining, ...(data.bondsRemaining || {}) };
    this.bondDefault = data.bondDefault || {};
    if (data.deposits) {
      DEPOSIT_DEFS.forEach((d) => {
        if (data.deposits[d.id]) this.deposits[d.id] = data.deposits[d.id];
      });
    }
    this.managerHired = !!data.managerHired;
    this.market.load(data.market);
    this.emit("tick", { dt: 0 });
  }

  /** Полный сброс прогресса.
   *  // TODO: prestige — вместо сброса начислять постоянный множитель */
  reset() {
    this.balance = CONFIG.STARTING_BALANCE;
    this.stats = freshStats();
    PROPERTY_DEFS.forEach((d) => (this.props[d.id] = null));
    this.portfolio = {};
    BOND_DEFS.forEach((b) => (this.bondsRemaining[b.id] = b.issue));
    this.bondDefault = {};
    DEPOSIT_DEFS.forEach((d) => (this.deposits[d.id] = null));
    this.managerHired = false;
    this.market = new MarketSim(MARKET_ASSETS);
    this.structural("all");
    this.emit("market");
    this.emit("tick", { dt: 0 });
  }
}
