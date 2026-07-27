/**
 * Блок настроек на вкладке «Статистика»: резервные копии прогресса.
 *
 * Прогресс живёт в localStorage конкретного браузера, поэтому очистка
 * данных сайта стирает его безвозвратно. Этот раздел даёт игроку
 * выгрузить сейв файлом или строкой-кодом и восстановить его где угодно.
 * Вся работа с форматом — в core/storage.js (SaveCodec, StorageManager),
 * здесь только DOM и подтверждения.
 */
class SettingsSection {
  /** game — точка сборки: умеет exportSave / applyImport / restoreBackup */
  constructor(state, game) {
    this.state = state;
    this.game = game;
  }

  mount(container) {
    this.container = container;
    container.innerHTML = `
      <div class="settings-block">
        <div class="settings-title">💾 Резервная копия</div>
        <div class="settings-note">
          Прогресс хранится только в этом браузере. Очистка данных сайта, режим инкогнито
          или переустановка браузера удалят его без возможности восстановления —
          сохраняйте копию время от времени.
        </div>
        <div class="prop-meta settings-info">
          <span class="label">Состояние сейва</span><span class="value" data-r="info">—</span>
        </div>
        <div class="row-btns">
          <button class="buy-btn" data-r="download">💾 Скачать файл</button>
          <button class="btn-sm gold" data-r="code">📋 Показать код</button>
        </div>
        <textarea class="save-code hidden" data-r="codeBox" readonly rows="3"
          title="Выделите и скопируйте эту строку"></textarea>
        <div class="settings-note hidden" data-r="copyHint"></div>
      </div>

      <div class="settings-block">
        <div class="settings-title">📂 Восстановление</div>
        <div class="settings-note">
          Загрузите файл сейва или вставьте код. Текущий прогресс будет заменён,
          но его копия сохранится — сразу после импорта появится кнопка отката.
        </div>
        <div class="row-btns">
          <button class="btn-sm" data-r="pick">📂 Выбрать файл…</button>
          <input type="file" accept=".json,.txt,application/json" hidden data-r="file">
        </div>
        <textarea class="save-code" data-r="importBox" rows="3"
          placeholder="…или вставьте сюда код сохранения"></textarea>
        <div class="row-btns">
          <button class="btn-sm green" data-r="import">Восстановить прогресс</button>
          <button class="btn-sm" data-r="restore">↩ Откатить к копии</button>
        </div>
        <div class="settings-note import-status hidden" data-r="status"></div>
      </div>

      <div class="settings-block danger-zone">
        <div class="settings-title">⚠ Опасная зона</div>
        <div class="settings-note">
          Полный сброс удаляет всё, включая золотые монеты и купленные перки престижа.
          Перед сбросом автоматически создаётся резервная копия.
        </div>
        <button class="danger-btn" data-r="reset">Сбросить прогресс</button>
      </div>

      <div class="settings-block">
        <div class="settings-title">🎛 Прочее</div>
        <div class="settings-note">
          <!-- TODO: переключатель темы — менять data-theme на <html>, палитра уже в CSS-переменных -->
          <!-- TODO: звук событий -->
          <!-- TODO: график роста капитала (можно переиспользовать sparkSVG из core/utils.js) -->
          Переключение темы, звук и график капитала — в планах.
        </div>
      </div>
    `;

    const r = (name) => container.querySelector(`[data-r="${name}"]`);
    this.refs = {
      info: r("info"), codeBox: r("codeBox"), copyHint: r("copyHint"),
      importBox: r("importBox"), status: r("status"), file: r("file"),
      restore: r("restore"),
    };

    r("download").addEventListener("click", () => this.download());
    r("code").addEventListener("click", () => this.showCode());
    r("pick").addEventListener("click", () => this.refs.file.click());
    this.refs.file.addEventListener("change", (e) => this.readFile(e));
    r("import").addEventListener("click", () => this.doImport(this.refs.importBox.value));
    this.refs.restore.addEventListener("click", () => this.doRestore());
    r("reset").addEventListener("click", () => this.doReset());

    this.refreshInfo();
    this.state.on("tick", () => this.refreshInfo());
  }

