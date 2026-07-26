/**
 * Биржевые инструменты. Общая модель цены: price = anchor × mood,
 * где anchor медленно растёт (growth, % в день), а mood — случайное
 * блуждание с возвратом к 1 (vol — волатильность за тик, moodRange —
 * коридор). Чем рискованнее инструмент, тем шире коридор и выше vol.
 *
 * Балансовая иерархия доходности (на вложенный рубль):
 *   вклады (безопасно, лимиты) < ОФЗ < корп. облигации < ВДО
 *   < дивидендные акции (+курсовой риск) < акции роста (чистый риск)
 *   < крипта (казино). Облигации ограничены объёмом выпуска.
 *
 * div    — дивиденды, доля стоимости позиции в час (0 — не платит)
 * coupon — купон облигации, доля номинала (face) в час
 * issue  — объём выпуска облигации, шт (первичный рынок ограничен)
 * // TODO: новый инструмент — добавить запись в соответствующий массив
 */
const STOCK_DEFS = [
  { id: "enst", kind: "stock", ticker: "ЭНСТ", name: "ЭнергоСеть",    sector: "Энергетика",    basePrice: 120, vol: 0.0015, growth: 0.010, div: 0.05,  moodRange: [0.7, 1.6] },
  { id: "gznf", kind: "stock", ticker: "ГЗНФ", name: "ГазНефть",      sector: "Нефтегаз",      basePrice: 340, vol: 0.002,  growth: 0.015, div: 0.045, moodRange: [0.6, 1.7] },
  { id: "bank", kind: "stock", ticker: "БАНК", name: "БанкИмперия",   sector: "Финансы",       basePrice: 210, vol: 0.003,  growth: 0.020, div: 0.035, moodRange: [0.6, 1.8] },
  { id: "agro", kind: "stock", ticker: "АГРО", name: "АгроХолдинг",   sector: "АПК",           basePrice: 95,  vol: 0.0028, growth: 0.020, div: 0.03,  moodRange: [0.6, 1.8] },
  { id: "mtlg", kind: "stock", ticker: "МТЛГ", name: "МеталлГрупп",   sector: "Металлургия",   basePrice: 155, vol: 0.004,  growth: 0.020, div: 0.025, moodRange: [0.5, 2.0] },
  { id: "rtlp", kind: "stock", ticker: "РТЛП", name: "РитейлПлюс",    sector: "Ритейл",        basePrice: 75,  vol: 0.0035, growth: 0.025, div: 0.02,  moodRange: [0.5, 2.0] },
  { id: "frmb", kind: "stock", ticker: "ФРМБ", name: "ФармБио",       sector: "Фарма",         basePrice: 480, vol: 0.006,  growth: 0.040, div: 0,     moodRange: [0.4, 2.5] },
  { id: "thsf", kind: "stock", ticker: "ТХСФ", name: "ТехноСфера",    sector: "IT",            basePrice: 620, vol: 0.007,  growth: 0.050, div: 0,     moodRange: [0.4, 3.0] },
  { id: "kvrb", kind: "stock", ticker: "КВРБ", name: "КвантРоботикс", sector: "Робототехника", basePrice: 45,  vol: 0.010,  growth: 0.060, div: 0,     moodRange: [0.3, 4.0] },
  { id: "ksml", kind: "stock", ticker: "КСМЛ", name: "КосмоЛайн",     sector: "Космос",        basePrice: 28,  vol: 0.014,  growth: 0.080, div: 0,     moodRange: [0.25, 5.0] },
];

const BOND_DEFS = [
  { id: "ofz1", kind: "bond", name: "ОФЗ «Стабильность»",  rating: "AAA", basePrice: 1000, face: 1000, vol: 0.0004, growth: 0, div: 0, moodRange: [0.92, 1.08], coupon: 0.06,  issue: 5000 },
  { id: "ofz2", kind: "bond", name: "ОФЗ «Развитие»",      rating: "AAA", basePrice: 1000, face: 1000, vol: 0.0005, growth: 0, div: 0, moodRange: [0.90, 1.10], coupon: 0.07,  issue: 4000 },
  { id: "enb",  kind: "bond", name: "ЭнергоСеть БО-1",     rating: "A+",  basePrice: 1000, face: 1000, vol: 0.0007, growth: 0, div: 0, moodRange: [0.88, 1.12], coupon: 0.09,  issue: 3000 },
  { id: "mtb",  kind: "bond", name: "МеталлГрупп БО-2",    rating: "BBB", basePrice: 1000, face: 1000, vol: 0.0009, growth: 0, div: 0, moodRange: [0.85, 1.15], coupon: 0.105, issue: 2500 },
  { id: "rtb",  kind: "bond", name: "РитейлПлюс БО-1",     rating: "BB",  basePrice: 1000, face: 1000, vol: 0.0011, growth: 0, div: 0, moodRange: [0.80, 1.20], coupon: 0.12,  issue: 2000 },
  { id: "kvb",  kind: "bond", name: "КвантРоботикс ВДО",   rating: "B-",  basePrice: 1000, face: 1000, vol: 0.0016, growth: 0, div: 0, moodRange: [0.35, 1.25], coupon: 0.15,  issue: 1500, risky: true },
];

const CRYPTO_DEFS = [
  { id: "cfk", kind: "crypto", ticker: "ЦФК", name: "Цифрокойн", sector: "Криптовалюта", basePrice: 52000, vol: 0.02,  growth: 0.03,  div: 0, moodRange: [0.2, 6],   step: 0.0001 },
  { id: "efr", kind: "crypto", ticker: "ЭФР", name: "Эфирион",   sector: "Криптовалюта", basePrice: 3900,  vol: 0.025, growth: 0.035, div: 0, moodRange: [0.15, 8],  step: 0.001 },
  { id: "dog", kind: "crypto", ticker: "ДОГ", name: "ДогМонета", sector: "Мем-койн",     basePrice: 2.4,   vol: 0.04,  growth: 0.02,  div: 0, moodRange: [0.05, 15], step: 1 },
];

/** Единый список всех биржевых активов для симулятора рынка */
const MARKET_ASSETS = [...STOCK_DEFS, ...BOND_DEFS, ...CRYPTO_DEFS];
