/**
 * ============================================================
 * SUPABASE.JS - Abstração de Chamadas ao Supabase
 * ============================================================
 * Centraliza TODAS as requisições REST. Nenhum outro arquivo
 * deve chamar fetch() diretamente ao Supabase.
 */

const SupabaseAPI = (() => {
  const headers = {
    'Content-Type': 'application/json',
    'apikey': CONFIG.supabase.anonKey,
    'Authorization': `Bearer ${CONFIG.supabase.anonKey}`
  };

  // Requisição genérica
  async function request(endpoint, method = 'GET', body = null) {
    const url = `${CONFIG.supabase.url}/rest/v1${endpoint}`;
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    Helpers.log(`${method} ${endpoint}`, body || '');

    const response = await fetch(url, options);

    if (!response.ok) {
      const erro = await response.text();
      throw new Error(`[${response.status}] ${erro}`);
    }

    return await response.json();
  }

  // RPC (chamar Supabase Function) com cache opcional
  async function rpc(funcName, params = {}, usarCache = true) {
    const chaveCache = `rpc_${funcName}_${JSON.stringify(params)}`;

    if (usarCache) {
      const cacheado = Helpers.Cache.get(chaveCache);
      if (cacheado) {
        Helpers.log(`Cache HIT: ${funcName}`);
        return cacheado;
      }
    }

    const resultado = await request(`/rpc/${funcName}`, 'POST', params);

    if (usarCache) {
      Helpers.Cache.set(chaveCache, resultado);
    }

    return resultado;
  }

  // SELECT genérico
  async function get(table, options = {}) {
    let query = `/${table}`;
    const params = new URLSearchParams();

    if (options.select) params.append('select', options.select);
    if (options.limit) params.append('limit', options.limit);
    if (options.offset) params.append('offset', options.offset);
    if (options.order) params.append('order', options.order);

    // Filtros customizados: { coluna: 'eq.valor' }
    if (options.filters) {
      Object.entries(options.filters).forEach(([col, val]) => {
        params.append(col, val);
      });
    }

    if (params.toString()) query += '?' + params.toString();
    return request(query);
  }

  return { request, rpc, get };
})();

window.SupabaseAPI = SupabaseAPI;
