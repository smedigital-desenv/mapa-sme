/**
 * agenda-para-planilha.gs — Lê uma (ou várias) agenda(s) do Google Calendar e
 * despeja os eventos numa aba do Google Sheets.
 *
 * A rotina é IDEMPOTENTE: rodar de novo não duplica. Cada linha é identificada
 * pela chave "id do evento | início", então evento editado ATUALIZA a própria
 * linha, evento novo entra e evento apagado (ou movido para fora da janela)
 * SAI da planilha.
 *
 * ⚠ A chave leva o início junto de propósito. Numa série recorrente o
 *   CalendarApp devolve o MESMO id para todas as ocorrências; só o id faria as
 *   52 semanas do ano colapsarem numa linha só, e a planilha mostraria apenas
 *   a última que o laço tivesse visto.
 *
 * ⚠ A linha inteira viaja junto na reescrita — colunas que você acrescentar à
 *   DIREITA de "Sincronizado em" continuam coladas no evento delas (anotação,
 *   marcação de conferido). O que a rotina reescreve é só até essa coluna.
 *   Não escreva à mão DENTRO das colunas geradas: a próxima execução desfaz.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SETUP (uma vez):
 *   1. Planilha ▸ Extensões ▸ Apps Script → cole este arquivo e salve.
 *   2. Recarregue a planilha → menu "Agenda para Planilha".
 *   3. Menu ▸ "Escolher a agenda (pelo link)" — cole o endereço que o Google
 *      Agenda mostra em "Integrar agenda" (aquele com "cid=" ou "src="). O
 *      script decodifica, confere o acesso e guarda o ID nas Propriedades do
 *      script.
 *   4. Menu ▸ "Importar agora" — o Google pede autorização na primeira vez
 *      (Calendar + Planilhas). Autorize com a conta que ENXERGA a agenda.
 *   5. Menu ▸ "Definir intervalo de atualização" — escolha de quanto em quanto
 *      tempo ela se atualiza (de 5 minutos a 1x por dia). O padrão é 1 hora.
 *   6. Menu ▸ "Ativar rotina automática" — instala o gatilho por tempo.
 *
 * ⚠ Trocar o intervalo REFAZ o gatilho na hora. Não adianta mudar número no
 *   código: o gatilho guarda a cadência de quando foi criado, e um já
 *   instalado seguiria na antiga.
 *
 * ⚠ O ID da agenda mora nas PROPRIEDADES DO SCRIPT, não aqui no código, e é de
 *   propósito: este repositório é público. As propriedades ficam no projeto
 *   Apps Script, no servidor do Google, e não viajam no Git.
 *   Configurações do projeto ▸ Propriedades do script:
 *         AGENDAS       = ID da agenda (vários? separe por vírgula)
 *                         'primary' = a agenda pessoal de quem roda
 *         INTERVALO_MIN = 60   (em minutos; use o menu, é mais seguro)
 *         DIAS_PASSADO  = 30
 *         DIAS_FUTURO   = 180
 *         ABA           = Agenda
 *   As propriedades VENCEM os valores da seção "Config" abaixo — é o jeito de
 *   mudar a janela sem editar o script.
 *
 * USO — menu "Agenda para Planilha":
 *   • Importar agora               → roda a importação na hora
 *   • Escolher a agenda (pelo link)→ decodifica o link e grava o ID
 *   • Definir intervalo            → escolhe a cadência e refaz o gatilho
 *   • Ativar rotina automática     → cria o gatilho na cadência configurada
 *   • Desativar rotina automática  → remove o gatilho
 *   • Conferir configuração        → mostra agendas, janela e aba em uso
 * ─────────────────────────────────────────────────────────────────────────
 */

// ── Config (Propriedades do script têm precedência sobre estes valores) ────
var AGENDAS      = 'primary';   // 'primary', ou 'a@x.br, b@group.calendar.google.com'
var DIAS_PASSADO = 30;          // quanto tempo para trás a janela alcança
var DIAS_FUTURO  = 180;         // quanto tempo para frente
var ABA          = 'Agenda';    // nome da aba de destino (criada se não existir)
var MAX_DESCRICAO = 2000;       // corta descrição gigante (célula aguenta 50k)

