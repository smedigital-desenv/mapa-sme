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
Consistência), Av. Diagnóstica SME/Vunesp, Av. Oral de Matemática, SARESP,
IDEB, IEE, Atribuição, Retrato Quantitativo de Atribuições, Análise de Jornada,
Educação Especial, Gerência de Liminares, Frequência × Distância, Fluência
Leitora, Elefante Letrado, Boletim da Escola, Boletim Estatístico, Relatórios,
Relatório Executivo.

### Telas de avaliação externa (tabelas `av_*`)

Alimentadas por **upload de planilha** na própria tela (gated), não por API.
As tabelas seguem o RLS padrão: `anon` sem nada, recorte por escola com as
chamadas dentro de `(select ...)`, escrita exigindo `posso_editar()`.

⚠️ **`av_diag_item` guarda uma linha por ITEM da prova, não por habilidade.**
Metade das habilidades é medida por mais de um item e a dispersão entre itens
da MESMA habilidade é de 13 p.p. em média (chega a 73 p.p. na rede — medido em
2026-06). Agregar por habilidade transformaria "uma questão todos acertam,
outra quase ninguém" num meio-termo que não descreve nenhuma das duas. Não
"simplifique" isso somando por habilidade.

⚠️ **A escala TRI muda a cor do TEXTO junto com a faixa.** Sobre os três tons
médios (`#65a30d`, `#ca8a04`, `#ea580c`) o texto branco fica em 2,94–3,56:1,
abaixo do mínimo de 4,5:1; com tinta escura sobe para 5,0–6,1:1. A paleta é a
mesma — não volte o texto para branco "para uniformizar".

### O ano escolar é um NÍVEL da árvore lateral, não um filtro à parte

⚠️ **Não recrie a barra de botões de ano (`#anoFilterBar`).** Ela foi removida
em 2026-08 por decisão da SME. A árvore lateral das três abas (Diagnóstica,
Bimestres, Total) é **unidade › ano escolar › turma**.

O motivo não é estética: a barra ficava no topo, separada da unidade, e os dois
filtros não conversavam. Dava para pedir "5º ano" numa unidade que não tem 5º
ano — a tela ficava vazia sem dizer por quê. Como nível da árvore, só aparece
o ano que a unidade realmente tem.

Formato: `arv[unidade][ano][turma] = alunos`. ⚠️ Monte e some **sempre** pelos
helpers `_arvAdd`, `_arvAnos`, `_arvTurmas`, `_arvTotalAno` e
`_arvTotalUnidade` — são seis rotinas que montam árvore (as três abas e os
caminhos reserva de cada uma), e foi o que permitiu trocar o formato num lugar
só. As três abas compartilham **um** renderizador, `_htmlArvoreLateral()`;
antes eram três cópias quase iguais, que na prática viviam em três estados
diferentes ao mesmo tempo.

⚠️ **A árvore NUNCA é filtrada pelo ano.** Ela é o navegador: filtrar por ano
esconderia os outros anos e não haveria como trocar. Havia cinco pontos que
faziam isso (`if (anoFiltro !== 'TODOS' && a !== anoFiltro) return`) dentro de
construtores de árvore — todos foram retirados, e só ali. Os mesmos testes
aplicados às LINHAS de dado continuam valendo.

⚠️ Quem muda o ano é sempre `_setAnoFiltroAtualSeguro()`, chamado pela árvore.
`anoFiltroAtual` continua sendo a variável que o resto da tela lê — o estado
`_hierAnoAtivo` só a alimenta. Manter os dois em sincronia é o que impede a
tela de mostrar os números de um ano com o rótulo de outro.

⚠️ `switchYear()` **não zera mais a unidade**. Quando o ano era uma barra
separada, trocar de ano significava recomeçar; agora o ano vive dentro da
unidade, e limpar a unidade desfaria o clique que a pessoa acabou de dar.

