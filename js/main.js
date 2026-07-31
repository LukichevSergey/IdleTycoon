
/**
 * Точка сборки: создаёт состояние, хранилище и UI, запускает циклы.
 * Архитектура (поток данных однонаправленный):
 *
 *   config + data/*  ──►  GameState (единственный источник истины)
 *                            │ emit: tick / market / structural / toast / dirty
 *                            ▼
 *          UI (вкладки и разделы) — читают состояние, зовут методы
 *                            │
 *   StorageManager ◄── serialize()/hydrate()   MarketSim — котировки
 */
class Game {
  constructor() {
    this.state = new GameState();
    // Смена хранилища: подставить другой провайдер, остальное без изменений.
    // TODO: new StorageManager(new RestApiStorageProvider(apiUrl))
    this.storage = new StorageManager(
      new LocalStorageProvider(CONFIG.SAVE_KEY),
      new LocalStorageProvider(CONFIG.SAVE_KEY + "-backup")
    );
    // Облако — второй, необязательный слот хранения: аккаунт по e-mail
    // и один документ сейва, общий для всех устройств игрока.
    this.cloud = new CloudSync(CLOUD_CONFIG, CONFIG.SAVE_KEY + "-cloud");
    this._lastTickTime = Date.now();
    this._nextEventAt = Date.now() + this._eventDelay();
  }

  _eventDelay() {
    const [a, b] = CONFIG.EVENT_DELAY_MIN;
    return (a + Math.random() * (b - a)) * 60 * 1000;
  }