/**
 * Intervalos oferecidos no menu, em minutos.
 *
 * ⚠ A lista NÃO é livre. O Apps Script só aceita alguns valores:
 *   everyMinutes() → 5, 10, 15, 30 (o de 1 minuto existe, mas queima cota à toa)
 *   everyHours()   → 1, 2, 4, 6, 8, 12
 *   everyDays()    → 1
 * Um valor fora disso é recusado na hora de criar o gatilho. Por isso o menu
 * oferece uma LISTA em vez de pedir um número: não há como escolher inválido.
 *
 * ⚠ 3, 5, 7 horas não estão aqui porque não dividem o dia — mesmo que fossem
 *   aceitos, o horário de disparo escorregaria de um dia para o outro.
 */
var INTERVALOS = [
  { min: 5,    rotulo: '5 minutos' },
  { min: 10,   rotulo: '10 minutos' },
  { min: 15,   rotulo: '15 minutos' },
  { min: 30,   rotulo: '30 minutos' },
  { min: 60,   rotulo: '1 hora' },
  { min: 120,  rotulo: '2 horas' },
  { min: 240,  rotulo: '4 horas' },
  { min: 360,  rotulo: '6 horas' },
  { min: 480,  rotulo: '8 horas' },
  { min: 720,  rotulo: '12 horas' },
  { min: 1440, rotulo: '1 vez por dia (de madrugada)' }
];
var INTERVALO_PADRAO = 60;      // usado enquanto ninguém tiver escolhido
var HORA_DIARIA      = 5;       // quando o intervalo é diário, dispara às 5h

var CABECALHO = [
  'Chave', 'ID do evento', 'Agenda', 'Título', 'Início', 'Fim', 'Dia inteiro',
  'Duração (h)', 'Local', 'Descrição', 'Organizador', 'Criado por',
  'Convidados', 'Nº convidados', 'Minha resposta', 'Visibilidade', 'Recorrente',
  'Link', 'Atualizado em', 'Sincronizado em'
];
var COL_CHAVE  = 0;   // índice da chave dentro da linha (base 0)
var COL_INICIO = 4;   // índice do início — usado para ordenar e para a janela
var COL_ATUALIZADO = 18;
var N_COLS     = CABECALHO.length;

var GATILHO = 'importarAgendaAgendado';

// ── Menu ──────────────────────────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Agenda para Planilha')
    .addItem('Importar agora', 'importarAgendaMenu')
    .addSeparator()
    .addItem('Escolher a agenda (pelo link)', 'configurarAgendaPeloLink')
    .addItem('Definir intervalo de atualização', 'definirIntervaloAgenda')
    .addSeparator()
    .addItem('Ativar rotina automática', 'ativarRotinaAgenda')
    .addItem('Desativar rotina automática', 'desativarRotinaAgenda')
    .addSeparator()
    .addItem('Conferir configuração', 'conferirConfigAgenda')
    .addToUi();
}

function importarAgendaMenu() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    var r = importarAgenda_();
    ss.toast(
      r.novos + ' novo(s), ' + r.atualizados + ' atualizado(s), ' +
      r.removidos + ' removido(s) — ' + r.total + ' evento(s) na janela.',
      'Importação concluída', 8);
  } catch (e) {
    SpreadsheetApp.getUi().alert('Não deu para importar:\n\n' + e.message);
    throw e;
  }
}

/** Chamado pelo gatilho por tempo — sem interface, só registro no log. */
function importarAgendaAgendado() {
  var r = importarAgenda_();
  Logger.log('Agenda para Planilha: %s novos, %s atualizados, %s removidos, %s na janela.',
             r.novos, r.atualizados, r.removidos, r.total);
}

