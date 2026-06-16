/**
 * ============================================================
 * MAPA DASHBOARD - Supabase Integration
 * ============================================================
 */

// Configuração Supabase
const SUPABASE_URL = 'https://gmwotfulohkmuqrezeef.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdtd290ZnVsb2hrbXVxcmV6ZWVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MTQxODYsImV4cCI6MjA5NzA5MDE4Nn0.6qjrT9Nux_0_Z5oH9ndpcCcJxzfO59VuXjhggVXSOFk';

// Elementos DOM
const unidadeSelect = document.getElementById('unidadeSelect');
const btnRefresh = document.getElementById('btnRefresh');
const loading = document.getElementById('loading');
const error = document.getElementById('error');
const tableBody = document.getElementById('tableBody');
const lastUpdate = document.getElementById('lastUpdate');

// Dados em cache
let dadosOriginais = [];
let unidadesDisponiveis = new Set();

// ──────────────────────────────────────────────────────────
// FUNÇÃO: Obter dados do Supabase
// ──────────────────────────────────────────────────────────

async function obterDadosDashboard(nomeUnidade = null) {
    try {
        exibirLoading(true);
        esconderErro();

        const response = await fetch(
            `${SUPABASE_URL}/rest/v1/rpc/obter_dashboard_turmas`,
            {
                method: 'POST',
                headers: {
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    p_nome_unidade: nomeUnidade ? `${nomeUnidade}%` : null
                })
            }
        );

        if (!response.ok) {
            throw new Error(`Erro ${response.status}: ${response.statusText}`);
        }

        const dados = await response.json();
        console.log('✅ Dados obtidos:', dados);
        
        exibirLoading(false);
        return dados;

    } catch (erro) {
        console.error('❌ Erro ao obter dados:', erro);
        exibirLoading(false);
        exibirErro(`Erro ao conectar ao Supabase: ${erro.message}`);
        return [];
    }
}

// ──────────────────────────────────────────────────────────
// FUNÇÃO: Renderizar tabela
// ──────────────────────────────────────────────────────────

function renderizarTabela(dados) {
    if (!dados || dados.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="9" class="text-center">Nenhum dado encontrado</td></tr>';
        atualizarResumo([]);
        return;
    }

    // Ordena dados por unidade e período
    dados.sort((a, b) => {
        if (a.nome_unidade !== b.nome_unidade) {
            return a.nome_unidade.localeCompare(b.nome_unidade);
        }
        return (a.periodo || '').localeCompare(b.periodo || '');
    });

    // Renderizar linhas
    tableBody.innerHTML = dados.map(linha => `
        <tr>
            <td><strong>${linha.nome_unidade}</strong></td>
            <td>${linha.periodo || 'TODOS'}</td>
            <td>${linha.total_turmas}</td>
            <td>${parseFloat(linha.carga_total).toFixed(2)}</td>
            <td style="color: #4caf50; font-weight: 600;">${parseFloat(linha.carga_atribuida).toFixed(2)}</td>
            <td style="color: #f44336; font-weight: 600;">${parseFloat(linha.carga_nao_atribuida).toFixed(2)}</td>
            <td>
                <span style="background: ${getCorPercentual(linha.percentual_atribuido)}; 
                             padding: 4px 8px; 
                             border-radius: 4px; 
                             color: white; 
                             font-weight: 600;">
                    ${parseFloat(linha.percentual_atribuido).toFixed(2)}%
                </span>
            </td>
            <td style="text-align: center;">${linha.turmas_atribuidas}</td>
            <td style="text-align: center;">${linha.turmas_nao_atribuidas}</td>
        </tr>
    `).join('');

    // Atualizar resumo
    atualizarResumo(dados);

    // Atualizar timestamp
    const agora = new Date();
    lastUpdate.textContent = agora.toLocaleTimeString('pt-BR');
}

// ──────────────────────────────────────────────────────────
// FUNÇÃO: Cor do percentual
// ──────────────────────────────────────────────────────────

function getCorPercentual(percentual) {
    const p = parseFloat(percentual);
    if (p >= 95) return '#4caf50'; // Verde
    if (p >= 80) return '#8bc34a'; // Verde claro
    if (p >= 60) return '#ff9800'; // Laranja
    return '#f44336'; // Vermelho
}

