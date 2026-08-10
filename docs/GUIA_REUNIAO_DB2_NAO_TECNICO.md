# Guia de bolso — reunião sobre os dados das avaliações

> Para quem vai participar da conversa **sem ser da área técnica**.
> Explica o que o projeto faz, o que estamos pedindo e o que responder às perguntas prováveis.
> Nenhum termo técnico aparece aqui sem tradução.
>
> Companheiro do documento técnico [`DB2_METADADOS_VIEWS.md`](DB2_METADADOS_VIEWS.md) — leve os dois.

---

## Parte 1 — Do que se trata

O **MAPA** é o painel que mostra como os estudantes da rede estão indo nas avaliações de cada
bimestre — por escola, por turma, por disciplina.

Para funcionar, ele precisa dos dados das avaliações. Hoje esses dados foram **copiados de uma
planilha** para um banco de dados nosso, na internet.

Essa cópia ficou grande: **750 mil linhas**, ocupando **79% de todo o espaço** disponível.

E é uma cópia desnecessária — **essa informação já existe no sistema da Prefeitura**, o DB2.
Estamos pedindo permissão para consultá-la lá, em vez de guardar uma segunda via.

### A frase para abrir a reunião

> "São dados de bimestres que já fecharam. Ninguém mais altera. Estamos guardando uma cópia de algo
> que já existe no sistema de vocês — só precisamos de permissão para consultar."

### Os números, se pedirem

| | |
|---|---|
| **79%** | do nosso banco é uma única tabela |
| **750.931** | linhas de dados que não mudam mais |
| **14.139** | estudantes, em 37 escolas |
| **404 → 95 MB** | tamanho do banco depois da mudança |

### Se precisar explicar o que é uma "view"

Uma **view** é como uma **janela** que a equipe do DB2 abre para a gente na sala onde os dados ficam
guardados.

Nós conseguimos **olhar** pela janela. Não conseguimos entrar na sala, não conseguimos mexer em
nada, e **são eles que decidem** exatamente o que fica visível pela janela. Se quiserem fechar a
janela depois, fecham.

---

## Parte 2 — Cinco coisas para pedir

Se sair da reunião com estes cinco itens encaminhados — cada um com um responsável e uma data — a
reunião cumpriu o objetivo.

**1. Duas consultas prontas (as "views")**
Uma com o resumo por turma, que é o que o painel usa o tempo todo. Outra com o detalhe por
estudante, para quando alguém clica em um nome específico.
*Elas criam, elas controlam, a gente só lê.*

**2. Um usuário só de leitura**
Um login de sistema que consegue **apenas consultar** essas duas janelas. Sem permissão para
alterar, apagar ou ver qualquer outra coisa.
*Deixe claro: leitura apenas, e só das views — nunca das tabelas originais.*

**3. Liberação de rede**
Autorização para que nosso sistema alcance o servidor deles. É a parte que costuma demorar mais,
por envolver a equipe de segurança.
*Peça para começarem por essa — é o caminho crítico.*

**4. As informações técnicas de conexão**
Endereço do servidor, tipo do sistema e alguns detalhes de configuração. Você não precisa entender
a lista — basta entregá-la e pedir que preencham.
*Está no documento técnico; leve impresso.*

**5. O código de cada habilidade**
Hoje guardamos o texto inteiro de cada habilidade avaliada — um parágrafo repetido centenas de
milhares de vezes. Queremos receber só o código curto, e uma listinha separada dizendo qual código
corresponde a qual texto.
*Este é o item que mais reduz o tamanho — vale insistir.*

> **Por que o item 5 importa tanto:** é a diferença entre escrever "São Paulo" ou escrever o nome
> completo do estado por extenso, com toda a descrição, 750 mil vezes. Só existem 207 parágrafos
> diferentes, e eles estão guardados 750.931 vezes.

---

## Parte 3 — Perguntas prováveis e o que responder

Cada resposta vem marcada: ✅ **pode afirmar** é seguro dizer; ⚠️ **cuidado** depende de algo ainda
não decidido; 🛑 **não responda sozinho**.

---

**✅ "Vocês querem acesso ao nosso banco de dados?"**

Não. Não queremos acesso ao banco. Queremos que vocês criem **duas consultas prontas** e nos deixem
ler apenas elas.

Vocês definem o que aparece, vocês controlam, e podem revogar quando quiserem. Não teremos contato
com as tabelas originais.

---

**✅ "Vocês vão conseguir alterar nossos dados?"**

Não. O acesso pedido é **somente leitura**. Tecnicamente não existe permissão para gravar, alterar
ou apagar nada. Estamos pedindo explicitamente que a permissão seja só de consulta, e só nas duas
views.

---

**✅ "Vocês já não têm esses dados? Por que precisam de novo?"**

Temos, mas é uma **cópia estática, feita por planilha**. Ela não se atualiza, ocupa espaço e veio
com defeitos: alguns acentos se corromperam na cópia, o que faz a mesma disciplina aparecer duas
vezes nos gráficos.

Consultando a fonte de vocês, esse tipo de erro deixa de existir.

---

**✅ "Por que isso é urgente?"**

Porque essa cópia ocupa **79% de todo o espaço** do nosso banco. Qualquer outra melhoria no projeto
disputa os 21% que sobram.

E o volume cresce a cada bimestre: o segundo já é quase o dobro do primeiro. Sem essa mudança, não
há teto.

---

**⚠️ "Quanto trabalho isso dá para a nossa equipe?"**

O pedido é objetivamente pequeno: **duas consultas, um usuário de leitura e uma liberação de rede**.

Mas **não diga que é rápido ou simples** — quem estima o esforço são eles. A frase segura é: "pelo
que mapeamos, o pedido é pequeno; mas quem sabe o esforço real são vocês."

