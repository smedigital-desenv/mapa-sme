# Metadados para criação de views no DB2 — Avaliações Bimestrais

> **Documento de trabalho para a reunião técnica.**
> Objetivo: listar **tudo o que precisa ser liberado pela equipe do DB2** para que o MAPA
> deixe de armazenar em base própria os dados fixos das avaliações do **1º e 2º bimestre**,
> passando a consumi-los por **views** no sistema corporativo.
>
> Origem dos dados: **DB2** (sistema corporativo) · Destino atual: **Supabase / PostgreSQL** (MAPA).

---

## 1. Por que este pedido é urgente — números medidos

Medição real executada no banco de produção:

| Métrica | Valor |
|---|---|
| Banco de dados completo | **404 MB** |
| Tabela `bimestres` (total) | **321 MB** |
| — dados | 283 MB |
| — índices | 38 MB |
| **Participação da tabela no banco** | **79%** |
| Linhas — 1º bimestre | 269.701 |
| Linhas — 2º bimestre | 481.230 |
| **Total de linhas** | **750.931** |

**Uma única tabela responde por quase quatro quintos de todo o banco de dados.** Esse é o número
que abre a reunião. Não é uma questão de otimização marginal: qualquer outra iniciativa de
economia no projeto disputa os 21% restantes.

A tabela guarda dados **fechados e imutáveis** — bimestres já encerrados. Foi carregada por
planilha, via `apps-script/migrar_bimestres.gs`, que registra no próprio cabeçalho a carga inicial
de 269.701 registros do 1º bimestre.

O ponto central do argumento: **são dados que não mudam mais**. Não há escrita, não há correção,
não há reprocessamento. Manter uma cópia estática de 750 mil linhas em base transacional própria é
custo puro. O dado já existe no DB2 — precisamos apenas de leitura.

### 1.1 Projeção após a migração

| Cenário | Tamanho do banco | Redução |
|---|---|---|
| Hoje | 404 MB | — |
| Bimestres 1 e 2 removidos + `VACUUM FULL` | **~83 MB** | **−79%** |
| Idem, mantendo tabela agregada local (plano B, seção 5.3) | ~85 a 95 MB | −77% |

Como as únicas linhas presentes na tabela são dos bimestres 1 e 2, removê-las **esvazia a tabela
por completo**. Não sobra resíduo.

### 1.2 Anomalia a investigar antes da reunião

O 2º bimestre tem **481.230 linhas contra 269.701 do 1º — 78% a mais**. Isso merece explicação
antes de virar requisito para o DB2, porque há três causas possíveis com consequências bem
diferentes:

1. Mais disciplinas ou eixos avaliados no 2º bimestre (legítimo)
2. Mais estudantes na base (legítimo)
3. **Carga duplicada ou parcialmente reexecutada** (defeito — e espaço recuperável hoje mesmo)

A hipótese 3 é plausível: o `migrar_bimestres.gs` envia lotes com
`Prefer: resolution=merge-duplicates`, o que só evita duplicidade se houver constraint de unicidade
declarada na tabela. Se não houver, uma reexecução da migração duplica linhas silenciosamente.

```sql
-- Diagnóstico: separa "mais alunos" de "mais linhas por aluno"
SELECT bimestre,
       COUNT(*)                        AS linhas,
       COUNT(DISTINCT rema_aluno)      AS alunos,
       ROUND(COUNT(*)::numeric
             / NULLIF(COUNT(DISTINCT rema_aluno), 0), 1) AS linhas_por_aluno
  FROM public.bimestres
 GROUP BY bimestre
 ORDER BY bimestre;

-- Se linhas_por_aluno saltar, checar duplicidade exata
SELECT COUNT(*) AS grupos_duplicados, SUM(n) - COUNT(*) AS linhas_excedentes
  FROM (
    SELECT COUNT(*) AS n
      FROM public.bimestres
     WHERE bimestre = 2
     GROUP BY rema_aluno, fnc_disciplina, descricao_fne, fqs, codigo_resposta
    HAVING COUNT(*) > 1
  ) d;
```

