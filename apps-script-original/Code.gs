/**
 * =====================================================================
 * MAPA — SME RIBEIRÃO PRETO
 * Code.gs — Entry point principal, helpers globais e função include()
 * =====================================================================
 *
 * CONTROLE DE ACESSO — três camadas:
 *   1. VIP (listaVIP)         → acesso total + modos especiais
 *   2. Usuário vinculado       → e-mail pessoal linkado a uma unidade (aba Usuarios)
 *   3. Unidade escolar         → e-mail institucional da escola (aba Unidades)
 *
 * Parâmetros de URL disponíveis para VIPs:
 *   ?modo=atribuicao           → abre modo atribuição
 *   ?modo=apresentacao         → abre modo apresentação
 *   ?testeEscola=email@escola  → simula acesso de uma unidade específica
 *   ?testeUsuario=email@user   → simula acesso de um usuário vinculado
 * =====================================================================
 */

// =======================================================
// CONFIGURAÇÃO GLOBAL
// =======================================================
var AVALIACAO_SHEETS = {
  primeiroBimestre: 'Primeiro_Bimestre',
  segundoBimestre:  'Segundo_Bimestre',
  terceiroBimestre: 'Terceiro_Bimestre',
  quartoBimestre:   'Quarto_Bimestre'
};

// =======================================================
// ENTRY POINT WEB
// =======================================================
function doGet(e) {
  var template = HtmlService.createTemplateFromFile('Index');

  var emailUsuario = '';
  try {
    emailUsuario = Session.getActiveUser().getEmail().toLowerCase().trim();
  } catch (erro) {
    emailUsuario = '';
  }

  // E-mail exclusivo do modo atribuição (não entra como VIP).
  var emailAtribuicaoEspecial = 'g.atribuicao@educacao.pmrp.sp.gov.br';

  var listaVIP = [
    'diogoperez@educacao.pmrp.sp.gov.br',
    'tarcisionaves@educacao.pmrp.sp.gov.br',
    'christianoliveira@educacao.pmrp.sp.gov.br',
    'matheusprospero@educacao.pmrp.sp.gov.br'
  ];

  var parametroModo = (e && e.parameter && e.parameter.modo)
    ? String(e.parameter.modo).toLowerCase().trim()
    : '';

  var isEmailAtribuicaoEspecial = emailUsuario === emailAtribuicaoEspecial;
  var isUsuarioVIP = listaVIP.indexOf(emailUsuario) !== -1;

  var isVIP = false;
  var isAtribuicao = false;

  // ── Resolução de modo para VIP e atribuição especial ──────────
  if (isEmailAtribuicaoEspecial) {
    parametroModo = 'atribuicao';
    isAtribuicao  = true;
    isVIP         = false;
  } else if (isUsuarioVIP && parametroModo === 'atribuicao') {
    isAtribuicao  = true;
    isVIP         = true;
  } else if (isUsuarioVIP && parametroModo === 'apresentacao') {
    isAtribuicao  = false;
    isVIP         = true;
  } else {
    parametroModo = '';
    isAtribuicao  = false;
    isVIP         = isUsuarioVIP;
  }

  // ── CONTROLE DE ACESSO POR UNIDADE / USUÁRIO ──────────────────
  // VIPs podem simular qualquer acesso via parâmetros de teste.
  var unidadeEscola = '';  // nome da unidade escolar filtrada
  var tipoAcesso    = '';  // '' = total | 'unidade' | 'usuario'

  var testeEscolaParam = (e && e.parameter && e.parameter.testeEscola)
    ? String(e.parameter.testeEscola).toLowerCase().trim()
    : '';

  var testeUsuarioParam = (e && e.parameter && e.parameter.testeUsuario)
    ? String(e.parameter.testeUsuario).toLowerCase().trim()
    : '';

  // Modo teste: somente VIPs podem usar esses parâmetros.
  var emailParaVerificar = emailUsuario;
  var modoTeste = false;

  if (isUsuarioVIP && testeUsuarioParam) {
    emailParaVerificar = testeUsuarioParam;
    modoTeste = true;
  } else if (isUsuarioVIP && testeEscolaParam) {
    emailParaVerificar = testeEscolaParam;
    modoTeste = true;
  }

  // Não aplica filtro de acesso em VIPs reais (sem modo teste) e em atribuição especial.
  var deveVerificarAcesso = modoTeste || (!isUsuarioVIP && !isEmailAtribuicaoEspecial && emailParaVerificar);

  if (deveVerificarAcesso) {
    // Prioridade 1: verificar se é usuário vinculado a uma unidade (aba Usuarios).
    var resultadoUsuario = _buscarUnidadePorUsuario_(emailParaVerificar);
    if (resultadoUsuario) {
      unidadeEscola = resultadoUsuario;
      tipoAcesso    = 'usuario';
    } else {
      // Prioridade 2: verificar se é e-mail institucional da escola (aba Unidades).
      var resultadoUnidade = _buscarUnidadePorEmail_(emailParaVerificar);
      if (resultadoUnidade) {
        unidadeEscola = resultadoUnidade;
        tipoAcesso    = 'unidade';
      }
    }

    // Acesso por unidade/usuário não tem modo especial nem é VIP visível.
    if (unidadeEscola && modoTeste) {
      isVIP         = false;
      parametroModo = '';
      isAtribuicao  = false;
    }
  }
  // ─────────────────────────────────────────────────────────────

  template.modo          = parametroModo;
  template.isVIP         = isVIP;
  template.isAtribuicao  = isAtribuicao;
  template.emailUsuario  = emailUsuario;
  template.unidadeEscola = unidadeEscola;   // '' = acesso total
  template.tipoAcesso    = tipoAcesso;      // '' | 'unidade' | 'usuario'

  return template
    .evaluate()
    .setTitle('MAPA | SME Ribeirão Preto')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// =======================================================
// INCLUDE — junta arquivos .html no template
// =======================================================
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// =======================================================
// CONTROLE DE ACESSO — UNIDADE ESCOLAR (aba Unidades)
// Estrutura da aba: coluna A = Nome da Escola | coluna B = E-mail
// Cache de 1h para não bater na planilha a cada requisição.
// =======================================================
function _buscarUnidadePorEmail_(email) {
  if (!email) return '';

  var cacheKey = 'acesso_unidade_email_' + email.replace(/[^a-z0-9]/g, '_');
  var cached = cacheGet_(cacheKey);
  if (cached !== null && cached !== undefined) return cached;

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Unidades');
    if (!sh || sh.getLastRow() < 2) {
      cachePut_(cacheKey, '', 3600);
      return '';
    }

    var data = sh.getDataRange().getValues();
    // Cabeçalho ignorado (linha 0). Colunas: A=Nome | B=E-mail
    for (var i = 1; i < data.length; i++) {
      var emailPlanilha = String(data[i][1] || '').toLowerCase().trim();
      if (emailPlanilha === email) {
        var nome = String(data[i][0] || '').trim();
        cachePut_(cacheKey, nome, 3600);
        return nome;
      }
    }
  } catch (err) {
    Logger.log('Erro _buscarUnidadePorEmail_: ' + err);
  }

  cachePut_(cacheKey, '', 3600);
  return '';
}

