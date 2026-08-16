# MAPA — SME Ribeirão Preto

> **Este arquivo é lido automaticamente por qualquer sessão do Claude Code neste
> repositório.** Ele existe para que qualquer pessoa ou IA que chegue aqui
> entenda o sistema antes de mexer — e, principalmente, para que ninguém
> "conserte" de volta uma proteção que foi colocada de propósito.
>
> **REGRA DE MANUTENÇÃO:** ao alterar arquitetura, modelo de acesso, fluxo de
> autenticação ou processo de publicação, **atualize este arquivo no mesmo
> commit**. Não espere que peçam. Um documento desatualizado é pior que nenhum,
> porque induz ao erro com aparência de autoridade.

---

## 1. O que é

Sistema de monitoramento de aprendizagem e acompanhamento dos projetos
alfabetizadores da rede municipal de Ribeirão Preto. Serve ~112 unidades
(EMEF, EMEI, CEI).

⚠️ **Este repositório é público e o sistema trata dados pessoais de crianças,
alguns de natureza sensível.** Nada que identifique aluno, nenhuma credencial e
nenhum detalhe de fragilidade operacional deve entrar aqui — nem em código, nem
em comentário, nem neste arquivo.

Site estático (HTML/JS puro, sem framework nem build) publicado no GitHub Pages
sob `smedigital.com.br/mapa-sme/`. Os dados ficam num projeto Supabase próprio.

**Telas:** Avaliações (Diagnóstica, 1º a 4º Bimestre, Total, Análise de
Consistência), Atribuição, Retrato Quantitativo de Atribuições, Análise de
Jornada, Educação Especial, Gerência de Liminares, Frequência × Distância,
Fluência Leitora, Elefante Letrado, Boletim da Escola, Relatórios,
Relatório Executivo.

---

## 2. Arquitetura de acesso

O MAPA **não tem login próprio**. A autenticação da rede acontece no
**Controle de Acesso CENTRAL**, um projeto Supabase separado, servido em
`smedigital.com.br/central/`. Ele governa quem entra e em quais telas.

O problema estrutural: são **dois projetos Supabase distintos**. Um token
emitido pelo central não é reconhecido pelo projeto do MAPA. E o painel do
Supabase só oferece Third-Party Auth com Firebase, Clerk, WorkOS, Auth0 e
Cognito — não há opção de JWKS customizado que permitiria o MAPA confiar
diretamente no central.

A solução é a Edge Function **`central-bridge`**, no projeto do MAPA:

```
navegador loga no CENTRAL
   → auth.js manda o token do central para central-bridge
      → a função valida a ASSINATURA ES256 contra o JWKS público do central
      → a função pergunta AO CENTRAL se a pessoa tem o sistema 'mapa' liberado
      → a função abre uma sessão do projeto MAPA e devolve os tokens
   → auth.js instala a sessão com setSession()
```

A partir daí `auth.uid()` existe no banco do MAPA e as policies funcionam.
**Uma chamada por sessão**, não por consulta.

### Pontos não óbvios do fluxo

- **A função é publicada com "Verify JWT" DESLIGADO.** O token que chega é de
  outro projeto; a verificação embutida o rejeitaria antes da função rodar. A
  validação é feita por dentro, e é por isso que ela é feita **três vezes**
  (assinatura, permissão no central, e conferência de que os e-mails batem).
- **A checagem de permissão é refeita no servidor** de propósito. O gate do
  navegador é conforto, não segurança: qualquer pessoa pode chamar a função
  direto.
- **A sessão é aberta por grant de senha**, não por magic link. A função define
  uma senha aleatória, obtém a sessão e devolve. A senha nunca sai da função,
  nunca vai para o navegador e é trocada a cada acesso. Isso não é gambiarra:
  o fluxo de OTP/magic link responde `otp_expired` mesmo gerando e verificando
  no mesmo milissegundo, e além disso é vulnerável a chamadas concorrentes.