Se a segunda consulta apontar volume relevante, há **espaço recuperável imediatamente**, sem
depender de nenhuma liberação externa. Vale rodar antes da reunião — muda o tom da conversa se
parte do problema for nosso.

### 1.3 Cota do plano

Confirmar o limite do plano Supabase contratado. O plano gratuito tem teto de 500 MB — se for o
caso, os 404 MB atuais representam **81% da cota**, o que explica a urgência e deve ser dito
explicitamente na reunião. Em plano pago o teto é bem maior, e o argumento passa a ser de custo e
de higiene arquitetural, não de risco iminente de indisponibilidade.

---

## 2. Estrutura atual — o que precisa ser reproduzido no DB2

Layout gravado hoje no Supabase (extraído de `migrar_bimestres.gs`, mapeamento posicional da
planilha de origem). Esta é a **especificação funcional** que as views precisam atender:

| # | Campo (MAPA/PostgreSQL) | Coluna da planilha | Descrição de negócio |
|---|---|---|---|
| 1 | `unidade_id` | — (resolvido por lookup) | FK para `unidades` no Supabase; derivado de `nome_unidade` |
| 2 | `nome_unidade` | `row[0]` | Nome da unidade escolar |
| 3 | `avaliacao` | `row[1]` | Identificação da avaliação aplicada |
| 4 | `ano_escolar` | `row[2]` | Ano/série do estudante |
| 5 | `bimestre` | `row[3]` | Período letivo (1 a 4) |
| 6 | `turma` | `row[4]` | Identificação da turma |
| 7 | `rema_aluno` | `row[5]` | Registro de matrícula do estudante (chave do aluno) |
| 8 | `nome_aluno` | `row[6]` | Nome do estudante |
| 9 | `fnc_disciplina` | `row[7]` | Disciplina/componente curricular |
| 10 | `descricao_fne` | `row[8]` | Eixo avaliado (ex.: ESCRITA, LEITURA, PRODUÇÃO TEXTUAL) |
| 11 | `fqs` | `row[9]` | **Semântica a confirmar com a equipe do DB2** |
| 12 | `codigo_resposta` | `row[10]` | Código da resposta/nível atingido |
| 13 | `texto_resposta` | `row[11]` | Descrição textual da resposta |
| 14 | `valor_resposta` | `row[12]` | Valor numérico da resposta |

### 2.1 Observação que vale levantar na reunião

Os prefixos **`fnc_`**, **`fne_`** e **`fqs`** não são convenção do MAPA — são nomes herdados,
quase certamente de campos físicos do próprio DB2 que atravessaram a planilha sem tradução.

Isso é uma boa notícia: sugere que **as tabelas de origem já existem** e que o trabalho é de
exposição/permissão, não de modelagem do zero. Vale abrir a reunião pedindo o **de-para dos nomes
físicos** desses três campos — provavelmente identifica a tabela-fonte imediatamente e encurta
todo o resto da conversa.

---

## 3. Metadados que precisamos RECEBER do DB2

Esta é a lista objetiva do que pedir. Sem esses itens não é possível escrever o cliente de leitura
com segurança de tipos.

### 3.1 Catálogo das views/tabelas

Pedir a saída destas consultas (a equipe do DB2 roda e nos envia em CSV):

```sql
-- Estrutura completa das colunas
SELECT TABSCHEMA, TABNAME, COLNO, COLNAME, TYPENAME, LENGTH, SCALE,
       NULLS, CODEPAGE, DEFAULT, REMARKS
  FROM SYSCAT.COLUMNS
 WHERE TABSCHEMA = '<SCHEMA>'
   AND TABNAME IN ('<VIEW_1>', '<VIEW_2>')
 ORDER BY TABNAME, COLNO;

-- Volumetria e cardinalidade
SELECT TABSCHEMA, TABNAME, TYPE, CARD, NPAGES, STATS_TIME
  FROM SYSCAT.TABLES
 WHERE TABSCHEMA = '<SCHEMA>';

-- Índices disponíveis (define quais filtros serão eficientes)
SELECT TABNAME, INDNAME, COLNAMES, UNIQUERULE
  FROM SYSCAT.INDEXES
 WHERE TABSCHEMA = '<SCHEMA>';

-- Permissões efetivamente concedidas ao nosso usuário
SELECT GRANTEE, TABSCHEMA, TABNAME, SELECTAUTH
  FROM SYSCAT.TABAUTH
 WHERE GRANTEE = '<USUARIO_MAPA>';
```