// =======================================================
// CONTROLE DE ACESSO — USUÁRIO VINCULADO (aba Usuarios)
// Estrutura da aba: coluna A = E-mail do usuário | coluna B = Nome da Unidade
// Permite vincular qualquer e-mail pessoal a uma unidade escolar.
// Cache de 1h.
// =======================================================
function _buscarUnidadePorUsuario_(email) {
  if (!email) return '';

  var cacheKey = 'acesso_usuario_email_' + email.replace(/[^a-z0-9]/g, '_');
  var cached = cacheGet_(cacheKey);
  if (cached !== null && cached !== undefined) return cached;

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Usuarios');
    if (!sh || sh.getLastRow() < 2) {
      cachePut_(cacheKey, '', 3600);
      return '';
    }

    var data = sh.getDataRange().getValues();
    // Cabeçalho ignorado (linha 0). Colunas: A=E-mail usuário | B=Nome da Unidade
    for (var i = 1; i < data.length; i++) {
      var emailPlanilha = String(data[i][0] || '').toLowerCase().trim();
      if (emailPlanilha === email) {
        var nomeUnidade = String(data[i][1] || '').trim();
        cachePut_(cacheKey, nomeUnidade, 3600);
        return nomeUnidade;
      }
    }
  } catch (err) {
    Logger.log('Erro _buscarUnidadePorUsuario_: ' + err);
  }

  cachePut_(cacheKey, '', 3600);
  return '';
}

