# Conexão com o DB2 — o que pedir, o que usamos e o que podemos usar

> Documento 3 de 3. Os outros: [`DB2_METADADOS_VIEWS.md`](DB2_METADADOS_VIEWS.md) (ficha técnica) e
> [`GUIA_REUNIAO_DB2_NAO_TECNICO.md`](GUIA_REUNIAO_DB2_NAO_TECNICO.md) (guia de bolso).
>
> Responde a duas perguntas: o que dizer quando pedirem "os metadados", e como os dois sistemas vão
> efetivamente conversar depois que as views forem liberadas.

---

## 1. "Metadados" são duas coisas — pergunte qual

Se alguém pede "os metadados" sem qualificar, a pergunta está incompleta. São dois conjuntos,
pedidos a pessoas diferentes.

| | **Conjunto A — estrutura** | **Conjunto B — conexão** |
|---|---|---|
| Descreve | O que o dado é | Como chegar até ele |
| Contém | Colunas, tipos, tamanhos, obrigatoriedade, índices, volume | Endereço, porta, banco, plataforma, driver, autenticação, codificação |
| Quem responde | O DBA, no catálogo do DB2 | Infraestrutura e segurança |
| Onde está a lista | Seção 3.1 da ficha técnica | Seção 2 deste documento |

### A resposta

> "Preciso dos dois: a **estrutura** das views — colunas, tipos e tamanhos — e os **dados de
> conexão** — endereço, porta, banco, driver e codificação. Trouxe a lista de cada um."

Existe um terceiro sentido: o **significado de negócio** de cada campo. Esse já mapeamos sozinhos,
analisando os dados. Não precisa pedir.

---

## 2. Ficha de conexão

A **primeira linha trava tudo**: LUW ou z/OS muda driver, licença, catálogo e até se haverá custo.

| Item | Para que serve | Exemplo | Resposta |
|---|---|---|---|
| **Plataforma** | Define driver, licença e sintaxe | `LUW` ou `z/OS` | |
| Versão | Compatibilidade do driver | `11.5` | |
| Host / IP | Onde o servidor está | `db2.pmrp.sp.gov.br` | |
| Porta | Por onde entrar | `50000` LUW · `446` z/OS | |
| Nome do banco | Qual base dentro do servidor | `EDUPROD` | |
| `LOCATION NAME` | Só em z/OS; substitui o nome do banco | `DB2PRD` | |
| Schema das views | Onde as views ficam | `EDUC` | |
| Usuário | A conta de leitura criada para nós | `MAPA_RO` | |
| Autenticação | Como provar identidade | usuário/senha, Kerberos, LDAP | |
| **TLS/SSL obrigatório?** | Se a conexão precisa ser cifrada | sim/não · porta e certificado | |
| **CCSID / codepage** | Se a acentuação vai chegar certa | `1208` UTF-8 · `37` EBCDIC | |
| Driver homologado | Qual eles aceitam e suportam | JDBC, ODBC, `ibm_db` | |
| Origem da conexão | Define a regra de firewall | IP da máquina/servidor | |
| Limite de conexões | Quantas simultâneas podemos abrir | `2` | |
| Janela de manutenção | Quando não consultar | domingo 2h–5h | |

### Pergunta de custo que costuma passar batido

**Se for DB2 for z/OS, perguntar sobre licenciamento do DB2 Connect.** Conectar a um DB2 de
mainframe a partir de aplicação distribuída normalmente exige essa licença — via
`db2jcc_license_cisuz.jar` no caso do JDBC.

Pode ser um custo ou um bloqueio administrativo. Melhor descobrir na reunião do que depois de tudo
aprovado.

---

## 3. O que usamos hoje

| Peça | Tecnologia | Onde roda | Alcança o DB2? |
|---|---|---|---|
| Painel (telas) | HTML + JS puro | GitHub Pages | ❌ navegador |
| Banco de dados | Supabase / PostgreSQL | Nuvem Supabase | ❌ sem extensão |
| `central-bridge` | Edge Function (Deno) | Nuvem Supabase | ❌ sem driver |
| Deploy | GitHub Actions | Runner da nuvem | ❌ fora da rede |
| `devolutivas-local.mjs` | Node 18+, sem dependências | Máquina local | ✅ se estiver na rede |
| Rotinas legadas | Google Apps Script | Nuvem Google | ❌ JDBC limitado |