> Em **DB2 for z/OS** os equivalentes são `SYSIBM.SYSCOLUMNS`, `SYSIBM.SYSTABLES`,
> `SYSIBM.SYSINDEXES` e `SYSIBM.SYSTABAUTH`. Confirmar a plataforma antes (ver 3.2).

### 3.2 Metadados de conexão

| Item | Por que precisamos | Preencher na reunião |
|---|---|---|
| **Plataforma**: DB2 LUW ou DB2 for z/OS | Muda driver, licença, catálogo e sintaxe | |
| Versão do DB2 | Compatibilidade do driver | |
| Hostname / IP | Conexão | |
| Porta | 50000/50001 (LUW) · 446 (DRDA z/OS) | |
| Nome do banco / `DATABASE` | String de conexão | |
| `LOCATION NAME` (se z/OS) | String de conexão | |
| Schema / collection das views | Qualificação dos objetos | |
| `CURRENT SCHEMA` padrão do usuário | Evita qualificar tudo manualmente | |
| **CCSID / codepage** | Crítico: EBCDIC (37) vs UTF-8 (1208) — acentuação | |
| Driver homologado | JDBC (`db2jcc4.jar`), ODBC, `ibm_db` (Python) | |
| Licença `db2jcc_license_cisuz.jar` | Obrigatória para JDBC contra z/OS | |
| TLS/SSL exigido? | `sslConnection=true` + truststore | |
| Tipo de autenticação | Usuário/senha, Kerberos, LDAP | |

### 3.3 Acessos e liberações (o "liberado" do pedido)

- [ ] **Usuário de serviço** dedicado, somente leitura, sem expiração de senha curta
      (sugestão de nome: `MAPA_RO` / `SVC_MAPA`)
- [ ] `GRANT SELECT` nas views — **nunca nas tabelas base**
- [ ] Liberação de **firewall** entre a origem da consulta e o host do DB2 (informar de onde
      partirá a conexão — ver seção 6)
- [ ] Definição de **ambiente**: existe homologação/QA? Precisamos testar antes de produção
- [ ] Política de rotação de senha e canal de entrega segura da credencial
- [ ] Limite de conexões simultâneas concedido ao usuário
- [ ] Janela de manutenção / horários em que a consulta é desaconselhada

### 3.4 De-para de tipos DB2 → PostgreSQL

Necessário para escrever a camada de leitura sem surpresa:

| DB2 | PostgreSQL | Cuidado |
|---|---|---|
| `CHAR(n)` | `char(n)` / `text` | Vem com **espaços à direita** — aplicar `TRIM()` na view |
| `VARCHAR(n)` | `varchar(n)` / `text` | Validar CCSID |
| `GRAPHIC` / `VARGRAPHIC` | `text` | Dupla codificação; evitar se possível |
| `SMALLINT` | `smallint` | |
| `INTEGER` | `integer` | |
| `DECIMAL(p,s)` | `numeric(p,s)` | **Não** converter para `float` — perde precisão |
| `DATE` | `date` | Formato de saída depende do `DATE FORMAT` da instância |
| `TIMESTAMP` | `timestamp` | Precisão de fração de segundo varia |
| `NULL` em `CHAR` | `NULL` vs `''` | Definir qual convenção a view entrega |

**Pedido explícito à equipe do DB2:** que as views já entreguem os campos **normalizados** —
`TRIM` aplicado, códigos como número quando forem número, e nomes de coluna em minúsculas ou com
alias estável. Isso evita replicar tratamento de string em toda consulta do nosso lado.

---

## 4. Views propostas

> ⚠️ **Os blocos SQL desta seção são modelos para a equipe do DB2, não scripts executáveis.**
> Tudo que aparece entre `< >` — `<SCHEMA>`, `<TABELA_ORIGEM>`, `<col_unidade>` — é lacuna a ser
> preenchida com os nomes físicos reais, que são justamente o que vamos descobrir na reunião
> (seção 2.1). Executar como está resulta em `syntax error at or near "<"`.
>
> São também **dialeto DB2 e rodam no servidor do DB2**, não no Supabase. Para o SQL que
> executamos do nosso lado, em PostgreSQL, ver a **seção 5.3**.

