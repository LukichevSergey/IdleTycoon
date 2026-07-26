/**
 * Роутинг верхних вкладок. Новая вкладка = запись в конфиге табов (main.js),
 * этот класс менять не нужно.
 */
class TabManager {
  /** tabs: [{ id, title, view (объект с render(container)) }] */
  constructor(tabs, navEl, containerEl) {
    this.tabs = [];
    tabs.forEach((tab, index) => {
      const btn = document.createElement("button");
      btn.className = "tab-btn" + (index === 0 ? " active" : "");
      btn.textContent = tab.title;
      btn.addEventListener("click", () => this.activate(tab.id));
      navEl.appendChild(btn);

      const panel = document.createElement("section");
      panel.className = "tab-panel" + (index === 0 ? " active" : "");
      containerEl.appendChild(panel);

      tab.view.render(panel);
      this.tabs.push({ id: tab.id, btn, panel });
    });
  }

  activate(tabId) {
    this.tabs.forEach(({ id, btn, panel }) => {
      btn.classList.toggle("active", id === tabId);
      panel.classList.toggle("active", id === tabId);
    });
  }
}
