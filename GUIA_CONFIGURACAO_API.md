# 🔌 Guia de Configuração — API de Relatórios

## Objetivo
Acessar dados reais do Google Sheets via `smedigital.com.br/mapa-sme/relatorios.html` (GitHub Pages) em vez de via URL do Google Apps Script.

---

## 🚀 **Passo 1: Deploy do Code.gs com API**

### 1a. Copiar o novo Code.gs

O arquivo atualizado está em: [`apps-script/relatorios/Code.gs`](https://github.com/smedigital-desenv/mapa-sme/blob/develop/apps-script/relatorios/Code.gs)

Contém as funções:
- `doGet()` - Interface Web App (HTML)
- `doPost()` - API para chamadas externas (CORS habilitado)
- `doOptions()` - Handle CORS preflight

### 1b. No Google Apps Script

1. Vá para seu Apps Script
2. Selecione o arquivo `Code.gs`
3. **Delete** o conteúdo antigo
4. **Cole** o novo código
5. Clique em **Salvar**

---

## 🚀 **Passo 2: Fazer Deploy como API**

### 2a. Criar um novo deployment

1. Clique em **Deploy** (ou **Publicar**)
2. Selecione **"New deployment"** (ou **"Nova implantação"**)
3. Tipo: **"Web app"**
4. Configurar:
   - **Execute as:** Seu e-mail
   - **Who has access:** "Anyone" (qualquer pessoa)
5. Clique em **Deploy**

### 2b. Copiar a URL

Você receberá uma URL assim:

```
https://script.google.com/macros/s/{SCRIPT_ID}/usercontent/v1/exec
```

ou

```
https://script.google.com/macros/d/{DEPLOYMENT_ID}/usercontent/v1/exec
```

**COPIE ESTA URL** — você vai precisar dela!

---

## ⚙️ **Passo 3: Atualizar relatorios.html**

Abra o arquivo `relatorios.html` no repositório (ou use um editor de texto).

Procure por:
```javascript
const API_URL = 'https://script.google.com/macros/d/AKfycbydArqsFE8fCijWuc_st3Kd3jbQaUWRyEnQja-Nh2dOaKueuV_jX0iaDyToMKRXjKHO/usercontent/v1/execute';
```

Substitua pela URL que você copiou:
```javascript
const API_URL = 'https://script.google.com/macros/s/SEU_SCRIPT_ID_AQUI/usercontent/v1/exec';
```

**Salve o arquivo!**

---

## 🔄 **Passo 4: Fazer Push no GitHub**

```bash
git add relatorios.html
git commit -m "chore(relatorios): atualiza API_URL para seu Apps Script"
git push origin develop
```

GitHub Pages será atualizado em 1-2 minutos.

---

## ✅ **Passo 5: Testar**

### Modo 1: Via seu domínio (GitHub Pages)
```
https://seu-dominio.github.io/mapa-sme/relatorios.html
```
✅ Verá dados reais do Sheets

### Modo 2: Via URL do Apps Script (sem mudanças)
```
https://script.google.com/macros/s/{SCRIPT_ID}/usercontent/v1/exec
```
✅ Continua funcionando

---

## 🔐 **Segurança (CORS)**

O `doPost()` no `Code.gs` permite requisições de **qualquer origem**:

```javascript
.setHeader('Access-Control-Allow-Origin', '*')
```

Isso é seguro porque:
- ✅ Google Sheets já controla o acesso via e-mail do usuário
- ✅ Apenas dados de sua planilha são retornados
- ✅ Operações de escrita (`salvarDevolutiva`) validam admin
- ⚠️ Para produção, considere restringir a `Access-Control-Allow-Origin` a seu domínio

### Exemplo restritivo (opcional):
```javascript
.setHeader('Access-Control-Allow-Origin', 'https://seu-dominio.com.br')
```

---

## 🐛 **Troubleshooting**

### P: "Erro CORS"
**R:** Verifique se o `doOptions()` está no Code.gs e faça novo deploy.

### P: "Dados ainda aparecem de teste"
**R:** 
1. Verifique se `API_URL` está correto
2. Limpe cache do navegador (Ctrl+Shift+Delete)
3. Verifique console (F12) para mensagens de erro

### P: "401 Unauthorized"
**R:** Deploy do Apps Script precisa estar com "Anyone" nas permissões.

### P: "O Apps Script não encontra as abas"
**R:** Verifique se as abas existem: Fundamental, Infantil, EMEF, EMEI, Admin

---

## 📋 **Checklist Final**

- ✅ Code.gs atualizado no Apps Script?
- ✅ Novo deployment criado?
- ✅ URL do Apps Script copiada?
- ✅ API_URL atualizada em relatorios.html?
- ✅ Push feito no GitHub?
- ✅ Cache limpo no navegador?
- ✅ Testou via seu domínio?
- ✅ Dados reais aparecem?

---

## 📚 **Referências**

- [Google Apps Script - doPost](https://developers.google.com/apps-script/guides/web/basic)
- [Fetch API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
- [CORS - MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)

---

**Pronto!** Seu módulo de Relatórios agora acessará dados reais via seu domínio! 🎉