Duas views cobrem todo o uso atual do painel. O desenho separa **agregado** (o que o painel
carrega sempre) de **detalhe** (o que só é buscado quando o usuário clica em um estudante) —
essa separação é o que permite o ganho de espaço descrito na seção 5.

### 4.1 `VW_MAPA_AVALIACAO_BIMESTRE_DET` — detalhe por estudante

Grão: **um registro por estudante × disciplina × eixo × bimestre**.
Uso: consulta pontual de drill-down. Baixo volume por chamada, sempre filtrada.

```sql
CREATE VIEW <SCHEMA>.VW_MAPA_AVALIACAO_BIMESTRE_DET AS
SELECT
    TRIM(<col_unidade>)      AS nome_unidade,
    TRIM(<col_avaliacao>)    AS avaliacao,
    TRIM(<col_ano_escolar>)  AS ano_escolar,
    <col_bimestre>           AS bimestre,
    TRIM(<col_turma>)        AS turma,
    TRIM(<col_rema>)         AS rema_aluno,
    TRIM(<col_nome_aluno>)   AS nome_aluno,
    TRIM(<col_disciplina>)   AS fnc_disciplina,
    TRIM(<col_eixo>)         AS descricao_fne,
    TRIM(<col_fqs>)          AS fqs,
    <col_cod_resposta>       AS codigo_resposta,
    TRIM(<col_txt_resposta>) AS texto_resposta,
    <col_val_resposta>       AS valor_resposta,
    <col_ano_letivo>         AS ano_letivo
  FROM <SCHEMA>.<TABELA_ORIGEM>
 WHERE <col_bimestre> IN (1, 2);
```

**Filtros que a view precisa suportar com eficiência** (exigem índice — confirmar na seção 3.1):

| Filtro | Origem no MAPA |
|---|---|
| `bimestre` | sempre presente |
| `nome_unidade` | filtro de unidade escolar |
| `turma` | filtro de turma |
| `ano_escolar` | filtro de ano/série |
| `fnc_disciplina` | filtro de disciplina |
| `rema_aluno` | drill-down de estudante individual |
| `ano_letivo` | separação entre anos |

### 4.2 `VW_MAPA_AVALIACAO_BIMESTRE_AGG` — agregado

Grão: **turma × disciplina × eixo × resposta** (sem identificação do estudante).
Uso: alimenta os KPIs, gráficos e tabelas do painel — que é o caminho quente.

```sql
CREATE VIEW <SCHEMA>.VW_MAPA_AVALIACAO_BIMESTRE_AGG AS
SELECT
    <col_bimestre>          AS bimestre,
    TRIM(<col_unidade>)     AS nome_unidade,
    TRIM(<col_ano_escolar>) AS ano_escolar,
    TRIM(<col_turma>)       AS turma,
    TRIM(<col_disciplina>)  AS fnc_disciplina,
    TRIM(<col_eixo>)        AS descricao_fne,
    <col_val_resposta>      AS valor_resposta,
    <col_cod_resposta>      AS codigo_resposta,
    COUNT(*)                AS qtd
  FROM <SCHEMA>.<TABELA_ORIGEM>
 WHERE <col_bimestre> IN (1, 2)
 GROUP BY <col_bimestre>, <col_unidade>, <col_ano_escolar>, <col_turma>,
          <col_disciplina>, <col_eixo>, <col_val_resposta>, <col_cod_resposta>;
```

**Cardinalidade medida: 50.156 linhas**, contra 750.931 do detalhe — **15× menos**. A redução vem
de remover `rema_aluno` e `nome_aluno` do grão, que é o fator que multiplica as linhas.

O número foi apurado aplicando a mesma agregação sobre os dados atuais do Supabase, de modo que é
exatamente o que a view do DB2 devolverá. Vale citá-lo na reunião: demonstra à equipe do DB2 que a
view agregada tem custo de consulta baixo e cabe em qualquer janela de execução.

