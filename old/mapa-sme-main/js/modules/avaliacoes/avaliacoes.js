/**
 * ============================================================
 * AVALIACOES.JS - Lógica Principal de Avaliações
 * ============================================================
 * Orquestra Avaliações/Bimestres: carrega unidades, disciplinas,
 * registros e gráfico. Gerencia o bimestre selecionado.
 */

const Avaliacoes = (() => {
  let estado = {
    bimestre: 1,
    unidadeId: null,
    unidades: [],
    dados: [],
    resumo: [],
    carregando: false,
    inicializado: false
  };

  // Carga inicial da aba (só na primeira vez)
  async function carregar() {
    if (!estado.inicializado) {
      estado.unidades = await DashboardAPI.obterUnidades();
      AvaliacoesRender.preencherSelectUnidades(estado.unidades);
      estado.inicializado = true;
    }
    await carregarDisciplinas();
    await buscar();
  }

  // Atualizar lista de disciplinas conforme unidade/bimestre
  async function carregarDisciplinas() {
    const select = document.getElementById('unidadeSelectAv');
    estado.unidadeId = select && select.value ? parseInt(select.value) : null;

    const disciplinas = await BimestreAPI.obterDisciplinas(estado.unidadeId, estado.bimestre);
    AvaliacoesRender.preencherSelectDisciplinas(disciplinas);
  }

  // Buscar registros + resumo com os filtros atuais
  async function buscar() {
    if (estado.carregando) return;
    estado.carregando = true;

    const tbody = document.getElementById('tabelaBimestreBody');
    UI.showLoading(tbody, 4);

    try {
      const selectUnidade = document.getElementById('unidadeSelectAv');
      const selectDisciplina = document.getElementById('disciplinaSelect');
      const inputAluno = document.getElementById('alunoSearch');

      estado.unidadeId = selectUnidade && selectUnidade.value
        ? parseInt(selectUnidade.value) : null;

      const filtros = {
        unidadeId: estado.unidadeId,
        bimestre: estado.bimestre,
        disciplina: selectDisciplina ? selectDisciplina.value || null : null,
        nomeAluno: inputAluno ? inputAluno.value.trim() || null : null
      };

      // Resumo (gráfico) e registros em paralelo
      const [resumo, registros] = await Promise.all([
        BimestreAPI.obterResumoDisciplinas(filtros.unidadeId, filtros.bimestre),
        BimestreAPI.obterRegistros(filtros)
      ]);

      estado.resumo = resumo;
      estado.dados = registros;

      Charts.renderizarDisciplinas(resumo);
      AvaliacoesRender.atualizarTabela(registros);

    } catch (erro) {
      console.error('Avaliacoes.buscar:', erro);
      UI.showErrorRow(tbody, 'Erro ao buscar dados: ' + erro.message, 4);
    } finally {
      estado.carregando = false;
    }
  }

  // Trocar bimestre (chamado pelas sub-abas)
  async function carregarBimestre(bimestreNum) {
    estado.bimestre = bimestreNum ?? 1;
    await carregarDisciplinas();
    await buscar();
  }

  function init() {
    AvaliacoesEvents.init();
  }

  return {
    carregar,
    buscar,
    carregarBimestre,
    carregarDisciplinas,
    init,
    getEstado: () => ({ ...estado })
  };
})();

window.Avaliacoes = Avaliacoes;