> **A última linha útil já existe.** O `tools/relatorios/devolutivas-local.mjs` é exatamente o
> formato de que precisamos: script Node que lê credenciais de um `.env` local e grava no Supabase.
> A rotina do DB2 é esse mesmo script com um passo de leitura a mais.

---

## 4. O que não funciona — e por quê

### 4.1 O painel consultar o DB2 direto

O painel roda **no navegador do usuário**. A senha do DB2 teria que ser enviada para o navegador de
cada pessoa — ou seja, publicada. Além disso, navegador não fala o protocolo do DB2.
**Nunca será uma opção.**

### 4.2 O Supabase conectar no DB2

Existe a extensão `db2_fdw`, que apresentaria uma tabela remota como se fosse local. Mas o Supabase
é **PostgreSQL gerenciado** e não permite instalar extensões arbitrárias.

Em um PostgreSQL próprio isso mudaria e seria o caminho mais simples de todos — vale registrar, caso
a hospedagem mude no futuro.

### 4.3 A Edge Function do Supabase buscar no DB2

Dois impedimentos. O driver do DB2 é componente nativo, e o ambiente das Edge Functions (Deno) não
o suporta. E mesmo que suportasse, a função roda **na nuvem da Supabase** — o DB2 teria que ser
exposto à internet, o que ninguém vai autorizar, com razão.

### 4.4 O Google Apps Script buscar no DB2

O Apps Script *tem* serviço de JDBC, o que dá a impressão de que resolveria. Mas suporta apenas
**MySQL, SQL Server e Oracle** — DB2 não está na lista. E também roda fora da rede.

### O padrão por trás dos quatro

Todos falham pelo mesmo motivo: **rodam fora da rede da Prefeitura**. Essa é a restrição que define
a arquitetura, e é por isso que a liberação de firewall é o item de maior prazo do pedido.

---

## 5. O que podemos usar

Regra única: **precisa rodar dentro da rede da Prefeitura** — uma máquina, um servidor ou um runner
próprio. A partir daí, quatro opções de driver.

| Opção | Driver | Instalação | Bom quando |
|---|---|---|---|
| **Java + JDBC** | `db2jcc4.jar` | Só o `.jar` — Tipo 4 é Java puro, sem cliente DB2 | A equipe do DB2 já é Java, ou é z/OS |
| **Python** | `ibm_db` | `pip install ibm_db` — traz o cliente junto | Ninguém tem preferência; menor atrito |
| **Node.js** | `ibm_db` (npm) | Módulo nativo — pode exigir ferramentas de compilação | Manter tudo em uma linguagem só |
| **ODBC** | IBM Data Server Driver | Instalação de cliente na máquina | Já existe padrão ODBC na casa |

**Recomendação:** não decidir sozinho. Uma das perguntas da ficha é "qual driver vocês homologam?".
Se a resposta for "tanto faz", ficamos com **Python + `ibm_db`**. Se a casa for Java — provável, se
for mainframe — o **JDBC Tipo 4** ganha, porque não exige instalar cliente nenhum: basta o `.jar`.

### 5.1 O desenho recomendado

| # | Passo | Onde acontece |
|---|---|---|
| 1 | Script lê as views do DB2 | Máquina dentro da rede da PMRP |
| 2 | Agrega e descarta o que não é necessário | Mesma máquina, em memória |
| 3 | Grava o resumo no Supabase via REST | Saída para a internet, já sem dado pessoal |
| 4 | Painel lê do Supabase, como hoje | Nada muda no navegador |

O passo 2 é o que mantém o desenho seguro e leve: o que sai da rede da Prefeitura é o **agregado por
turma — cerca de 50 mil linhas, sem nome e sem matrícula**. O detalhe individual nunca é copiado.

### 5.2 Duas boas práticas para citar ao DBA

- **Consultar com `WITH UR`** (leitura não confirmada): nossa consulta não trava linhas em uso pelo
  sistema deles. DBA de produção valoriza ouvir isso.