### 4.3 Compatibilidade com o que o painel já consome

As views precisam responder às mesmas perguntas que as RPCs atuais do Supabase:

| RPC atual | View que atende | Observação |
|---|---|---|
| `agrupar_bimestres` | `..._AGG` | Caminho principal do painel |
| `resumo_disciplinas_bimestre` | `..._AGG` | Agregação por disciplina |
| `estatisticas_bimestre` | `..._AGG` | KPIs |
| `obter_bimestre_registros` | `..._DET` | Lista paginada |
| `detalhe_aluno_bimestre` | `..._DET` | Filtro por `rema_aluno` |

Enquanto o formato de saída for preservado, a troca da fonte não exige reescrever a camada de
apresentação — apenas o adaptador de dados.

---

## 5. Plano de liberação de espaço

### 5.1 Sequência recomendada

1. ~~Medir o espaço real~~ — **feito**: 321 MB de 404 MB, 79% do banco (seção 1)
2. Investigar a anomalia do 2º bimestre (seção 1.2) — pode liberar espaço sem depender do DB2
3. Obter as views e o acesso de leitura (seções 3 e 4)
4. Validar paridade: conferir que os totais vindos do DB2 batem com os do Supabase
   para uma amostra de unidades. **Sem paridade confirmada, não apagar nada**
5. Substituir a fonte do painel para os bimestres 1 e 2
6. Manter as duas fontes em paralelo por um período de observação
7. Só então remover as linhas dos bimestres 1 e 2 do Supabase

### 5.2 Cuidado técnico na remoção — usar `TRUNCATE`, não `DELETE`

`DELETE` **não devolve espaço em disco no PostgreSQL**: as páginas ficam marcadas como
reutilizáveis, mas o arquivo não encolhe e a cota continua consumida. O reflexo natural é
compensar com `VACUUM FULL` — e aqui há uma armadilha concreta neste caso específico.

**`VACUUM FULL` reescreve a tabela inteira em um arquivo novo antes de liberar o antigo**, ou seja,
exige transitoriamente espaço livre equivalente ao tamanho da tabela. Com 321 MB de tabela em um
banco de 404 MB, se a cota for de 500 MB **não há folga suficiente e a operação falha por falta de
espaço** — exatamente o problema que se tentava resolver.

Como a medição mostrou que a tabela contém **apenas** linhas dos bimestres 1 e 2, ela fica vazia
após a remoção. Isso permite o caminho limpo:

```sql
-- Devolve o espaço imediatamente, sem reescrita e sem exigir folga de disco
TRUNCATE TABLE public.bimestres;
```

`TRUNCATE` descarta os arquivos de dados diretamente, é praticamente instantâneo e dispensa
`VACUUM FULL`. Exige lock exclusivo, mas por um intervalo muito curto.

**Se sobrarem linhas de outros bimestres** (situação diferente da medida hoje), aí sim é
`DELETE` seguido de compactação — e nesse caso prefira `pg_repack`, que compacta sem lock
prolongado e sem exigir o dobro de espaço, em vez de `VACUUM FULL`.

> Antes de qualquer uma das duas operações: **backup**. Uma vez executado o `TRUNCATE`, não há
> desfazer fora de restauração de backup.

### 5.3 Ganho imediato, independente do DB2 — SQL executável no Supabase

Este é o **único bloco do documento pronto para rodar como está**, no SQL Editor do Supabase.
Dialeto PostgreSQL, sem placeholders.

A cardinalidade do agregado já foi medida: **50.156 linhas**, contra 750.931 do detalhe — uma
redução de **15×**, ou 93,3% menos linhas. O agregado deve ocupar em torno de 10 a 15 MB.

#### Passo 1 — criar a tabela agregada

```sql
CREATE TABLE public.bimestres_agg AS
SELECT bimestre, nome_unidade, ano_escolar, turma,
       fnc_disciplina, descricao_fne, valor_resposta, codigo_resposta,
       COUNT(*) AS qtd
  FROM public.bimestres
 WHERE bimestre IN (1, 2)
 GROUP BY 1, 2, 3, 4, 5, 6, 7, 8;
```

