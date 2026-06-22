/**
 * ============================================================
 * CONFIG.JS - Configurações Globais
 * ============================================================
 * Centraliza todas as constantes e configurações do projeto.
 * Este é o ÚNICO lugar onde credenciais e URLs ficam.
 */

const CONFIG = {
  // Supabase
  supabase: {
    url: 'https://gmwotfulohkmuqrezeef.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdtd290ZnVsb2hrbXVxcmV6ZWVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MTQxODYsImV4cCI6MjA5NzA5MDE4Nn0.6qjrT9Nux_0_Z5oH9ndpcCcJxzfO59VuXjhggVXSOFk'
  },

  // Cache (localStorage)
  cache: {
    enabled: true,
    ttl: 3600000, // 1 hora em milissegundos
    prefix: 'MAPA_CACHE_'
  },

  // Paginação
  pagination: {
    pageSize: 50,
    maxRecords: 1000
  },

  // Mapa de bimestres (sub-abas → número)
  bimestres: {
    diagnostica: 0,
    bimestre1: 1,
    bimestre2: 2,
    bimestre3: 3,
    bimestre4: 4,
    total: 5
  },

  // Valores padrão de filtros
  defaults: {
    unidade: null,
    bimestre: 1,
    limite: 500
  },

  // Modo debug (true = logs detalhados no console)
  debug: false
};

// Tornar acessível globalmente
window.CONFIG = CONFIG;
