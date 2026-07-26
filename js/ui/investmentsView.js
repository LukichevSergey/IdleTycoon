
/**
 * Вкладка «Инвестиции»: под-навигация по разделам.
 * Новый раздел = запись в SECTIONS + класс секции. Роутинг менять не нужно.
 * // TODO: раздел «Бизнесы», «Предметы роскоши» и т.п.
 */
class InvestmentsView {
  constructor(state, tradeModal) {
    this.state = state;
    this.tradeModal = tradeModal;
    this.sections = [];
    this.activeId = "realty";
  }

  render(container) {
    container.innerHTML = `
      <div class="subnav" id="inv-subnav"></div>
      <div id="inv-sections"></div>
    `;
    const nav = container.querySelector("#inv-subnav");
    const host = container.querySelector("#inv-sections");

    const SECTIONS = [
      { id: "realty", title: "🏠 Недвижимость", make: () => new RealtySection(this.state) },
      { id: "stocks", title: "📈 Акции", make: () => new MarketSection(this.state, "stock", STOCK_DEFS, this.tradeModal) },
      { id: "bonds", title: "📜 Облигации", make: () => new MarketSection(this.state, "bond", BOND_DEFS, this.tradeModal) },
      { id: "deposits", title: "🏦 Вклады", make: () => new DepositsSection(this.state) },
      { id: "crypto", title: "🪙 Крипта", make: () => new MarketSection(this.state, "crypto", CRYPTO_DEFS, this.tradeModal,
          "⚠ Криптовалюты — крайне волатильный инструмент: можно удвоиться, можно потерять почти всё. Дохода не приносят, вся ставка — на курс.") },
    ];

    SECTIONS.forEach((sec, i) => {
      const pill = document.createElement("button");
      pill.className = "pill" + (i === 0 ? " active" : "");
      pill.textContent = sec.title;
      pill.addEventListener("click", () => this.activate(sec.id));
      nav.appendChild(pill);

      const wrap = document.createElement("div");
      wrap.className = i === 0 ? "" : "hidden";
      host.appendChild(wrap);

      const instance = sec.make();
      instance.mount(wrap);
      this.sections.push({ id: sec.id, pill, wrap });
    });
  }

  activate(id) {
    this.activeId = id;
    this.sections.forEach((s) => {
      s.pill.classList.toggle("active", s.id === id);
      s.wrap.classList.toggle("hidden", s.id !== id);
    });
  }
}
