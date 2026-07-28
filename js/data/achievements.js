/**
 * Достижения — система целей. Отвечают на вопрос «что делать дальше»
 * и заодно работают как экскурсия по механикам: каждая ветка подталкивает
 * попробовать раздел, до которого игрок ещё не добрался.
 *
 * Награда — золотые монеты престижа. Это сознательно: достижения позволяют
 * попробовать магазин перков задолго до первого перерождения. Но именно
 * бонус, а не основной источник: суммарно по всем 45 достижениям 69 монет,
 * из них до первого перерождения реально собрать около 17 — меньше, чем
 * приносят четыре-пять перерождений. Вес перевзвешен по сложности: лёгкие
 * ранние цели дают 1 монету, самые тяжёлые (триллион, 15 перерождений,
 * бизнес 25 уровня, весь город) — 3–5.
 *
 * Формат записи (два варианта на выбор):
 *   value + goal — числовая цель, прогресс считается автоматически
 *   check        — произвольное условие (прогресс 0 или 1)
 * secret: true — до получения показывается как «???».
 * // TODO: новое достижение — просто добавить запись сюда
 */
const ACHIEVEMENT_DEFS = [
  // ---------- Капитал ----------
  { id: "cap1", cat: "Капитал", icon: "💵", name: "Первые десять тысяч", coins: 1,
    desc: "Накопите капитал 10 000 ₽", value: (s) => s.netWorth, goal: 1e4, unit: "money" },
  { id: "cap2", cat: "Капитал", icon: "💰", name: "Шестизначный", coins: 1,
    desc: "Накопите капитал 100 000 ₽", value: (s) => s.netWorth, goal: 1e5, unit: "money" },
  { id: "cap3", cat: "Капитал", icon: "🤑", name: "Миллионер", coins: 1,
    desc: "Накопите капитал 1 млн ₽", value: (s) => s.netWorth, goal: 1e6, unit: "money" },
  { id: "cap4", cat: "Капитал", icon: "🏦", name: "Мультимиллионер", coins: 1,
    desc: "Накопите капитал 10 млн ₽", value: (s) => s.netWorth, goal: 1e7, unit: "money" },
  { id: "cap5", cat: "Капитал", icon: "🏛️", name: "Сотня миллионов", coins: 2,
    desc: "Накопите капитал 100 млн ₽", value: (s) => s.netWorth, goal: 1e8, unit: "money" },
  { id: "cap6", cat: "Капитал", icon: "👑", name: "Миллиардер", coins: 3,
    desc: "Накопите капитал 1 млрд ₽", value: (s) => s.netWorth, goal: 1e9, unit: "money" },
  { id: "cap7", cat: "Капитал", icon: "🌍", name: "Триллионер", coins: 5,
    desc: "Накопите капитал 1 трлн ₽", value: (s) => s.netWorth, goal: 1e12, unit: "money" },

  // ---------- Недвижимость ----------
  { id: "re1", cat: "Недвижимость", icon: "🔑", name: "Ключи в руках", coins: 1,
    desc: "Купите первый объект недвижимости", value: (s) => s.ownedPropsCount, goal: 1 },
  { id: "re2", cat: "Недвижимость", icon: "🏘️", name: "Арендодатель", coins: 1,
    desc: "Владейте 5 объектами", value: (s) => s.ownedPropsCount, goal: 5 },
  { id: "re3", cat: "Недвижимость", icon: "🏙️", name: "Портфель растёт", coins: 1,
    desc: "Владейте 12 объектами", value: (s) => s.ownedPropsCount, goal: 12 },
  { id: "re4", cat: "Недвижимость", icon: "🗺️", name: "Скупил весь город", coins: 3,
    desc: "Владейте всеми 25 объектами", value: (s) => s.ownedPropsCount, goal: 25 },
  { id: "re5", cat: "Недвижимость", icon: "✨", name: "Премиум-класс", coins: 1,
    desc: "Доведите объект до 3-го уровня улучшений",
    value: (s) => PROPERTY_DEFS.filter((d) => s.props[d.id]?.lv >= 3).length, goal: 1 },
  { id: "re6", cat: "Недвижимость", icon: "🛠️", name: "Идеальный хозяин", coins: 2,
    desc: "5 объектов на максимальном уровне",
    value: (s) => PROPERTY_DEFS.filter((d) => s.props[d.id]?.lv >= 3).length, goal: 5 },
  { id: "re7", cat: "Недвижимость", icon: "🌆", name: "Магнат-Тауэр", coins: 2,
    desc: "Купите небоскрёб", check: (s) => !!s.props.skyscraper },

  // ---------- Бизнес ----------
  { id: "bz1", cat: "Бизнес", icon: "☕", name: "Первое дело", coins: 1,
    desc: "Откройте свой первый бизнес",
    value: (s) => BUSINESS_DEFS.filter((d) => s.businesses[d.id]).length, goal: 1 },
  { id: "bz2", cat: "Бизнес", icon: "🧩", name: "Диверсификация", coins: 2,
    desc: "Откройте все 6 бизнесов",
    value: (s) => BUSINESS_DEFS.filter((d) => s.businesses[d.id]).length, goal: 6 },
  { id: "bz3", cat: "Бизнес", icon: "📈", name: "Растущая сеть", coins: 1,
    desc: "Прокачайте бизнес до 10 уровня",
    value: (s) => Math.max(0, ...BUSINESS_DEFS.map((d) => s.businesses[d.id]?.lv || 0)), goal: 10 },
  { id: "bz4", cat: "Бизнес", icon: "🏆", name: "Высший ранг", coins: 2,
    desc: "Прокачайте бизнес до 20 уровня",
    value: (s) => Math.max(0, ...BUSINESS_DEFS.map((d) => s.businesses[d.id]?.lv || 0)), goal: 20 },
  { id: "bz5", cat: "Бизнес", icon: "💎", name: "Дело всей жизни", coins: 3,
    desc: "Прокачайте бизнес до 25 уровня",
    value: (s) => Math.max(0, ...BUSINESS_DEFS.map((d) => s.businesses[d.id]?.lv || 0)), goal: 25 },
  { id: "bz6", cat: "Бизнес", icon: "🍿", name: "Хит проката", coins: 1,
    desc: "Снимите фильм со сборами ×3 и выше",
    value: (s) => s.stats.bestFilmBox, goal: 3 },

  // ---------- Биржа ----------
  { id: "mk1", cat: "Биржа", icon: "🧾", name: "Первая сделка", coins: 1,
    desc: "Купите любую ценную бумагу", value: (s) => s.stats.tradeCount, goal: 1 },
  { id: "mk2", cat: "Биржа", icon: "📊", name: "Инвестор", coins: 1,
    desc: "Соберите портфель на 1 млн ₽", value: (s) => s.portfolioValue(), goal: 1e6, unit: "money" },
  { id: "mk3", cat: "Биржа", icon: "🗃️", name: "Коллекционер", coins: 2,
    desc: "Владейте акциями всех 10 компаний",
    value: (s) => STOCK_DEFS.filter((d) => s.portfolio[d.id]?.qty > 0).length, goal: 10 },
  { id: "mk4", cat: "Биржа", icon: "📜", name: "Купонная рента", coins: 1,
    desc: "Доведите доход по купонам до 100 ₽/с", value: (s) => s.couponPerSec, goal: 100, unit: "money" },
  { id: "mk5", cat: "Биржа", icon: "🪙", name: "Криптоэнтузиаст", coins: 1,
    desc: "Купите любую криптовалюту",
    check: (s) => CRYPTO_DEFS.some((d) => s.portfolio[d.id]?.qty > 0) },
  { id: "mk6", cat: "Биржа", icon: "🚀", name: "Удачный трейд", coins: 2,
    desc: "Заработайте 1 млн ₽ на торговле", value: (s) => s.stats.tradeProfit, goal: 1e6, unit: "money" },

  // ---------- Форекс ----------
  { id: "fx1", cat: "Форекс", icon: "💱", name: "Первый ордер", coins: 1,
    desc: "Откройте валютную позицию", value: (s) => s.stats.fxTrades, goal: 1 },
  { id: "fx2", cat: "Форекс", icon: "🐻", name: "Медведь", coins: 1,
    desc: "Закройте короткую позицию с прибылью", value: (s) => s.stats.fxShortWins, goal: 1 },
  { id: "fx3", cat: "Форекс", icon: "🎚️", name: "На всё плечо", coins: 1,
    desc: "Откройте позицию с плечом 1:100", value: (s) => s.stats.fxMaxLev, goal: 100 },
  { id: "fx4", cat: "Форекс", icon: "💥", name: "Урок маржи", coins: 1,
    desc: "Поймайте свой первый стоп-аут (бывает с каждым)",
    value: (s) => s.stats.fxStopOuts, goal: 1 },
  { id: "fx5", cat: "Форекс", icon: "🎣", name: "Кэрри-трейдер", coins: 1,
    desc: "Заработайте 10 000 ₽ на положительных свопах",
    value: (s) => s.stats.fxSwapEarned, goal: 1e4, unit: "money" },

  // ---------- Вклады ----------
  { id: "dp1", cat: "Вклады", icon: "🐷", name: "Копилка", coins: 1,
    desc: "Откройте любой банковский вклад",
    check: (s) => DEPOSIT_DEFS.some((d) => s.deposits[d.id]) },
  { id: "dp2", cat: "Вклады", icon: "🏧", name: "Полный банкинг", coins: 1,
    desc: "Держите открытыми все 4 вклада одновременно",
    value: (s) => DEPOSIT_DEFS.filter((d) => s.deposits[d.id]).length, goal: 4 },

  // ---------- Престиж ----------
  { id: "pr1", cat: "Престиж", icon: "👑", name: "Новая жизнь", coins: 2,
    desc: "Переродитесь в первый раз", value: (s) => s.prestigeCount, goal: 1 },
  { id: "pr2", cat: "Престиж", icon: "🔁", name: "Опытный магнат", coins: 2,
    desc: "Переродитесь 5 раз", value: (s) => s.prestigeCount, goal: 5 },
  { id: "pr3", cat: "Престиж", icon: "🗿", name: "Ветеран", coins: 5,
    desc: "Переродитесь 15 раз", value: (s) => s.prestigeCount, goal: 15 },
  { id: "pr4", cat: "Престиж", icon: "🛒", name: "Первая покупка", coins: 1,
    desc: "Купите улучшение в магазине престижа",
    value: (s) => Object.values(s.perks).reduce((a, b) => a + b, 0), goal: 1 },
  { id: "pr5", cat: "Престиж", icon: "🎖️", name: "Коллекция перков", coins: 2,
    desc: "Наберите 10 уровней улучшений суммарно",
    value: (s) => Object.values(s.perks).reduce((a, b) => a + b, 0), goal: 10 },

  // ---------- Разное ----------
  { id: "ms1", cat: "Разное", icon: "🤝", name: "Мастер переговоров", coins: 1,
    desc: "Заключите 100 сделок вручную", value: (s) => s.stats.clickCount, goal: 100 },
  { id: "ms2", cat: "Разное", icon: "⏱️", name: "Час в деле", coins: 1,
    desc: "Проведите в игре 1 час", value: (s) => s.stats.playTimeSec, goal: 3600, unit: "time" },
  { id: "ms3", cat: "Разное", icon: "📅", name: "Марафонец", coins: 1,
    desc: "Проведите в игре сутки", value: (s) => s.stats.playTimeSec, goal: 86400, unit: "time" },
  { id: "ms4", cat: "Разное", icon: "🌙", name: "Деньги во сне", coins: 1,
    desc: "Заберите офлайн-доход", value: (s) => s.stats.offlineCollected, goal: 1 },
  { id: "ms5", cat: "Разное", icon: "🤵", name: "Делегирование", coins: 1,
    desc: "Наймите управляющего недвижимостью", check: (s) => s.managerHired },
  { id: "ms6", cat: "Разное", icon: "🧯", name: "Полная разруха", coins: 1, secret: true,
    desc: "Довести здание до нулевого состояния — тоже надо уметь",
    check: (s) => PROPERTY_DEFS.some((d) => s.props[d.id] && s.props[d.id].cond <= 0.5) },
  { id: "ms7", cat: "Разное", icon: "🎰", name: "Ва-банк", coins: 1, secret: true,
    desc: "Пережить 10 стоп-аутов на форексе и не бросить",
    value: (s) => s.stats.fxStopOuts, goal: 10 },
];

const ACH_BY_ID = Object.fromEntries(ACHIEVEMENT_DEFS.map((a) => [a.id, a]));
/** Порядок категорий в интерфейсе */
const ACH_CATEGORIES = ["Капитал", "Недвижимость", "Бизнес", "Биржа", "Форекс", "Вклады", "Престиж", "Разное"];
