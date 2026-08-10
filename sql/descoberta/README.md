# Scripts de descoberta — origem das avaliações bimestrais

Dois scripts que respondem, juntos, à pergunta que trava a criação das views no DB2:
**quais são os nomes reais das tabelas e colunas de origem?**

Ninguém precisa saber isso de cor. O catálogo do DB2 responde sozinho.

| Arquivo | Onde roda | Quem roda | O que devolve |
|---|---|---|---|
| `01_supabase_perfil_bimestres.sql` | Supabase (PostgreSQL) | nós | A especificação exata do que pedir: tipos, tamanhos, domínios, grão |
| `02_db2_localizar_origem.sql` | DB2 | equipe do DB2 / DBA | Qual tabela e quais colunas alimentam as avaliações |

Nenhum dos dois altera dado algum. São só leitura.

---

## Ordem de uso

### 1. Rodar o Script A (nosso lado), antes da reunião

Abrir o SQL Editor do Supabase e executar `01_supabase_perfil_bimestres.sql`, consulta por
consulta. São 10 blocos numerados de **A1** a **A10**.

Guardar as saídas — elas descrevem o que precisamos que a view do DB2 entregue. Três blocos são
os mais importantes:

- **A3** define o `VARCHAR(n)` a pedir em cada campo, sem truncar nem pedir folga à toa
- **A4** lista os domínios fechados, que é como vamos validar que a view do DB2 devolve o mesmo conjunto
- **A6** e **A7** desvendam `fqs`, `codigo_resposta` e `valor_resposta` — hoje o maior ponto cego do mapeamento

> **LGPD:** a consulta A5 mascara `rema_aluno` e omite `nome_aluno` de propósito. Não trocar por
> `SELECT *` — não há motivo para circular nome de estudante em documento de reunião.

### 2. Entregar o Script B à equipe do DB2, na reunião

`02_db2_localizar_origem.sql` está organizado em blocos **B0** a **B8**, com versões separadas para
**DB2 LUW** (catálogo `SYSCAT`) e **DB2 for z/OS** (catálogo `SYSIBM`). O bloco **B0** identifica
qual é a plataforma, caso ainda não saibamos.

Pedir a saída de **B1, B2 e B3** — esses três localizam a tabela. Os demais só fazem sentido depois,
com o nome em mãos.

### 3. Montar a view com os nomes reais

Com as saídas de A e B lado a lado, o modelo de view em
[`docs/DB2_METADADOS_VIEWS.md`](../../docs/DB2_METADADOS_VIEWS.md) (seção 4) deixa de ter lacunas e
vira DDL executável.

---

## Por que o B1 é a consulta mais importante

Os campos que temos hoje chamam-se `fnc_disciplina`, `descricao_fne` e `fqs`. Esses prefixos
**FNC / FNE / FQS não são convenção do MAPA** — são nomes herdados que atravessaram a planilha
sem tradução, quase certamente vindos de campos físicos do próprio DB2.

O bloco **B1** procura no catálogo por colunas que comecem com esses prefixos. Se a hipótese
estiver certa, ele aponta direto para a tabela de origem, e boa parte da reunião fica resolvida
em uma consulta.

**B3 é a rede de segurança**, caso a hipótese falhe: classifica cada coluna do banco em um conceito
de negócio — aluno, turma, disciplina, bimestre, resposta — e ranqueia as tabelas por quantos
conceitos reúnem ao mesmo tempo. A tabela de avaliação deve estar no topo.

---

## Uma pergunta que o Script B também responde

Na nossa base, o 2º bimestre tem **481.230 linhas contra 269.701 do 1º** — 78% a mais. O bloco
**B5** conta as linhas por bimestre na origem.

Se lá os dois volumes forem parecidos, **a nossa carga do 2º bimestre está duplicada** — e parte do
problema de espaço é nosso, resolvível sem depender de nenhuma liberação externa. Os blocos **A9** e
**A10** testam a mesma hipótese do nosso lado.
