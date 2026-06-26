# 🔒 Modo Demonstração — gravar tutoriais sem expor dados (LGPD)

O **Modo Demonstração** permite gravar vídeos/treinamentos do MAPA **sem exibir
dados pessoais reais** de alunos, professores e escolas. Os dados continuam
vindo do Supabase normalmente, mas são **pseudonimizados na hora** (antes de
chegarem à tela e ao cache), por uma camada implementada em `demo-mode.js`.

> Base legal: a LGPD protege dados pessoais e dá **proteção reforçada a dados de
> crianças e adolescentes** (art. 14). Pseudonimizar antes de gravar evita a
> exposição/tratamento indevido desses dados em material de divulgação.

## Como ativar

### 1. Botão na interface (recomendado)

Em **todas** as páginas há um botão flutuante discreto no **canto inferior
esquerdo**:

- **Desligado:** botão acinzentado e translúcido **"🛡️ Modo demonstração"**
  (fica mais visível ao passar o mouse).
- Clique nele para **ligar** — a página recarrega já com os dados fictícios.
- **Ligado:** botão vermelho **"🔒 Demonstração ON"**. Clique de novo para
  **voltar aos dados reais**.

Assim você liga/desliga a anonimização a qualquer momento, sem digitar nada.

### 2. Pela URL (alternativa)

Também dá para acionar acrescentando `?demo=1` na URL de qualquer página
(ex.: `avaliacao.html?demo=1`); para desligar, `?demo=0`.

> Observações:
> - Uma vez ativado, o modo **permanece ligado ao navegar entre as páginas**
>   (na mesma aba do navegador).
> - Em modo demo, além do botão vermelho, aparece um selo central
>   **"DADOS FICTÍCIOS — MODO DEMONSTRAÇÃO"** e uma marca d'água discreta ao fundo.

## O que é pseudonimizado

| Dado | Antes (real) | Depois (fictício, consistente) |
|------|--------------|-------------------------------|
| Nome do aluno | Maria da Silva | Olívia Vieira Mendes |
| RA do aluno | 123456789 | 20249352772 |
| Nome do professor (titular/substituto) | Ana Santos | Gustavo Monteiro Teixeira |
| Código funcional do professor | 778899 | 644244 |
| Nome da escola/unidade | EMEF Centro | EMEF Almeida Moreira |
| E-mail (usuários/configuração) | diretor@pmrp… | usuario549@escola.exemplo |

- **Consistência**: o mesmo aluno/professor/escola vira **sempre** o mesmo nome
  fictício em todas as telas e abas — os gráficos e tabelas continuam coerentes.
- Cobre respostas REST e RPC, **inclusive as tabelas posicionais da Educação
  Especial** (AEE, Liminares, Apoio).
- Notas, conceitos, percentuais e demais números **não** são alterados (o painel
  continua realista).

## Segurança extra durante a demonstração

- **Gravações bloqueadas (padrão):** cliques em "salvar / atribuir / criar" **não
  alteram o banco real** — o sistema devolve um "sucesso" fictício, então o fluxo
  do vídeo fica natural sem persistir nada.
  - Para permitir gravações reais durante o demo: `?demo=1&writes=allow`.
- **Cache:** ao entrar/sair do modo demo, o cache local (`MAPA_CACHE_*`) é
  limpo, para não vazar dado real cacheado nem contaminar o ambiente normal.

### Opções da URL

| Parâmetro | Efeito |
|-----------|--------|
| `?demo=1` | Liga o modo demonstração |
| `?demo=0` | Desliga |
| `&writes=allow` | Permite gravações no Supabase (padrão: bloqueado) |
| `&mark=off` | Remove a marca d'água de fundo (mantém o selo) |

## ⚠️ Importante para a gravação

A pseudonimização protege o que aparece **na interface**. Durante a gravação:

- **Não** abra "Ver código-fonte" / **DevTools** (F12): a chave do Supabase e a
  lista de e-mails de acesso ficam no código das páginas.
- **Não** mostre a tela de login (`login.html`) com e-mails reais digitados.
- Prefira **tela cheia** do navegador, sem barra de favoritos/histórico que possa
  conter nomes reais.
- Confira que o selo vermelho **"DADOS FICTÍCIOS"** está visível antes de gravar.

## Checklist rápido antes de gravar

1. Abrir a página com `?demo=1`.
2. Confirmar o selo vermelho **"DADOS FICTÍCIOS — MODO DEMONSTRAÇÃO"**.
3. Navegar pelas abas e conferir que nomes/escolas estão fictícios.
4. Manter DevTools fechado e navegador em tela cheia.
5. Gravar. Ao terminar, abrir `?demo=0` para voltar ao normal.
