/**
 * ============================================================
 * COMMON.JS - Funções de UI Reutilizáveis
 * ============================================================
 * Loading, erros, badges, relógio. Usado por todos os módulos.
 */

const UI = (() => {
  // Loading spinner dentro de um elemento
  function showLoading(elemento, colspan = 6) {
    if (!elemento) return;
    elemento.innerHTML = `
      <tr><td colspan="${colspan}" class="text-center py-4">
        <div class="spinner-border text-primary" role="status">
          <span class="visually-hidden">Carregando...</span>
        </div>
        <p class="mt-2 text-muted mb-0">Carregando dados...</p>
      </td></tr>`;
  }

  // Mensagem de erro em tabela
  function showErrorRow(elemento, mensagem, colspan = 6) {
    if (!elemento) return;
    elemento.innerHTML = `
      <tr><td colspan="${colspan}" class="text-center text-danger py-4">
        <i class="bi bi-exclamation-triangle-fill me-2"></i>${mensagem}
      </td></tr>`;
  }

  // Mensagem vazia em tabela
  function showEmptyRow(elemento, mensagem = 'Nenhum dado encontrado', colspan = 6) {
    if (!elemento) return;
    elemento.innerHTML = `
      <tr><td colspan="${colspan}" class="text-center text-muted py-4">${mensagem}</td></tr>`;
  }

  // Desabilitar botão com spinner
  function disableButton(botao, texto = 'Carregando...') {
    if (!botao) return;
    botao.dataset.htmlOriginal = botao.innerHTML;
    botao.disabled = true;
    botao.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>${texto}`;
  }

  // Restaurar botão
  function enableButton(botao) {
    if (!botao) return;
    botao.disabled = false;
    if (botao.dataset.htmlOriginal) {
      botao.innerHTML = botao.dataset.htmlOriginal;
    }
  }

  // Badge colorido por percentual
  function badgePercentual(valor) {
    const v = parseFloat(valor) || 0;
    let cor = 'danger';
    if (v >= 90) cor = 'success';
    else if (v >= 75) cor = 'warning';
    return `<span class="badge bg-${cor}">${Format.percentual(valor)}</span>`;
  }

  // Badge de resultado (Sim/Não)
  function badgeResultado(valor) {
    if (valor === 'S' || valor === 'Sim' || valor === 'SIM') {
      return '<span class="badge bg-success">Sim</span>';
    }
    if (valor === 'N' || valor === 'Não' || valor === 'NAO' || valor === 'NÃO') {
      return '<span class="badge bg-danger">Não</span>';
    }
    return `<span class="badge bg-secondary">${valor || '-'}</span>`;
  }

  // Atualizar relógio do header
  function updateClock() {
    const el = document.getElementById('relogio');
    if (el) el.textContent = new Date().toLocaleTimeString('pt-BR');
  }

  // Atualizar timestamp do footer
  function updateTimestamp() {
    const el = document.getElementById('lastUpdate');
    if (el) el.textContent = new Date().toLocaleTimeString('pt-BR');
  }

  // Preencher um <select> a partir de array de objetos
  function preencherSelect(selectId, itens, valorKey, textoKey, manterPrimeira = true) {
    const select = document.getElementById(selectId);
    if (!select) return;

    // Mantém a primeira opção ("Todas")
    while (select.options.length > (manterPrimeira ? 1 : 0)) {
      select.remove(manterPrimeira ? 1 : 0);
    }

    itens.forEach(item => {
      const opt = document.createElement('option');
      opt.value = typeof item === 'object' ? item[valorKey] : item;
      opt.textContent = typeof item === 'object' ? item[textoKey] : item;
      select.appendChild(opt);
    });
  }

  return {
    showLoading,
    showErrorRow,
    showEmptyRow,
    disableButton,
    enableButton,
    badgePercentual,
    badgeResultado,
    updateClock,
    updateTimestamp,
    preencherSelect
  };
})();

window.UI = UI;
