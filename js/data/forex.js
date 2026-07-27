/**
 * Валютные пары для раздела «Форекс».
 *
 * Ключевое отличие от акций: торгуется НЕ актив, а котировка пары —
 * поэтому можно вставать и в лонг (base растёт), и в шорт (base падает),
 * причём с кредитным плечом под залог (маржу).
 *
 * Модель цены — та же, что у акций (anchor × mood, см. core/marketSim.js):
 *   growth — дрейф «якоря» в день. У мажоров 0: валюты колеблются, а не
 *            дорожают систематически. У экзотики положительный — слабая
 *            валюта девальвируется к доллару (реальное явление).
 *   vol / moodRange — волатильность и коридор колебаний.
 *
 * Спред задан в пунктах (pip) и пересчитывается в долю от цены на лету:
 *   spreadFrac = spreadPips × pip / price
 * Вход в лонг по ask, выход по bid (и наоборот для шорта), поэтому спред
 * списывается сам собой, без отдельной комиссии.
 *
 * swapLong / swapShort — плата за перенос позиции, % от объёма в час.
 * Одна из сторон бывает положительной (carry trade — заработок на разнице
 * ставок), но сумма свопов по паре всегда отрицательная: брокер берёт своё,
 * поэтому бесконечной халявы нет.
 *
 * maxLev — максимальное плечо: чем экзотичнее пара, тем ниже (как у
 * настоящих брокеров, ограничивающих риск по неликвидным валютам).
 * // TODO: новая пара — просто добавить запись сюда
 */