- **`auth.js` espera o fim do prerender.** O `index.html` usa Speculation Rules
  para pré-renderizar outra página. A aba invisível executa o JavaScript e
  disputava a abertura de sessão com a aba visível. Enquanto
  `document.prerendering` for verdadeiro, a execução aguarda.
- **`auth.js` intercepta `window.fetch`** para o caminho `/rest/v1/` do MAPA e
  assina com a sessão do projeto. Isso cobre de uma vez as páginas que montam
  requisição na mão. `/auth/v1/` e `/functions/v1/` ficam **fora** do
  interceptador: é por eles que a sessão nasce, e interceptá-los causa impasse.
- **Simulação ("Ver como") troca a identidade NO BANCO.** Um super admin pode
  abrir o sistema como outra pessoa; a ponte emite a sessão dela. É
  personificação real, restrita a super admin do central e registrada no log da
  função. Sem isso não há como testar o isolamento, já que ele vive no Postgres.

### Integração CODERP — Edge Function `coderp-ficha`

A API **ObterFichaAvaliacao** do CODERP (Ficha de Acompanhamento e Avaliação
Bimestral) é consumida **ao vivo** — por decisão de projeto, **nada do que ela
devolve é gravado no banco do MAPA**. A API existe justamente para não inflar o
consumo da instância; não reverta isso criando tabela de cache/carga.

O acesso passa pela Edge Function **`coderp-ficha`** (projeto do MAPA), porque
o token da API do CODERP é credencial: vive no secret `CODERP_TOKEN` da função
e **nunca vai para o navegador nem para este repositório**. A função:

1. exige sessão válida **deste** projeto (deploy com Verify JWT **LIGADO** —
   ao contrário da `central-bridge`);
2. refaz no banco, com a identidade de quem chamou, a checagem
   `vejo_a_rede_toda()` — por ora **todos os níveis** (rede, escola, turma,
   aluno) exigem visão de rede. Abrir o recorte por unidade exige antes mapear
   o código CODERP (`uni_cod`) para o catálogo `escolas`;
3. injeta o token e repassa a consulta (níveis: `/IndicadorRede`, `/IndicadorEscola`,
   `/IndicadorTurma`, `/IndicadorAluno`), devolvendo a resposta como veio;
4. mantém **cache em memória de 10 min** (gzip; inclui o nível aluno) — a
   permissão é checada por requisição ANTES do cache, que guarda só a
   resposta do CODERP. O `auth.js` **pré-aquece** de qualquer tela (rede dos
   4 bimestres + fichas por escola do 1º/2º) e guarda as respostas num
   **cache local do navegador** (`window.MapaFichaCache`, IndexedDB + gzip,
   TTL 10 min): a tela de Avaliações lê dali sem rede — é o que a torna
   instantânea. As três camadas (IndexedDB, memória da função, CODERP) têm o
   mesmo TTL de propósito.

Secrets: `CODERP_TOKEN` (obrigatório) e `CODERP_URL` (opcional; o padrão é o
ambiente `dsv`).

**Quem consome em produção é a `avaliacao.html`**: as abas de bimestre
(`pacoteViaFichaApi`), o **Total** (`fichaGruposTotal`, nível **agregado** —
4 bimestres × 5 anos via `fichaRedeTurma`, turma `—`; o detalhe por turma de
UMA unidade desce sob demanda ao clicar, via `fichaDetalheUnidadeTotal`.
⚠️ NÃO voltar o Total para o nível aluno da rede inteira: 112 escolas × 4
bimestres no navegador congelava a tela por minutos — a média ponderada pela
qtd dá o MESMO número) e a **Análise de Consistência** (essa sim via
`fichaAlunosBimestre`, memoizada por bimestre: baixa as fichas aluno a aluno,
por lotes — a API não fornece nome de aluno, só REMA). Uma
chamada `IndicadorTurma` por ano escolar, sem `escola`, devolve a rede aberta
por unidade. O front nunca grava erro/vazio-com-Messages nos caches (session,
IndexedDB) e usa tokens de geração para descartar resposta atrasada de outra
aba — não "simplificar" esses guardas. O código CODERP (`uni_cod`) vira
nome pela tabela **`escolas_catalogo`** (código, nome, tipo, setor, geoloc —
fonte CODERP/SAE; separada do catálogo `escolas` do RLS, de propósito). Se a
API falhar ou o perfil não tiver permissão, a tela cai sozinha para a RPC
`agrupar_bimestres` (dados importados, RLS normal); `?coderp=0` força esse
caminho. Peculiaridades já tratadas no código — não "simplificar":

