/** Всплывающие уведомления (тосты). type: 'info' | 'success' | 'warn' | 'danger' */
const Toasts = {
  el: null,
  init(el) {
    this.el = el;
  },
  show(type, msg, ms = 4500) {
    if (!this.el) return;
    const t = document.createElement("div");
    t.className = `toast ${type}`;
    t.textContent = msg;
    this.el.appendChild(t);
    // Не даём тостам копиться бесконечно
    while (this.el.children.length > 5) this.el.firstChild.remove();
    setTimeout(() => {
      t.classList.add("out");
      setTimeout(() => t.remove(), 300);
    }, ms);
  },
};
