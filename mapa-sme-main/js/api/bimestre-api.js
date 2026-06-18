/**
 * ============================================================
 * BIMESTRE-API.JS - API específica de Avaliações (Bimestres)
 * ============================================================
 * Todas as chamadas Supabase relacionadas a Avaliações.
 */

const BimestreAPI = (() => {
  // Registros detalhados com filtros
  async function obterRegistros(filtros = {}) {
    try {
      const params = {
        p_unidade_id: filtros.unidadeId || null,
        p_bimestre: filtros.bimestre ?? 1,
        p_turma: filtros.turma || null,
        p_disciplina: filtros.disciplina || null,
        p_nome_aluno: filtros.nomeAluno || null,
        p_limit: filtros.limit || CONFIG.pagination.maxRecords,
        p_offset: filtros.offset || 0
      };
      return await SupabaseAPI.rpc('obter_bimestre_registros', params);
    } catch (erro) {
      console.error('BimestreAPI.obterRegistros:', erro);
      return [];
    }
  }

  // Resumo de disciplinas (para gráfico)
  async function obterResumoDisciplinas(unidadeId = null, bimestre = 1) {
    try {
      return await SupabaseAPI.rpc('resumo_disciplinas_bimestre', {
        p_unidade_id: unidadeId,
        p_bimestre: bimestre
      });
    } catch (erro) {
      console.error('BimestreAPI.obterResumoDisciplinas:', erro);
      return [];
    }
  }

  // Detalhes de um aluno
  async function obterDetalheAluno(remaAluno, bimestre = null) {
    try {
      return await SupabaseAPI.rpc('detalhe_aluno_bimestre', {
        p_rema_aluno: remaAluno,
        p_bimestre: bimestre
      });
    } catch (erro) {
      console.error('BimestreAPI.obterDetalheAluno:', erro);
      return [];
    }
  }

  // Estatísticas gerais (cards da Rede)
  async function obterEstatisticas(unidadeId = null, bimestre = 1) {
    try {
      const dados = await SupabaseAPI.rpc('estatisticas_bimestre', {
        p_unidade_id: unidadeId,
        p_bimestre: bimestre
      });
      return (dados && dados[0]) || {};
    } catch (erro) {
      console.error('BimestreAPI.obterEstatisticas:', erro);
      return {};
    }
  }

  // Lista de disciplinas (derivada do resumo)
  async function obterDisciplinas(unidadeId = null, bimestre = 1) {
    try {
      const resumo = await obterResumoDisciplinas(unidadeId, bimestre);
      return resumo.map(r => r.fnc_disciplina);
    } catch (erro) {
      console.error('BimestreAPI.obterDisciplinas:', erro);
      return [];
    }
  }

  return {
    obterRegistros,
    obterResumoDisciplinas,
    obterDetalheAluno,
    obterEstatisticas,
    obterDisciplinas
  };
})();

window.BimestreAPI = BimestreAPI;
