# 📊 Módulo Relatórios — MAPA-SME

Sistema de relatórios pedagógicos com análise por Gemini AI integrado ao MAPA.

## 📁 Estrutura

```
apps-script/relatorios/
├── Code.gs              # Backend (Google Apps Script)
├── README.md            # Este arquivo
└── sql/                 # Scripts SQL (quando usar DB externo)
```

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
| **EMEF** | Nome da Escola | Regional | Cadastro de escolas Fundamental |
| **EMEI** | Nome da Escola | Regional | Cadastro de escolas Infantil |
| **Fundamental** | (dados de visita) | - | Visitas pedagógicas EMEF |
| **Infantil** | (dados de visita) | - | Visitas pedagógicas EMEI |
| **Admin** | (vazio) | E-mail | Administradores (coluna B = emails) |
| **Devolutivas_Individual** | (automático) | - | Gerado automaticamente |

## 🎯 Funções Principais

### Frontend (`relatorios.html`)

- **Navegação por abas**: Fundamental, Infantil, Devolutivas
- **Filtros**: Regional, Escola, Busca textual
- **Análise em Lote**: Selecionar múltiplas visitas para análise com IA
- **Impressão/PDF**: Exportar relatórios formatados

### Backend (`Code.gs`)

```javascript
getDadosCompletos()          // Retorna visitas + escolas + regionais
autenticarUsuario()          // Verifica e-mail + admin
analisarVisitaComGemini()    // Análise individual com IA (TODO)
salvarDevolutiva()           // Persiste resultado da análise
lerDevolutivas()             // Retorna análises salvas
excluirDevolutiva(id)        // Remove análise
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

## 🤖 Integração Gemini (TODO)

Atualmente, `analisarVisitaComGemini()` retorna dados de exemplo. Para ativar:

1. Obter API key do [Google AI Studio](https://aistudio.google.com)
2. Adicionar função `_chamarGemini()` em `Code.gs`:

```javascript
function _chamarGemini(prompt) {
  const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + apiKey;
  
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 3000 }
    }),
    muteHttpExceptions: true
  });

  const result = JSON.parse(response.getContentText());
  return JSON.parse(result.candidates[0].content.parts[0].text);
}
```

3. Adicionar a chave no Apps Script:
```bash
clasp run setGeminiKey -- "sk_xxx..."
```

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

- [MAPA Dashboard](https://smedigital-desenv.github.io/mapa-sme)
- [Google Apps Script Console](https://script.google.com)
- [Gemini API Docs](https://ai.google.dev)

---

**Desenvolvido para SME Ribeirão Preto**
