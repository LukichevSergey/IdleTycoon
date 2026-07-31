/**
 * Блок «Облако» на вкладке «Статистика»: вход в аккаунт и синхронизация сейва
 * между устройствами. Вся работа с сетью — в core/cloudSync.js, здесь только
 * DOM, подтверждения и человеческие формулировки.
 *
 * Блок целиком перерисовывается на вход и выход из аккаунта — состояний
 * всего три (не настроено / не вошли / вошли), и держать ссылки на элементы
 * для каждого дороже, чем собрать разметку заново.
 */
class CloudSection {
  constructor(state, game) {
    this.state = state;
    this.game = game;
    this.cloud = game.cloud;
  }

  mount(container) {
    this.container = container;
    this.render();
    this.cloud.onChange(() => this.render());
  }

  render() {
    if (!this.cloud.configured) return this._renderSetup();
    if (!this.cloud.signedIn) return this._renderAuth();
    this._renderAccount();
  }

  _renderSetup() {
    this.container.innerHTML = `
      <div class="settings-block">
        <div class="settings-title">☁ Облачные сохранения</div>
        <div class="settings-note">
          Облако выключено: не заполнен файл <code>js/cloudConfig.js</code>.
          Нужны два значения из консоли Firebase — веб-ключ API и идентификатор
          проекта. Пока их нет, прогресс живёт только в этом браузере,
          а переносить его можно файлом или кодом (блоки ниже).
        </div>
      </div>
    `;
  }