#### Passo 2 — validar paridade ANTES de apagar qualquer coisa

```sql
SELECT (SELECT SUM(qtd) FROM public.bimestres_agg)                          AS soma_agregado,
       (SELECT COUNT(*) FROM public.bimestres WHERE bimestre IN (1, 2))     AS linhas_originais;
```

Os dois valores precisam bater **exatamente em 750.931**. Se não baterem, parar e investigar —
não prosseguir.

#### Passo 3 — índice para os filtros do painel

```sql
CREATE INDEX idx_bimestres_agg_filtros
    ON public.bimestres_agg (bimestre, nome_unidade, ano_escolar, turma);

CREATE INDEX idx_bimestres_agg_disciplina
    ON public.bimestres_agg (bimestre, fnc_disciplina);
```

#### Passo 4 — conferir o tamanho obtido

```sql
SELECT pg_size_pretty(pg_total_relation_size('public.bimestres_agg')) AS agregado,
       pg_size_pretty(pg_database_size(current_database()))           AS banco;
```

#### Passo 5 — repontar a RPC, e só então liberar o espaço

> 🛑 **Ordem obrigatória.** O painel lê a tabela `bimestres` diretamente e através da RPC
> `agrupar_bimestres`. Executar o `TRUNCATE` da seção 5.2 **antes** de repontar a RPC para
> `bimestres_agg` derruba as telas de avaliação. Repontar primeiro, validar o painel, truncar
> depois.

**Risco associado:** a definição de `agrupar_bimestres` **não está versionada neste repositório** —
existe apenas dentro do Supabase. Antes de alterá-la, exportar o código atual e commitá-lo em
`sql/`, para que exista ponto de retorno. Recomenda-se aproveitar a ocasião para versionar também
as demais RPCs (`obter_bimestre_registros`, `resumo_disciplinas_bimestre`,
`estatisticas_bimestre`, `detalhe_aluno_bimestre`).

```sql
-- Exportar a definição atual antes de qualquer alteração
SELECT pg_get_functiondef(oid)
  FROM pg_proc
 WHERE proname IN ('agrupar_bimestres', 'obter_bimestre_registros',
                   'resumo_disciplinas_bimestre', 'estatisticas_bimestre',
                   'detalhe_aluno_bimestre');
```

#### Resultado esperado

| | Linhas | Espaço |
|---|---|---|
| Hoje — `bimestres` | 750.931 | 321 MB |
| Depois — `bimestres_agg` | 50.156 | ~10 a 15 MB |
| **Banco completo** | — | **404 MB → ~95 MB** |

Isso entrega a maior parte da economia porque o painel consome majoritariamente agregado — a
própria função `agrupar_bimestres` existe exatamente para "evitar baixar a tabela bimestres
inteira", conforme o comentário no código. O detalhe por estudante seria o único uso temporariamente
indisponível, retornando quando as views do DB2 entrarem no ar.

**Recomendação:** tratar 5.3 como caminho paralelo, não como substituto do pedido ao DB2. Ele
resolve a urgência de espaço; as views resolvem a dependência estrutural — sem elas, o detalhe por
estudante fica indisponível e a base volta a crescer nos próximos bimestres.

---

## 6. Arquitetura de integração — decisão necessária

**Restrição que precisa ser dita na reunião:** o PostgreSQL gerenciado do Supabase **não permite
instalar `db2_fdw`** nem extensões arbitrárias. A ideia de "apontar o Supabase direto para o DB2"
não é executável. Necessariamente haverá um componente intermediário.

| | Opção A — ETL agendado | Opção B — API intermediária | Opção C — Bridge sob demanda |
|---|---|---|---|
| **Como funciona** | Job na rede da PMRP lê as views e grava o agregado no Supabase | Serviço na rede da PMRP expõe as views por REST; MAPA consome | Edge Function chama um endpoint interno que fala com o DB2 |
| **Firewall** | Só saída do job → DB2 | Entrada no serviço + saída → DB2 | Entrada no serviço + saída → DB2 |
| **Dados no Supabase** | Só o agregado | Nenhum | Nenhum |
| **Dependência de rede em tempo real** | Não | Sim | Sim |
| **Esforço** | Baixo | Médio | Médio |
| **Risco de indisponibilidade** | Baixo (dado local) | Painel cai se o serviço cair | Painel cai se o serviço cair |

