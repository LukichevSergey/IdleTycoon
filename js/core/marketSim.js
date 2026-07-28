
/**
 * Имитация котировок. Модель: price = anchor × mood.
 *  - anchor — «справедливая цена», медленно растёт (growth, доля в день);
 *  - mood — лог-случайное блуждание с возвратом к 1 (mean reversion),
 *    ограничено коридором moodRange. Это даёт живые колебания без
 *    бесконтрольного улёта цены.
 * Смена модели ценообразования затрагивает только этот класс.
 */
class MarketSim {
  constructor(defs) {
    this.defs = defs;
    this.s = {};
    defs.forEach((d) => {
      this.s[d.id] = { anchor: d.basePrice, mood: 1, price: d.basePrice, history: [d.basePrice] };
    });
  }

  price(id) { return this.s[id].price; }
  history(id) { return this.s[id].history; }
  /** Настроение (price / anchor): <1 — бумага дешевле «справедливой» цены */
  mood(id) { return this.s[id].mood; }

  /** Изменение цены за окно спарклайна (~3 мин), в процентах */
  changePct(id) {
    const h = this.s[id].history;
    if (h.length < 2) return 0;
    return ((h[h.length - 1] - h[0]) / h[0]) * 100;
  }

  /** Один рыночный тик (каждые MARKET_TICK_MS) */
  tick() {
    const dtDay = CONFIG.MARKET_TICK_MS / 1000 / 86400;
    this.defs.forEach((d) => {
      const s = this.s[d.id];
      s.anchor *= Math.exp(d.growth * dtDay);
      let lm = Math.log(s.mood);
      lm = lm * (1 - CONFIG.MOOD_REVERSION) + d.vol * U.randn();
      s.mood = U.clamp(Math.exp(lm), d.moodRange[0], d.moodRange[1]);
      s.price = s.anchor * s.mood;
      this._push(s, s.price);
    });
  }

  /** Внешний шок (случайное событие): моментальный сдвиг настроения */
  shock(id, mult) {
    const d = this.defs.find((x) => x.id === id);
    const s = this.s[id];
    if (!d || !s) return;
    s.mood = U.clamp(s.mood * mult, d.moodRange[0], d.moodRange[1]);
    s.price = s.anchor * s.mood;
    this._push(s, s.price);
  }

  /**
   * Офлайн-прогресс рынка за `seconds`.
   *
   * Период разбивается на `steps` равных отрезков; после каждого вызывается
   * `onStep(seg)`. Это нужно форексу: маржинальной позиции важна не только
   * конечная цена, но и путь — по дороге мог сработать стоп-лосс или стоп-аут.
   * При steps = 1 поведение прежнее — один прыжок на весь период.
   *
   * Дисперсия одного отрезка берётся ТОЧНОЙ для AR(1) с возвратом:
   *   V(n) = (1 - ρ^(2n)) / (1 - ρ²),  ρ = 1 - MOOD_REVERSION,
   * где n — число рыночных тиков в отрезке. Это принципиально при дроблении:
   * у точной формулы K отрезков складываются ровно в ту же стационарную
   * дисперсию, что и один большой прыжок, тогда как прежнее приближение
   * min(n, 1/(2θ)) завышало дисперсию каждого отрезка и при дроблении
   * раздувало итоговую волатильность.
   *
   * @param {number} seconds длительность офлайна
   * @param {number} [steps] на сколько отрезков дробить путь
   * @param {function(number):void} [onStep] колбэк после каждого отрезка
   */
  advance(seconds, steps = 1, onStep = null) {
    steps = Math.max(1, Math.floor(steps));
    const seg = seconds / steps;
    const n = seg / (CONFIG.MARKET_TICK_MS / 1000);
    const rho = 1 - CONFIG.MOOD_REVERSION;
    const damp = Math.pow(rho, n);
    const varFactor = Math.sqrt((1 - Math.pow(rho, 2 * n)) / (1 - rho * rho));

    // Параметры отрезка одинаковы для всех шагов — считаем их один раз,
    // чтобы 48 часов офлайна не превратились в тысячи лишних Math.pow
    const items = [];
    const from = {};
    this.defs.forEach((d) => {
      const s = this.s[d.id];
      from[d.id] = s.price;
      items.push({ d, s, anchorMult: Math.exp(d.growth * (seg / 86400)), sigma: d.vol * varFactor });
    });

    for (let i = 0; i < steps; i++) {
      for (const it of items) {
        const s = it.s;
        s.anchor *= it.anchorMult;
        const lm = Math.log(s.mood) * damp + it.sigma * U.randn();
        s.mood = U.clamp(Math.exp(lm), it.d.moodRange[0], it.d.moodRange[1]);
        s.price = s.anchor * s.mood;
      }
      if (onStep) onStep(seg);
    }

    // Спарклайн заполняем один раз в конце: если рисовать его на каждом
    // отрезке, история (60 точек) будет забита служебными шагами офлайна.
    for (const it of items) {
      const s = it.s;
      const oldPrice = from[it.d.id];
      for (let k = 1; k <= 8; k++) {
        const p = oldPrice + ((s.price - oldPrice) * k) / 8;
        this._push(s, p * (1 + it.d.vol * 2 * U.randn()));
      }
      this._push(s, s.price);
    }
  }

  _push(s, price) {
    s.history.push(price);
    if (s.history.length > CONFIG.HISTORY_LEN) s.history.shift();
  }

  serialize() {
    const out = {};
    this.defs.forEach((d) => {
      const s = this.s[d.id];
      out[d.id] = { a: s.anchor, m: s.mood, h: s.history.slice(-20) };
    });
    return out;
  }

  load(data) {
    if (!data) return;
    this.defs.forEach((d) => {
      const saved = data[d.id];
      if (!saved) return;
      const s = this.s[d.id];
      s.anchor = saved.a || d.basePrice;
      s.mood = U.clamp(saved.m || 1, d.moodRange[0], d.moodRange[1]);
      s.price = s.anchor * s.mood;
      s.history = Array.isArray(saved.h) && saved.h.length ? saved.h : [s.price];
    });
  }
}