⚠️ A chave do ano é a forma **normalizada** (`'1 ANO'`), que é o que
`normalizarAnoFiltroFront` devolve — não `'1º ANO'`. `ORDEM_ANO_HIER` escrito
com o ordinal faz a ordenação errar em silêncio e cair no desempate por texto,
que só acerta enquanto os anos forem de um dígito. O ordinal aparece só no
rótulo, por `_rotuloAnoHier()`.

### A rosca da Diagnóstica tem etiqueta externa para a fatia miúda

As três distribuições da Diagnóstica (Leitura, Escrita, Produção Textual) são
roscas, **por decisão da SME**. O que mudou foi como se clica nelas.

O defeito original: **numa rosca a área de clique é proporcional ao dado**, e a
categoria que mais interessa é justamente a menor. Medido em `avaliacao.html`
com os números da rede: `L. Fluente`, 5 alunos em 2.432, ocupa **0,68° de
arco**. É inclicável — e fica *pior quanto melhor a rede fica*.

⚠️ Três saídas já descartadas, não as retome:

1. **Aumentar a rosca** — 0,68° continua 0,68°, ângulo não depende de raio.
2. **Inflar a fatia mínima** — mentiria na proporção, que é a única coisa que
   a rosca faz.
3. **Anel externo com fatias iguais** — funcionava (alvo de 47°, clique 7/7),
   mas a SME recusou: virou ruído em volta do gráfico.

O que existe hoje, em `_roscaAlunos()` + `_desenharChamadas()`: a rosca é de
anel único e fica intacta; a fatia **abaixo de 5%** ganha uma linha de chamada
até uma **etiqueta fora do gráfico**, com nome e número, e a etiqueta é o alvo.
As fatias grandes continuam clicáveis nelas mesmas. Medido: **12/12** etiquetas
abrem a lista certa, sem sobreposição, nos três gráficos.

⚠️ **Fatia de menos de 2° não recebe realce no gráfico.** Não é preguiça: com
`spacing` + `hoverOffset`, o Chart.js degenera o traçado de um arco muito fino
e pinta o **anel inteiro** com a cor da fatia — `Não Avaliado` com 8 alunos
(0,35° de arco) deixava a rosca toda cinza. Medido: 0,35° pinta 75% do anel; a
partir de 1,74° o desenho se comporta. Realçar um fio de cabelo não mostraria
nada de todo jeito, e o nome, o número e a descrição continuam na etiqueta
externa e na linha da legenda, que se acendem por CSS.

⚠️ Pontos que **não** são detalhe:

- **A altura da etiqueta é MEDIDA, nunca constante.** Ela depende da fonte e de
  quantas linhas o nome ocupa (`N4 Pré-leitor` quebra, `Nível 5` não). Chutar
  38px produziu etiquetas sobrepostas — a real era 50px. O código desenha,
  mede com `offsetHeight` e só então empilha.
- **A folga lateral só é reservada do lado em que há etiqueta** (`layout.padding`),
  senão a rosca encolhe à toa.
- **`animation.onComplete` dispara a cada `update()`**, e o realce vindo da
  legenda chama `update()`. Sem a trava de assinatura (`$chamadasSig`), as
  etiquetas seriam recriadas sob o cursor: o elemento sob o mouse é
  substituído, o `mouseout` nunca chega e o realce fica preso aceso.
- As etiquetas são **DOM de verdade**, não desenho no canvas — é o que lhes dá
  foco de teclado, leitor de tela e o reaproveitamento dos listeners da legenda
  (daí a classe `.legend-clicavel` e os `data-cv`/`data-label`).

As linhas da legenda também são alvo, com altura fixa de 44px+ (`.legend-alvo`),
igual para quem tem 1.372 alunos e para quem tem 5, com barrinha de magnitude.

A paleta de `COR_FIXA` **não** foi mexida: ela é a linguagem visual da rede
(badges, tabelas, outras telas). Ela é um arco-íris sobre uma escala ordinal —
o certo seria um degradê de um só tom —, mas trocá-la é decisão da SME, não
efeito colateral de um ajuste de usabilidade.