**Recomendação: Opção A.** Como os dados são fixos, não há benefício em consulta em tempo real —
uma carga única já resolve, e o painel continua funcionando mesmo se o DB2 estiver indisponível.
É também a opção com menor superfície de exposição de rede, o que costuma ser o ponto mais
sensível na aprovação. As opções B e C só se justificam se houver exigência de acesso ao detalhe
por estudante em tempo real.

O projeto já tem precedente de padrão bridge em `supabase/functions/central-bridge`, então a
Opção C não seria território desconhecido caso a equipe prefira esse caminho.

---

## 7. LGPD e segurança

Os dados incluem **nome de estudante e registro de matrícula** — dado pessoal de menores, com
proteção reforçada. Pontos a alinhar:

- [ ] A view de detalhe precisa mesmo expor `nome_aluno`, ou o `rema_aluno` basta como chave?
      Reduzir o escopo facilita a aprovação
- [ ] Registrar a **base legal** do tratamento e a finalidade declarada
- [ ] Confirmar se há exigência de log de auditoria de acesso do lado do DB2
- [ ] Credencial de serviço **nunca** em repositório — variável de ambiente/secret
- [ ] `GRANT` restrito a `SELECT` nas views, sem acesso às tabelas base
- [ ] Definir retenção: por quanto tempo o agregado fica no Supabase

O projeto já possui pseudonimização implementada em `demo-mode.js` (nomes e RA substituídos para
demonstrações), o que é um argumento favorável a apresentar: há tratamento de privacidade
estabelecido, não improvisado.

---

## 8. Pauta sugerida para a reunião

**Bloco 1 — Contexto (5 min)**
Abrir com o número medido: **a tabela `bimestres` é 79% do banco inteiro — 321 MB de 404 MB, em
750.931 linhas**. Argumento central: dado fixo, sem escrita, já existente no DB2.

**Bloco 2 — Identificação da origem (15 min)**
De-para dos campos `fnc_disciplina`, `descricao_fne`, `fqs`. Qual tabela/schema. Confirmar
plataforma (LUW ou z/OS).

**Bloco 3 — Views (15 min)**
Apresentar as duas views da seção 4. Definir nomes, schema e responsável pela criação.

**Bloco 4 — Acessos (10 min)**
Percorrer o checklist 3.3. Definir ambiente de teste.

**Bloco 5 — Arquitetura (10 min)**
Apresentar as três opções da seção 6 com a recomendação. A decisão de firewall costuma ser a de
maior prazo — sair da reunião com ela encaminhada.

**Bloco 6 — Prazos e responsáveis (5 min)**

### 8.1 Perguntas em aberto — levar por escrito

1. `fqs` significa o quê? É código, sequencial ou classificação?
2. Existe `ano_letivo` na origem? O layout atual não tem esse campo, e sem ele os anos se misturam
3. `codigo_resposta` e `valor_resposta` são campos distintos na origem ou derivados?
4. Qual a chave primária real do registro na origem?
5. Os dados dos bimestres 1 e 2 estão **fechados** no DB2, ou ainda sofrem correção retroativa?
6. **O 2º bimestre tem 78% mais registros que o 1º na nossa base. Na origem essa proporção se
   confirma?** Se o DB2 mostrar volumes equivalentes entre os dois, nossa carga do 2º bimestre
   está duplicada — e o problema é nosso, não de armazenamento
7. Existe histórico de anos anteriores disponível? (pode viabilizar série histórica sem custo de armazenamento)
8. Há ambiente de homologação para testar antes de produção?
9. Qual o prazo interno típico para criação de view e concessão de acesso?

---

## 9. Resumo de uma linha

Precisamos de **duas views somente-leitura no DB2** (detalhe e agregado dos bimestres 1 e 2), de
**um usuário de serviço com `SELECT`**, da **liberação de firewall** e dos **metadados de conexão e
de catálogo** — para deixar de manter no Supabase **750.931 linhas de dados que não mudam mais,
hoje responsáveis por 79% de todo o banco**.
