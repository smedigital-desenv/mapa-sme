/**
 * ============================================================
 * FASE 2: MIGRAR BIMESTRES DO GOOGLE SHEETS PARA SUPABASE
 * ============================================================
 * 
 * Este script lê a aba "Primeiro_Bimestre" e migra para Supabase
 * Total: 269.701 registros
 * 
 * INSTRUÇÕES:
 * 1. Abra Apps Script do Google Sheets
 * 2. Cole este código
 * 3. Execute: executarMigracaoBimestres()
 * 4. Acompanhe o progresso no console
 */

// ──────────────────────────────────────────────────────────
// CONFIGURAÇÃO SUPABASE
// ──────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://gmwotfulohkmuqrezeef.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdtd290ZnVsb2hrbXVxcmV6ZWVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MTQxODYsImV4cCI6MjA5NzA5MDE4Nn0.6qjrT9Nux_0_Z5oH9ndpcCcJxzfO59VuXjhggVXSOFk';

// ──────────────────────────────────────────────────────────
// FUNÇÃO: Obter unidade_id baseado no nome
// ──────────────────────────────────────────────────────────

function obterUnidadeId(nomeUnidade) {
  const url = `${SUPABASE_URL}/rest/v1/unidades?select=id&nome_escola=eq.${encodeURIComponent(nomeUnidade)}`;
  
  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    const data = JSON.parse(response.getContentText());
    return data.length > 0 ? data[0].id : null;
  } catch (e) {
    console.error(`Erro ao buscar unidade "${nomeUnidade}":`, e.toString());
    return null;
  }
}

// ──────────────────────────────────────────────────────────
// FUNÇÃO: Migrar lote de registros
// ──────────────────────────────────────────────────────────

function migrarLoteBimestres(registros, numerolote) {
  const url = `${SUPABASE_URL}/rest/v1/bimestres`;
  
  const payload = registros.map(row => ({
    unidade_id: obterUnidadeId(row[0]),
    nome_unidade: row[0],
    avaliacao: row[1],
    ano_escolar: row[2],
    bimestre: parseInt(row[3]) || 0,
    turma: row[4],
    rema_aluno: row[5],
    nome_aluno: row[6],
    fnc_disciplina: row[7],
    descricao_fne: row[8],
    fqs: row[9],
    codigo_resposta: row[10],
    texto_resposta: row[11],
    valor_resposta: row[12]
  }));

  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const status = response.getResponseCode();
    
    if (status === 201 || status === 200) {
      console.log(`✅ Lote ${numerolote}: ${registros.length} registros inseridos`);
      return { sucesso: true, contagem: registros.length, lote: numerolote };
    } else {
      const erro = response.getContentText();
      console.error(`❌ Erro no lote ${numerolote}: ${erro}`);
      return { sucesso: false, contagem: 0, lote: numerolote, erro: erro };
    }
  } catch (e) {
    console.error(`❌ Exceção no lote ${numerolote}:`, e.toString());
    return { sucesso: false, contagem: 0, lote: numerolote, erro: e.toString() };
  }
}

// ──────────────────────────────────────────────────────────
// FUNÇÃO PRINCIPAL: Executar migração completa
// ──────────────────────────────────────────────────────────

