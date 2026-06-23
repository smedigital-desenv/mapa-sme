/**
 * ============================================================
 * AVALIACOES-RENDER.JS - Renderização de Avaliações
 * ============================================================
 * Gera HTML das tabelas e preenche selects. Sem lógica de API.
 */

const AvaliacoesRender = (() => {
  // Tabela de registros detalhados
  function atualizarTabela(dados) {
    const tbody = document.getElementById('tabelaBimestreBody');
    if (!tbody) return;

    if (!dados || dados.length === 0) {
      UI.showEmptyRow(tbody, 'Nenhum registro encontrado', 4);
      return;
    }

    // Limita à página para não travar o navegador
    const pagina = dados.slice(0, CONFIG.pagination.pageSize);

    tbody.innerHTML = pagina.map(row => `
      <tr>
        <td><strong>${row.nome_aluno}</strong></td>
        <td>${row.fnc_disciplina || '-'}</td>
        <td><small class="text-muted">${Format.truncar(row.descricao_fne, 60)}</small></td>
        <td>${UI.badgeResultado(row.valor_resposta)}</td>
      </tr>
    `).join('');

    // Aviso se houver mais registros do que o exibido
    if (dados.length > CONFIG.pagination.pageSize) {
      const aviso = document.createElement('tr');
      aviso.innerHTML = `
        <td colspan="4" class="text-center text-muted small fst-italic">
          Exibindo ${CONFIG.pagination.pageSize} de ${dados.length} registros.
          Use os filtros para refinar a busca.
        </td>`;
      tbody.appendChild(aviso);
    }

    UI.updateTimestamp();
  }

  // Preencher select de unidades
  function preencherSelectUnidades(unidades) {
    UI.preencherSelect('unidadeSelectAv', unidades, 'id', 'nome_escola');
  }

  // Preencher select de disciplinas
  function preencherSelectDisciplinas(disciplinas) {
    UI.preencherSelect('disciplinaSelect', disciplinas);
  }

  return {
    atualizarTabela,
    preencherSelectUnidades,
    preencherSelectDisciplinas
  };
})();

window.AvaliacoesRender = AvaliacoesRender;