- `qtd_alunos` chega como **texto**; "não avaliado" chega em **4 grafias**
  (a rotulagem por `fqr_vl` via `labelRespostaPainel` resolve);
- o nível agregado **não rotula turma** (`per_cod`/`tur_cod` vazios, mesmo
  filtrando por turma) e não há endpoint que liste as turmas existentes — a
  turma entra como `—` no pacote de rede e, ao clicar numa unidade, o detalhe
  real (ano/turma por aluno) vem de UMA chamada `IndicadorAluno` da escola e
  substitui as linhas `—` daquela unidade (`getDetalheUnidadeFicha`);
- um item pode ter **mais de uma pergunta por aluno**: o total de alunos por
  unidade×ano é o **mínimo** das somas por item (validado contra o nível
  aluno: 231×235 na escola de teste), não o máximo nem a média;
- `IndicadorAluno` sem `rema` devolve a escola inteira aluno a aluno — por
  isso a função exige recorte: perfil de escola só consulta com o código da
  própria unidade (`escolas_catalogo` → `posso_ver_unidade()`), e nível de
  rede exige `vejo_a_rede_toda()`.

---

## 3. Modelo de segurança do banco

> ⚠️ **LEIA ANTES DE "CONSERTAR" QUALQUER `403` OU `permission denied`.**

As restrições abaixo foram aplicadas deliberadamente, após revisão de
segurança, e são o que garante o isolamento por unidade. **Um `403` ou
`permission denied` vindo delas é o sistema funcionando como projetado**, não
uma avaria a ser corrigida com `grant`.

### Invariantes — quebrar qualquer uma reabre o vazamento

1. **`anon` não tem permissão em nada.** Nem tabela, nem função. Se você
   escrever `grant ... to anon`, está reabrindo o buraco.
2. **`bimestres` e as views materializadas não são alcançáveis pelo REST.**
   O acesso a elas passa obrigatoriamente por funções `SECURITY DEFINER` que
   aplicam o recorte por unidade. View materializada **ignora RLS** — proteger
   só a tabela de origem é proteção de fachada.
3. **Toda tabela com coluna de unidade tem RLS com recorte por escola.** O
   padrão é: quem vê a rede toda passa; os demais só veem a própria unidade.
4. **Perfil de escola é somente leitura.** Escrita exige `posso_editar()`.
5. **Nenhuma policy pode ser `using (true)` numa tabela com dado de aluno.**
   Policies permissivas se somam com **OR** — basta uma sem condição para
   anular todas as outras da mesma tabela. Esta é a verificação canônica:

   ```sql
   select tablename, policyname, cmd from pg_policies
    where schemaname='public' and qual='true' and cmd in ('SELECT','ALL');
   ```
   Só catálogo e configuração podem aparecer aí.

### As funções de isolamento

| Função | Responde |
|---|---|
| `mapa_norm(texto)` | normaliza nome de unidade (acento, pontuação, caixa) |
| `meu_perfil_id()` | quem sou eu — casa por `auth.uid()` ou pelo e-mail do token |
| `vejo_a_rede_toda()` | super admin, ou perfil sem vínculo de unidade |
| `minhas_grafias_norm()` | todas as grafias das minhas unidades, normalizadas |
| `resolver_unidade(nome)` | traduz a grafia do dado para o id do catálogo |
| `posso_ver_unidade(nome)` | predicado de leitura |
| `posso_editar()` | falso para perfil de escola |