// ── Rotina principal ──────────────────────────────────────────────────────
function importarAgenda_() {
  var cfg   = configAgenda_();
  var agora = new Date();
  var ini   = new Date(agora.getTime() - cfg.diasPassado * 864e5);
  var fim   = new Date(agora.getTime() + cfg.diasFuturo  * 864e5);

  // 1) Lê os eventos de todas as agendas configuradas.
  var linhas = [];
  cfg.agendas.forEach(function (idAgenda) {
    var cal = (idAgenda === 'primary')
      ? CalendarApp.getDefaultCalendar()
      : CalendarApp.getCalendarById(idAgenda);
    if (!cal) {
      throw new Error('Agenda não encontrada ou sem acesso: "' + idAgenda +
        '".\nConfira o ID e se ela está compartilhada com a conta que roda o script.');
    }
    var nome = cal.getName();
    cal.getEvents(ini, fim).forEach(function (ev) {
      linhas.push(linhaDoEvento_(ev, cal, nome, agora));
    });
  });

  // 2) Estado atual da planilha — a linha INTEIRA, para não perder coluna extra.
  var aba = abaDestino_(cfg.aba);
  var ultimaLinha = aba.getLastRow();
  var largura = Math.max(aba.getLastColumn(), N_COLS);
  var existentes = (ultimaLinha > 1)
    ? aba.getRange(2, 1, ultimaLinha - 1, largura).getValues()
    : [];

  var porChave = {};
  existentes.forEach(function (l, i) { porChave[String(l[COL_CHAVE])] = i; });

  var novos = 0, atualizados = 0, vistas = {};

  linhas.forEach(function (nova) {
    var chave = nova[COL_CHAVE];
    vistas[chave] = true;
    var i = porChave[chave];
    if (i === undefined) {
      var linha = nova.slice();
      while (linha.length < largura) linha.push('');
      existentes.push(linha);
      porChave[chave] = existentes.length - 1;
      novos++;
    } else {
      // "Sincronizado em" muda toda vez; ele fica fora da comparação, senão
      // toda execução acusaria a planilha inteira como alterada.
      var antes = existentes[i].slice(0, N_COLS - 1).join('');
      for (var c = 0; c < N_COLS; c++) existentes[i][c] = nova[c];
      if (antes !== nova.slice(0, N_COLS - 1).join('')) atualizados++;
    }
  });

  // 3) O que estava na JANELA e não apareceu mais: evento apagado ou movido.
  //    Fora da janela nada é tocado — é histórico que esta execução não olhou.
  var antesDoFiltro = existentes.length;
  existentes = existentes.filter(function (l) {
    if (vistas[String(l[COL_CHAVE])]) return true;
    var d = l[COL_INICIO];
    if (!(d instanceof Date)) d = new Date(d);
    if (isNaN(d.getTime())) return true;          // linha estranha: preserva
    return !(d >= ini && d <= fim);               // fora da janela: preserva
  });
  var removidos = antesDoFiltro - existentes.length;

  // 4) Ordena por início e reescreve de uma vez só.
  existentes.sort(function (a, b) {
    return dataOrd_(a[COL_INICIO]) - dataOrd_(b[COL_INICIO]);
  });
  gravar_(aba, existentes, largura, ultimaLinha);

  return {
    novos: novos, atualizados: atualizados, removidos: removidos,
    total: linhas.length
  };
}

// ── Um evento vira uma linha ──────────────────────────────────────────────
function linhaDoEvento_(ev, cal, nomeAgenda, agora) {
  var diaInteiro = ev.isAllDayEvent();
  var inicio, fim;
  if (diaInteiro) {
    inicio = ev.getAllDayStartDate();
    // A API devolve o fim EXCLUSIVO (meia-noite do dia seguinte). Para leitura
    // humana, a planilha mostra o ÚLTIMO dia do evento.
    fim = new Date(ev.getAllDayEndDate().getTime() - 864e5);
  } else {
    inicio = ev.getStartTime();
    fim    = ev.getEndTime();
  }

  // A duração usa sempre o intervalo cru (fim exclusivo): evento de dia
  // inteiro de um dia dá 24h, não 0.
  var horas = (ev.getEndTime().getTime() - ev.getStartTime().getTime()) / 36e5;

  var convidados = [], minhaResposta = '';
  try {
    convidados = ev.getGuestList().map(function (g) {
      var nome = g.getName();
      return nome ? nome + ' <' + g.getEmail() + '>' : g.getEmail();
    });
    minhaResposta = String(ev.getMyStatus() || '');
  } catch (e) {
    // Agenda compartilhada só como "livre/ocupado" não entrega convidado.
    // Isso é resposta da API, não avaria — a linha entra assim mesmo.
    minhaResposta = '(sem acesso ao detalhe)';
  }

  var desc = String(ev.getDescription() || '');
  if (desc.length > MAX_DESCRICAO) desc = desc.slice(0, MAX_DESCRICAO) + ' [...]';

  return [
    ev.getId() + '|' + ev.getStartTime().toISOString(),
    ev.getId(),
    nomeAgenda,
    ev.getTitle(),
    inicio,
    fim,
    diaInteiro ? 'Sim' : 'Não',
    Math.round(horas * 100) / 100,
    String(ev.getLocation() || ''),
    desc,
    seguro_(function () { return ev.getOriginalCalendarId(); }),
    seguro_(function () { return ev.getCreators().join(', '); }),
    convidados.join(', '),
    convidados.length,
    minhaResposta,
    seguro_(function () { return String(ev.getVisibility()); }),
    ev.isRecurringEvent() ? 'Sim' : 'Não',
    linkDoEvento_(ev, cal),
    seguro_(function () { return ev.getLastUpdated(); }),
    agora
  ];
}

