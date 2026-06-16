/**
 * ============================================================
 * FORMAT.JS - Funções de Formatação
 * ============================================================
 * Formata números, datas, strings, etc. Funções puras (sem
 * efeitos colaterais), reutilizáveis por qualquer módulo.
 */

const Format = (() => {
  // Número para moeda (R$)
  function moeda(valor) {
    if (!valor && valor !== 0) return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(parseFloat(valor));
  }

  // Número com casas decimais
  function decimal(valor, casas = 2) {
    if (!valor && valor !== 0) return '0,00';
    return parseFloat(valor).toLocaleString('pt-BR', {
      minimumFractionDigits: casas,
      maximumFractionDigits: casas
    });
  }

  // Percentual (75.5 → "75,50%")
  function percentual(valor) {
    if (!valor && valor !== 0) return '--';
    return parseFloat(valor).toFixed(2).replace('.', ',') + '%';
  }

  // Hora (HH:MM:SS)
  function hora(data) {
    const d = data ? new Date(data) : new Date();
    return d.toLocaleTimeString('pt-BR');
  }

  // Data (DD/MM/YYYY)
  function data(valor) {
    if (!valor) return '--/--/--';
    return new Date(valor).toLocaleDateString('pt-BR');
  }

  // Data e hora (DD/MM/YYYY HH:MM)
  function dataHora(valor) {
    if (!valor) return '--/--/-- --:--';
    return new Date(valor).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  // Truncar texto longo
  function truncar(texto, maxChars = 50) {
    if (!texto) return '';
    return texto.length > maxChars ? texto.substring(0, maxChars) + '...' : texto;
  }

  // Capitalizar primeira letra
  function capitalize(texto) {
    if (!texto) return '';
    return texto.charAt(0).toUpperCase() + texto.slice(1).toLowerCase();
  }

  // Normalizar espaços
  function normalizar(texto) {
    if (!texto) return '';
    return texto.trim().replace(/\s+/g, ' ');
  }

  // Inteiro com separador de milhar
  function inteiro(valor) {
    if (!valor && valor !== 0) return '--';
    return parseInt(valor).toLocaleString('pt-BR');
  }

  return {
    moeda, decimal, percentual, hora, data, dataHora,
    truncar, capitalize, normalizar, inteiro
  };
})();

window.Format = Format;
