/**
 * Облачные сохранения: аккаунт по e-mail и один документ сейва на игрока.
 *
 * Работа идёт напрямую по REST API Firebase, без официального SDK. Причины:
 *  - проект принципиально живёт без зависимостей и без сборки;
 *  - JS-SDK весит около 250 КБ и требует «разрешённых доменов», а у страницы,
 *    открытой двойным кликом (file://), домен пустой — вход бы не заработал.
 * REST-эндпоинты отдают CORS любому источнику, поэтому облако одинаково
 * доступно и на github.io, и при локальном запуске.
 *
 * Токен доступа (idToken) живёт час, поэтому рядом хранится refreshToken —
 * он лежит в localStorage и заменяет собой галочку «оставаться в системе».
 * Это долгоживущий ключ от аккаунта: у того, кто получил доступ к браузеру,
 * и так есть сам сейв, но выход из аккаунта стирает токен полностью.
 */

/** Человеческие формулировки для кодов ошибок Firebase */
const CLOUD_ERRORS = {
  EMAIL_EXISTS: "Такой e-mail уже зарегистрирован — войдите вместо регистрации",
  EMAIL_NOT_FOUND: "Аккаунт с таким e-mail не найден",
  INVALID_PASSWORD: "Неверный пароль",
  INVALID_LOGIN_CREDENTIALS: "Неверный e-mail или пароль",
  INVALID_EMAIL: "Похоже, e-mail введён с ошибкой",
  MISSING_EMAIL: "Введите e-mail",
  MISSING_PASSWORD: "Введите пароль",
  WEAK_PASSWORD: "Пароль слишком короткий — нужно не меньше 6 символов",
  USER_DISABLED: "Этот аккаунт заблокирован",
  TOO_MANY_ATTEMPTS_TRY_LATER: "Слишком много попыток подряд. Попробуйте через несколько минут",
  OPERATION_NOT_ALLOWED: "Вход по e-mail выключен в настройках Firebase",
  TOKEN_EXPIRED: "Сессия истекла — войдите заново",
  USER_NOT_FOUND: "Аккаунт больше не существует — войдите заново",
};

/**
 * Документ сейва в Firestore. Реализует общий контракт StorageProvider,
 * поэтому его можно завернуть в StorageManager и бесплатно получить
 * версионирование и миграции — те же самые, что у локального хранилища.
 *
 * Весь сейв кладётся ОДНИМ полем-строкой (base64). Firestore умеет хранить
 * вложенные структуры, но капризен к пустым значениям и запрещает массив
 * внутри массива, а в сейве лежит история котировок — строка снимает
 * весь этот класс проблем разом.
 */
class FirestoreSaveProvider extends StorageProvider {
  constructor(cloud) {
    super();
    this.cloud = cloud;
  }

  _url() {
    return `https://firestore.googleapis.com/v1/projects/${this.cloud.cfg.projectId}`
      + `/databases/(default)/documents/saves/${this.cloud.uid}`;
  }

  async save(data) {
    // pushId — метка «кто и когда положил сюда сейв». Устройство помнит метку
    // своей последней выгрузки, поэтому умеет отличить собственный снимок
    // от чужого и не спрашивать игрока там, где расхождения нет.
    const pushId = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    await this.cloud._request(this._url(), "PATCH", {
      fields: {
        payload: { stringValue: SaveCodec.encode(data) },
        lastTimestamp: { integerValue: String(data.lastTimestamp || Date.now()) },
        version: { integerValue: String(data.version || CONFIG.SAVE_VERSION) },
        pushId: { stringValue: pushId },
      },
    });
    this.cloud.remotePushId = pushId;
    this.cloud.knownPushId = pushId;
    this.cloud._persist();
  }

  async load() {
    const doc = await this.cloud._request(this._url(), "GET", null, true);
    if (!doc || !doc.fields || !doc.fields.payload) return null;
    this.cloud.remotePushId = doc.fields.pushId ? doc.fields.pushId.stringValue : null;
    try {
      return SaveCodec.decode(doc.fields.payload.stringValue);
    } catch (e) {
      console.warn("Облачный сейв повреждён", e);
      return null;
    }
  }

  async clear() {
    await this.cloud._request(this._url(), "DELETE", null, true);
  }
}

class CloudSync {
  /**
   * @param {object} cfg  CLOUD_CONFIG (apiKey + projectId)
   * @param {string} key  ключ localStorage для токена сессии
   */
  constructor(cfg, key) {
    this.cfg = cfg;
    this.key = key;
    this.uid = null;
    this.email = null;
    this.idToken = null;
    this.expiresAt = 0;
    this.refreshToken = null;
    this.knownPushId = null;  // метка нашей последней синхронизации
    this.remotePushId = null; // метка того, что сейчас лежит в облаке
    this.store = new StorageManager(new FirestoreSaveProvider(this));
    this._listeners = [];
  }

  /**
   * В облаке появилось что-то, чего это устройство ещё не видело
   * (то есть выгружал не мы) — только в этом случае есть смысл
   * спрашивать игрока, какой прогресс оставить.
   */
  get remoteIsNew() {
    return !!this.remotePushId && this.remotePushId !== this.knownPushId;
  }