⚠️ As roscas **por eixo** e as de **detalhe por pergunta** (mesma tela) ainda
não têm etiqueta externa: nelas a fatia miúda só é alcançável pela legenda.

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
   4 bimestres + `detalherede` do 1º/2º) e guarda as respostas num
   **cache local do navegador** (`window.MapaFichaCache`, IndexedDB + gzip,
   TTL 10 min): a tela de Avaliações lê dali sem rede — é o que a torna
   instantânea. As três camadas (IndexedDB, memória da função, CODERP) têm o
   mesmo TTL de propósito.

#### O nível sintético `detalherede` — por que ele existe

⚠️ **Leia isto antes de mexer.** `/IndicadorTurma` EXISTE e é a fonte dos
números das abas de bimestre e do Total — não confunda "a API não tem endpoint
de turma" (falso) com "a resposta não rotula a turma".

O `pacoteViaFichaApi` **lê `tur_cod`** da resposta do `IndicadorTurma` e o
console registra o resultado (`X linhas COM tur_cod, Y sem`). Durante muito
tempo o código cravava `'—'` e **nunca lia o campo** — a afirmação "vem vazio"
não estava sendo testada por ninguém.

**A API VOLTOU A ROTULAR — medido em 2026-08-17.** Durante um tempo ela não
rotulava (28.141 linhas do 2º bimestre, zero com `tur_cod`), e é dessa época
que vem a varredura descrita abaixo. Hoje `tur_cod` e `per_cod` vêm
preenchidos em **100% das linhas, inclusive sem filtro de escola**: 57.919 de
57.919 no 1º bimestre. O contador da tela confirma sozinho a cada abertura.

⚠️ Isso torna a varredura por código de turma **desnecessária**, não apenas
desligada. Ela continua no código como reserva caso a rotulagem regrida, mas
não deve ser religada sem antes reconferir o contador.

⚠️ Ao testar isso, cuidado com um detalhe que já enganou: um teste feito COM
`escola` no corpo não responde pela rota da rede, que consulta SEM esse
filtro. Use a sonda `MapaDiagRotulos(bimestre[, codEscola])`, que mede os dois
recortes e dá o veredicto.

🚫 **A VARREDURA POR TURMA ESTÁ DESLIGADA (`?turmas=1` liga) — ela corrompe a
contagem de alunos.** Medido em produção: ALCINA passou de 236 (correto) para
68 no 1º bim e 466 no 2º. A causa NÃO é o filtro da API (esse funciona), é a
forma de contar: alunos por turma sai do **mínimo entre os itens**, regra que
assume que todo aluno responde todo item. Isso é FALSO para itens que só valem
para parte da turma — Atendimento Educacional Especializado e Educação
Especial aparecem no 1º bimestre. ⚠️ A conferência não pega esse erro porque
ela confere a **soma crua** (alunos-resposta), e a soma crua fecha; o que está
errado é a **contagem de alunos**, outra grandeza. Antes de religar, é preciso
uma forma confiável de contar aluno por turma a partir do nível agregado — ou
usar o nível aluno, que conta REMA distinto e é exato.

### Como se conta ALUNO a partir do nível agregado — `alunosPorItens()`

⚠️ **Esta é a regra que já errou duas vezes.** O mesmo defeito que derrubou a
varredura por turma (acima) estava também na rota principal: em 2026-08 a tela
mostrava **4.522 alunos no 1º bimestre contra 13.095 no 2º**, e o 2º só estava
certo por acidente — a Ed. Especial ainda não havia sido lançada nele.

A regra vive em `alunosPorItens()`, em `avaliacao.html`, e é usada nos **três**
lugares que contam aluno pelo agregado (rota de rede, detalhe por turma e
índice do Total). Se você mexer em um, mexa nos três — ou melhor, mexa só na
função.

⚠️ **Ela fica no escopo compartilhado, NÃO dentro do adaptador Supabase.** O
índice do Total vive em outro bloco `<script>`; enquanto a regra esteve dentro
daquele IIFE, o Total contava por conta própria e a lateral dele mostrava **12**
onde o 1º bimestre mostrava **232** — 12 era a quantidade de combinações
ano×turma, não de alunos. `disciplinaContaAluno()` também normaliza por conta
própria, sem chamar `normalizar()`: aquele helper carrega depois, e a
dependência quebrava em silêncio, caindo no mínimo entre itens.

