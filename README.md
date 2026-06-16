# 📊 MAPA - Dashboard de Atribuições

Sistema de Gerenciamento de Atribuições de Professores para SME Ribeirão Preto

## ✨ Características

- 📱 **Responsivo**: Funciona em desktop, tablet e mobile
- 🚀 **Rápido**: Conecta diretamente ao Supabase
- 🎨 **Bonito**: Interface moderna e intuitiva
- 📊 **Dados em Tempo Real**: Atualiza dados do Supabase
- 🔍 **Filtros**: Filtrar por unidade escolar
- 📈 **Resumo Geral**: Estatísticas de atribuição

## 🛠️ Tecnologias

- **Frontend**: HTML5 + CSS3 + JavaScript Vanilla
- **Backend**: Supabase (PostgreSQL + REST API)
- **Hosting**: GitHub Pages
- **Versionamento**: Git

## 📂 Estrutura

```
mapa-dashboard/
├── index.html          # Página principal
├── css/
│   └── style.css       # Estilos
├── js/
│   └── app.js          # Lógica JavaScript
└── README.md           # Este arquivo
```

## 🚀 Como Usar

### Localmente (com Live Server)

1. **Instale a extensão Live Server** no VS Code
2. **Abra o arquivo `index.html`**
3. **Clique em "Go Live"** (VS Code)

Ou simplesmente abra `index.html` no navegador.

### Online (GitHub Pages)

Acesse: `https://seu-usuario.github.io/mapa-dashboard`

## 🔧 Configuração Supabase

As credenciais estão em `js/app.js`:

```javascript
const SUPABASE_URL = 'https://gmwotfulohkmuqrezeef.supabase.co';
const SUPABASE_ANON_KEY = '...';
```

## 📊 Funcionalidades

### Dashboard
- ✅ Lista de todas as unidades
- ✅ Distribuição por período (M, T, N)
- ✅ Carga total, atribuída e não atribuída
- ✅ Percentual de atribuição
- ✅ Contagem de turmas

### Filtros
- 🔍 Filtrar por unidade específica
- 🔄 Botão para atualizar dados

### Resumo
- 📈 Total de turmas
- 📊 Carga total em horas
- ✅ Carga atribuída
- ❌ Carga não atribuída
- 📍 Percentual geral

## 🎯 Próximos Passos

- [ ] Aba de Bimestres
- [ ] Aba de Total
- [ ] Gráficos
- [ ] Modo escuro
- [ ] Exportar para Excel

## 🐛 Troubleshooting

**Dados não carregam?**
- Abra o Console (F12)
- Verifique se há erros de conexão
- Confirme que os dados existem no Supabase

**CSS/JS não carregam?**
- Verifique os caminhos dos arquivos
- Limpe o cache do navegador (Ctrl+Shift+Delete)

**GitHub Pages mostra 404?**
- Espere 2-3 minutos após fazer push
- Verifique se Settings > Pages está configurado

## 📝 Licença

MIT

## 👥 Autor

Desenvolvido para SME Ribeirão Preto

---

**Última atualização**: 2026-06-16