  /** Признать облачный сейв своим — после того, как игрок его принял */
  acceptRemote() {
    this.knownPushId = this.remotePushId;
    this._persist();
  }

  /** Настроено ли облако вообще (заполнен ли конфиг) */
  get configured() {
    return !!(this.cfg.apiKey && this.cfg.projectId);
  }

  get signedIn() {
    return !!this.uid;
  }

  /** Подписка на вход/выход — UI перерисовывает себя */
  onChange(cb) {
    this._listeners.push(cb);
  }

  _notify() {
    this._listeners.forEach((cb) => cb(this));
  }

  // --- аккаунт -------------------------------------------------------------

  /**
   * Восстановление сессии при запуске: меняем сохранённый refreshToken
   * на свежий токен доступа. Возвращает true, если игрок остался в аккаунте.
   */
  async restore() {
    if (!this.configured) return false;
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(this.key) || "null");
    } catch (_) { /* мусор в ключе — считаем, что сессии нет */ }
    if (!saved || !saved.refreshToken) return false;

    this.refreshToken = saved.refreshToken;
    this.uid = saved.uid;
    this.email = saved.email;
    this.knownPushId = saved.knownPushId || null;
    try {
      await this._refresh();
      this._notify();
      return true;
    } catch (e) {
      // Токен отозван (сменили пароль, удалили аккаунт) — тихо разлогиниваемся:
      // прогресс от этого не страдает, он есть локально.
      this._forget();
      return false;
    }
  }

  async signUp(email, password) {
    await this._authRequest("signUp", email, password);
  }

  async signIn(email, password) {
    await this._authRequest("signInWithPassword", email, password);
  }

  /** Письмо со ссылкой на смену пароля */
  async sendReset(email) {
    if (!email) throw new Error(CLOUD_ERRORS.MISSING_EMAIL);
    await this._identity("sendOobCode", { requestType: "PASSWORD_RESET", email });
  }

  signOut() {
    this._forget();
  }

  _forget() {
    this.uid = null;
    this.email = null;
    this.idToken = null;
    this.refreshToken = null;
    this.expiresAt = 0;
    this.knownPushId = null;
    this.remotePushId = null;
    localStorage.removeItem(this.key);
    this._notify();
  }

  /** Запомнить сессию между запусками */
  _persist() {
    localStorage.setItem(this.key, JSON.stringify({
      refreshToken: this.refreshToken,
      uid: this.uid,
      email: this.email,
      knownPushId: this.knownPushId,
    }));
  }

  async _authRequest(method, email, password) {
    const res = await this._identity(method, {
      email: String(email || "").trim(),
      password: String(password || ""),
      returnSecureToken: true,
    });
    this.uid = res.localId;
    this.email = res.email;
    this._setToken(res.idToken, res.refreshToken, res.expiresIn);
    this._notify();
  }

  _setToken(idToken, refreshToken, expiresIn) {
    this.idToken = idToken;
    this.refreshToken = refreshToken;
    this.expiresAt = Date.now() + (parseInt(expiresIn, 10) || 3600) * 1000;
    this._persist();
  }

  async _refresh() {
    const body = "grant_type=refresh_token&refresh_token=" + encodeURIComponent(this.refreshToken);
    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${this.cfg.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(this._message(data));
    this.uid = data.user_id || this.uid;
    this._setToken(data.id_token, data.refresh_token, data.expires_in);
  }

  /** Действующий токен доступа; за минуту до истечения обновляем заранее */
  async _token() {
    if (!this.refreshToken) throw new Error("Вы не вошли в аккаунт");
    if (!this.idToken || Date.now() > this.expiresAt - 60000) await this._refresh();
    return this.idToken;
  }

  async _identity(method, body) {
    if (!this.configured) throw new Error("Облако не настроено");
    const url = `https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${this.cfg.apiKey}`;
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (_) {
      throw new Error("Нет связи с сервером — проверьте интернет");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(this._message(data));
    return data;
  }

  /**
   * Запрос к Firestore с токеном доступа.
   * @param {boolean} nullOn404 вернуть null вместо ошибки, если документа нет
   *        (первый вход — это нормальная ситуация, а не сбой)
   */
  async _request(url, method, body, nullOn404 = false) {
    const token = await this._token();
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (_) {
      throw new Error("Нет связи с облаком — проверьте интернет");
    }
    if (res.status === 404 && nullOn404) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 403) {
        throw new Error("Firestore отклонил запрос: проверьте правила доступа в консоли Firebase");
      }
      throw new Error(this._message(data));
    }
    return data;
  }

  /** Код ошибки Firebase -> текст для игрока */
  _message(data) {
    const raw = (data && data.error && data.error.message) || "";
    const code = raw.split(":")[0].trim();
    return CLOUD_ERRORS[code] || (raw ? "Ошибка облака: " + raw : "Неизвестная ошибка облака");
  }

  // --- сейв ----------------------------------------------------------------

  /** Сейв из облака (уже смигрированный) либо null, если его там нет */
  async pull() {
    return await this.store.load();
  }

  /** Выгрузить состояние в облако. data — результат GameState.serialize() */
  async push(data) {
    await this.store.save(data);
    this.lastPushAt = Date.now();
  }
}
