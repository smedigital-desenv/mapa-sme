# 📊 Módulo Relatórios — MAPA-SME

Sistema de relatórios pedagógicos com análise por Gemini AI integrado ao MAPA.

## 📁 Estrutura

```
apps-script/relatorios/
├── Code.gs                 # Backend atual (Google Apps Script + Planilhas)
├── visitas-sync.gs         # Rotina: sincroniza a planilha → Supabase (gatilho por tempo)
├── supabase-migracao.md    # Migração p/ Supabase: SQL (tabelas + RLS + RPCs) e passo a passo
└── README.md               # Este arquivo
```

## 🚚 Migração para o Supabase (em andamento)

O Google Forms segue ativo; a coleta continua no Google Sheets. A migração alinha o
módulo ao restante do MAPA (que já roda no Supabase):

- **`visitas-sync.gs`** — Apps Script agendado que leva as respostas do formulário
  (abas Fundamental/Infantil/…2) para a tabela `relatorios_visitas` no Supabase, de
  forma incremental e idempotente. É uma **rotina** (gatilho por tempo, 1x/hora).
- **`supabase-migracao.md`** — o SQL das tabelas (`relatorios_visitas`,
  `relatorios_devolutivas`), o RLS por escola (reaproveitando `minhas_permissoes()`),
  as RPCs de leitura, e o roteiro de cutover do front-end e da carga das devolutivas.

Ganho principal: o isolamento de dados por escola passa a ser **no servidor** (RLS),
em vez de filtragem no cliente como é hoje.

## 🔧 Instalação

### 1. Conectar ao Google Apps Script

```bash
npm install -g @google/clasp
clasp login
cd apps-script/relatorios
clasp create --type sheets --title "MAPA Relatórios"
```

### 2. Copiar `Code.gs` para o Apps Script

```bash
# O arquivo Code.gs será carregado automaticamente pelo clasp
clasp push
```

### 3. Deploy

```bash
clasp deploy
```

## 📌 Planilha Obrigatória

A planilha do Google Sheets deve ter as seguintes abas:

| Aba | Coluna A | Coluna B | Descrição |
|-----|----------|----------|-----------|
| **EMEF** | Nome da Escola | (ignorada) | Lista de escolas Fundamental |
| **EMEI** | Nome da Escola | (ignorada) | Lista de escolas Infantil |
| **Fundamental** | (dados de visita) | - | Visitas pedagógicas EMEF |
| **Infantil** | (dados de visita) | - | Visitas pedagógicas EMEI |
| **Fundamental2** | (dados de visita) | - | Visitas EMEF de diálogo/PPA/boas práticas (2º formulário) |
| **Infantil2** | (dados de visita) | - | Visitas EMEI de diálogo/boas práticas (2º formulário) |
| **Admin** | (vazio) | E-mail | Administradores (coluna B = emails) |
| **Devolutivas_Individual** | (automático) | - | Gerado automaticamente |
| **Devolutivas_Rede** | (automático) | - | Análises de rede (seleção manual), geradas automaticamente |
| **Devolutivas_Regional** | (automático) | - | Análises por regional, geradas automaticamente |
| **Sintese_Rede_Global** | (automático) | - | Síntese de rede a partir das análises regionais |

Em `Fundamental2`/`Infantil2` a escola visitada também fica na coluna F (índice 5, igual
às abas originais) — apenas as perguntas seguintes mudam. Como esses formulários não
perguntam a regional da escola, ela é resolvida em tempo de leitura a partir das
**respostas dos formulários base** (`Fundamental`/`Infantil`), onde a própria escola
marcou a regional no campo "Marque a Regional...". Esse é o mapa escola → regional
autoritativo; a coluna B das abas `EMEF`/`EMEI` **não** é usada para regional.

A regional de cada escola vive na tabela `relatorios.relatorios_escolas` (Supabase) e
pode ser **corrigida à mão** na aba Estatísticas do `relatorios.html` (super admin,
ícone de lápis na coluna Regional). Uma regional editada à mão é marcada como manual e o
sync deixa de sobrescrevê-la; as demais continuam sendo preenchidas automaticamente a
partir das respostas.

## 🎯 Funções Principais

### Frontend (`relatorios.html`)

- **Navegação por abas**: Fundamental, Infantil, Devolutivas, Estatísticas
- **Filtros**: Regional, Escola, Busca textual
- **Autenticação**: usa o login global do MAPA (`auth.js` / `window.MapaAuth`) — a
  página não tem login próprio. `isAdmin` = super admin do sistema (`perfil.is_super_admin`).
