# 🏛️ Arquitetura do MAPA

Documento técnico que explica como o sistema é organizado e como estender.

---

## Visão Geral

```
┌─────────────────────────────────────────────────────┐
│                    NAVEGADOR                         │
│                                                      │
│   index.html  →  carrega CSS e JS em ordem           │
│                                                      │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐         │
│   │ modules/ │ → │   ui/    │ → │  api/    │         │
│   │ (negócio)│   │(interface)│   │ (dados)  │         │
│   └──────────┘   └──────────┘   └─────┬────┘         │
│                                       │              │
└───────────────────────────────────────┼──────────────┘
                                        │ HTTPS (REST)
                                        ▼
                            ┌────────────────────┐
                            │     SUPABASE       │
                            │  PostgreSQL + RPC  │
                            └────────────────────┘
```

---

## Camadas

### 1. `config.js`
Único ponto com credenciais e constantes. Carregado **primeiro**.

### 2. `utils/` — Funções puras
- `format.js` — formatação de números, datas, textos.
- `helpers.js` — debounce, cache (localStorage), ordenação.

Não dependem de nada além de `config`. Podem ser testadas isoladamente.

### 3. `api/` — Acesso a dados
- `supabase.js` — abstração genérica. **Nenhum outro arquivo chama `fetch` ao Supabase diretamente.**
- `dashboard-api.js` — funções de Turmas.
- `bimestre-api.js` — funções de Avaliações.

Cada função retorna dados limpos ou `[]`/`{}` em caso de erro (nunca lança para a UI).

### 4. `ui/` — Interface compartilhada
- `common.js` — loading, badges, preenchimento de selects, relógio.
- `tabs.js` — troca de abas e sub-abas.

### 5. `modules/` — Funcionalidades
Cada área tem sua pasta. Padrão de 3 arquivos:

| Arquivo            | Responsabilidade                        |
|--------------------|-----------------------------------------|
| `nome.js`          | lógica, estado, orquestração            |
| `nome-render.js`   | gera HTML (recebe dados, devolve view)  |
| `nome-events.js`   | liga eventos do DOM às funções          |

### 6. `main.js`
Carregado por **último**. Inicializa relógio, registra eventos e carrega a aba inicial.

---

## Ordem de Carregamento (crítica)

```
config → utils → api → ui → modules → main
```

Cada camada só usa o que foi carregado antes. Se inverter a ordem, quebra.

---

## Fluxo de uma Ação (exemplo)

Usuário clica em **"Buscar"** na aba Avaliações:

```
1. onclick="Avaliacoes.buscar()"        [HTML]
2. Avaliacoes.buscar()                  [modules/avaliacoes/avaliacoes.js]
   ├─ lê filtros do DOM
   ├─ chama BimestreAPI.obterRegistros() [api/bimestre-api.js]
   │    └─ SupabaseAPI.rpc()             [api/supabase.js]
   │         └─ fetch → Supabase         [HTTPS]
   ├─ Charts.renderizarDisciplinas()     [modules/avaliacoes/charts.js]
   └─ AvaliacoesRender.atualizarTabela() [modules/avaliacoes/avaliacoes-render.js]
```

---

## Cache

`api/supabase.js` guarda as respostas RPC em `localStorage` por 1 hora
(configurável em `config.js → cache.ttl`).

Para limpar manualmente no console do navegador:
```js
Helpers.Cache.clear();
```

---

## Como Adicionar uma Nova Aba

Exemplo: aba **"Relatórios"**.

1. **HTML** — adicione o botão e a seção em `index.html`:
   ```html
   <button class="nav-link" id="navRelatorios" onclick="Tabs.switchTab('relatorios')">Relatórios</button>
   ...
   <section id="tabRelatorios" class="tab-content d-none"> ... </section>
   ```

2. **Módulo** — crie `js/modules/relatorios/relatorios.js`:
   ```js
   const Relatorios = (() => {
     async function carregar() { /* ... */ }
     return { carregar };
   })();
   window.Relatorios = Relatorios;
   ```

3. **Registrar no Tabs** — em `ui/tabs.js`, adicione no `onTabChange`:
   ```js
   case 'relatorios':
     if (window.Relatorios) Relatorios.carregar();
     break;
   ```

4. **Carregar o script** — em `index.html`:
   ```html
   <script src="js/modules/relatorios/relatorios.js"></script>
   ```

Nenhum arquivo existente precisa ser reescrito. ✅

---

## Como Adicionar uma Nova Função de Dados

1. Crie a função RPC no Supabase (`sql/`).
2. Adicione o método na API correspondente (`api/*.js`):
   ```js
   async function novaConsulta(param) {
     return await SupabaseAPI.rpc('nome_da_funcao', { p_param: param });
   }
   ```
3. Use no módulo. Pronto.

---

## Convenções

- **Nomes:** funções e variáveis em português; código em camelCase.
- **Módulos:** padrão IIFE (`const X = (() => { ... })()`) exposto em `window.X`.
- **Erros:** logados no console; a UI mostra mensagem amigável.
- **Sem framework:** JavaScript puro, sem build. Edição direta.
