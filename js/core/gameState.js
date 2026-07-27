
const PROP_BY_ID = Object.fromEntries(PROPERTY_DEFS.map((d) => [d.id, d]));
const ASSET_BY_ID = Object.fromEntries(MARKET_ASSETS.map((d) => [d.id, d]));
const DEP_BY_ID = Object.fromEntries(DEPOSIT_DEFS.map((d) => [d.id, d]));

function freshStats() {
  return {
    totalEarned: 0,   // всё заработанное (аренда, купоны, дивиденды, % по вкладам, сделки, трейдинг)
    rentEarned: 0,
    couponEarned: 0,
    divEarned: 0,
    businessEarned: 0,
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

    // Бизнесы: id -> null (не открыт) | состояние бизнеса
    this.businesses = {};
    BUSINESS_DEFS.forEach((d) => (this.businesses[d.id] = null));

    // Престиж: переживает перерождения, обнуляется только полным сбросом
    this.gold = 0;            // золотые монеты
    this.prestigeCount = 0;   // сколько раз перерождался
    this.perks = {};          // perkId -> уровень (для once: 0/1)
    this.lifetime = { earned: 0, playTimeSec: 0 }; // «вечная» статистика

    // TODO: достижения (this.achievements), бусты (this.boosts)
  }

  // ======================= ПРЕСТИЖ: ПЕРКИ И МНОЖИТЕЛИ =======================
  perkLv(id) { return this.perks[id] || 0; }

  /** Глобальный множитель дохода (аренда, купоны, дивиденды, вклады, клики) */
  get incomeMult() {
    return (1 + 0.1 * this.perkLv("grip"))
      * (this.perkLv("empire") ? 1.5 : 1)
      * (this.perkLv("legend") ? 2 : 1);
  }
  get rentMult() { return 1 + 0.15 * this.perkLv("realtor"); }
  get investMult() { return 1 + 0.15 * this.perkLv("guru"); }
  get businessMult() {
    return (1 + 0.15 * this.perkLv("mogul")) * (this.perkLv("bizempire") ? 1.5 : 1);
  }
  /** «Надёжный поставщик»: скорость расхода зерна кофейни */
  get coffeeUseRate() { return this.perkLv("logist") ? 0.75 : 1; }
  get offlineMult() { return 1 + 0.25 * this.perkLv("compound"); }
  get clickMult() { return this.perkLv("goldclick") ? 5 : 1; }
  get wearMult() { return this.perkLv("foreman") ? 0.7 : 1; }
  get tradeFee() { return CONFIG.TRADE_FEE * (this.perkLv("broker") ? 1 / 3 : 1); }
  get managerCut() { return this.perkLv("steward") ? 0.10 : CONFIG.MANAGER_CUT; }
  get managerHireCost() { return this.perkLv("steward") ? 0 : CONFIG.MANAGER_HIRE_COST; }
  get minOfferMult() { return this.perkLv("lawyer") ? 0.95 : CONFIG.RATE_RANGE[0]; }
  get hasInsurance() { return this.perkLv("insurance") > 0; }
  get hasInsider() { return this.perkLv("insider") > 0; }
  /** Эффективная ставка вклада (%/ч, доля) с учётом «Банковского VIP» */
  depositRate(d) { return d.rate + 0.01 * this.perkLv("vip"); }
  /** Эффективный лимит вклада с учётом «Программы лояльности» */
  depositMax(d) { return d.max * (this.perkLv("loyalty") ? 2 : 1); }
  get startingBalance() {
    return [CONFIG.STARTING_BALANCE, 5000, 20000, 75000, 250000, 1000000][this.perkLv("heir")];
  }

  /** Сколько монет даст перерождение при текущем капитале */
  get pendingCoins() {
    return Math.floor(Math.sqrt(Math.max(0, this.netWorth) / CONFIG.PRESTIGE_BASE_NW));
  }
  /** Капитал, необходимый для следующей монеты */
  get nextCoinAt() {
    return Math.pow(this.pendingCoins + 1, 2) * CONFIG.PRESTIGE_BASE_NW;
  }

  buyPerk(id) {
    const def = PRESTIGE_BY_ID[id];
    if (!def) return false;
    const lv = this.perkLv(id);
    if (lv >= def.costs.length) return false; // максимум
    const cost = def.costs[lv];
    if (this.gold < cost) return false;
    this.gold -= cost;
    this.perks[id] = lv + 1;
    this.toast("success", `🪙 Куплено: ${def.name}${def.type === "level" ? ` (ур. ${lv + 1})` : ""}`);
    this.structural("prestige");
    this.emit("tick", { dt: 0 });
    this.dirty();
    return true;
  }

  /**
   * Перерождение: текущий забег сгорает, монеты и перки остаются.
   * Возвращает количество полученных монет (0 = условия не выполнены).
   */
  doPrestige() {
    const coins = this.pendingCoins;
    if (coins < 1) return 0;
    this.gold += coins;
    this.prestigeCount += 1;
    this.lifetime.earned += this.stats.totalEarned;
    this.lifetime.playTimeSec += this.stats.playTimeSec;

    // Сброс забега (перки/монеты/lifetime не трогаем)
    this.balance = this.startingBalance;
    this.stats = freshStats();
    PROPERTY_DEFS.forEach((d) => (this.props[d.id] = null));
    this.portfolio = {};
    BOND_DEFS.forEach((b) => (this.bondsRemaining[b.id] = b.issue));
    this.bondDefault = {};
    DEPOSIT_DEFS.forEach((d) => (this.deposits[d.id] = null));
    this.managerHired = false;
    BUSINESS_DEFS.forEach((d) => (this.businesses[d.id] = null));
    this.market = new MarketSim(MARKET_ASSETS);

    this.toast("success", `👑 Перерождение! Получено монет: ${coins} 🪙`);
    this.structural("all");
    this.emit("market");
    this.emit("tick", { dt: 0 });
    this.dirty();
    return coins;
  }

  // ======================= БИЗНЕСЫ =======================
  /** Достигнутый ранг (0..5): каждые 5 уровней */
  bizRank(lv) { return Math.floor(lv / 5); }
  /** Название бизнеса с учётом ранга */
  bizRankName(def, lv) {
    const r = this.bizRank(lv);
    return r > 0 ? def.ranks[r - 1].name : def.name;
  }
  /** Множитель уровня: ×1.18 за уровень, ×1.5 за каждый ранг */
  bizLevelMult(lv) {
    return Math.pow(CONFIG.BIZ_INCOME_COEFF, lv - 1)
      * Math.pow(CONFIG.BIZ_RANK_MULT, this.bizRank(lv));
  }
  bizUpgradeCost(def, lv) {
    return def.openCost * CONFIG.BIZ_UPGRADE_COST * Math.pow(CONFIG.BIZ_UPGRADE_COEFF, lv - 1);
  }

  /** Множитель индивидуальной механики бизнеса */
  bizMechMult(id, now = Date.now()) {
    const def = BIZ_BY_ID[id];
    const b = this.businesses[id];
    if (!b) return 0;
    switch (id) {
      case "coffee": return b.stockH > 0 ? 1 : 0.25;
      case "taxi": return 1; // машины учтены в базе
      case "shop": return b.boost && now < b.boost.until ? b.boost.mult : 1;
      case "factory":
        return b.contract ? b.contract.mult
          : (b.lv >= 20 ? def.contract.idleMult20 : def.contract.idleMult);
      case "startup": return b.rndMult;
      case "studio": {
        const per = b.lv >= 20 ? def.film.catalogPerFilm20 : def.film.catalogPerFilm;
        return 1 + Math.min(b.films, def.film.catalogCap) * per;
      }
      default: return 1;
    }
  }

  /**
   * Доход бизнеса ₽/сек. ignoreMech=true — «полная мощность» (для расчёта
   * стоимости закупок, кампаний и бюджетов, чтобы не было петли скидок).
   */
  bizIncome(id, ignoreMech = false, now = Date.now()) {
    const def = BIZ_BY_ID[id];
    const b = this.businesses[id];
    if (!b) return 0;
    let base = def.base;
    if (id === "taxi") {
      const working = b.cars.filter((c) => !c.broken).length;
      base += working * def.fleet.carIncome;
    }
    const mech = ignoreMech ? 1 : this.bizMechMult(id, now);
    return base * this.bizLevelMult(b.lv) * mech * this.incomeMult * this.businessMult;
  }
  /** Доход за час на полной мощности — база для цен механик */
  bizHourlyFull(id) { return this.bizIncome(id, true) * 3600; }

  openBusiness(id) {
    const def = BIZ_BY_ID[id];
    if (!def || this.businesses[id] || this.balance < def.openCost) return false;
    this.balance -= def.openCost;
    this.stats.totalSpent += def.openCost;
    const b = { lv: 1, invested: def.openCost };
    // Стартовое состояние механики
    if (id === "coffee") { b.stockH = 6; b.auto = true; }
    if (id === "taxi") b.cars = [{ broken: false }]; // первая машина в подарок
    if (id === "shop") { b.boost = null; b.cooldownUntil = 0; }
    if (id === "factory") { b.contract = null; b.offer = null; b.nextOfferAt = Date.now() + 30000; }
    if (id === "startup") { b.rndMult = 1; b.project = null; }
    if (id === "studio") { b.film = null; b.films = 0; b.lastBox = null; }
    this.businesses[id] = b;
    this.toast("success", `🎉 Открыт бизнес: «${def.name}»!`);
    this.structural("business");
    this.dirty();
    return true;
  }

  upgradeBusiness(id) {
    const def = BIZ_BY_ID[id];
    const b = this.businesses[id];
    if (!def || !b || b.lv >= CONFIG.BIZ_MAX_LV) return false;
    const cost = this.bizUpgradeCost(def, b.lv);
    if (this.balance < cost) return false;
    this.balance -= cost;
    b.lv += 1;
    b.invested += cost;
    this.stats.upgradeSpent += cost;
    if (b.lv % 5 === 0) {
      const r = this.bizRank(b.lv);
      this.toast("success", `🏆 «${def.name}» — новый ранг: ${def.ranks[r - 1].name}! (${def.ranks[r - 1].bonus})`);
    }
    this.structural("business");
    this.dirty();
    return true;
  }

  // --- Кофейня: запасы ---
  coffeeStockCap(b) { return b.lv >= 15 ? BIZ_BY_ID.coffee.supply.capH15 : BIZ_BY_ID.coffee.supply.capH; }
  coffeeSupplyCost(hours) {
    const def = BIZ_BY_ID.coffee;
    const b = this.businesses.coffee;
    return this.bizHourlyFull("coffee") * hours * def.supply.costFrac
      * (b && b.lv >= 20 ? def.supply.discount20 : 1);
  }
  buySupplies(hours) {
    const b = this.businesses.coffee;
    if (!b) return false;
    const cap = this.coffeeStockCap(b);
    hours = Math.min(hours, cap - b.stockH);
    if (hours <= 0.01) return false;
    const cost = this.coffeeSupplyCost(hours);
    if (this.balance < cost) return false;
    this.balance -= cost;
    b.stockH += hours;
    this.structural("business");
    this.dirty();
    return true;
  }

  // --- Таксопарк: машины ---
  taxiCarLimit(b) {
    const f = BIZ_BY_ID.taxi.fleet;
    return f.baseSlots + Math.floor(b.lv / f.lvPerSlot);
  }
  taxiCarCost(b) {
    const f = BIZ_BY_ID.taxi.fleet;
    return f.carCost * Math.pow(f.carCostCoeff, b.cars.length);
  }
  taxiRepairCost(b) {
    const f = BIZ_BY_ID.taxi.fleet;
    const broken = b.cars.filter((c) => c.broken).length;
    return broken * f.repairCost * (b.lv >= 10 ? 0.5 : 1);
  }
  buyCar() {
    const b = this.businesses.taxi;
    if (!b || b.cars.length >= this.taxiCarLimit(b)) return false;
    const cost = this.taxiCarCost(b);
    if (this.balance < cost) return false;
    this.balance -= cost;
    b.invested += cost;
    this.stats.totalSpent += cost;
    b.cars.push({ broken: false });
    this.toast("success", `🚕 Машина №${b.cars.length} вышла на линию`);
    this.structural("business");
    this.dirty();
    return true;
  }
  repairCars() {
    const b = this.businesses.taxi;
    if (!b) return false;
    const cost = this.taxiRepairCost(b);
    if (cost <= 0 || this.balance < cost) return false;
    this.balance -= cost;
    this.stats.repairSpent += cost;
    b.cars.forEach((c) => (c.broken = false));
    this.structural("business");
    this.dirty();
    return true;
  }

  // --- Интернет-магазин: рекламные кампании ---
  shopCampaignPrice(c) {
    return this.bizHourlyFull("shop") * c.costH * (this.perkLv("viral") ? 0.7 : 1);
  }
  runCampaign(campaignId) {
    const def = BIZ_BY_ID.shop;
    const b = this.businesses.shop;
    const c = def.campaigns.find((x) => x.id === campaignId);
    if (!b || !c) return false;
    const now = Date.now();
    if (b.boost && now < b.boost.until) return false;
    if (b.lv < 10 && now < b.cooldownUntil) return false;
    const cost = this.shopCampaignPrice(c);
    if (this.balance < cost) return false;
    this.balance -= cost;
    const mult = b.lv >= 20 ? 1 + (c.mult - 1) * 1.5 : c.mult;
    const durH = b.lv >= 15 ? c.durH * 1.5 : c.durH;
    b.boost = { mult, until: now + durH * 3600 * 1000, name: c.name };
    this.toast("success", `📣 Кампания «${c.name}»: доход ×${mult.toFixed(2)} на ${durH} ч`);
    this.structural("business");
    this.dirty();
    return true;
  }

  // --- Завод: контракты ---
  _makeFactoryOffer(b, now) {
    const cc = BIZ_BY_ID.factory.contract;
    const range = b.lv >= 15 ? cc.multRange15 : cc.multRange;
    // «Госзаказы»: нижняя граница ставки не меньше ×1.1
    const low = this.perkLv("gos") ? Math.max(range[0], 1.1) : range[0];
    return {
      client: U.choice(FACTORY_CLIENTS),
      mult: Math.round(U.rand(low, range[1]) * 100) / 100,
      hours: Math.round(U.rand(...cc.durH) * 2) / 2,
      expires: now + cc.ttlSec * 1000,
    };
  }
  _factoryNextOffer(b, now) {
    const cc = BIZ_BY_ID.factory.contract;
    const delay = b.lv >= 10 ? cc.offerDelayMin10 : cc.offerDelayMin;
    b.nextOfferAt = now + U.rand(...delay) * 60 * 1000;
  }
  acceptContract() {
    const b = this.businesses.factory;
    if (!b || !b.offer) return false;
    const o = b.offer;
    b.contract = { client: o.client, mult: o.mult, end: Date.now() + o.hours * 3600 * 1000 };
    b.offer = null;
    this.toast("success", `🏭 Контракт: ${o.client}, ×${o.mult} на ${o.hours} ч`);
    this.structural("business");
    this.dirty();
    return true;
  }
  declineContract() {
    const b = this.businesses.factory;
    if (!b || !b.offer) return false;
    b.offer = null;
    this._factoryNextOffer(b, Date.now());
    this.structural("business");
    return true;
  }

  // --- IT-стартап: R&D ---
  startupProjectPrice(p) {
    return this.bizHourlyFull("startup") * p.costH * (this.perkLv("angel") ? 0.7 : 1);
  }
  startProject(projectId) {
    const def = BIZ_BY_ID.startup;
    const b = this.businesses.startup;
    const p = def.rnd.projects.find((x) => x.id === projectId);
    if (!b || !p || b.project) return false;
    if (b.rndMult >= def.rnd.cap) {
      this.toast("warn", "R&D-потенциал исчерпан (множитель на максимуме)");
      return false;
    }
    const cost = this.startupProjectPrice(p);
    if (this.balance < cost) return false;
    this.balance -= cost;
    const durH = b.lv >= 20 ? p.durH / 2 : p.durH;
    b.project = { id: p.id, name: p.name, done: Date.now() + durH * 3600 * 1000 };
    this.toast("info", `💻 Запущен R&D: «${p.name}» (${durH} ч)`);
    this.structural("business");
    this.dirty();
    return true;
  }
  _finishProject(b, silent = false) {
    const def = BIZ_BY_ID.startup;
    const p = def.rnd.projects.find((x) => x.id === b.project.id);
    const chance = p.chance + (b.lv >= 10 ? 0.10 : 0);
    const ok = Math.random() < chance;
    const gain = ok ? p.gain : p.failGain;
    b.rndMult = U.clamp(b.rndMult * (1 + gain), 0.5, def.rnd.cap);
    b.project = null;
    if (!silent) {
      this.toast(ok ? "success" : "warn",
        ok ? `🚀 R&D «${p.name}» — успех! Доход стартапа ×${b.rndMult.toFixed(2)}`
           : `🧯 R&D «${p.name}» не взлетел (${gain >= 0 ? "+" : ""}${(gain * 100).toFixed(0)}%)`);
    }
    return ok;
  }

  // --- Кинокомпания: фильмы ---
  startFilm(budget) {
    const def = BIZ_BY_ID.studio;
    const b = this.businesses.studio;
    if (!b || b.film) return false;
    const perHour = this.bizHourlyFull("studio");
    const min = perHour * def.film.budgetMinH;
    const max = perHour * def.film.budgetMaxH;
    budget = U.clamp(budget, min, max);
    if (this.balance < budget) return false;
    this.balance -= budget;
    const durH = b.lv >= 10 ? def.film.durH10 : def.film.durH;
    b.film = { budget, done: Date.now() + durH * 3600 * 1000 };
    this.toast("info", `🎬 Съёмки начались! Бюджет ${Fmt.moneyShort(budget)}, премьера через ${durH} ч`);
    this.structural("business");
    this.dirty();
    return true;
  }
  /** Премьера: возвращает выплату; начисление денег — на вызывающей стороне */
  _premiere(b, silent = false) {
    // Сборы: 0.4–4.0 от бюджета, скошено к скромным (квадрат равномерной)
    let box = 0.4 + Math.pow(Math.random(), 2) * 3.6;
    if (this.perkLv("producer")) box = Math.max(box, 0.7); // «Продюсерское чутьё»
    if (b.lv >= 15) box += 0.3;
    const payout = b.film.budget * box;
    b.films += 1;
    b.lastBox = box;
    if (!silent) {
      this.toast(box >= 1 ? "success" : "warn",
        `🍿 Премьера! Сборы ×${box.toFixed(2)}: +${Fmt.moneyShort(payout)} (фильмов в каталоге: ${b.films})`);
    }
    b.film = null;
    return payout;
  }

  /** Тик бизнесов: доход + индивидуальные механики. Вызывается из tick(). */
  _bizTick(dt, now) {
    let structural = false;
    for (const def of BUSINESS_DEFS) {
      const b = this.businesses[def.id];
      if (!b) continue;

      // Доход
      const inc = this.bizIncome(def.id, false, now) * dt;
      if (inc > 0) {
        this.balance += inc;
        this.stats.businessEarned += inc;
        this.stats.totalEarned += inc;
      }

      switch (def.id) {
        case "coffee": {
          const had = b.stockH > 0;
          b.stockH = Math.max(0, b.stockH - (dt / 3600) * this.coffeeUseRate);
          // Автозакупка с 10 уровня: пополняем при остатке < 2 ч
          if (b.lv >= 10 && b.auto && b.stockH < 2) {
            const cap = this.coffeeStockCap(b);
            const cost = this.coffeeSupplyCost(cap - b.stockH);
            if (this.balance >= cost) {
              this.balance -= cost;
              b.stockH = cap;
              structural = true;
            }
          }
          if (had && b.stockH <= 0) {
            this.toast("warn", "☕ В кофейне закончилось зерно — доход упал!");
            structural = true;
          }
          break;
        }
        case "taxi": {
          const f = def.fleet;
          const breakEvery = f.breakEveryH * (b.lv >= 20 ? 2 : 1) * 3600;
          for (const car of b.cars) {
            if (!car.broken && Math.random() < dt / breakEvery) {
              car.broken = true;
              this.toast("warn", "🔧 Машина таксопарка сломалась");
              structural = true;
            }
          }
          break;
        }
        case "shop": {
          if (b.boost && now >= b.boost.until) {
            b.cooldownUntil = now + BIZ_BY_ID.shop.cooldownH * 3600 * 1000;
            b.boost = null;
            this.toast("info", "📣 Рекламная кампания завершена");
            structural = true;
          }
          break;
        }
        case "factory": {
          if (b.contract && now >= b.contract.end) {
            this.toast("info", `🏭 Контракт с ${b.contract.client} выполнен`);
            b.contract = null;
            this._factoryNextOffer(b, now);
            structural = true;
          }
          if (!b.contract) {
            if (b.offer && now >= b.offer.expires) {
              b.offer = null;
              this._factoryNextOffer(b, now);
              structural = true;
            } else if (!b.offer && now >= b.nextOfferAt) {
              b.offer = this._makeFactoryOffer(b, now);
              // «Отдел продаж» 25 ур.: автоприём выгодных контрактов
              if (b.lv >= 25 && b.offer.mult >= 1.2) {
                this.acceptContract();
              }
              structural = true;
            }
          }
          break;
        }
        case "startup": {
          if (b.project && now >= b.project.done) {
            this._finishProject(b);
            structural = true;
            this.dirty();
          }
          break;
        }
        case "studio": {
          if (b.film && now >= b.film.done) {
            const payout = this._premiere(b);
            this.balance += payout;
            this.stats.businessEarned += payout;
            this.stats.totalEarned += payout;
            structural = true;
            this.dirty();
          }
          break;
        }
      }
    }
    return structural;
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
  /** Грязная аренда объекта (до комиссии управляющего), с перками престижа */
  propGrossRent(id) {
    const p = this.props[id];
    if (!p || !p.lease) return 0;
    const def = PROP_BY_ID[id];
    return def.rent * CONFIG.UPGRADE_MULTS[p.lv] * condMult(p.cond) * p.lease.mult
      * this.incomeMult * this.rentMult;
  }
  /** Чистая аренда объекта (после комиссии) */
  propNetRent(id) {
    return this.propGrossRent(id) * (this.managerHired ? 1 - this.managerCut : 1);
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
    }, 0) * this.incomeMult * this.investMult;
  }
  get divPerSec() {
    return STOCK_DEFS.reduce((s, d) => {
      const pos = this.portfolio[d.id];
      if (!pos || !pos.qty || !d.div) return s;
      return s + (pos.qty * this.market.price(d.id) * d.div) / 3600;
    }, 0) * this.incomeMult * this.investMult;
  }
  get depositPerSec() {
    return DEPOSIT_DEFS.reduce((s, d) => {
      const dep = this.deposits[d.id];
      if (!dep || d.termH !== 0) return s; // срочные платят в конце срока
      return s + (dep.principal * this.depositRate(d)) / 3600;
    }, 0) * this.incomeMult;
  }
  get businessPerSec() {
    return BUSINESS_DEFS.reduce((s, d) => s + this.bizIncome(d.id), 0);
  }
  get incomePerSec() {
    return this.rentPerSec + this.couponPerSec + this.divPerSec
      + this.depositPerSec + this.businessPerSec;
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
  get bizInvested() {
    return BUSINESS_DEFS.reduce((s, d) => s + (this.businesses[d.id]?.invested || 0), 0);
  }
  get netWorth() {
    return this.balance + this.propsInvested + this.portfolioValue()
      + this.depositsTotal + this.bizInvested;
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
        const cut = this.managerHired ? gross * this.managerCut : 0;
        const inc = (gross - cut) * dt;
        this.balance += inc;
        this.stats.rentEarned += inc;
        this.stats.totalEarned += inc;
        this.stats.managerPaid += cut * dt;

        const wear = (CONFIG.WEAR_LEASED_PER_HOUR * (1 - CONFIG.WEAR_LEVEL_DISCOUNT * p.lv))
          / 3600 * this.wearMult;
        p.cond = Math.max(0, p.cond - wear * dt);

        if (now >= p.lease.end) {
          this.toast("warn", `${p.lease.tenant}: договор аренды «${def.name}» истёк`);
          p.lease = null;
          this._startVacancy(p, now);
          structuralRealty = true;
          this.dirty();
        }
      } else {
        p.cond = Math.max(0, p.cond - (CONFIG.WEAR_VACANT_PER_HOUR / 3600) * this.wearMult * dt);

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
    const investAll = this.incomeMult * this.investMult;
    for (const b of BOND_DEFS) {
      const pos = this.portfolio[b.id];
      if (!pos || !pos.qty || this.bondDefault[b.id] > now) continue;
      const inc = ((pos.qty * b.face * b.coupon) / 3600) * investAll * dt;
      this.balance += inc;
      this.stats.couponEarned += inc;
      this.stats.totalEarned += inc;
    }

    // --- Дивиденды акций ---
    for (const d of STOCK_DEFS) {
      if (!d.div) continue;
      const pos = this.portfolio[d.id];
      if (!pos || !pos.qty) continue;
      const inc = ((pos.qty * this.market.price(d.id) * d.div) / 3600) * investAll * dt;
      this.balance += inc;
      this.stats.divEarned += inc;
      this.stats.totalEarned += inc;
    }

    // --- Вклады: начисление «Копилки», выплата срочных ---
    for (const d of DEPOSIT_DEFS) {
      const dep = this.deposits[d.id];
      if (!dep) continue;
      if (d.termH === 0) {
        dep.accrued += ((dep.principal * this.depositRate(d)) / 3600) * this.incomeMult * dt;
      } else if (now >= dep.maturesAt) {
        const interest = dep.principal * this.depositRate(d) * d.termH * this.incomeMult;
        this.balance += dep.principal + interest;
        this.stats.depositEarned += interest;
        this.stats.totalEarned += interest;
        this.deposits[d.id] = null;
        this.toast("success", `Вклад ${d.name} закрыт: +${Fmt.money(dep.principal + interest)}`);
        structuralDeposits = true;
        this.dirty();
      }
    }

    // --- Бизнесы ---
    const structuralBiz = this._bizTick(dt, now);

    this.stats.playTimeSec += dt;
    if (structuralRealty) this.structural("realty");
    if (structuralDeposits) this.structural("deposits");
    if (structuralBiz) this.structural("business");
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
      // «Личный юрист» поднимает нижнюю границу ставки
      mult: Math.round(U.rand(this.minOfferMult, CONFIG.RATE_RANGE[1]) * 100) / 100,
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
    if (this.managerHired || this.balance < this.managerHireCost) return false;
    this.balance -= this.managerHireCost;
    this.stats.managerPaid += this.managerHireCost;
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
      const fee = cost * this.tradeFee;
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
      const fee = proceeds * this.tradeFee;
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
      if (cur + amount > this.depositMax(d)) {
        this.toast("warn", `Лимит вклада — ${Fmt.moneyShort(this.depositMax(d))}`);
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
      if (amount > this.depositMax(d)) {
        this.toast("warn", `Лимит вклада — ${Fmt.moneyShort(this.depositMax(d))}`);
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
    const gain = (CONFIG.CLICK_BASE * this.incomeMult
      + this.incomePerSec * CONFIG.CLICK_INCOME_SECONDS) * this.clickMult;
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
    // «Страховка» из магазина престижа полностью исключает аварии
    if (ownedDefs.length && !this.hasInsurance) {
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
    const rep = { seconds: T, rent: 0, coupons: 0, divs: 0, deposits: 0, business: 0, total: 0 };
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
          const gross = def.rent * CONFIG.UPGRADE_MULTS[p.lv] * condMult(p.cond) * p.lease.mult
            * this.incomeMult * this.rentMult;
          const cut = this.managerHired ? gross * this.managerCut : 0;
          rep.rent += (gross - cut) * seg;
          this.stats.managerPaid += cut * seg;
          const wear = (CONFIG.WEAR_LEASED_PER_HOUR * (1 - CONFIG.WEAR_LEVEL_DISCOUNT * p.lv))
            / 3600 * this.wearMult;
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
    const investAll = this.incomeMult * this.investMult;
    for (const b of BOND_DEFS) {
      const pos = this.portfolio[b.id];
      if (!pos || !pos.qty || this.bondDefault[b.id] > now) continue;
      rep.coupons += ((pos.qty * b.face * b.coupon) / 3600) * investAll * T;
    }
    for (const d of STOCK_DEFS) {
      const pos = this.portfolio[d.id];
      if (!pos || !pos.qty || !d.div) continue;
      rep.divs += ((pos.qty * this.market.price(d.id) * d.div) / 3600) * investAll * T;
    }

    // --- вклады ---
    let depositInterest = 0;
    for (const d of DEPOSIT_DEFS) {
      const dep = this.deposits[d.id];
      if (!dep) continue;
      if (d.termH === 0) {
        dep.accrued += ((dep.principal * this.depositRate(d)) / 3600) * this.incomeMult * T;
      } else if (now >= dep.maturesAt) {
        const interest = dep.principal * this.depositRate(d) * d.termH * this.incomeMult;
        depositInterest += interest;
        rep.deposits += dep.principal + interest;
        this.deposits[d.id] = null;
      }
    }

    // --- бизнесы (упрощённая, но честная модель) ---
    for (const def of BUSINESS_DEFS) {
      const b = this.businesses[def.id];
      if (!b) continue;
      const full = this.bizIncome(def.id, true, now); // полная мощность, ₽/с
      switch (def.id) {
        case "coffee": {
          if (b.lv >= 10 && b.auto) {
            // Автозакупка: работаем всё время, поставки вычтены из выручки
            rep.business += full * T * (1 - def.supply.costFrac);
            b.stockH = this.coffeeStockCap(b);
          } else {
            const tFull = Math.min(T, (b.stockH * 3600) / this.coffeeUseRate);
            rep.business += full * tFull + full * 0.25 * (T - tFull);
            b.stockH = Math.max(0, b.stockH - (T / 3600) * this.coffeeUseRate);
          }
          break;
        }
        case "taxi": // офлайн машины не ломаются — не наказываем за сон
          rep.business += this.bizIncome("taxi", false, now) * T;
          break;
        case "shop": {
          let tBoost = 0;
          if (b.boost) {
            tBoost = U.clamp((b.boost.until - start) / 1000, 0, T);
            rep.business += full * b.boost.mult * tBoost;
            if (now >= b.boost.until) { b.boost = null; b.cooldownUntil = 0; }
          }
          rep.business += full * (T - tBoost);
          break;
        }
        case "factory": {
          const idle = b.lv >= 20 ? def.contract.idleMult20 : def.contract.idleMult;
          let tC = 0;
          if (b.contract) {
            tC = U.clamp((b.contract.end - start) / 1000, 0, T);
            rep.business += full * b.contract.mult * tC;
            if (now >= b.contract.end) { b.contract = null; this._factoryNextOffer(b, now); }
          }
          rep.business += full * idle * (T - tC);
          break;
        }
        case "startup":
          rep.business += this.bizIncome("startup", false, now) * T;
          if (b.project && now >= b.project.done) this._finishProject(b); // тост при входе
          break;
        case "studio":
          rep.business += this.bizIncome("studio", false, now) * T;
          if (b.film && now >= b.film.done) rep.business += this._premiere(b, true);
          break;
      }
    }

    // «Сложный процент»: бонус к заработанному офлайн (тело вкладов не трогаем)
    rep.rent *= this.offlineMult;
    rep.coupons *= this.offlineMult;
    rep.divs *= this.offlineMult;
    rep.business *= this.offlineMult;
    rep.total = rep.rent + rep.coupons + rep.divs + rep.deposits + rep.business;
    this.balance += rep.total;
    this.stats.rentEarned += rep.rent;
    this.stats.couponEarned += rep.coupons;
    this.stats.divEarned += rep.divs;
    this.stats.depositEarned += depositInterest;
    this.stats.businessEarned += rep.business;
    this.stats.totalEarned += rep.rent + rep.coupons + rep.divs + depositInterest + rep.business;

    this.structural("realty");
    this.structural("deposits");
    this.structural("portfolio");
    this.structural("business");
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
      businesses: this.businesses,
      market: this.market.serialize(),
      gold: this.gold,
      prestigeCount: this.prestigeCount,
      perks: this.perks,
      lifetime: this.lifetime,
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
    if (data.businesses) {
      BUSINESS_DEFS.forEach((d) => {
        if (data.businesses[d.id]) this.businesses[d.id] = data.businesses[d.id];
      });
    }
    this.market.load(data.market);
    this.gold = data.gold || 0;
    this.prestigeCount = data.prestigeCount || 0;
    this.perks = data.perks || {};
    this.lifetime = { earned: 0, playTimeSec: 0, ...(data.lifetime || {}) };
    this.emit("tick", { dt: 0 });
  }

  /** Полный сброс прогресса — стирает и престиж (перерождение — doPrestige) */
  reset() {
    this.balance = CONFIG.STARTING_BALANCE;
    this.stats = freshStats();
    PROPERTY_DEFS.forEach((d) => (this.props[d.id] = null));
    this.portfolio = {};
    BOND_DEFS.forEach((b) => (this.bondsRemaining[b.id] = b.issue));
    this.bondDefault = {};
    DEPOSIT_DEFS.forEach((d) => (this.deposits[d.id] = null));
    this.managerHired = false;
    BUSINESS_DEFS.forEach((d) => (this.businesses[d.id] = null));
    this.market = new MarketSim(MARKET_ASSETS);
    this.gold = 0;
    this.prestigeCount = 0;
    this.perks = {};
    this.lifetime = { earned: 0, playTimeSec: 0 };
    this.structural("all");
    this.emit("market");
    this.emit("tick", { dt: 0 });
  }
}