**`vejo_a_rede_toda()` nega por padrão:** quem o banco não reconhece não vê
nada. A versão ingênua ("sem vínculo = vê tudo") fazia o oposto.

### Desempenho do RLS — não é detalhe

As policies **precisam** envolver as chamadas em `(select ...)`:

```sql
using ( (select public.vejo_a_rede_toda())
        or public.mapa_norm(coluna) in (select public.minhas_grafias_norm()) )
```

Isso faz o Postgres avaliar uma vez por consulta (InitPlan) em vez de uma vez
por linha. Sem esse cuidado, o resultado é `canceling statement due to
statement timeout` até em tabela de 80 kB.

### Nome de unidade: catálogo × dado

O catálogo (`escolas`) tem a grafia oficial das 112 unidades. Os dados guardam
grafias soltas e às vezes abreviadas, que nenhuma normalização automática casa.
A tabela **`escola_alias`** traduz cada grafia encontrada para uma unidade do
catálogo, ou a marca como fora da rede municipal (alunos de liminar em escola
particular ou estadual, que existem e são legítimos).

**Ela sobrevive à reimportação dos dados; corrigir a grafia na origem não.**

⚠️ **O apelido casa por igualdade exata**, incluindo maiúsculas e acentos. Ao
cadastrar, copie a grafia exatamente como aparece no dado — não "arrume" a
caixa. Padronizar a grafia dos dados sem antes tornar `resolver_unidade()`
insensível à caixa faz a tradução parar de casar, e o sintoma é unidade da rede
sumindo da tela de quem tem direito a ela.

Ao aparecer uma unidade nova, o padrão seguro é entrar como "fora da rede" e
ser promovida só após conferência humana. Errar para o lado de esconder é
visível e reclamável; errar para o lado de mostrar é invisível e grave.

---

## 4. Publicação

Duas branches, publicadas pelo mesmo workflow:

| Branch | Vai para |
|---|---|
| `main` | `smedigital.com.br/mapa-sme/` (produção) |
| `develop` | `smedigital.com.br/mapa-sme/teste/` (homologação) |

⚠️ **O push não dispara o deploy** quando feito por token de automação. Rode o
workflow `deploy-pages.yml` manualmente pela aba Actions depois de publicar.

⚠️ **Confirme o push por hash, não pela mensagem.** `git push` seguido de
`tail` esconde "Everything up-to-date". Sempre:
```bash
git fetch origin -q && git rev-parse --short origin/main
```

### As páginas `-v2` (homologação)

A `develop` carrega uma cópia de cada tela com o sufixo `-v2`, para avaliar o
visual novo sem tocar nas telas em uso. Elas são **geradas**, não escritas:
`tools/gerar-v2.py` copia cada página da raiz e acrescenta os atributos de
tema, o `mapa-v2.css`, o fundo e os defaults do Chart.js. O mesmo comando
atualiza, dentro de `mapa-v2.css`, o bloco entre os marcadores
`>>> INÍCIO DO BLOCO GERADO ... >>>` e `<<< FIM DO BLOCO GERADO <<<`, que
devolve ao tema escuro as cores claras cravadas no CSS embutido das telas.

**Isso roda sozinho no deploy**, dentro de `_src/develop`, antes da montagem
do site — não é preciso lembrar de rodar nada ao alterar uma tela. Para ver o
resultado antes de publicar, rode localmente:

```bash
python3 tools/gerar-v2.py          # regenera as -v2 e o bloco do CSS
python3 tools/gerar-v2.py --limpar # apaga as -v2
```

⚠️ **Não edite `*-v2.html` nem o bloco entre os marcadores de `mapa-v2.css`.**
A próxima publicação reescreve os dois. Ajuste na tela original, ou no CSS
escrito à mão fora dos marcadores.

⚠️ Se os marcadores sumirem do `mapa-v2.css`, o gerador **para com erro** em
vez de reescrever a folha inteira — o restante dela é trabalho manual. O passo
do workflow tem `continue-on-error`, para que uma falha na geração não impeça
a publicação da produção; quando isso acontece, o resumo da execução avisa e
o `/teste` sai com as cópias antigas.