/**
 * O CalendarApp não expõe o htmlLink; ele é remontado como o próprio Google
 * monta: base64 de "<id sem o domínio> <id da agenda>".
 */
function linkDoEvento_(ev, cal) {
  try {
    var id = ev.getId().replace(/@google\.com$/, '');
    var alvo = Utilities.base64Encode(id + ' ' + cal.getId()).replace(/=+$/, '');
    return 'https://calendar.google.com/calendar/u/0/r/eventedit/' + alvo;
  } catch (e) {
    return '';
  }
}

/** Campo que a API pode recusar conforme a permissão — vazio em vez de erro. */
function seguro_(fn) {
  try { var v = fn(); return (v === null || v === undefined) ? '' : v; }
  catch (e) { return ''; }
}

function dataOrd_(v) {
  if (v instanceof Date) return v.getTime();
  var d = new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

// ── Planilha ──────────────────────────────────────────────────────────────
function abaDestino_(nome) {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName(nome) || ss.insertSheet(nome);
  if (aba.getMaxColumns() < N_COLS) {
    aba.insertColumnsAfter(aba.getMaxColumns(), N_COLS - aba.getMaxColumns());
  }
  var cab = (aba.getLastColumn() >= N_COLS)
    ? aba.getRange(1, 1, 1, N_COLS).getValues()[0]
    : [];
  if (cab.join('|') !== CABECALHO.join('|')) {
    aba.getRange(1, 1, 1, N_COLS).setValues([CABECALHO])
       .setFontWeight('bold').setBackground('#e8eaed');
    aba.setFrozenRows(1);
  }
  return aba;
}

function gravar_(aba, linhas, largura, ultimaLinhaAntes) {
  if (linhas.length) {
    if (aba.getMaxRows() < linhas.length + 1) {
      aba.insertRowsAfter(aba.getMaxRows(), linhas.length + 1 - aba.getMaxRows());
    }
    aba.getRange(2, 1, linhas.length, largura).setValues(linhas);
    aba.getRange(2, COL_INICIO + 1, linhas.length, 2)
       .setNumberFormat('dd/mm/yyyy hh:mm');
    aba.getRange(2, COL_ATUALIZADO + 1, linhas.length, 2)
       .setNumberFormat('dd/mm/yyyy hh:mm');
  }
  // Sobrou cauda da execução anterior (eventos removidos): limpa o resto.
  var sobra = ultimaLinhaAntes - 1 - linhas.length;
  if (sobra > 0) aba.getRange(linhas.length + 2, 1, sobra, largura).clearContent();

  // A chave é ferramenta da rotina, não informação para quem lê.
  aba.hideColumns(COL_CHAVE + 1);
  SpreadsheetApp.flush();
}

// ── Configuração ──────────────────────────────────────────────────────────
function configAgenda_() {
  var p = PropertiesService.getScriptProperties();
  var lista = String(p.getProperty('AGENDAS') || AGENDAS)
    .split(',').map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length; });
  if (!lista.length) throw new Error('Nenhuma agenda configurada (AGENDAS).');
  return {
    agendas: lista,
    diasPassado: Number(p.getProperty('DIAS_PASSADO') || DIAS_PASSADO),
    diasFuturo:  Number(p.getProperty('DIAS_FUTURO')  || DIAS_FUTURO),
    aba:         String(p.getProperty('ABA') || ABA)
  };
}