---

**⚠️ "E a LGPD? São dados de crianças."**

Sim, e é por isso que estamos **reduzindo** o que trafega, não aumentando. A consulta principal traz
apenas totais por turma, **sem nome e sem matrícula**.

O nome do estudante só apareceria na consulta de detalhe. **Pergunte a eles se preferem que a gente
nem receba o nome** — o número de matrícula pode ser suficiente, e isso reduz o risco para os dois
lados.

Nosso sistema já tem função que troca nomes reais por fictícios em demonstrações. É tratamento
existente, não improviso.

---

**⚠️ "Vocês vão copiar tudo isso para a nuvem?"**

A opção que recomendamos é levar **apenas o resumo por turma** — cerca de 50 mil linhas, sem nome e
sem matrícula — e deixar o detalhe individual sempre no sistema de vocês, consultado só quando
necessário.

Existem outras duas formas de fazer, em que nada fica armazenado do nosso lado. Se preferirem uma
delas, tudo bem — **essa decisão é conjunta** e está no documento técnico.

---

**✅ "Por que não pedem os quatro bimestres de uma vez?"**

Porque o primeiro e o segundo já estão fechados — não mudam mais. São os que ocupam espaço sem
necessidade e os que dão resultado imediato. O terceiro e o quarto entram naturalmente depois, pelo
mesmo caminho, quando fecharem.

---

**✅ "E se a gente não conseguir liberar?"**

Temos um plano alternativo que resolve o problema de espaço sozinho, do nosso lado: guardar só o
resumo e descartar o detalhe.

Mas nesse caso **perdemos a consulta individual por estudante**, e o problema volta nos próximos
bimestres. O pedido continua de pé.

---

**🛑 "Quando vocês precisam disso pronto?"**

Não invente prazo, e não aceite pressão para dar um. A resposta honesta é que a urgência é nossa, de
espaço, e que **o prazo depende do processo interno deles**.

Devolva a pergunta: "qual é o prazo típico de vocês para criar uma view e liberar um acesso?" — essa
resposta é justamente um dos itens que precisamos levar da reunião.

---

**🛑 Perguntas técnicas específicas** (nomes de tabela, tipo de servidor, codificação)

Não tente responder. Anote a pergunta e diga: **"isso está no documento técnico, vou confirmar com a
equipe de desenvolvimento e retorno."**

Não há prejuízo nenhum em não saber — o documento técnico existe exatamente para isso.

---

## Parte 4 — O que não prometer

- **Não prometa prazo do lado deles.** Nem "é rapidinho", nem "dá pra fazer essa semana". Quem
  estima o trabalho é quem vai executá-lo.
- **Não aceite acesso às tabelas originais.** Se oferecerem acesso direto às tabelas em vez das
  views, agradeça e diga que preferimos as views. Menos acesso é melhor para todo mundo — inclusive
  para nós.
- **Não receba senha por e-mail, WhatsApp ou papel.** Combine que a credencial será entregue pelo
  canal seguro que eles usarem normalmente.
- **Não afirme que os nomes dos estudantes são indispensáveis.** Ainda não decidimos isso. A resposta
  correta é que estamos avaliando se o número de matrícula basta.
- **Não feche a decisão de arquitetura na reunião.** Há três formas de conectar os dois sistemas.
  Apresente a recomendação, ouça a preferência deles, e leve para a equipe técnica decidir em
  conjunto.

### A frase que resolve qualquer travamento

> "Anotei sua pergunta. Vou confirmar com a equipe de desenvolvimento e retorno ainda esta semana."

---

## Parte 5 — Se ouvir estas palavras

| Termo | O que é |
|---|---|
| **View** | Uma consulta pronta e salva. A "janela" da analogia: mostra um recorte dos dados sem dar acesso ao resto |
| **DB2** | O sistema de banco de dados da Prefeitura, onde as informações originais ficam. É de onde queremos ler |
| **Supabase / PostgreSQL** | O banco que o MAPA usa hoje, na internet. É onde está a cópia que queremos eliminar |
| **SELECT** | O comando de *consultar*. "Permissão de SELECT" quer dizer "permissão de só olhar" |
| **Firewall** | A barreira de segurança da rede. "Liberar o firewall" é autorizar que um sistema converse com o outro |
| **Agregado × detalhe** | Agregado é o total por turma ("18 estudantes atingiram"). Detalhe é linha por estudante. O painel usa agregado quase sempre |
| **Habilidade** | Cada item avaliado, descrito por um parágrafo da BNCC. É o texto longo que queremos trocar por um código curto |
| **RA / matrícula** | O número que identifica o estudante. Serve como chave sem precisar do nome |
| **Codificação / CCSID** | Como o sistema guarda letras com acento. Se estiver errada, "MÚSICA" vira "M?SICA". É por isso que perguntamos |
| **LUW ou z/OS** | Os dois tipos possíveis de DB2. Só precisamos saber qual é — muda a forma de conectar. Anote a resposta |

---

## Parte 6 — Antes de sair da sala

1. **É LUW ou z/OS?** Uma palavra só. Sem ela, nada avança.
2. **Qual tabela guarda as avaliações?** Nome e schema. O script de descoberta encontra isso na hora.
3. **Quem cria as views, e até quando?** Um nome e uma data.
4. **Quem pede a liberação de rede, e até quando?** Costuma ser o item mais demorado.
5. **Existe ambiente de teste?** Sim ou não. Preferimos testar antes de produção.
6. **Existe código para cada habilidade?** Sim ou não. Se sim, qual é o formato.

### O pedido inteiro, em uma frase

> "Precisamos de duas consultas somente-leitura, um usuário de consulta e uma liberação de rede —
> para parar de guardar 750 mil linhas de dados que não mudam mais."