  _renderAuth() {
    this.container.innerHTML = `
      <div class="settings-block">
        <div class="settings-title">☁ Облачные сохранения</div>
        <div class="settings-note">
          Войдите — и прогресс будет доступен на любом устройстве:
          на ноутбуке, на телефоне, в другом браузере. Игра сама выгружает
          сейв в облако во время игры и предлагает выбор, если сохранения
          на устройстве и в облаке разошлись.
        </div>
        <div class="cloud-form">
          <input type="email" class="num-input" data-r="email" placeholder="E-mail" autocomplete="username">
          <input type="password" class="num-input" data-r="pass" placeholder="Пароль (от 6 символов)" autocomplete="current-password">
        </div>
        <div class="row-btns">
          <button class="buy-btn" data-r="in">Войти</button>
          <button class="btn-sm gold" data-r="up">Создать аккаунт</button>
          <button class="btn-sm" data-r="forgot">Забыли пароль?</button>
        </div>
        <div class="settings-note import-status hidden" data-r="status"></div>
      </div>
    `;
    const r = (n) => this.container.querySelector(`[data-r="${n}"]`);
    this.refs = { email: r("email"), pass: r("pass"), status: r("status") };

    r("in").addEventListener("click", () => this._auth("in"));
    r("up").addEventListener("click", () => this._auth("up"));
    r("forgot").addEventListener("click", () => this._forgot());
    // Enter в любом поле = «Войти»: самый частый сценарий
    [this.refs.email, this.refs.pass].forEach((el) =>
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") this._auth("in"); }));
  }

  _renderAccount() {
    const last = this.cloud.lastPushAt
      ? Fmt.durShort((Date.now() - this.cloud.lastPushAt) / 1000) + " назад"
      : "ещё не выгружался в этой сессии";
    this.container.innerHTML = `
      <div class="settings-block">
        <div class="settings-title">☁ Облако: ${this.cloud.email}</div>
        <div class="settings-note">
          Прогресс выгружается автоматически во время игры и при сворачивании
          вкладки. Последняя выгрузка: ${last}.
        </div>
        <div class="row-btns">
          <button class="buy-btn" data-r="push">⬆ Выгрузить сейчас</button>
          <button class="btn-sm gold" data-r="pull">⬇ Загрузить из облака</button>
          <button class="btn-sm" data-r="out">Выйти</button>
        </div>
        <div class="settings-note import-status hidden" data-r="status"></div>
      </div>
    `;
    const r = (n) => this.container.querySelector(`[data-r="${n}"]`);
    this.refs = { status: r("status") };
    r("push").addEventListener("click", () => this._push());
    r("pull").addEventListener("click", () => this._pull());
    r("out").addEventListener("click", () => this._signOut());
  }

  _status(ok, text) {
    if (!this.refs.status) return;
    this.refs.status.classList.remove("hidden");
    this.refs.status.className = "settings-note import-status " + (ok ? "ok" : "err");
    this.refs.status.textContent = text;
  }

  /** mode: "in" — вход, "up" — регистрация */
  async _auth(mode) {
    const email = this.refs.email.value.trim();
    const pass = this.refs.pass.value;
    if (!email || !pass) {
      this._status(false, "Заполните e-mail и пароль");
      return;
    }
    this._status(true, mode === "up" ? "Создаём аккаунт…" : "Входим…");
    try {
      if (mode === "up") await this.cloud.signUp(email, pass);
      else await this.cloud.signIn(email, pass);
    } catch (e) {
      this._status(false, "❌ " + e.message);
      return;
    }
    // Вход прошёл — блок перерисован в _renderAccount, ссылки на поля устарели.
    // Дальше решаем судьбу сейвов: в облаке может лежать другой прогресс.
    await this._syncAfterSignIn();
  }

  /**
   * Первое подключение устройства к аккаунту: в облаке либо пусто (выгружаем
   * текущий прогресс), либо чужой для этого браузера сейв (спрашиваем игрока).
   */
  async _syncAfterSignIn() {
    let cloudSave;
    try {
      cloudSave = await this.cloud.pull();
    } catch (e) {
      this._status(false, "Вошли, но облако не ответило: " + e.message);
      return;
    }
    if (!cloudSave) {
      await this._push("Аккаунт создан, прогресс выгружен в облако");
      return;
    }
    const local = await this.game.storage.raw();
    const choice = local ? await CloudConflictModal.ask(local, cloudSave) : "cloud";
    if (choice === "cloud") {
      await this.game.applyCloudSave(cloudSave);
      this._status(true, "✅ Загружен прогресс из облака");
      this.state.toast("success", "Прогресс загружен из облака");
    } else {
      await this._push("Прогресс этого устройства выгружен в облако");
    }
  }

  async _push(okText) {
    try {
      await this.game.pushToCloud();
    } catch (e) {
      this._status(false, "❌ " + e.message);
      return;
    }
    this._status(true, "✅ " + (okText || "Прогресс выгружен в облако"));
  }

  async _pull() {
    let cloudSave;
    try {
      cloudSave = await this.cloud.pull();
    } catch (e) {
      this._status(false, "❌ " + e.message);
      return;
    }
    if (!cloudSave) {
      this._status(false, "В облаке пока нет сохранения");
      return;
    }
    const ago = cloudSave.lastTimestamp
      ? `\n\nСохранён ${Fmt.durShort((Date.now() - cloudSave.lastTimestamp) / 1000)} назад — доход за это время будет начислен (не больше ${CONFIG.OFFLINE_CAP_HOURS} ч).`
      : "";
    const summary = `капитал ${Fmt.moneyShort(cloudSave.balance || 0)}, `
      + `перерождений ${cloudSave.prestigeCount || 0}, монет ${cloudSave.gold || 0}`;
    if (!confirm(`Загрузить прогресс из облака?\n\n${summary}${ago}\n\nТекущий прогресс будет заменён (копия сохранится для отката).`)) return;
    await this.game.applyCloudSave(cloudSave);
    this._status(true, "✅ Прогресс загружен из облака");
    this.state.toast("success", "Прогресс загружен из облака");
  }

  _signOut() {
    if (!confirm("Выйти из аккаунта?\n\nПрогресс останется в этом браузере и в облаке — вы просто перестанете синхронизироваться.")) return;
    this.cloud.signOut();
  }
}