// =======================================================
// INVALIDAR CACHE DE ACESSO
// Execute no editor do Apps Script quando mudar a aba Unidades ou Usuarios.
// =======================================================
function invalidarCacheAcesso() {
  try {
    var cache = CacheService.getScriptCache();
    // Não há listagem de chaves no CacheService; expiração natural em 1h.
    // Para forçar a invalidação imediata, limpe o cache do script.
    cache.remove('acesso_unidade_email_*'); // simbólico; use removeAll quando necessário
    Logger.log('Cache de acesso invalidado (expiração natural em 1h).');
    Logger.log('Para invalidação imediata de todos os caches, use: CacheService.getScriptCache().removeAll([...])');
  } catch (err) {
    Logger.log('Erro ao invalidar cache de acesso: ' + err);
  }
}

// =======================================================
// HELPERS DE STRING
// =======================================================
function normalizeKey_(value) {
  return String(value || '').trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function cleanUnit_(value) {
  return String(value || '').trim().split(',')[0].trim();
}

function idx_(headers, names) {
  var normHeaders = headers.map(function(h) { return normalizeKey_(h); });
  for (var i = 0; i < names.length; i++) {
    var pos = normHeaders.indexOf(normalizeKey_(names[i]));
    if (pos !== -1) return pos;
  }
  return -1;
}

function safeCell_(row, index) {
  if (index === undefined || index === null || index < 0) return '';
  return row[index];
}

function parseNumber_(value) {
  if (value === null || value === undefined || value === '') return null;
  var n = parseFloat(String(value).replace(',', '.').replace(/[^\d.-]/g, ''));
  return isNaN(n) ? null : n;
}

function average_(arr) {
  if (!arr || !arr.length) return null;
  var valid = arr.filter(function(v) { return typeof v === 'number' && !isNaN(v); });
  if (!valid.length) return null;
  var sum = valid.reduce(function(a, b) { return a + b; }, 0);
  return Math.round((sum / valid.length) * 100) / 100;
}

// =======================================================
// CONVERSÃO DE ANO ESCOLAR (UI → banco)
// "1º ANO" → "1 ANO"  (a planilha usa formato sem o "º")
// =======================================================
function anoParaBanco_(ano) {
  if (!ano || ano === 'TODOS') return '';
  var s = String(ano).trim().toUpperCase()
    .replace(/[º°]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s; // "1 ANO", "2 ANO"...
}

// =======================================================
// CACHE (CacheService) — usado por todas as funções backend
// =======================================================
function cacheGet_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var value = cache.get(key);
    if (value) return JSON.parse(value);
  } catch (e) {}
  return null;
}

function cachePut_(key, value, seconds) {
  try {
    var cache = CacheService.getScriptCache();
    cache.put(key, JSON.stringify(value), seconds || 21600);
  } catch (e) {} // ignora se passar do limite
}