/**
 * Recebe o endereço que o Google Agenda oferece em "Integrar agenda" e guarda
 * o ID nas Propriedades do script. Aceita as três formas que circulam por aí:
 *   .../calendar/u/0?cid=<base64 do ID>      (o botão "copiar link")
 *   .../calendar/embed?src=<ID codificado>   (o código de incorporação)
 *   o próprio ID da agenda, colado direto (o que termina em
 *   "group.calendar.google.com", ou o e-mail de uma agenda pessoal)
 */
function configurarAgendaPeloLink() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Escolher a agenda',
    'Cole o link da agenda (o endereço com "cid=" ou "src=") ou o ID dela.\n' +
    'Para mais de uma, separe por vírgula ou por linha.',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;

  var ids = String(r.getResponseText()).split(/[\n,;]+/)
    .map(idDaAgenda_)
    .filter(function (s) { return s.length; });
  if (!ids.length) { ui.alert('Nada reconhecido no que foi colado.'); return; }

  // Confere o acesso ANTES de gravar: melhor recusar aqui, com o link à vista,
  // do que deixar a rotina falhar depois, sozinha, no gatilho por tempo.
  var nomes = [];
  for (var i = 0; i < ids.length; i++) {
    var cal = (ids[i] === 'primary')
      ? CalendarApp.getDefaultCalendar()
      : CalendarApp.getCalendarById(ids[i]);
    if (!cal) {
      ui.alert('Sem acesso a esta agenda:\n\n' + ids[i] + '\n\n' +
        'Ela precisa estar compartilhada com a conta que está rodando o script ' +
        '(pelo menos "Ver todos os detalhes do evento"). Nada foi gravado.');
      return;
    }
    nomes.push(cal.getName() + '  —  ' + ids[i]);
  }

  PropertiesService.getScriptProperties().setProperty('AGENDAS', ids.join(', '));
  ui.alert('Agenda(s) configurada(s):\n\n' + nomes.join('\n') +
    '\n\nAgora use "Importar agora".');
}

