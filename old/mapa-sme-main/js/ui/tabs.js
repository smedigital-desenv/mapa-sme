/**
 * ============================================================
 * TABS.JS - Navegação entre Abas
 * ============================================================
 * Controla troca de abas principais e sub-abas de avaliações.
 */

const Tabs = (() => {
  let abaAtual = 'turmas';
  let subAbaAtual = 'bimestre1';

  // Trocar aba principal
  function switchTab(tabName) {
    // Esconder todas as seções de aba
    document.querySelectorAll('.tab-content').forEach(tab => {
      tab.classList.add('d-none');
      tab.classList.remove('active');
    });

    // Desativar botões
    document.querySelectorAll('[role="tab"]').forEach(btn => {
      btn.classList.remove('active');
    });

    // Mostrar a aba escolhida
    const cap = tabName.charAt(0).toUpperCase() + tabName.slice(1);
    const sec = document.getElementById('tab' + cap);
    if (sec) {
      sec.classList.remove('d-none');
      sec.classList.add('active');
      abaAtual = tabName;
    }

    const btn = document.getElementById('nav' + cap);
    if (btn) btn.classList.add('active');

    // Sub-nav só aparece em Avaliações
    const subNav = document.getElementById('subNavAvaliacoes');
    if (subNav) {
      subNav.classList.toggle('d-none', tabName !== 'avaliacoes');
    }

    onTabChange(tabName);
  }

  // Trocar sub-aba (bimestre)
  function switchSubTab(subTabName) {
    document.querySelectorAll('#subNavAvaliacoes button').forEach(btn => {
      btn.classList.remove('active');
    });

    const btn = document.querySelector(`[data-subtab="${subTabName}"]`);
    if (btn) btn.classList.add('active');

    subAbaAtual = subTabName;

    const bimestreNum = CONFIG.bimestres[subTabName] ?? 1;
    if (window.Avaliacoes) {
      Avaliacoes.carregarBimestre(bimestreNum);
    }
  }

  // Callback ao trocar de aba principal
  function onTabChange(tabName) {
    switch (tabName) {
      case 'turmas':
        if (window.Dashboard) Dashboard.carregar();
        break;
      case 'avaliacoes':
        if (window.Avaliacoes) Avaliacoes.carregar();
        break;
      case 'rede':
        if (window.Rede) Rede.carregar();
        break;
    }
  }

  function getAbaAtual() {
    return { principal: abaAtual, sub: subAbaAtual };
  }

  return { switchTab, switchSubTab, getAbaAtual };
})();

window.Tabs = Tabs;
