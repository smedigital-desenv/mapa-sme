/**
 * ============================================================
 * REDE.JS - Estatísticas Gerais da Rede
 * ============================================================
 * Carrega e exibe os cards de resumo geral (turmas, carga,
 * percentual de atribuição e total de alunos).
 */

const Rede = (() => {
  let estado = { carregando: false, jaCarregou: false };

  async function carregar() {
    if (estado.carregando) return;
    estado.carregando = true;

    try {
      // Dados de turmas (Dashboard) para somatórios
      const turmas = await DashboardAPI.obterTurmas();

      const totalTurmas = turmas.reduce((s, t) => s + (t.total_turmas || 0), 0);
      const cargaTotal = turmas.reduce((s, t) => s + parseFloat(t.carga_total || 0), 0);
      const cargaAtribuida = turmas.reduce((s, t) => s + parseFloat(t.carga_atribuida || 0), 0);
      const percentual = cargaTotal > 0 ? (cargaAtribuida / cargaTotal * 100) : 0;

      setText('statTurmas', Format.inteiro(totalTurmas));
      setText('statCarga', Format.decimal(cargaAtribuida));
      setText('statPercentual', Format.percentual(percentual));

      // Estatísticas de alunos (Bimestres) — total geral
      const stats = await BimestreAPI.obterEstatisticas(null, 1);
      setText('statAlunos', Format.inteiro(stats.total_alunos || 0));

      estado.jaCarregou = true;

    } catch (erro) {
      console.error('Rede.carregar:', erro);
    } finally {
      estado.carregando = false;
    }
  }

  function setText(id, valor) {
    const el = document.getElementById(id);
    if (el) el.textContent = valor;
  }

  return { carregar, getEstado: () => ({ ...estado }) };
})();

window.Rede = Rede;