- **Paginar com `FETCH FIRST n ROWS ONLY`**, em vez de trazer tudo de uma vez.

---

## 6. Teste de fumaça — provar que funciona

Testar **nesta ordem**. Cada passo isola uma causa diferente; pular etapas leva a culpar a coisa
errada.

### Passo 1 — a rede chega lá?

```bash
# Se falhar aqui, é firewall. Não adianta mexer em senha nem driver.
nc -zv <HOST> <PORTA>

# Alternativa onde não houver nc:
telnet <HOST> <PORTA>
```

### Passo 2a — a credencial funciona? (Python)

```bash
pip install ibm_db
```

```python
import ibm_db
c = ibm_db.connect(
    "DATABASE=<BANCO>;HOSTNAME=<HOST>;PORT=<PORTA>;"
    "PROTOCOL=TCPIP;UID=<USUARIO>;PWD=<SENHA>;", "", "")
print("conectou")
```

Se exigir TLS, acrescentar à string: `SECURITY=SSL;SSLServerCertificate=<caminho do certificado>;`

### Passo 2b — a credencial funciona? (JDBC, sem escrever código)

```bash
# O próprio driver traz um utilitário de teste embutido.
java -cp db2jcc4.jar com.ibm.db2.jcc.DB2Jcc \
     -url "jdbc:db2://<HOST>:<PORTA>/<BANCO>" \
     -user <USUARIO> -password <SENHA>
```

Em z/OS a URL usa o *location name* no lugar do nome do banco, e o
`db2jcc_license_cisuz.jar` precisa estar no classpath.

### Passo 3 — a view responde, e a acentuação chegou certa?

```sql
SELECT COUNT(*) AS total
  FROM <SCHEMA>.VW_MAPA_AVALIACAO_BIMESTRE_AGG WITH UR;

-- Confere acentuação: deve sair MÚSICA, não M?SICA
SELECT DISTINCT descricao_fne
  FROM <SCHEMA>.VW_MAPA_AVALIACAO_BIMESTRE_AGG
 FETCH FIRST 20 ROWS ONLY WITH UR;
```

O passo 3 valida o **CCSID**. Se a acentuação sair errada aqui, o problema é de codificação e se
resolve na configuração da conexão — mas só se for detectado antes de a carga rodar por inteiro.

### 6.1 Onde a senha do DB2 vai morar

Em um arquivo `.env` na máquina que roda a rotina, **nunca no repositório**. O `.gitignore` do
projeto já bloqueia `.env` e `*.sql` por política de proteção de dados — o padrão já existe e é o
mesmo usado hoje em `tools/relatorios/.env`.

Se a rotina rodar em servidor, usar o cofre de segredos que a Prefeitura já utilizar. **Não receber
a senha por e-mail nem por mensagem** — combinar o canal na reunião.

---

## 7. O que responder agora

Mensagem pronta para enviar:

---

> Sobre os metadados: preciso de dois conjuntos, porque são coisas diferentes.
>
> **1. Estrutura das views** — nome das colunas, tipo, tamanho, se aceita vazio, índices e
> quantidade de linhas. Tenho as consultas de catálogo prontas para o DBA rodar; envio o arquivo.
>
> **2. Dados de conexão** — para conseguirmos acessar de fato:
>
> - É DB2 LUW ou DB2 for z/OS, e qual versão
> - Host, porta e nome do banco (ou *location name*, se for z/OS)
> - Schema onde as views ficarão
> - Se exige TLS/SSL, e qual certificado
> - Qual o CCSID / codepage do banco
> - Qual driver vocês homologam (JDBC, ODBC ou `ibm_db`)
> - De qual endereço nossa conexão deve partir, para a regra de firewall
>
> Só precisamos de **leitura**, e apenas das views — nunca das tabelas de origem. Se for z/OS,
> também preciso saber se há exigência de licença do DB2 Connect.

---

A primeira pergunta — **LUW ou z/OS** — é a que destrava as outras. Se conseguir só essa resposta,
já é progresso: ela define driver, licença e metade da ficha.
