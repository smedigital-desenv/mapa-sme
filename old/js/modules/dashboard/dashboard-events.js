/**
 * ============================================================
 * DASHBOARD-EVENTS.JS - Event Listeners do Dashboard
 * ============================================================
 * Liga os elementos da interface às funções do módulo.
 */

const DashboardEvents = (() => {
  function init() {
    const select = document.getElementById('unidadeSelect');
    if (select) {
      select.addEventListener('change', () => Dashboard.renderizar());
    }
  }

  return { init };
})();

window.DashboardEvents = DashboardEvents;