1. A soma de um item é `alunos × nº de perguntas daquele item` — um item pode
   ter mais de uma pergunta por aluno (Ciências/Matéria e Energia tem 3).
2. **Educação Especial e AEE ficam FORA da conta.** Elas atendem só parte da
   turma, então quebram a premissa de que todo aluno responde todo item. Isso
   NÃO as esconde da tela: elas continuam como disciplina e nos percentuais; o
   que elas deixam de fazer é decidir quantos alunos existem.
3. O **mínimo** entre os itens restantes identifica a escala de "um aluno por
   resposta" — mas escolher o mínimo é escolher o item PIOR lançado. Então
   entre os itens de pergunta única (soma abaixo de 1,5× o mínimo) vale o
   **MAIOR**, que é o item mais completamente lançado.

Medido contra a planilha oficial do 1º bimestre (13.626 alunos, 553 baldes
unidade/ano/turma): o mínimo puro acerta 395 baldes e perde 580 alunos — 521
deles só porque um item de Língua Portuguesa teve meia dúzia de lançamentos a
menos que os demais da mesma turma. A regra atual acerta **533 dos 553** e,
medido, **nunca conta acima do real** — os 20 restantes ficam abaixo, que é o
lado seguro: aluno inventado é invisível, aluno faltando é reclamável.

⚠️ O que sobra de diferença **não é defeito de código, é lançamento
incompleto**. Não tente fechar os últimos 2% inflando a estimativa.

⚠️ O nível **Aluno** conta REMA distinto e é exato — não precisa desta regra.
Ela existe só porque cobrir a rede pelo nível aluno é inviável no navegador.

### O que `per_cod` traz, e por que a tela fica em 1º a 5º ano

O `per_cod` (o ano escolar) devolve **18 valores distintos** quando a consulta
vai sem filtro. Medido em 2026-08, 1º bimestre, 57.919 linhas:

| `per_cod` | o que é | disciplinas |
|---|---|---|
| 1 ANO … 5 ANO | Fundamental — anos iniciais | **10** |
| 6 ANO … 9 ANO | Fundamental — anos finais | 2 |
| CIC 2/3/4 | Educação Infantil, ciclos | 2 |
| ETP 1/2 | Educação Infantil, etapas I e II | 2 |
| PECAI | PEC dos Anos Iniciais | 2 |
| TAIMS / TAFMS | Termos Multi Seriados (treinamento) | 2 |
| TREIN | Prática Desportiva masc./fem. | 1 |

⚠️ **A coluna "disciplinas" é a razão do recorte, e ela engana quem olha rápido.**
Só de 1º a 5º ano existe avaliação curricular (Língua Portuguesa, Matemática,
Geografia, História, Ciências, Arte, Ed. Física, Inglês, além de Educação
Especial e AEE). De 6º a 9º — e em todos os demais — vêm **apenas Educação
Especial e AEE**: é ficha de outra natureza, não currículo.

⚠️ Não conclua "dá para incluir" comparando o vocabulário na direção errada.
Perguntar "o que existe em 6º–9º e não existe em 1º–5º" devolve ZERO nos três
eixos (disciplina, item, resposta) — porque 6º–9º é SUBCONJUNTO. A pergunta
que decide é a inversa.

Por decisão da SME (2026-08), a tela de Avaliações cobre **1º a 5º ano**. As
fichas de Educação Especial dos demais anos são assunto da tela de Educação
Especial, não desta. `PER_COD_FORA`, em `avaliacao.html`, é lista de EXCLUSÃO
de propósito: `per_cod` novo entra e aparece, em vez de sumir calado.

⚠️ Os `tur_cod` fora do padrão de letra única (`3C`, `TA`) são todos de
`per_cod = TREIN` — 51 linhas em 2 unidades. Não são "3º ano turma C".

