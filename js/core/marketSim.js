
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

  /** Офлайн-прыжок: эквивалент T секунд случайного блуждания одним шагом */
  advance(seconds) {
    const ticks = seconds / (CONFIG.MARKET_TICK_MS / 1000);
    this.defs.forEach((d) => {
      const s = this.s[d.id];
      const oldPrice = s.price;
      s.anchor *= Math.exp(d.growth * (seconds / 86400));
      // Дисперсия блуждания с возвратом ограничена стационарной (~1/(2θ))
      const damp = Math.exp(-CONFIG.MOOD_REVERSION * ticks);
      const sigmaEff = d.vol * Math.sqrt(Math.min(ticks, 1 / (2 * CONFIG.MOOD_REVERSION)));
      const lm = Math.log(s.mood) * damp + sigmaEff * U.randn();
      s.mood = U.clamp(Math.exp(lm), d.moodRange[0], d.moodRange[1]);
      s.price = s.anchor * s.mood;
      // Заполняем спарклайн правдоподобной интерполяцией
      for (let i = 1; i <= 8; i++) {
        const p = oldPrice + ((s.price - oldPrice) * i) / 8;
        this._push(s, p * (1 + d.vol * 2 * U.randn()));
      }
      this._push(s, s.price);
    });
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
