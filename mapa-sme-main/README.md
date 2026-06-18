# 📊 MAPA — Dashboard de Atribuições

Sistema de gerenciamento de atribuições de professores e avaliações pedagógicas da **SME Ribeirão Preto**.

Frontend estático (HTML + CSS + JavaScript modular) hospedado no **GitHub Pages**, consumindo dados do **Supabase** (PostgreSQL + REST API).

---

## 🗂️ Estrutura do Projeto

```
mapa-sme-main/
├── index.html                    # Página principal (estrutura HTML)
│
├── css/                          # Estilos modulares
│   ├── style.css                 # ← único importado; agrega os demais
│   ├── variables.css             # cores, fontes, sombras (tema)
│   ├── base.css                  # reset e base
│   ├── components.css            # botões, cards, navegação
│   ├── layout.css                # grid, abas, footer
│   ├── tables.css                # tabelas
│   ├── charts.css                # gráficos
│   └── responsive.css            # media queries (mobile/tablet)
│
├── js/                           # JavaScript modular
│   ├── config.js                 # ← credenciais e constantes (1 lugar só)
│   │
│   ├── api/                      # camada de dados (Supabase)
│   │   ├── supabase.js           # abstração REST + cache
│   │   ├── dashboard-api.js      # endpoints de Turmas
│   │   └── bimestre-api.js       # endpoints de Avaliações
│   │
│   ├── ui/                       # interface compartilhada
│   │   ├── common.js             # loading, badges, selects, relógio
│   │   └── tabs.js               # navegação entre abas
│   │
│   ├── modules/                  # funcionalidades (1 pasta por área)
│   │   ├── dashboard/            # aba Turmas (PPA)
│   │   │   ├── dashboard.js          # lógica + estado
│   │   │   ├── dashboard-render.js   # HTML
│   │   │   └── dashboard-events.js   # eventos
│   │   ├── avaliacoes/           # aba Avaliações (Bimestres)
│   │   │   ├── avaliacoes.js
│   │   │   ├── avaliacoes-render.js
│   │   │   ├── avaliacoes-events.js
│   │   │   └── charts.js             # gráficos Chart.js
│   │   └── rede/                 # aba Rede (estatísticas)
│   │       └── rede.js
│   │
│   ├── utils/                    # funções puras reutilizáveis
│   │   ├── format.js             # números, datas, textos
│   │   └── helpers.js            # debounce, cache, ordenação
│   │
│   └── main.js                   # ← inicialização (último a carregar)
│
├── sql/                          # scripts do Supabase
│   ├── 01_schema_bimestres.sql       # cria tabela + índices
│   └── 02_functions_bimestres.sql    # funções RPC
│
├── apps-script/                  # migração de dados
│   └── migrar_bimestres.gs           # Sheets → Supabase
│
└── docs/                         # documentação técnica
    └── ARQUITETURA.md
```

---

## 🚀 Como Rodar Localmente

Por usar caminhos relativos e `fetch`, abra com um servidor local (não direto pelo arquivo):

**VS Code (recomendado):**
1. Instale a extensão **Live Server**
2. Clique com o botão direito em `index.html` → **Open with Live Server**

**Ou via Python:**
```bash
cd mapa-sme-main
python -m http.server 8000
# acesse http://localhost:8000
```

---

## 🌐 Deploy (GitHub Pages)

```bash
git add .
git commit -m "Atualização do MAPA"
git push
```

Em **Settings → Pages**, selecione branch `main` e pasta `/ (root)`.
O site atualiza em 1–2 minutos.

---

## 🧩 Tecnologias

| Camada     | Tecnologia                    |
|------------|-------------------------------|
| Frontend   | HTML5, CSS3, JavaScript (ES6) |
| UI         | Bootstrap 5.3 + Bootstrap Icons |
| Gráficos   | Chart.js 4 + DataLabels       |
| Backend    | Supabase (PostgreSQL + REST)  |
| Hospedagem | GitHub Pages                  |

---

## 🔧 Configuração

Todas as credenciais ficam em **um único arquivo**: `js/config.js`.
Para trocar de ambiente (produção/teste), edite apenas as URLs e chaves lá.

---

## 📐 Princípios de Arquitetura

- **Modular:** cada arquivo tem uma responsabilidade clara.
- **Camadas separadas:** `api/` (dados) · `ui/` (interface) · `modules/` (negócio) · `utils/` (puras).
- **Padrão por módulo:** `*.js` (lógica) · `*-render.js` (HTML) · `*-events.js` (eventos).
- **Sem dependências circulares:** `main.js` carrega por último.
- **Cache:** respostas das funções RPC ficam em `localStorage` por 1 hora.

Para detalhes, veja [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

---

**Desenvolvido para a SME Ribeirão Preto**