// =======================================================
// NORMALIZAÇÃO DE VL E RÓTULOS CURTOS
// =======================================================
var LABEL_CURTO = {
  'ESCRITA':           { '1':'Pré-silábica','2':'Silábica','3':'Silábico-alf.','4':'Alfabética','5':'Ortográfica' },
  'LEITURA':           { '1':'N1 Pré-leitor','2':'N2 Pré-leitor','3':'N3 Pré-leitor','4':'N4 Pré-leitor','5':'L. Iniciante','6':'L. Fluente' },
  'PRODUCAO TEXTUAL':  { '1':'Nível 1','2':'Nível 2','3':'Nível 3','4':'Nível 4','5':'Nível 5','9':'Não produz' },
  'AUTONOMIA':         { '0':'Autônomo','1':'Apoio leve','2':'Apoio frequente','3':'Dependente' },
  'AUTORREGULACAO':    { '0':'Autônomo','1':'Apoio leve','2':'Apoio frequente','3':'Dependente' },
  'COMUNICACAO':       { '0':'Autônomo','1':'Apoio leve','2':'Apoio frequente','3':'Dependente' },
  'ENGAJAMENTO':       { '0':'Autônomo','1':'Apoio leve','2':'Apoio frequente','3':'Dependente' },
  'SEGURANCA':         { '0':'Autônomo','1':'Apoio leve','2':'Apoio frequente','3':'Dependente' },
  'POTENCIALIDADES':   { 'S':'Sim','N':'Não','X':'Não Avaliado' },
};

function normVl_(vl) {
  var s = String(vl == null ? '' : vl).trim();
  if (!s) return 'X';
  var sUp = s.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if (sUp.indexOf('NAO AVAL') !== -1) return 'X';
  if (sUp === 'S' || sUp === 'SIM') return 'S';
  if (sUp === 'N' || sUp === 'NAO') return 'N';
  if (sUp === 'X' || sUp.indexOf('NAO AVALIADO') !== -1) return 'X';
  return s;
}

function labelCurto_(fne, vlRaw) {
  var vl   = normVl_(vlRaw);
  var fneN = normalizeKey_(fne);

  if (vl === 'S') return 'Sim';
  if (vl === 'N') return 'Não';
  if (vl === 'X') return 'Não Avaliado';

  if (LABEL_CURTO[fneN] && LABEL_CURTO[fneN][vl]) return LABEL_CURTO[fneN][vl];
  return vl;
}

function vlNumerico_(vl) {
  var v = normVl_(vl);
  if (v === 'S') return 1;
  if (v === 'N') return 0;
  if (v === 'X') return null;
  if (v === '9') return null;
  var n = parseNumber_(v);
  return n;
}

// =======================================================
// HELPERS ADICIONAIS — compatibilidade com backend refatorado
// =======================================================
function normFne_(fne) {
  return normalizeKey_(fne);
}

function normalizarDisciplina_(valor) {
  var txt = String(valor || '').trim();
  if (!txt) return '';
  var n = normalizeKey_(txt);

  if (n.indexOf('LINGUA PORTUGUESA') !== -1 || n.indexOf('PORTUGUES') !== -1) return 'Língua Portuguesa';
  if (n.indexOf('MATEMATICA') !== -1) return 'Matemática';
  if (n.indexOf('CIENCIAS') !== -1) return 'Ciências';
  if (n.indexOf('HISTORIA') !== -1) return 'História';
  if (n.indexOf('GEOGRAFIA') !== -1) return 'Geografia';
  if (n.indexOf('ARTES VISUAIS') !== -1) return 'Artes Visuais';
  if (n === 'ARTE' || n.indexOf('ARTE') !== -1) return 'Arte';
  if (n.indexOf('EDUCACAO FISICA') !== -1) return 'Educação Física';
  if (n.indexOf('LINGUA INGLESA') !== -1 || n.indexOf('INGLES') !== -1) return 'Língua Inglesa';
  if (n.indexOf('ATENDIMENTO EDUCACIONAL') !== -1 || n === 'AEE') return 'Atendimento Educacional Especializado';

  return txt;
}