function executarMigracaoBimestres() {
  console.log('🚀 Iniciando migração de Bimestres...\n');
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const aba = ss.getSheetByName('Primeiro_Bimestre'); // AJUSTE O NOME DA ABA SE NECESSÁRIO
  
  if (!aba) {
    console.error('❌ Aba "Primeiro_Bimestre" não encontrada!');
    return;
  }

  const dados = aba.getDataRange().getValues();
  const totalLinhas = dados.length - 1; // Menos header
  
  console.log(`📊 Total de registros: ${totalLinhas}`);
  console.log(`⏱️  Iniciando leitura...\n`);

  const TAMANHO_LOTE = 100; // 100 registros por lote
  let totalInserido = 0;
  let totalErros = 0;
  const resultados = [];

  // Iterar em lotes
  for (let i = 1; i < dados.length; i += TAMANHO_LOTE) {
    const fim = Math.min(i + TAMANHO_LOTE, dados.length);
    const lote = dados.slice(i, fim);
    const numeroLote = Math.floor(i / TAMANHO_LOTE) + 1;

    const resultado = migrarLoteBimestres(lote, numeroLote);
    resultados.push(resultado);
    
    if (resultado.sucesso) {
      totalInserido += resultado.contagem;
    } else {
      totalErros++;
    }

    // Log de progresso a cada 10 lotes
    if (numeroLote % 10 === 0) {
      console.log(`📈 Progresso: ${Math.min(i + TAMANHO_LOTE, dados.length)}/${dados.length}`);
    }

    // Pause para não sobrecarregar (Google Apps Script)
    Utilities.sleep(500);
  }

  // ─────────────────────────────────────────────────────────
  // RESUMO FINAL
  // ─────────────────────────────────────────────────────────

  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║              RESUMO DA MIGRAÇÃO                       ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  console.log(`✅ Registros inseridos: ${totalInserido}`);
  console.log(`❌ Lotes com erro: ${totalErros}`);
  console.log(`📊 Taxa de sucesso: ${((totalInserido / totalLinhas) * 100).toFixed(2)}%`);
  console.log(`\n🔗 Acesse Supabase em: ${SUPABASE_URL}`);
  
  // Salvar relatório em cache (opcional)
  PropertiesService.getScriptProperties().setProperty('ultimaMigracao', JSON.stringify({
    data: new Date().toLocaleString('pt-BR'),
    totalInserido: totalInserido,
    totalErros: totalErros,
    status: totalErros === 0 ? 'SUCESSO' : 'PARCIAL'
  }));
}

// ──────────────────────────────────────────────────────────
// FUNÇÃO: Testar conexão com Supabase
// ──────────────────────────────────────────────────────────

function testarConexaoBimestres() {
  console.log('🔗 Testando conexão com Supabase...\n');
  
  try {
    const response = UrlFetchApp.fetch(`${SUPABASE_URL}/rest/v1/bimestres?limit=1`, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const status = response.getResponseCode();
    
    if (status === 200) {
      console.log('✅ Conexão bem-sucedida!');
      console.log(`📊 Tabela de bimestres acessível`);
      return true;
    } else {
      console.error(`❌ Erro ${status}: ${response.getContentText()}`);
      return false;
    }
  } catch (e) {
    console.error('❌ Erro de conexão:', e.toString());
    return false;
  }
}

// ──────────────────────────────────────────────────────────
// FUNÇÃO: Verificar status da migração
// ──────────────────────────────────────────────────────────

function verificarStatusMigracao() {
  console.log('📊 Verificando status...\n');
  
  try {
    const response = UrlFetchApp.fetch(
      `${SUPABASE_URL}/rest/v1/bimestres?select=count()`,
      {
        method: 'GET',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'count=exact'
        }
      }
    );

    const count = response.getHeaders()['content-range']?.split('/')[1] || 'desconhecido';
    console.log(`✅ Total de registros em bimestres: ${count}`);
    
  } catch (e) {
    console.error('❌ Erro ao verificar status:', e.toString());
  }
}

/**
 * ══════════════════════════════════════════════════════════
 * INSTRUÇÕES DE USO
 * ══════════════════════════════════════════════════════════
 * 
 * 1. TESTE A CONEXÃO:
 *    - Execute: testarConexaoBimestres()
 *    - Deve retornar: ✅ Conexão bem-sucedida!
 * 
 * 2. INICIE A MIGRAÇÃO:
 *    - Execute: executarMigracaoBimestres()
 *    - Acompanhe o progresso no console
 *    - Leva ~15-20 minutos para 269.701 registros
 * 
 * 3. VERIFIQUE O RESULTADO:
 *    - Execute: verificarStatusMigracao()
 *    - Deve mostrar: Total de registros em bimestres: 269701
 * 
 * ══════════════════════════════════════════════════════════
 */