✅ **MEDIDO: o filtro `turma` FUNCIONA.** A sonda `MapaDiagTurma(2)` comparou
as consultas filtradas com a sem filtro (2026, 2º bim, 1 ANO): 92.756
alunos-resposta sem filtro contra 92.360 somando A–F — as partes reproduzem o
todo. Então a turma vem do que é **PEDIDO**, não do que a resposta devolve.

É por isso que a rede abre por turma com **~40 consultas leves por bimestre**
(5 anos × códigos de turma) em vez do leque de 112 fichas de escola. Os
códigos saem da tabela `turmas` do MAPA (`letra_turma`); a varredura para
depois de 2 códigos vazios seguidos, porque a cauda é rarefeita (a turma F já
só existe em 6 unidades).

⚠️ **O CODERP responde `404`, e não lista vazia, quando não há dado** — turma
que não existe naquele ano, bimestre sem lançamento. Isso é RESPOSTA, não
avaria: o front trata 404 como vazio (e memoiza, senão cada abertura repetiria
a consulta). Tratar 404 como falha fazia a varredura abortar no primeiro código
inexistente. O erro carrega `err.coderpStatus` justamente para essa distinção.

⚠️ **Ano que falha de verdade (não 404) marca o pacote como `incompleto`, e
pacote incompleto NÃO entra em cache.** Sem isso, um bimestre em que 4 dos 5
anos falharam ficaria 45 min na tela mostrando um quinto da rede sem avisar.

⚠️ **A aprovação é por unidade × ANO, e o CODERP dá timeout esporádico.** Já
aconteceu de um único 504 no 3º ano deixar a rede INTEIRA sem turma: a
consulta era tentada uma vez só, e a reprovação valia para a unidade inteira.
Hoje a consulta insiste 3 vezes, e o ano reprovado apenas continua agregado
('—') sem custar os outros quatro. O `_aplicarDetalheUnidade` respeita
`det.anos` — trocar as linhas '—' de anos NÃO detalhados apagaria alunos.

⚠️ **NADA é aplicado sem conferência.** Esta rota rotula pelo que foi pedido,
então um código faltando na lista sumiria com alunos **em silêncio**. Por isso
o pacote agregado carrega `bruto` (soma crua por unidade/ano) e o detalhe só
substitui as linhas de uma unidade quando a soma das turmas **reproduz
exatamente** esse número, em TODOS os anos daquela unidade. Quem não fecha
continua com `'—'` e sai no console. Se você mexer aqui, não remova a
conferência: sem ela o erro é invisível.

A aba **Total** usa a MESMA rota e a MESMA conferência, com uma diferença: ela
pontua pelo `fqr_vl` CRU, não pelo rótulo normalizado — rótulos diferentes
colapsam no mesmo texto e o `respostaScore` precisa do código para dar a nota
certa. Por isso a varredura devolve duas agregações (`ag` normalizada para as
abas de bimestre, `agCru` para o Total).

O nível `detalherede` (leque por escola dentro da Edge Function) continua
escrito e é a reserva para o dia em que o filtro `turma` deixar de funcionar —
aí a turma só existiria no nível Aluno, e cobrir a rede custaria **~300 MB de
JSON por bimestre**. Ele NÃO está publicado; enquanto não estiver, a chamada
responde 400 e a tela segue pela rota por turma.

Fazer isso **no navegador** já foi tentado duas vezes e é inviável — baixar e
desserializar ~3 MB por unidade na thread da interface travava a tela por
minutos, **e o custo se repetia para cada pessoa**. ⚠️ Não reintroduza esse
laço no front (o comentário em `_prefetchTurmasFicha` diz o mesmo).

O nível `detalherede` (`POST { nivel:'detalherede', parms:{anoLetivo,bimestre} }`)
faz o leque **dentro da Edge Function**, com concorrência 8, e devolve só o
agregado: ~9 MB de JSON, **~600 kB comprimido**, servido do cache de 10 min
para todos. É a diferença entre 300 MB por usuário e 600 kB compartilhados.

Pontos que **não** são detalhe:

