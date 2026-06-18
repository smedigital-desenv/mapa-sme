/**
 * ============================================================
 * DASHBOARD.JS - Lógica Principal do Dashboard (Turmas)
 * ============================================================
 * Orquestra: carrega dados via API, gerencia estado, chama
 * render. É o "controlador" do módulo Dashboard.
 */

const Dashboard = (() => {
  let estado = {
    dados: [],
    carregando: false,
    jaCarregou: false
  };

  // Carregar dados (uma vez; usa cache nas próximas)
  async function carregar() {
    if (estado.carregando) return;
    estado.carregando = true;

    const tbody = document.getElementById('tabelaDashboardBody');
    UI.showLoading(tbody, 6);

    try {
      estado.dados = await DashboardAPI.obterTurmas();

      if (estado.dados.length === 0) {
        UI.showEmptyRow(tbody, 'Nenhum dado disponível', 6);
        return;
      }

      DashboardRender.preencherSelectUnidades(estado.dados);
      renderizar();
      estado.jaCarregou = true;

    } catch (erro) {
      console.error('Dashboard.carregar:', erro);
      UI.showErrorRow(tbody, 'Erro ao carregar dados: ' + erro.message, 6);
    } finally {
      estado.carregando = false;
    }
  }

  // Renderizar aplicando filtro de unidade selecionada
  function renderizar() {
    const select = document.getElementById('unidadeSelect');
    const unidadeId = select && select.value ? parseInt(select.value) : null;

    const dados = unidadeId
      ? estado.dados.filter(d => d.unidade_id === unidadeId)
      : estado.dados;

    DashboardRender.atualizarTabela(dados);
  }

  function init() {
    DashboardEvents.init();
  }

  return { carregar, renderizar, init, getEstado: () => ({ ...estado }) };
})();

window.Dashboard = Dashboard;
