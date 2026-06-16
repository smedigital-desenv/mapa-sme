/**
 * ============================================================
 * HELPERS.JS - Funções Auxiliares + Cache
 * ============================================================
 * Utilidades gerais: debounce, cache com localStorage, etc.
 */

const Helpers = (() => {
  // ── Debounce: atrasa execução até parar de chamar ──
  function debounce(fn, delay = 300) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ── Cache em localStorage com TTL ──
  const Cache = {
    set(chave, valor) {
      if (!CONFIG.cache.enabled) return;
      try {
        const item = {
          valor: valor,
          expira: Date.now() + CONFIG.cache.ttl
        };
        localStorage.setItem(CONFIG.cache.prefix + chave, JSON.stringify(item));
      } catch (e) {
        console.warn('Cache: não foi possível salvar', e);
      }
    },

    get(chave) {
      if (!CONFIG.cache.enabled) return null;
      try {
        const raw = localStorage.getItem(CONFIG.cache.prefix + chave);
        if (!raw) return null;

        const item = JSON.parse(raw);
        if (Date.now() > item.expira) {
          localStorage.removeItem(CONFIG.cache.prefix + chave);
          return null;
        }
        return item.valor;
      } catch (e) {
        return null;
      }
    },

    remove(chave) {
      localStorage.removeItem(CONFIG.cache.prefix + chave);
    },

    // Limpar todo o cache do MAPA
    clear() {
      Object.keys(localStorage)
        .filter(k => k.startsWith(CONFIG.cache.prefix))
        .forEach(k => localStorage.removeItem(k));
    }
  };

  // ── Ordenar array de objetos por campo de texto ──
  function ordenarPor(array, campo) {
    return [...array].sort((a, b) => {
      const va = (a[campo] || '').toString();
      const vb = (b[campo] || '').toString();
      return va.localeCompare(vb, 'pt-BR');
    });
  }

  // ── Remover duplicados de um array ──
  function unico(array) {
    return [...new Set(array)];
  }

  // ── Log condicional (só em modo debug) ──
  function log(...args) {
    if (CONFIG.debug) console.log('[MAPA]', ...args);
  }

  return { debounce, Cache, ordenarPor, unico, log };
})();

window.Helpers = Helpers;
