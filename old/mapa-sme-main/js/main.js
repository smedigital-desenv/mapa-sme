/**
 * ============================================================
 * MAIN.JS - Inicialização da Aplicação
 * ============================================================
 * Último script carregado. Espera o DOM, inicializa relógio,
 * registra eventos dos módulos e carrega a aba inicial.
 */

document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 Iniciando MAPA Dashboard...');

  try {
    // Relógio do header (atualiza a cada segundo)
    UI.updateClock();
    setInterval(UI.updateClock, 1000);

    // Registrar event listeners dos módulos
    Dashboard.init();
    Avaliacoes.init();

    // Carregar a aba inicial (Turmas)
    Dashboard.carregar();

    console.log('✅ MAPA Dashboard carregado com sucesso!');

  } catch (erro) {
    console.error('❌ Erro ao inicializar:', erro);
  }
});