⚠️ **As Edge Functions não vão junto no deploy.** Alterar
`supabase/functions/central-bridge/index.ts` exige republicar pelo painel do
Supabase ou pela CLI, **com Verify JWT desligado**; a `coderp-ficha` republica
**com Verify JWT ligado** (o padrão). Front-end e função precisam estar na
mesma versão: quando desalinham, o sintoma é "não foi possível abrir sua
sessão" com status 200.

### SQL

⚠️ **O SQL Editor do Supabase envolve o script inteiro numa transação.** Um
erro no meio **desfaz tudo que veio antes**, e o painel mostra só a mensagem do
erro — dá a impressão de que o resto passou. Ao falhar no meio, presuma que
**nada** rodou e confira.

`VACUUM` não roda em transação; `ANALYZE` roda.

**Nunca versione arquivo `.sql`, `.csv` ou `.dump` neste repositório** — o
`.gitignore` os bloqueia. Este é um repositório público; script de carga e
export costumam carregar dado real junto, e uma vez publicado o histórico do
Git guarda para sempre. Scripts de banco ficam fora do versionamento.

---

## 5. Diagnóstico de infraestrutura

Antes de investigar código, descarte causas de plataforma. Os sintomas abaixo
**não são bug de aplicação** e não se resolvem mexendo em permissão:

- `PGRST002`, `504`, `Connection terminated due to connection timeout` →
  verifique a saúde e a capacidade da instância no painel do Supabase (aba
  Usage / Reports) **antes** de procurar erro no código ou nas policies.
- Timeout em tabela pequena logo após mudanças de esquema → estatísticas
  desatualizadas. Rode `ANALYZE` nas tabelas afetadas e
  `notify pgrst, 'reload schema';`.
- A capacidade da instância e o crescimento do volume são acompanhados pela
  equipe responsável; consulte o painel para o estado atual em vez de assumir
  qualquer número.

---

## 6. Convenções do código

- HTML/JS puro, sem framework, sem build. Cada tela é um `.html` autocontido.
- `auth.js` expõe `window.MapaAuth` e `window.MAPA_SB`. **Toda página deve
  reaproveitar `window.MAPA_SB`** — criar cliente próprio com a chave anon
  produz requisição sem identidade, que o banco recusa.
- O filtro por escola no JavaScript (`filtrarEscolas`, `podeVerEscola`)
  **não é segurança** — é conforto visual. A segurança está no Postgres. Não
  remova, mas não confie nele.
- Comentários e mensagens de usuário em português.
- `?demo=0` desliga o modo demonstração, que também intercepta `fetch` e
  atrapalha diagnóstico de autenticação.

---

## 7. Sistemas irmãos

Todos sob `smedigital.com.br`, com login no mesmo central: GOM, SATE, Roçadas,
Revista, Presença, Cardápio, Repositório, SAELM, Sistemas. O padrão de
integração é o mesmo descrito aqui.

O **central** (`smedigital-desenv.github.io`) é o hub: catálogo de sistemas,
telas, papéis, perfis e vínculos de escola. Alterações no modelo de permissão
acontecem lá, não aqui.

---

## 8. Ao investigar um problema

1. **`403` / `permission denied` em `bimestres` ou `mv_*` é esperado.** Não
   conceda acesso; verifique se a função que deveria alcançar o dado está como
   `SECURITY DEFINER`.
2. **Tela vazia para perfil de escola** costuma ser grafia de unidade ausente
   em `escola_alias` — uma linha resolve, não é código.
3. **Erro intermitente que "funciona depois de algumas tentativas"** é assinatura
   de corrida, não de configuração. Procure o que executa o mesmo código duas
   vezes (prerender, prefetch, listener duplicado).
4. **Timeout em tabela pequena** é estatística velha ou instância saturada,
   não policy mal escrita.
5. **Antes de propor `grant`**, releia a seção 3.