- **A função não nomeia nada.** Devolve os campos crus
  (`[uni_cod, per_cod, tur_cod, fnc_des, fne_des, fqr_vl, fqr_txt, qtd]`); a
  normalização de unidade/disciplina/resposta continua só no front. Duplicá-la
  no servidor criaria duas verdades que divergem em silêncio.
- **`qtd` conta alunos DISTINTOS (REMA)**, nunca linhas — um item pode ter mais
  de uma pergunta por aluno.
- **Leques simultâneos são deduplicados** (`_emVoo`): sem isso, dez pessoas
  abrindo a tela com o cache frio disparariam dez leques de 112 consultas.
- **Resposta parcial não entra em cache nenhum** (nem na função, nem no
  IndexedDB): congelar uma rede incompleta por 10 min esconderia unidades de
  quem tem direito a elas. Parcial ainda é útil — o front mescla o que chegou
  sobre o pacote agregado, que já tem os totais certos.
- **Orçamento de 100 s**; o que não coube volta em `faltando` e continua
  descendo por clique.
- O front **degrada sozinho**: se o nível não estiver publicado, a chamada
  responde 400 e a tela volta ao comportamento de detalhar por clique.

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

### O cabeçalho é copiado em cada tela — e isso tem consequência

Não há include: o `<header class="mg-header">` está escrito por extenso em cada
`.html`. **Item novo no menu precisa entrar nas ~17 telas que o têm**, senão o
usuário perde a navegação ao mudar de tela. Já aconteceu de o submenu ficar em
três estados diferentes ao mesmo tempo.

⚠️ **O CSS do submenu vem do `auth-guard.js`**, injetado antes do primeiro
render para não haver flash. Seis telas redeclaram `.mg-dd-menu` na própria
folha e, por especificidade, **vencem a regra compartilhada** — mexer só no
`auth-guard.js` conserta 11 telas e deixa 6 para trás. Mexa nos dois lugares.

⚠️ **Classe de item é `mg-dd-item`, e só.** Uma variação inventada
(`mg-dd-item__ATIVO`) não casa com o seletor, o item perde o `display:flex` e
os links viram texto corrido embolado — o menu continua "funcionando", então
o defeito passa por revisão. A tela atual leva `mg-dd-item active`, uma por
página.

---

## 7. Sistemas irmãos

Todos sob `smedigital.com.br`, com login no mesmo central: GOM, SATE, Roçadas,
Revista, Presença, Cardápio, Repositório, SAELM, Sistemas. O padrão de
integração é o mesmo descrito aqui.

O **central** (`smedigital-desenv.github.io`) é o hub: catálogo de sistemas,
telas, papéis, perfis e vínculos de escola. Alterações no modelo de permissão
acontecem lá, não aqui.

### Tela nova não existe até ser cadastrada no central

Publicar o `.html` e criar as tabelas **não basta**. Enquanto a tela não estiver
no catálogo do central e liberada para o perfil, ela não é alcançável — e o
sintoma não diz isso: aparece como erro de permissão na tela, o que leva a
procurar defeito nas policies do MAPA, que estão certas.

No banco do **central** (projeto separado, não o do MAPA):

```sql
-- 1) uma linha por tela, no sistema 'mapa'
insert into public.telas (sistema_id, slug, nome, ordem)
select id, 'saresp', 'SARESP', 3 from public.sistemas where slug='mapa';

-- 2) liberar para o perfil (perfil_tela: pode_ver / pode_editar / pode_exportar)
insert into public.perfil_tela (perfil_id, tela_id, pode_ver, pode_editar, pode_exportar)
select p.id, t.id, true, true, true
  from public.perfis p, public.telas t
 where p.auth_user_id = '<uuid do usuário>' and t.slug = 'saresp';
```

⚠️ A identidade em `perfis` é o **`auth_user_id` (uuid)**, não o `id` (bigint)
da própria tabela — o join errado falha com `operator does not exist: uuid =
bigint`. `sistemas` e `telas` identificam por **`slug`**, não por `codigo`.

O `data-tela` no HTML das telas do MAPA é **decorativo** — hoje nada o lê. O
gate de verdade é o do central.

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