const FOREX_DEFS = [
  // ---------- МАЖОРЫ: узкий спред, спокойные движения, плечо до 1:100 ----------
  {
    id: "eurusd", kind: "forex", cls: "Мажор", ticker: "EUR/USD", nick: "«Фибер»",
    name: "Евро — Доллар США", basePrice: 1.0850, digits: 5, pip: 0.0001,
    spreadPips: 1.2, vol: 0.0008, growth: 0, moodRange: [0.88, 1.14],
    swapLong: -0.004, swapShort: 0.001, maxLev: 100,
    desc: "Самая ликвидная пара мира. Узкий спред, предсказуемый характер — с неё стоит начинать.",
  },
  {
    id: "gbpusd", kind: "forex", cls: "Мажор", ticker: "GBP/USD", nick: "«Кабель»",
    name: "Фунт стерлингов — Доллар США", basePrice: 1.2650, digits: 5, pip: 0.0001,
    spreadPips: 1.6, vol: 0.0011, growth: 0, moodRange: [0.86, 1.16],
    swapLong: -0.005, swapShort: 0.001, maxLev: 100,
    desc: "Историческое прозвище — от трансатлантического кабеля. Резче евро, но всё ещё мажор.",
  },
  {
    id: "usdjpy", kind: "forex", cls: "Мажор", ticker: "USD/JPY", nick: "«Ниндзя»",
    name: "Доллар США — Японская иена", basePrice: 149.50, digits: 3, pip: 0.01,
    spreadPips: 1.4, vol: 0.0010, growth: 0, moodRange: [0.85, 1.18],
    swapLong: 0.004, swapShort: -0.010, maxLev: 100,
    desc: "Классика carry trade: за лонг платят своп, потому что ставка в США выше японской.",
  },
  {
    id: "usdchf", kind: "forex", cls: "Мажор", ticker: "USD/CHF", nick: "«Свисси»",
    name: "Доллар США — Швейцарский франк", basePrice: 0.8750, digits: 5, pip: 0.0001,
    spreadPips: 1.8, vol: 0.0009, growth: 0, moodRange: [0.88, 1.13],
    swapLong: 0.003, swapShort: -0.008, maxLev: 100,
    desc: "Франк — валюта-убежище: в кризис инвесторы бегут в него, и пара падает.",
  },
  {
    id: "audusd", kind: "forex", cls: "Мажор", ticker: "AUD/USD", nick: "«Осси»",
    name: "Австралийский доллар — Доллар США", basePrice: 0.6550, digits: 5, pip: 0.0001,
    spreadPips: 1.5, vol: 0.0012, growth: 0, moodRange: [0.84, 1.18],
    swapLong: -0.002, swapShort: -0.001, maxLev: 100,
    desc: "Сырьевая валюта: ходит вслед за ценами на металлы и спросом из Азии.",
  },
  {
    id: "usdcad", kind: "forex", cls: "Мажор", ticker: "USD/CAD", nick: "«Луни»",
    name: "Доллар США — Канадский доллар", basePrice: 1.3650, digits: 5, pip: 0.0001,
    spreadPips: 1.9, vol: 0.0011, growth: 0, moodRange: [0.86, 1.16],
    swapLong: 0.001, swapShort: -0.005, maxLev: 100,
    desc: "«Луни» — по гагаре на монете. Тесно связан с нефтью: дорожает нефть — падает пара.",
  },

  // ---------- КРОССЫ: без доллара, спред шире, ходят резче, плечо до 1:50 ----------
  {
    id: "eurgbp", kind: "forex", cls: "Кросс", ticker: "EUR/GBP", nick: "",
    name: "Евро — Фунт стерлингов", basePrice: 0.8580, digits: 5, pip: 0.0001,
    spreadPips: 2.2, vol: 0.0010, growth: 0, moodRange: [0.87, 1.15],
    swapLong: -0.006, swapShort: 0.002, maxLev: 50,
    desc: "Тихий кросс двух соседей: узкий диапазон, движения мелкие и вязкие.",
  },
  {
    id: "eurjpy", kind: "forex", cls: "Кросс", ticker: "EUR/JPY", nick: "",
    name: "Евро — Японская иена", basePrice: 162.20, digits: 3, pip: 0.01,
    spreadPips: 2.5, vol: 0.0014, growth: 0, moodRange: [0.82, 1.20],
    swapLong: 0.003, swapShort: -0.009, maxLev: 50,
    desc: "Барометр аппетита к риску: растёт, когда рынки настроены оптимистично.",
  },
  {
    id: "gbpjpy", kind: "forex", cls: "Кросс", ticker: "GBP/JPY", nick: "«Дракон»",
    name: "Фунт стерлингов — Японская иена", basePrice: 189.00, digits: 3, pip: 0.01,
    spreadPips: 3.5, vol: 0.0022, growth: 0, moodRange: [0.78, 1.26],
    swapLong: 0.004, swapShort: -0.011, maxLev: 50,
    desc: "Легендарный «Дракон» — самая злая из популярных пар. Кормит смелых и сжигает жадных.",
  },

  // ---------- ЭКЗОТИКА: широкий спред, тренд девальвации, плечо до 1:20 ----------
  {
    id: "usdtry", kind: "forex", cls: "Экзотика", ticker: "USD/TRY", nick: "",
    name: "Доллар США — Турецкая лира", basePrice: 32.50, digits: 4, pip: 0.0001,
    spreadPips: 350, vol: 0.0040, growth: 0.040, moodRange: [0.75, 1.30],
    swapLong: -0.085, swapShort: 0.040, maxLev: 20,
    desc: "Лира годами слабеет — пара ползёт вверх. Но за лонг придётся платить огромный своп.",
  },
  {
    id: "usdzar", kind: "forex", cls: "Экзотика", ticker: "USD/ZAR", nick: "«Ранд»",
    name: "Доллар США — Южноафриканский ранд", basePrice: 18.90, digits: 4, pip: 0.0001,
    spreadPips: 250, vol: 0.0035, growth: 0.020, moodRange: [0.78, 1.28],
    swapLong: -0.050, swapShort: 0.020, maxLev: 20,
    desc: "Валюта золота и платины: реагирует на сырьё и политические новости резкими скачками.",
  },
  {
    id: "usdrub", kind: "forex", cls: "Экзотика", ticker: "USD/RUB", nick: "",
    name: "Доллар США — Российский рубль", basePrice: 92.50, digits: 4, pip: 0.0001,
    spreadPips: 400, vol: 0.0038, growth: 0.030, moodRange: [0.76, 1.30],
    swapLong: -0.070, swapShort: 0.030, maxLev: 20,
    desc: "Родная пара магната: широкий спред и нервный характер, зато движения знакомые.",
  },
  {
    id: "usdmxn", kind: "forex", cls: "Экзотика", ticker: "USD/MXN", nick: "«Песо»",
    name: "Доллар США — Мексиканское песо", basePrice: 17.20, digits: 4, pip: 0.0001,
    spreadPips: 200, vol: 0.0030, growth: 0.015, moodRange: [0.80, 1.25],
    swapLong: -0.040, swapShort: 0.015, maxLev: 20,
    desc: "Любимица кэрри-трейдеров: высокая ставка делает шорт доллара доходным, но рискованным.",
  },
];

const FX_BY_ID = Object.fromEntries(FOREX_DEFS.map((d) => [d.id, d]));

/**
 * Все инструменты, которые считает MarketSim: спотовые (акции/облигации/
 * крипта) + валютные пары. Портфельная логика по-прежнему работает только
 * с MARKET_ASSETS — у форекса своя структура позиций (маржа, плечо, сторона).
 */
const ALL_SIM_ASSETS = [...MARKET_ASSETS, ...FOREX_DEFS];
