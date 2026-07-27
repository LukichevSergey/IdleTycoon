
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
    try {
      localStorage.setItem(this.key, JSON.stringify(data));
    } catch (e) {
      // Чаще всего это переполнение хранилища или приватный режим браузера.
      // Молча терять прогресс нельзя — пробрасываем наверх, там покажем игроку.
      throw new Error("Не удалось записать сохранение в браузер: " + e.message);
    }
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
 * Кодирование сейва для переноса между устройствами.
 * Файл сохраняем читаемым JSON, а «код» — это тот же JSON в base64:
 * его удобно скопировать одной строкой в мессенджер или заметки.
 */
const SaveCodec = {
  /** Объект -> компактная строка-код */
  encode(data) {
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    // btoa работает с байтами, а не с юникодом (в сейве есть кириллица),
    // и падает при слишком длинном списке аргументов — режем на куски
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  },

  /** Строка -> объект. Понимает и обычный JSON (файл), и код base64 */
  decode(text) {
    const t = String(text).trim();
    try {
      return JSON.parse(t);
    } catch (_) {
      const bin = atob(t.replace(/\s+/g, ""));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    }
  },

  /** Читаемый JSON для файла */
  toFileText(data) {
    return JSON.stringify(data, null, 2);
  },
};

/**
 * StorageManager знает СТРУКТУРУ и ВЕРСИИ сейва, но не знает, где данные
 * лежат физически (это дело провайдера).
 * backupProvider — второй слот хранения: туда кладётся копия перед импортом,
 * чтобы ошибочное восстановление можно было откатить.
 */
class StorageManager {
  constructor(provider, backupProvider = null) {
    this.provider = provider;
    this.backupProvider = backupProvider;
  }

  /** Сырой сейв как он лежит в хранилище (для экспорта) */
  async raw() {
    return await this.provider.load();
  }

  /**
   * Разбирает и проверяет входящие данные перед импортом.
   * Возвращает { ok, data } либо { ok: false, error } с понятным текстом —
   * решение о применении принимает вызывающий код.
   */
  prepareImport(text) {
    if (!text || !String(text).trim()) {
      return { ok: false, error: "Пусто: вставьте код сохранения или выберите файл" };
    }
    let data;
    try {
      data = SaveCodec.decode(text);
    } catch (_) {
      return { ok: false, error: "Не удалось прочитать данные: файл повреждён или это не сохранение игры" };
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, error: "Это не похоже на сохранение игры" };
    }
    if (typeof data.balance !== "number" || typeof data.version !== "number") {
      return { ok: false, error: "Это не похоже на сохранение «Финансового магната»" };
    }
    if (data.version > CONFIG.SAVE_VERSION) {
      return {
        ok: false,
        error: `Сохранение сделано в более новой версии игры (v${data.version}, здесь v${CONFIG.SAVE_VERSION}). Обновите страницу.`,
      };
    }
    return { ok: true, data: this._migrate(data), fromVersion: data.version };
  }

  /** Скопировать текущий сейв в резервный слот */
  async backup() {
    if (!this.backupProvider) return false;
    const cur = await this.provider.load();
    if (!cur) return false;
    await this.backupProvider.save(cur);
    return true;
  }

  /** Достать резервную копию (null, если её нет) */
  async loadBackup() {
    if (!this.backupProvider) return null;
    const data = await this.backupProvider.load();
    return data ? this._migrate(data) : null;
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
   * Миграции между версиями сейва (выполняются по цепочке).
   * v1 -> v2: старые 4 обезличенных актива упразднены; игроку полностью
   * возвращаются потраченные на них деньги (компенсация).
   * v2 -> v3: добавлен престиж (монеты, перки, счётчик перерождений).
   * v3 -> v4: добавлены бизнесы. v4 -> v5: добавлен форекс.
   * // TODO: при изменении структуры добавить шаг v5 -> v6 по образцу
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
    if (data.version === 2) {
      data.version = 3;
      data.gold = 0;
      data.prestigeCount = 0;
      data.perks = {};
      data.lifetime = { earned: 0, playTimeSec: 0 };
    }
    if (data.version === 3) {
      data.version = 4;
      data.businesses = {}; // v3 -> v4: добавлена вкладка «Бизнес»
    }
    if (data.version === 4) {
      data.version = 5;     // v4 -> v5: добавлен раздел «Форекс»
      data.fx = {};
      data.fxNextId = 1;
    }
    return data;
  }
}
