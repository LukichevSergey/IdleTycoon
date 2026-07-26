/** Чистые утилиты: случайные числа и форматирование. Без состояния и DOM. */

const U = {
  rand: (a, b) => a + Math.random() * (b - a),
  randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
  choice: (arr) => arr[Math.floor(Math.random() * arr.length)],
  clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
  /** Нормальное распределение (Бокс — Мюллер) для симуляции котировок */
  randn() {
    let u = 0, v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  },
};

const nfMoney = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfShort = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
const nfQty = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 4 });
const nfPct = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const Fmt = {
  /** Деньги полностью: 1 234 567,89 ₽ */
  money: (v) => nfMoney.format(v) + " ₽",

  /** Компактно для крупных сумм: 1,15 млн ₽ */
  moneyShort(v) {
    const a = Math.abs(v);
    if (a >= 1e9) return nfShort.format(v / 1e9) + " млрд ₽";
    if (a >= 1e6) return nfShort.format(v / 1e6) + " млн ₽";
    return this.money(v);
  },

  /** Процент со знаком: +1,2 % */
  signPct(p) {
    return (p >= 0 ? "+" : "") + nfPct.format(p) + " %";
  },

  qty: (v) => nfQty.format(v),

  /** Полная длительность: 2 д 5 ч 12 мин 30 с */
  dur(totalSeconds) {
    const d = Math.floor(totalSeconds / 86400);
    const h = Math.floor((totalSeconds % 86400) / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    const parts = [];
    if (d) parts.push(d + " д");
    if (h) parts.push(h + " ч");
    if (m) parts.push(m + " мин");
    parts.push(s + " с");
    return parts.join(" ");
  },

  /** Короткая длительность для таймеров: «7 ч 59 мин», «3 мин 12 с», «43 с» */
  durShort(totalSeconds) {
    const t = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    if (h) return `${h} ч ${m} мин`;
    if (m) return `${m} мин ${s} с`;
    return `${s} с`;
  },
};

/** Мини-график цены (SVG). trendClass: 'up' | 'down' | '' */
function sparkSVG(history, w = 120, h = 32) {
  if (!history || history.length < 2) return "";
  const min = Math.min(...history);
  const max = Math.max(...history);
  const span = max - min || 1;
  const n = history.length - 1;
  const pts = history
    .map((p, i) => `${((i / n) * w).toFixed(1)},${(h - 3 - ((p - min) / span) * (h - 6)).toFixed(1)}`)
    .join(" ");
  const trend = history[history.length - 1] >= history[0] ? "up" : "down";
  return `<svg class="spark ${trend}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5"/>
  </svg>`;
}
