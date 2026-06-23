/**
 * ============================================================
 * DASHBOARD-RENDER.JS - Renderização do Dashboard
 * ============================================================
 * Funções que geram HTML. Não fazem chamadas de API nem
 * gerenciam estado — apenas recebem dados e renderizam.
 */

const DashboardRender = (() => {
  // Renderizar tabela de turmas
  function atualizarTabela(dados) {
    const tbody = document.getElementById('tabelaDashboardBody');
    if (!tbody) return;

    if (!dados || dados.length === 0) {
      UI.showEmptyRow(tbody, 'Nenhum dado encontrado', 6);
      return;
    }

    tbody.innerHTML = dados.map(linha => `
      <tr>
        <td><strong>${linha.nome_unidade}</strong></td>
        <td>${linha.periodo || 'TODOS'}</td>
        <td>${linha.total_turmas || 0}</td>
        <td>${Format.decimal(linha.carga_total)}</td>
        <td><span class="text-success fw-bold">${Format.decimal(linha.carga_atribuida)}</span></td>
        <td>${UI.badgePercentual(linha.percentual_atribuido)}</td>
      </tr>
    `).join('');

    UI.updateTimestamp();
  }

  // Preencher select de unidades (sem duplicar)
  function preencherSelectUnidades(dados) {
    const mapa = new Map();
    dados.forEach(d => {
      if (!mapa.has(d.unidade_id)) {
        mapa.set(d.unidade_id, d.nome_unidade);
      }
    });

    const itens = Array.from(mapa, ([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

    UI.preencherSelect('unidadeSelect', itens, 'id', 'nome');
  }

  return { atualizarTabela, preencherSelectUnidades };
})();

window.DashboardRender = DashboardRender;
