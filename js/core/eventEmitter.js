/**
 * Простейший observer. GameState наследует его: UI подписывается на события
 * состояния и никогда не мутирует его напрямую (односторонний поток данных).
 */
class EventEmitter {
  constructor() {
    this._listeners = new Map();
  }
  on(event, callback) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(callback);
    return () => this.off(event, callback); // функция отписки
  }
  off(event, callback) {
    const list = this._listeners.get(event);
    if (list) this._listeners.set(event, list.filter((cb) => cb !== callback));
  }
  emit(event, payload) {
    (this._listeners.get(event) || []).forEach((cb) => cb(payload));
  }
}