// ──────────────────────────────────────────────────────────
// FUNÇÃO: Atualizar resumo geral
// ──────────────────────────────────────────────────────────

function atualizarResumo(dados) {
    if (!dados || dados.length === 0) {
        document.getElementById('totalTurmas').textContent = '0';
        document.getElementById('cargaTotal').textContent = '0';
        document.getElementById('cargaAtribuida').textContent = '0';
        document.getElementById('cargaNaoAtribuida').textContent = '0';
        document.getElementById('percentualGeral').textContent = '0%';
        return;
    }

    const totalTurmas = dados.reduce((sum, d) => sum + d.total_turmas, 0);
    const cargaTotal = dados.reduce((sum, d) => sum + parseFloat(d.carga_total), 0);
    const cargaAtribuida = dados.reduce((sum, d) => sum + parseFloat(d.carga_atribuida), 0);
    const cargaNaoAtribuida = cargaTotal - cargaAtribuida;
    const percentual = cargaTotal > 0 ? ((cargaAtribuida / cargaTotal) * 100) : 0;

    document.getElementById('totalTurmas').textContent = totalTurmas.toLocaleString('pt-BR');
    document.getElementById('cargaTotal').textContent = cargaTotal.toFixed(2);
    document.getElementById('cargaAtribuida').textContent = cargaAtribuida.toFixed(2);
    document.getElementById('cargaNaoAtribuida').textContent = cargaNaoAtribuida.toFixed(2);
    document.getElementById('percentualGeral').textContent = percentual.toFixed(2) + '%';
}

// ──────────────────────────────────────────────────────────
// FUNÇÃO: Preencher select de unidades
// ──────────────────────────────────────────────────────────

function preencherSelectUnidades(dados) {
    unidadesDisponiveis.clear();
    
    dados.forEach(linha => {
        unidadesDisponiveis.add(linha.nome_unidade);
    });

    const unidadesOrdenadas = Array.from(unidadesDisponiveis).sort();
    
    // Limpar opções anteriores (mantém apenas "Todas")
    while (unidadeSelect.options.length > 1) {
        unidadeSelect.remove(1);
    }

    // Adicionar novas opções
    unidadesOrdenadas.forEach(unidade => {
        const option = document.createElement('option');
        option.value = unidade;
        option.textContent = unidade;
        unidadeSelect.appendChild(option);
    });
}

// ──────────────────────────────────────────────────────────
// FUNÇÃO: UI - Exibir/Esconder Loading
// ──────────────────────────────────────────────────────────

function exibirLoading(mostrar) {
    loading.style.display = mostrar ? 'block' : 'none';
}

function exibirErro(mensagem) {
    error.style.display = 'block';
    error.textContent = '❌ ' + mensagem;
}

function esconderErro() {
    error.style.display = 'none';
}

// ──────────────────────────────────────────────────────────
// EVENTOS
// ──────────────────────────────────────────────────────────

btnRefresh.addEventListener('click', async () => {
    const unidadeSelecionada = unidadeSelect.value;
    const dados = await obterDadosDashboard(unidadeSelecionada || null);
    renderizarTabela(dados);
});

unidadeSelect.addEventListener('change', async () => {
    const unidadeSelecionada = unidadeSelect.value;
    const dados = await obterDadosDashboard(unidadeSelecionada || null);
    renderizarTabela(dados);
});

// ──────────────────────────────────────────────────────────
// INICIALIZAÇÃO
// ──────────────────────────────────────────────────────────

async function inicializar() {
    console.log('🚀 Inicializando Dashboard...');
    
    // Carregar dados
    dadosOriginais = await obterDadosDashboard();
    
    if (dadosOriginais.length > 0) {
        // Preencher select
        preencherSelectUnidades(dadosOriginais);
        
        // Renderizar tabela
        renderizarTabela(dadosOriginais);
        
        console.log('✅ Dashboard carregado com sucesso!');
    } else {
        console.warn('⚠️ Nenhum dado foi carregado');
    }
}

// Iniciar quando página carregar
document.addEventListener('DOMContentLoaded', inicializar);