  /** Строка о текущем сейве: версия, размер, когда сохранён */
  async refreshInfo() {
    // Читаем не чаще раза в 5 секунд — это обращение к localStorage
    const now = Date.now();
    if (this._infoAt && now - this._infoAt < 5000) return;
    this._infoAt = now;

    const raw = await this.game.storage.raw();
    if (!raw) {
      this.refs.info.textContent = "ещё не сохранялся";
      return;
    }
    const kb = (new Blob([JSON.stringify(raw)]).size / 1024).toFixed(1);
    const ago = Fmt.durShort((now - (raw.lastTimestamp || now)) / 1000);
    this.refs.info.textContent = `v${raw.version} · ${kb} КБ · сохранён ${ago} назад`;

    const hasBackup = !!(await this.game.storage.loadBackup());
    this.refs.restore.disabled = !hasBackup;
  }

  _fileName() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `finmagnat-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
  }

  async download() {
    const data = await this.game.exportSave();
    const blob = new Blob([SaveCodec.toFileText(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = this._fileName();
    a.click();
    // Отдаём память обратно, но не раньше, чем браузер заберёт файл
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    this.state.toast("success", "Файл сохранения скачан");
  }

  async showCode() {
    const data = await this.game.exportSave();
    const code = SaveCodec.encode(data);
    this.refs.codeBox.classList.remove("hidden");
    this.refs.codeBox.value = code;
    this.refs.codeBox.select();

    // Буфер обмена доступен не везде (например, при открытии через file://),
    // поэтому при отказе просто оставляем строку выделенной
    let copied = false;
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
    } catch (_) { /* не страшно — код уже выделен */ }

    this.refs.copyHint.classList.remove("hidden");
    this.refs.copyHint.textContent = copied
      ? `Код скопирован в буфер обмена (${code.length} символов). Сохраните его где-нибудь.`
      : "Код выделен — скопируйте его вручную (Ctrl+C / Cmd+C).";
  }

  readFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => this.doImport(String(reader.result));
    reader.onerror = () => this._status(false, "Не удалось прочитать файл");
    reader.readAsText(file);
    e.target.value = ""; // чтобы повторный выбор того же файла тоже сработал
  }

  _status(ok, text) {
    this.refs.status.classList.remove("hidden");
    this.refs.status.className = "settings-note import-status " + (ok ? "ok" : "err");
    this.refs.status.textContent = text;
  }

  /** Краткая сводка входящего сейва — чтобы игрок понимал, что восстанавливает */
  _preview(data) {
    const parts = [`капитал ${Fmt.moneyShort(data.balance || 0)}`];
    if (data.prestigeCount) parts.push(`перерождений ${data.prestigeCount}`);
    if (data.gold) parts.push(`монет ${data.gold}`);
    if (data.stats?.playTimeSec) parts.push(`в игре ${Fmt.dur(data.stats.playTimeSec)}`);
    if (data.lastTimestamp) {
      parts.push(`сохранён ${new Date(data.lastTimestamp).toLocaleString("ru-RU")}`);
    }
    return parts.join(", ");
  }

  async doImport(text) {
    const res = this.game.storage.prepareImport(text);
    if (!res.ok) {
      this._status(false, "❌ " + res.error);
      return;
    }
    const summary = this._preview(res.data);
    const migrated = res.fromVersion < CONFIG.SAVE_VERSION
      ? `\n\nСейв версии v${res.fromVersion} будет обновлён до v${CONFIG.SAVE_VERSION}.` : "";
    if (!confirm(`Восстановить прогресс?\n\n${summary}${migrated}\n\nТекущий прогресс будет заменён (копия сохранится для отката).`)) {
      this._status(false, "Импорт отменён");
      return;
    }
    await this.game.applyImport(res.data);
    this.refs.importBox.value = "";
    this._infoAt = 0;
    this.refreshInfo();
    this._status(true, "✅ Прогресс восстановлен: " + summary);
    this.state.toast("success", "Прогресс восстановлен из резервной копии");
  }

  async doRestore() {
    const backup = await this.game.storage.loadBackup();
    if (!backup) {
      this._status(false, "Резервной копии пока нет");
      return;
    }
    if (!confirm(`Откатиться к предыдущему состоянию?\n\n${this._preview(backup)}`)) return;
    await this.game.restoreBackup();
    this._infoAt = 0;
    this.refreshInfo();
    this._status(true, "✅ Откат выполнен");
    this.state.toast("success", "Возврат к предыдущему сохранению");
  }

  doReset() {
    if (!confirm("Точно сбросить весь прогресс?\n\nУдалится всё, включая золотые монеты и перки престижа. Копия сохранится — откатить можно кнопкой «Откатить к копии».")) return;
    this.game.resetProgress();
    this._infoAt = 0;
    this.refreshInfo();
    this._status(true, "Прогресс сброшен. Откат доступен кнопкой выше.");
  }
}
