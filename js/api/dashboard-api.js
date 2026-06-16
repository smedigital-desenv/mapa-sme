/**
 * ============================================================
 * DASHBOARD-API.JS - API específica do Dashboard (Turmas)
 * ============================================================
 * Todas as chamadas Supabase relacionadas a Turmas / PPA.
 */

const DashboardAPI = (() => {
  // Resumo de turmas por unidade e período
  async function obterTurmas(nomeUnidade = null) {
    try {
      const dados = await SupabaseAPI.rpc('obter_dashboard_turmas', {
        p_nome_unidade: nomeUnidade
      });
      return dados || [];
    } catch (erro) {
      console.error('DashboardAPI.obterTurmas:', erro);
      return [];
    }
  }

  // Lista de unidades (id + nome)
  async function obterUnidades() {
    try {
      const dados = await SupabaseAPI.get('unidades', {
        select: 'id,nome_escola',
        order: 'nome_escola'
      });
      return dados || [];
    } catch (erro) {
      console.error('DashboardAPI.obterUnidades:', erro);
      return [];
    }
  }

  return { obterTurmas, obterUnidades };
})();

window.DashboardAPI = DashboardAPI;