function idDaAgenda_(texto) {
  var t = String(texto).trim();
  if (!t) return '';
  var m = t.match(/[?&]cid=([^&#\s]+)/);
  if (m) {
    var decodificado = base64Tolerante_(decodeURIComponent(m[1]));
    // Se não saiu um ID plausível, o cid não era base64 — vale o que veio.
    return (decodificado.indexOf('@') > 0) ? decodificado : decodeURIComponent(m[1]);
  }
  m = t.match(/[?&]src=([^&#\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  return t;
}

/** O cid ora vem em base64 comum, ora em base64 web-safe, e às vezes sem o
 *  preenchimento final. Os três casos entram aqui. */
function base64Tolerante_(s) {
  try {
    var web = /[-_]/.test(s);
    var t = String(s).replace(/=+$/, '');
    while (t.length % 4) t += '=';
    var bytes = web ? Utilities.base64DecodeWebSafe(t) : Utilities.base64Decode(t);
    return Utilities.newBlob(bytes).getDataAsString();
  } catch (e) {
    return '';
  }
}

function conferirConfigAgenda() {
  var c = configAgenda_();
  SpreadsheetApp.getUi().alert(
    'Agendas: ' + c.agendas.join(', ') + '\n' +
    'Janela: ' + c.diasPassado + ' dia(s) para trás, ' +
                 c.diasFuturo + ' para frente\n' +
    'Aba de destino: ' + c.aba + '\n' +
    'Fuso do script: ' + Session.getScriptTimeZone() + '\n\n' +
    'Rotina automática: ' + (gatilhoAgenda_() ? 'ATIVA' : 'desligada') + '\n' +
    'Intervalo configurado: ' + rotuloIntervalo_(intervaloAtual_()));
}

// ── Gatilho por tempo ─────────────────────────────────────────────────────
function gatilhoAgenda_() {
  var achou = null;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === GATILHO) achou = t;
  });
  return achou;
}

/** Intervalo escolhido, em minutos — sempre um dos valores de INTERVALOS. */
function intervaloAtual_() {
  var p = PropertiesService.getScriptProperties();
  var min = Number(p.getProperty('INTERVALO_MIN'));
  if (!min) {                                   // versão antiga guardava horas
    var horas = Number(p.getProperty('FREQ_HORAS'));
    if (horas) min = horas * 60;
  }
  return rotuloIntervalo_(min) ? min : INTERVALO_PADRAO;
}

/** Rótulo do intervalo, ou '' se o valor não estiver na lista aceita. */
function rotuloIntervalo_(min) {
  for (var i = 0; i < INTERVALOS.length; i++) {
    if (INTERVALOS[i].min === Number(min)) return INTERVALOS[i].rotulo;
  }
  return '';
}

/** Cria o gatilho na cadência pedida, escolhendo o método que o Apps Script
 *  aceita para aquela faixa. */
function instalarGatilho_(min) {
  var b = ScriptApp.newTrigger(GATILHO).timeBased();
  if (min < 60)        b.everyMinutes(min);
  else if (min < 1440) b.everyHours(min / 60);
  else                 b.everyDays(1).atHour(HORA_DIARIA);
  b.create();
}

/**
 * ⚠ O gatilho guarda a cadência de QUANDO FOI CRIADO — mudar a configuração não
 *   alcança um gatilho já instalado. Por isso trocar o intervalo o REFAZ na
 *   hora, em vez de pedir que a pessoa desligue e religue: quem esquecesse o
 *   segundo passo continuaria na cadência antiga achando que mudou.
 */
function definirIntervaloAgenda() {
  var ui = SpreadsheetApp.getUi();
  var atual = intervaloAtual_();
  var lista = INTERVALOS.map(function (it, i) {
    return '  ' + (i + 1) + ') ' + it.rotulo + (it.min === atual ? '   <= atual' : '');
  }).join('\n');

  var r = ui.prompt('Intervalo de atualização',
    'De quanto em quanto tempo a planilha deve se atualizar sozinha?\n\n' +
    lista + '\n\nDigite o número da opção:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;

  var n = parseInt(String(r.getResponseText()).trim(), 10);
  if (!(n >= 1 && n <= INTERVALOS.length)) {
    ui.alert('Opção inválida — digite um número de 1 a ' + INTERVALOS.length +
             '. Nada foi alterado.');
    return;
  }

  var escolhido = INTERVALOS[n - 1];
  PropertiesService.getScriptProperties()
    .setProperty('INTERVALO_MIN', String(escolhido.min));

  var t = gatilhoAgenda_();
  if (t) {
    ScriptApp.deleteTrigger(t);
    instalarGatilho_(escolhido.min);
  }
  ui.alert('Intervalo: ' + escolhido.rotulo + '.\n\n' + (t
    ? 'A rotina automática foi refeita e já roda nessa cadência.'
    : 'A rotina automática está desligada — use "Ativar rotina automática".'));
}

function ativarRotinaAgenda() {
  var min = intervaloAtual_();
  var antigo = gatilhoAgenda_();
  // Substitui em vez de recusar: assim "Ativar" sempre deixa o gatilho na
  // cadência configurada, mesmo que já houvesse um de antes.
  if (antigo) ScriptApp.deleteTrigger(antigo);
  instalarGatilho_(min);
  SpreadsheetApp.getUi().alert(
    'Rotina ativada: a importação roda sozinha a cada ' + rotuloIntervalo_(min) +
    '.' + (antigo ? '\n\n(O gatilho anterior foi substituído.)' : ''));
}

function desativarRotinaAgenda() {
  var t = gatilhoAgenda_();
  if (!t) {
    SpreadsheetApp.getUi().alert('A rotina automática já está desligada.');
    return;
  }
  ScriptApp.deleteTrigger(t);
  SpreadsheetApp.getUi().alert('Rotina automática desligada.');
}
