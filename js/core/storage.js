
/**
 * Слой хранения. StorageProvider — контракт (асинхронный, чтобы замена
 * на серверное API не меняла вызывающий код).
 * // TODO: FirebaseStorageProvider / RestApiStorageProvider — реализовать
 *          save/load/clear и подставить в main.js
 */
class StorageProvider {
  async save(_data) { throw new Error("Не реализовано"); }
  async load() { throw new Error("Не реализовано"); }
  async clear() { throw new Error("Не реализовано"); }
}

class LocalStorageProvider extends StorageProvider {
  constructor(key) {
    super();
    this.key = key;
  }
  async save(data) {
    localStorage.setItem(this.key, JSON.stringify(data));
  }
  async load() {
    const raw = localStorage.getItem(this.key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.warn("Повреждённый сейв, начинаем заново", e);
      return null;
    }
  }
  async clear() {
    localStorage.removeItem(this.key);
  }
}

/**
 * StorageManager знает СТРУКТУРУ и ВЕРСИИ сейва, но не знает, где данные
 * лежат физически (это дело провайдера).
 */
class StorageManager {
  constructor(provider) {
    this.provider = provider;
  }

  /** data — результат GameState.serialize() */
  async save(data) {
    await this.provider.save({
      version: CONFIG.SAVE_VERSION,
      lastTimestamp: Date.now(),
      ...data,
    });
  }

  async load() {
    let data = await this.provider.load();
    if (!data) return null;
    return this._migrate(data);
  }

  async clear() {
    await this.provider.clear();
  }

  /**
   * Миграции между версиями сейва.
   * v1 -> v2: старые 4 обезличенных актива упразднены; игроку полностью
   * возвращаются потраченные на них деньги (компенсация).
   * // TODO: при изменении структуры добавить шаг v2 -> v3 по образцу
   */
  _migrate(data) {
    if (typeof data.version !== "number") data.version = 1;
    if (data.version === 1) {
      data = {
        version: 2,
        migratedFromV1: true,
        lastTimestamp: data.lastTimestamp || Date.now(),
        balance: (data.balance || 0) + (data.stats?.totalSpent || 0),
        stats: {
          totalEarned: data.stats?.totalEarned || 0,
          playTimeSec: data.stats?.playTimeSec || 0,
          startedAt: data.stats?.startedAt || Date.now(),
        },
      };
    }
    return data;
  }
}
