/**
 * ============================================================
 * AVALIACOES-EVENTS.JS - Event Listeners de Avaliações
 * ============================================================
 * Liga botões, selects e inputs às funções do módulo.
 */

const AvaliacoesEvents = (() => {
  function init() {
    const selectUnidade = document.getElementById('unidadeSelectAv');
    const inputAluno = document.getElementById('alunoSearch');

    // Mudar unidade recarrega disciplinas
    if (selectUnidade) {
      selectUnidade.addEventListener('change', () => {
        Avaliacoes.carregarDisciplinas();
      });
    }

    // Enter no campo aluno dispara busca
    if (inputAluno) {
      inputAluno.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') Avaliacoes.buscar();
      });
    }
  }

  return { init };
})();

window.AvaliacoesEvents = AvaliacoesEvents;
