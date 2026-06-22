/**
 * =====================================================================
 * Backend_Acesso.gs — Gerenciamento de perfis e acessos
 * =====================================================================
 * Funções chamadas pelo painel de Configurações (JS_Configuracoes.html).
 * Somente VIPs têm acesso a este painel no frontend.
 *
 * Abas utilizadas:
 *   Unidades  → col A: Nome da Escola | col B: E-mail institucional
 *   Usuarios  → col A: E-mail do usuário | col B: Nome da Unidade | col C: Observação
 *
 * Todas as funções que escrevem na planilha invalidam o cache de acesso
 * automaticamente para garantir que o novo estado seja lido na próxima
 * abertura do sistema (sem esperar a expiração de 1h).
 * =====================================================================
 */

// =======================================================
// HELPERS INTERNOS
// =======================================================

/**
 * Retorna a aba pelo nome, criando-a com cabeçalho se não existir.
 */
function _abaAcesso_(nome, cabecalho) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(nome);
  if (!sh) {
    sh = ss.insertSheet(nome);
    if (cabecalho && cabecalho.length) {
      sh.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
      sh.getRange(1, 1, 1, cabecalho.length)
        .setFontWeight('bold')
        .setBackground('#002b5e')
        .setFontColor('#ffffff');
      sh.setFrozenRows(1);
    }
  }
  return sh;
}

/**
 * Invalida as entradas de cache de acesso pelo prefixo.
 * Como o CacheService não tem listagem de chaves, recriamos as chaves
 * conhecidas a partir dos dados atuais das abas e as removemos.
 */
function _invalidarCacheAcessoCompleto_() {
  try {
    var cache = CacheService.getScriptCache();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var keysParaRemover = [];

    // Coleta e-mails da aba Unidades
    var shU = ss.getSheetByName('Unidades');
    if (shU && shU.getLastRow() > 1) {
      var dU = shU.getRange(2, 2, shU.getLastRow() - 1, 1).getValues();
      dU.forEach(function(r) {
        var e = String(r[0] || '').toLowerCase().trim();
        if (e) keysParaRemover.push('acesso_unidade_email_' + e.replace(/[^a-z0-9]/g, '_'));
      });
    }

    // Coleta e-mails da aba Usuarios
    var shUs = ss.getSheetByName('Usuarios');
    if (shUs && shUs.getLastRow() > 1) {
      var dUs = shUs.getRange(2, 1, shUs.getLastRow() - 1, 1).getValues();
      dUs.forEach(function(r) {
        var e = String(r[0] || '').toLowerCase().trim();
        if (e) keysParaRemover.push('acesso_usuario_email_' + e.replace(/[^a-z0-9]/g, '_'));
      });
    }

    if (keysParaRemover.length) cache.removeAll(keysParaRemover);
  } catch (err) {
    Logger.log('Aviso ao invalidar cache de acesso: ' + err);
  }
}

// =======================================================
// LEITURA — UNIDADES
// Retorna lista de unidades da aba Unidades para o select do modal.
// =======================================================
function getListaUnidades() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName('Unidades');
    if (!sh || sh.getLastRow() < 2) return { ok: true, unidades: [] };

    var data = sh.getDataRange().getValues();
    var unidades = [];
    for (var i = 1; i < data.length; i++) {
      var nome  = String(data[i][0] || '').trim();
      var email = String(data[i][1] || '').trim();
      if (nome) unidades.push({ nome: nome, email: email });
    }
    unidades.sort(function(a, b) { return a.nome.localeCompare(b.nome); });
    return { ok: true, unidades: unidades };
  } catch (err) {
    return { ok: false, erro: String(err) };
  }
}

// =======================================================
// LEITURA — USUÁRIOS VINCULADOS
// Retorna todos os registros da aba Usuarios.
// =======================================================
function getListaUsuarios() {
  try {
    var sh = _abaAcesso_('Usuarios', ['E-mail do Usuário', 'Nome da Unidade', 'Observação']);
    if (sh.getLastRow() < 2) return { ok: true, usuarios: [] };

    var data = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
    var usuarios = [];
    for (var i = 0; i < data.length; i++) {
      var email = String(data[i][0] || '').trim();
      var unid  = String(data[i][1] || '').trim();
      var obs   = String(data[i][2] || '').trim();
      if (email || unid) {
        usuarios.push({ linha: i + 2, email: email, unidade: unid, obs: obs });
      }
    }
    return { ok: true, usuarios: usuarios };
  } catch (err) {
    return { ok: false, erro: String(err) };
  }
}

// =======================================================
// ESCRITA — ADICIONAR USUÁRIO
// =======================================================
function adicionarUsuario(email, nomeUnidade, obs) {
  email       = String(email       || '').toLowerCase().trim();
  nomeUnidade = String(nomeUnidade || '').trim();
  obs         = String(obs         || '').trim();

  if (!email || !nomeUnidade) return { ok: false, erro: 'E-mail e unidade são obrigatórios.' };

  try {
    var sh = _abaAcesso_('Usuarios', ['E-mail do Usuário', 'Nome da Unidade', 'Observação']);

    // Verifica duplicidade
    if (sh.getLastRow() > 1) {
      var existentes = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < existentes.length; i++) {
        if (String(existentes[i][0] || '').toLowerCase().trim() === email) {
          return { ok: false, erro: 'E-mail já cadastrado. Use editar para alterar.' };
        }
      }
    }

    sh.appendRow([email, nomeUnidade, obs]);
    _invalidarCacheAcessoCompleto_();
    return { ok: true };
  } catch (err) {
    return { ok: false, erro: String(err) };
  }
}