  async start() {
    Toasts.init(document.getElementById("toasts"));
    OfflineModal.init();
    this.state.on("toast", ({ type, msg }) => Toasts.show(type, msg));
    this.state.on("dirty", () => this.save());

    // 1. Загрузка сейва: сначала выясняем, какой прогресс продолжаем —
    // этого браузера или облачный. Порядок принципиален: офлайн-доход
    // считается ниже от таймстампа победителя, а если посчитать его раньше
    // и потом подменить состояние облачным, начисленные деньги исчезнут
    // у игрока на глазах.
    const save = await this._resolveStartupSave();
    if (save) this.state.hydrate(save);

    // 2. UI
    this.tradeModal = new TradeModal(this.state);
    this.forexModal = new ForexModal(this.state);
    const goto = (tabId, sectionId) => {
      this.tabManager.activate(tabId);
      if (sectionId) this.investmentsView.activate(sectionId);
    };
    this.homeView = new HomeView(this.state, goto);
    this.investmentsView = new InvestmentsView(this.state, this.tradeModal, this.forexModal);
    this.businessView = new BusinessView(this.state);
    this.achievementsView = new AchievementsView(this.state);
    this.prestigeView = new PrestigeView(this.state);
    this.statsView = new StatsView(this.state, this);

    // Конфиг вкладок: новая вкладка — новая запись здесь. // TODO: «Достижения»
    this.tabManager = new TabManager(
      [
        { id: "home", title: "Главная", view: this.homeView },
        { id: "investments", title: "Инвестиции", view: this.investmentsView },
        { id: "business", title: "Бизнес", view: this.businessView },
        { id: "achievements", title: "Достижения", view: this.achievementsView },
        { id: "prestige", title: "Престиж", view: this.prestigeView },
        { id: "stats", title: "Статистика", view: this.statsView },
      ],
      document.getElementById("tabs-nav"),
      document.getElementById("tabs-container"),
      this.state // для бейджей-счётчиков «требует внимания» на кнопках вкладок
    );

    // 3. Офлайн-прогресс
    this._applyOfflineFrom(save);
    if (save && save.migratedFromV1) {
      Toasts.show("info",
        "Экономика игры обновлена: старые активы упразднены, потраченные деньги возвращены на баланс.", 9000);
    }

    // 4. Игровой цикл: dt по реальному времени, чтобы доход не терялся
    // при троттлинге фоновых вкладок браузера
    setInterval(() => {
      const now = Date.now();
      const dt = (now - this._lastTickTime) / 1000;
      this._lastTickTime = now;
      this.state.tick(dt, now);

      // Планировщик случайных событий
      if (now >= this._nextEventAt) {
        this.state.randomEvent(now);
        this._nextEventAt = now + this._eventDelay();
      }
    }, CONFIG.TICK_MS);

    // 5. Рыночный цикл
    setInterval(() => this.state.marketTick(), CONFIG.MARKET_TICK_MS);

    // 6. Автосохранение + сохранение при закрытии
    setInterval(() => this.save(), CONFIG.AUTOSAVE_MS);
    window.addEventListener("beforeunload", () => this.save());

    // 7. Автовыгрузка в облако. Отдельный, более редкий цикл: это сетевой
    // запрос, а не запись в localStorage. Плюс выгрузка при сворачивании
    // вкладки — на телефоне это единственный надёжный сигнал «игрок ушёл»,
    // beforeunload там часто не приходит вовсе.
    setInterval(() => this._autoPush(), CONFIG.CLOUD_SYNC_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this._autoPush();
    });
    if (this._cloudDirty) this._autoPush();
  }

  // --- облако --------------------------------------------------------------

  /**
   * Какой сейв продолжаем — локальный или облачный.
   * Спрашиваем игрока только при настоящем расхождении: если в облаке лежит
   * снимок, выгруженный этим же устройством, выбирать не из чего.
   */
  async _resolveStartupSave() {
    const local = await this.storage.load();
    if (!(await this.cloud.restore())) return local;

    let remote = null;
    try {
      remote = await this.cloud.pull();
    } catch (e) {
      // Нет сети или облако недоступно — это не повод не дать поиграть
      console.warn("Облако недоступно при запуске:", e.message);
      this.state.toast("info", "Облако недоступно — играем с сохранением этого устройства");
      return local;
    }

    if (!remote) {              // аккаунт есть, сейва в облаке ещё нет
      this._cloudDirty = true;
      return local;
    }
    if (!local) {               // новое устройство — забираем облачный
      this.cloud.acceptRemote();
      return remote;
    }
    if (!this.cloud.remoteIsNew) { // в облаке наш же снимок, локальный свежее
      this._cloudDirty = true;
      return local;
    }

    const choice = await CloudConflictModal.ask(local, remote);
    if (choice === "cloud") {
      await this.storage.backup(); // выбор можно откатить кнопкой в настройках
      this.cloud.acceptRemote();
      return remote;
    }
    this._cloudDirty = true;
    return local;
  }

  /**
   * Начисление офлайн-дохода за время, пока игра была закрыта.
   * Считается от таймстампа самого сейва, а не от «последнего запуска»,
   * поэтому облачный сейв двухдневной давности даёт доход за эти два дня
   * (в пределах OFFLINE_CAP_HOURS) — ровно как если бы игру просто не открывали.
   */
  _applyOfflineFrom(save) {
    if (!save || !save.lastTimestamp) return;
    const seconds = Math.floor((Date.now() - save.lastTimestamp) / 1000);
    if (seconds < CONFIG.MIN_OFFLINE_SECONDS) return;
    const rep = this.state.applyOffline(seconds);
    if (rep.total > 0.01) {
      OfflineModal.show(rep);
      this.homeView.flashBalance();
    }
    this.save();
  }

  /** Выгрузка в облако по расписанию: молча пропускаем, если игрок не вошёл */
  async _autoPush() {
    if (!this.cloud.signedIn) return;
    try {
      await this.pushToCloud();
      this._cloudDirty = false;
      this._pushFailed = false;
    } catch (e) {
      // Обрыв связи — обычное дело; ругаемся один раз, а не каждые три минуты
      if (!this._pushFailed) {
        this._pushFailed = true;
        console.warn("Не удалось выгрузить сейв в облако:", e.message);
      }
    }
  }

  /** Выгрузить актуальное состояние в облако */
  async pushToCloud() {
    await this.save();
    await this.cloud.push(this.state.serialize());
  }

  /**
   * Применить сейв, пришедший из облака, уже во время игры.
   * В отличие от импорта файла здесь доход за простой начисляется:
   * сейв — это состояние, замороженное в свой lastTimestamp, и досчитать
   * его до «сейчас» — то же самое, что открыть игру на другом устройстве.
   */
  async applyCloudSave(data) {
    await this.storage.backup();
    this.state.hydrate(data);
    this._lastTickTime = Date.now();
    this.cloud.acceptRemote();
    this._applyOfflineFrom(data);
    await this.save();
  }

  async save() {
    try {
      await this.storage.save(this.state.serialize());
      SaveIndicator.blink();
      this._saveFailed = false;
    } catch (e) {
      // Предупреждаем один раз, чтобы не заспамить тостами каждые 30 секунд
      if (!this._saveFailed) {
        this._saveFailed = true;
        Toasts.show("danger",
          "⚠ Не удалось сохранить прогресс в браузере. Скачайте резервную копию на вкладке «Статистика».", 12000);
        console.error(e);
      }
    }
  }

  async resetProgress() {
    await this.storage.backup(); // на случай, если сброс нажали случайно
    await this.storage.clear();
    this.state.reset();
    await this.save();
  }

  /** Актуальный сейв для выгрузки: сначала фиксируем текущее состояние */
  async exportSave() {
    await this.save();
    return await this.storage.raw();
  }

  /**
   * Восстановление прогресса. Текущий сейв уходит в резервный слот,
   * поэтому неудачный импорт можно откатить.
   * Время последнего сохранения намеренно сбрасывается на «сейчас»:
   * импорт не должен начислять офлайн-доход за годы лежания файла.
   */
  async applyImport(data) {
    await this.storage.backup();
    this.state.hydrate(data); // сам пересоберёт UI (structural + market + tick)
    this._lastTickTime = Date.now();
    await this.save();
  }

  /** Откат к копии, сделанной перед последним импортом или сбросом */
  async restoreBackup() {
    const data = await this.storage.loadBackup();
    if (!data) return false;
    await this.applyImport(data);
    return true;
  }
}

const game = new Game();
game.start();
window.game = game; // для отладки в консоли
