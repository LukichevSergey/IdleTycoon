/**
 * Магазин престижа. Валюта — «Золотые монеты» (🪙), выдаются при перерождении:
 *   монеты = floor(CONFIG.PRESTIGE_COIN_K × sqrt(капитал / CONFIG.PRESTIGE_BASE_NW))
 * Корень не даёт стать имбой за один сброс, но каждый следующий забег
 * с купленными перками идёт быстрее — в этом и есть петля прогресса.
 *
 * Типы товаров:
 *  - level: БЕСКОНЕЧНЫЙ многоуровневый перк. Цена уровня — геометрическая
 *           прогрессия ceil(base × growth^уровень), эффект за уровень
 *           постоянный и аддитивный. Магазин нельзя «скупить»: монетам
 *           всегда есть куда деваться, а аддитивный эффект против
 *           геометрической цены сам себя балансирует.
 *  - once:  одноразовый перк качества жизни / билд-опция, costs — [цена].
 *           Такие перки бинарные, их конечность — это нормально.
 * Поле `current(lv)` — текстовое описание уже накопленного эффекта (для UI).
 * Эффекты реализованы в GameState (геттеры-множители perkLv/incomeMult и др.).
 * // TODO: новый товар — добавить запись и вплести эффект в GameState
 */
const PRESTIGE_DEFS = [
  // --- Уровневые множители: главный бесконечный сток монет ---
  {
    id: "grip", icon: "💼", name: "Деловая хватка", type: "level",
    base: 1, growth: 1.55,
    effect: "+10% ко всему доходу за уровень",
    current: (lv) => `сейчас +${lv * 10}% к доходу`,
  },
  {
    id: "realtor", icon: "🏠", name: "Риелтор", type: "level",
    base: 1, growth: 1.5,
    effect: "+15% к доходу от аренды за уровень",
    current: (lv) => `сейчас +${lv * 15}% к аренде`,
  },
  {
    id: "guru", icon: "📈", name: "Биржевой гуру", type: "level",
    base: 1, growth: 1.5,
    effect: "+15% к купонам и дивидендам за уровень",
    current: (lv) => `сейчас +${lv * 15}% к купонам и дивидендам`,
  },
  {
    id: "vip", icon: "🏦", name: "Банковский VIP", type: "level",
    base: 1, growth: 1.7,
    effect: "+1 п.п. к ставкам всех вкладов за уровень",
    current: (lv) => `сейчас +${lv} п.п. к ставкам`,
  },
  {
    id: "heir", icon: "👑", name: "Наследство", type: "level",
    base: 1, growth: 2.4,
    effect: "Стартовый капитал после перерождения: 12 тыс ₽ на 1-м уровне и ×3 за каждый следующий",
    current: (lv) => `сейчас старт ${Fmt.moneyShort(heirBalance(lv))}`,
  },
  {
    id: "compound", icon: "🌙", name: "Сложный процент", type: "level",
    base: 2, growth: 1.6,
    effect: "+25% к офлайн-доходу за уровень",
    current: (lv) => `сейчас +${lv * 25}% к офлайн-доходу`,
  },
  {
    id: "mogul", icon: "🚀", name: "Серийный предприниматель", type: "level",
    base: 1, growth: 1.5,
    effect: "+15% к доходу бизнесов за уровень",
    current: (lv) => `сейчас +${lv * 15}% к доходу бизнесов`,
  },

  // --- Одноразовые перки качества жизни ---
  {
    id: "lawyer", icon: "⚖️", name: "Личный юрист", type: "once", costs: [3],
    effect: "Арендаторы не предлагают ставку ниже ×0.95",
  },
  {
    id: "foreman", icon: "👷", name: "Прораб", type: "once", costs: [4],
    effect: "Здания изнашиваются на 30% медленнее",
  },
  {
    id: "broker", icon: "🧾", name: "Оптовый брокер", type: "once", costs: [3],
    effect: "Комиссия брокера 0,3% → 0,1%",
  },
  {
    id: "steward", icon: "🤵", name: "Штатный управляющий", type: "once", costs: [5],
    effect: "Наём управляющего бесплатен, его комиссия 15% → 10%",
  },
  {
    id: "insurance", icon: "🛡️", name: "Страховка", type: "once", costs: [6],
    effect: "Аварии в зданиях больше не случаются",
  },
  {
    id: "loyalty", icon: "💳", name: "Программа лояльности", type: "once", costs: [4],
    effect: "Лимиты всех вкладов ×2",
  },
  {
    id: "insider", icon: "🕵️", name: "Инсайдер", type: "once", costs: [8],
    effect: "На бирже видно, когда бумага недооценена или переоценена",
  },
  {
    id: "dealer", icon: "💱", name: "Валютный дилер", type: "once", costs: [6],
    effect: "Спред на всех валютных парах на 40% уже",
  },

  // --- Перки под механики бизнесов ---
  {
    id: "logist", icon: "🚚", name: "Надёжный поставщик", type: "once", costs: [4],
    effect: "Запасы кофейни расходуются на 25% медленнее",
  },
  {
    id: "viral", icon: "📱", name: "Вирусный маркетинг", type: "once", costs: [5],
    effect: "Рекламные кампании магазина на 30% дешевле",
  },
  {
    id: "gos", icon: "🏛️", name: "Госзаказы", type: "once", costs: [6],
    effect: "Контракты завода — не ниже ставки ×1.1",
  },
  {
    id: "angel", icon: "😇", name: "Бизнес-ангел", type: "once", costs: [6],
    effect: "R&D-проекты стартапа на 30% дешевле",
  },
  {
    id: "producer", icon: "🍿", name: "Продюсерское чутьё", type: "once", costs: [8],
    effect: "Сборы фильмов не бывают ниже ×0.7 бюджета",
  },

  // --- Дорогая эндгейм-экзотика ---
  {
    id: "goldclick", icon: "🤝", name: "Золотое рукопожатие", type: "once", costs: [10],
    effect: "«Заключить сделку» приносит в 5 раз больше",
  },
  {
    id: "empire", icon: "🌍", name: "Империя", type: "once", costs: [25],
    effect: "+50% ко всему доходу",
  },
  {
    id: "bizempire", icon: "💎", name: "Империя бизнеса", type: "once", costs: [40],
    effect: "Доход всех бизнесов ×1.5",
  },
  {
    id: "legend", icon: "🏆", name: "Легенда рынка", type: "once", costs: [50],
    effect: "Весь доход ×2",
  },
];

const PRESTIGE_BY_ID = Object.fromEntries(PRESTIGE_DEFS.map((d) => [d.id, d]));

/**
 * Цена следующего уровня перка. lv — сколько уровней уже куплено.
 * Для уровневых — геометрическая прогрессия без верхней границы,
 * для одноразовых — фиксированная цена из costs.
 */
function prestigeCost(def, lv) {
  if (def.type === "once") return def.costs[lv];
  return Math.ceil(def.base * Math.pow(def.growth, lv));
}

/** Потолок уровней: у уровневых перков его нет */
function prestigeMaxLv(def) {
  return def.type === "once" ? def.costs.length : Infinity;
}

/**
 * Стартовый капитал при уровне «Наследства» lv.
 * Вынесено сюда, чтобы описание перка и GameState считали по одной формуле.
 */
function heirBalance(lv) {
  if (lv <= 0) return CONFIG.STARTING_BALANCE;
  return CONFIG.HEIR_BASE * Math.pow(CONFIG.HEIR_GROWTH, lv - 1);
}