// =======================================================
// ESCRITA — EDITAR USUÁRIO (por número de linha)
// =======================================================
function editarUsuario(linha, email, nomeUnidade, obs) {
  linha       = Number(linha);
  email       = String(email       || '').toLowerCase().trim();
  nomeUnidade = String(nomeUnidade || '').trim();
  obs         = String(obs         || '').trim();

  if (!linha || linha < 2) return { ok: false, erro: 'Linha inválida.' };
  if (!email || !nomeUnidade) return { ok: false, erro: 'E-mail e unidade são obrigatórios.' };

  try {
    var sh = _abaAcesso_('Usuarios', ['E-mail do Usuário', 'Nome da Unidade', 'Observação']);
    if (linha > sh.getLastRow()) return { ok: false, erro: 'Linha não encontrada.' };

    sh.getRange(linha, 1, 1, 3).setValues([[email, nomeUnidade, obs]]);
    _invalidarCacheAcessoCompleto_();
    return { ok: true };
  } catch (err) {
    return { ok: false, erro: String(err) };
  }
}

// =======================================================
// ESCRITA — REMOVER USUÁRIO (por número de linha)
// =======================================================
function removerUsuario(linha) {
  linha = Number(linha);
  if (!linha || linha < 2) return { ok: false, erro: 'Linha inválida.' };

  try {
    var sh = _abaAcesso_('Usuarios', ['E-mail do Usuário', 'Nome da Unidade', 'Observação']);
    if (linha > sh.getLastRow()) return { ok: false, erro: 'Linha não encontrada.' };

    sh.deleteRow(linha);
    _invalidarCacheAcessoCompleto_();
    return { ok: true };
  } catch (err) {
    return { ok: false, erro: String(err) };
  }
}

// =======================================================
// LEITURA — PAINEL UNIDADES (com e-mail institucional)
// Retorna lista completa para a aba de gerenciamento de unidades.
// =======================================================
function getListaUnidadesCompleta() {
  try {
    var sh = _abaAcesso_('Unidades', ['Nome da Escola', 'E-mail']);
    if (sh.getLastRow() < 2) return { ok: true, unidades: [] };

    var data = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    var unidades = [];
    for (var i = 0; i < data.length; i++) {
      var nome  = String(data[i][0] || '').trim();
      var email = String(data[i][1] || '').trim();
      if (nome) unidades.push({ linha: i + 2, nome: nome, email: email });
    }
    return { ok: true, unidades: unidades };
  } catch (err) {
    return { ok: false, erro: String(err) };
  }
}

// =======================================================
// ESCRITA — ATUALIZAR E-MAIL INSTITUCIONAL DA UNIDADE
// =======================================================
function atualizarEmailUnidade(linha, email) {
  linha = Number(linha);
  email = String(email || '').toLowerCase().trim();

  if (!linha || linha < 2) return { ok: false, erro: 'Linha inválida.' };

  try {
    var sh = _abaAcesso_('Unidades', ['Nome da Escola', 'E-mail']);
    if (linha > sh.getLastRow()) return { ok: false, erro: 'Linha não encontrada.' };

    sh.getRange(linha, 2).setValue(email);
    _invalidarCacheAcessoCompleto_();
    return { ok: true };
  } catch (err) {
    return { ok: false, erro: String(err) };
  }
}

// =======================================================
// UTILITÁRIO — VERIFICAR ACESSO DE UM E-MAIL
// Permite testar na interface qual acesso um e-mail receberia.
// =======================================================
function verificarAcessoEmail(email) {
  email = String(email || '').toLowerCase().trim();
  if (!email) return { ok: false, erro: 'Informe um e-mail.' };

  var listaVIP = [
    'diogoperez@educacao.pmrp.sp.gov.br',
    'tarcisionaves@educacao.pmrp.sp.gov.br',
    'christianoliveira@educacao.pmrp.sp.gov.br',
    'matheusprospero@educacao.pmrp.sp.gov.br'
  ];
  var emailAtribuicao = 'g.atribuicao@educacao.pmrp.sp.gov.br';

  if (listaVIP.indexOf(email) !== -1) return { ok: true, tipo: 'vip', descricao: 'Acesso total (VIP)' };
  if (email === emailAtribuicao)       return { ok: true, tipo: 'atribuicao', descricao: 'Modo Atribuição' };

  var unidUsuario = _buscarUnidadePorUsuario_(email);
  if (unidUsuario) return { ok: true, tipo: 'usuario', descricao: 'Usuário vinculado → ' + unidUsuario, unidade: unidUsuario };

  var unidEmail = _buscarUnidadePorEmail_(email);
  if (unidEmail) return { ok: true, tipo: 'unidade', descricao: 'E-mail institucional → ' + unidEmail, unidade: unidEmail };

  return { ok: true, tipo: 'sem_acesso', descricao: 'Sem acesso configurado' };
}