- **Disparo de análises por IA**:
  - **Individual**: botão "Gerar/Regerar devolutiva (IA)" no modal de cada visita.
  - **Em lote (individuais)**: marca várias visitas → "Gerar devolutivas (IA)" gera a
    devolutiva individual de cada uma, em sequência.
  - **Regional**: com uma Regional filtrada → "Análise da Regional (IA)" consolida a
    regional **juntando os dois formulários** (base + variante "2").
  - **Síntese de rede**: na aba Devolutivas → "Gerar síntese de rede (IA)" consolida as
    análises regionais já salvas do segmento.
- **Exibição** das devolutivas nos 4 formatos (individual / rede / regional / síntese global).
- **Impressão/PDF**: Exportar relatórios e devolutivas formatados.

> A comunicação com o Apps Script (`chamarAPI`) envia os parâmetros no **corpo** da
> requisição (`application/x-www-form-urlencoded`, sem preflight CORS), permitindo enviar
> uma visita inteira para análise sem estourar o limite de tamanho da URL.

### Backend (`Code.gs`)

```javascript
getDadosCompletos()                     // Retorna visitas (4 segmentos) + escolas + regionais
autenticarUsuario()                     // Verifica e-mail + admin
analisarVisitaComGemini(dados)          // Análise individual com IA — escolhe o roteiro de prompt
                                         // (pedagógico ou diálogo/PPA/boas práticas) pelo segmento
analisarRedeComGemini(payload)          // Análise de um conjunto de escolas (seleção manual)
analisarRegionalComGemini(payload)      // Análise de uma regional (regional vem do mapa escola→regional)
analisarRedeAPartirDeRegionaisComGemini(payload) // Síntese de rede a partir de análises regionais salvas
salvarDevolutiva(payload)               // Persiste devolutiva individual
salvarDevolutivaRede(payload)           // Persiste devolutiva de rede
salvarDevolutivaRegional(payload)       // Persiste devolutiva regional
salvarSinteseRedeGlobal(payload)        // Persiste síntese de rede global
lerDevolutivas()                        // Retorna todas as devolutivas salvas
excluirDevolutiva(id)                   // Remove devolutiva (qualquer tipo)
```

## 🔐 Autenticação

O módulo lê o e-mail do usuário logado no Google:
- **Logado** → `Session.getActiveUser().getEmail()`
- **Admin** → E-mail consta na aba `Admin`, coluna B

### Configurar Admins

Na aba `Admin` da planilha:
```
Coluna A    Coluna B
(vazio)     admin1@educacao.gov.br
(vazio)     admin2@educacao.gov.br
```

## 🤖 Integração Gemini

`analisarVisitaComGemini()` chama a API Gemini de fato via `_chamarGemini()`, com pool
de chaves, rotação por cota (429) e retry com backoff para erros 5xx.

1. Obtenha uma ou mais API keys no [Google AI Studio](https://aistudio.google.com).
2. Configure a propriedade de script `GEMINI_KEYS` (lista separada por vírgula, uma ou
   mais chaves) em **Configurações do projeto → Propriedades do script** no editor do
   Apps Script.

## 📋 Usar o Módulo

1. Abra o [MAPA](https://seu-dominio-github-pages) no navegador
2. Clique em **Relatórios** no menu
3. Selecione segmento (Fundamental/Infantil)
4. Filtre por Regional/Escola
5. Selecione visitas e clique **Analisar com IA** (admin)

## 🚀 Deploy no GitHub Pages

O arquivo `relatorios.html` é servido automaticamente via GitHub Pages:

```
mapa-sme/
├── index.html           # Dashboard principal
├── relatorios.html      # Novo módulo ✅
└── ...
```

Não precisa de build — é estático!

## 📝 Versionamento

- **Frontend**: `relatorios.html` (versionado no GitHub)
- **Backend**: `apps-script/relatorios/Code.gs` (versionado + `clasp push` para Apps Script)
- **Banco**: Google Sheets (não versionado, apenas estrutura documentada)

## 🔗 Links Úteis

- [MAPA Dashboard](https://smedigital.com.br/mapa-sme)
- [Google Apps Script Console](https://script.google.com)
- [Gemini API Docs](https://ai.google.dev)

---

**Desenvolvido para SME Ribeirão Preto**
