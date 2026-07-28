/**
 * Роутинг верхних вкладок. Новая вкладка = запись в конфиге табов (main.js),
 * этот класс менять не нужно.
 *
 * Здесь же живёт общий помощник для бейджей-счётчиков «требует внимания»:
 * им пользуются и кнопки вкладок, и «пилюли» разделов инвестиций.
 */

/** Бейдж-счётчик: создание и обновление без перестройки DOM */
const AttnBadge = {
  /** Создаёт скрытый бейдж и возвращает элемент */
  create() {
    const el = document.createElement("span");
    el.className = "attn-badge";
    return el;
  },
  /**
   * Обновляет бейдж по сводке {count, urgent} из GameState.
   * Меняются только текст и классы — DOM не пересобирается.
   */
  paint(el, info) {
    if (!el) return;
    const count = info ? info.count : 0;
    if (!count) {
      if (el.classList.contains("visible")) el.className = "attn-badge";
      return;
    }
    const text = count > 9 ? "9+" : String(count);
    if (el.textContent !== text) el.textContent = text;
    const cls = "attn-badge visible" + (info.urgent ? " urgent" : "");
    if (el.className !== cls) el.className = cls;
  },
};

class TabManager {
  /**
   * tabs: [{ id, title, view (объект с render(container)) }]
   * state — нужен только для счётчиков «требует внимания» (необязателен)
   */
  constructor(tabs, navEl, containerEl, state) {
    this.tabs = [];
    this.state = state;
    tabs.forEach((tab, index) => {
      const btn = document.createElement("button");
      btn.className = "tab-btn" + (index === 0 ? " active" : "");
      // Подпись отдельным элементом, чтобы бейдж не затирался textContent
      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = tab.title;
      const badge = AttnBadge.create();
      btn.appendChild(label);
      btn.appendChild(badge);
      btn.addEventListener("click", () => this.activate(tab.id));
      navEl.appendChild(btn);

      const panel = document.createElement("section");
      panel.className = "tab-panel" + (index === 0 ? " active" : "");
      containerEl.appendChild(panel);

      tab.view.render(panel);
      this.tabs.push({ id: tab.id, btn, panel, badge });
    });

    if (this.state) {
      this.state.on("tick", () => this.updateBadges());
      this.updateBadges();
    }
  }

  /** Раз в тик: только текст и видимость бейджей */
  updateBadges() {
    const now = Date.now();
    this.tabs.forEach((t) => AttnBadge.paint(t.badge, this.state.attnTab(t.id, now)));
  }

  activate(tabId) {
    this.tabs.forEach(({ id, btn, panel }) => {
      btn.classList.toggle("active", id === tabId);
      panel.classList.toggle("active", id === tabId);
    });
  }
}
