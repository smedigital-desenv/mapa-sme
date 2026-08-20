---
name: auditoria-rls
description: Audita as invariantes de segurança do banco Supabase deste sistema da rede SME (RLS, policies permissivas, views materializadas, grants para anon, SECURITY DEFINER). Use quando pedirem auditoria de segurança do banco, verificação de RLS, revisão de policies, ou antes de publicar mudanças de esquema.
---

# Auditoria de RLS — rede SME Ribeirão Preto

Os repositórios desta rede são públicos e os bancos tratam dados pessoais de
crianças. As invariantes abaixo estão documentadas no CLAUDE.md e **quebrar
qualquer uma expõe dado**. Esta skill as transforma em verificação executável.

## Como executar

1. **Com o MCP do Supabase conectado** (plugin `supabase`): execute cada
   consulta abaixo no projeto do repositório atual e monte o relatório.
2. **Sem MCP**: entregue o bloco de SQL completo para a pessoa rodar no
   SQL Editor do Supabase e interprete o resultado que ela colar.
   Lembre: o SQL Editor envolve tudo numa transação — estas consultas são
   somente leitura, então podem rodar juntas sem risco.

## Verificações (rodar todas, na ordem)

### 1. Policy permissiva sem condição real — a mais grave

Policies permissivas se somam com OR: uma única `using (true)` anula todas as
outras da tabela.

```sql
select tablename, policyname, cmd, roles from pg_policies
 where schemaname = 'public' and qual = 'true'
   and cmd in ('SELECT', 'ALL')
 order by tablename;
```

**Aprovado se:** só tabelas de catálogo/configuração aparecem (sem dado
pessoal). Qualquer tabela com dado de aluno/pessoa aqui é FALHA CRÍTICA.

### 2. Grants para anon — deve ser vazio

```sql
select table_name, privilege_type from information_schema.role_table_grants
 where grantee = 'anon' and table_schema = 'public'
union all
select routine_name, 'EXECUTE' from information_schema.role_routine_grants
 where grantee = 'anon' and routine_schema = 'public';
```

**Aprovado se:** zero linhas. O papel `anon` não tem permissão em nada nesta
rede. Antes de propor qualquer `grant ... to anon`, releia a seção 3 do
CLAUDE.md — e não proponha.

### 3. Views materializadas alcançáveis — ignoram RLS

View materializada é cópia física dos dados; proteger só a tabela de origem é
proteção de fachada.

```sql
select m.matviewname, g.grantee, g.privilege_type
  from pg_matviews m
  join information_schema.role_table_grants g
    on g.table_name = m.matviewname and g.table_schema = m.schemaname
 where m.schemaname = 'public'
   and g.grantee in ('anon', 'authenticated');
```

**Aprovado se:** zero linhas. Acesso a matview passa por função
`SECURITY DEFINER` com recorte por dentro, nunca por grant direto.

### 4. Tabela com RLS desligado

```sql
select c.relname
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
   and not c.relrowsecurity
 order by 1;
```

**Aprovado se:** só catálogo/configuração sem dado pessoal. Toda tabela com
dado pessoal precisa de RLS ligado E policy com condição real (a verificação
1 cobre a segunda parte).

### 5. Funções SECURITY DEFINER — revisar recorte

```sql
select p.proname,
       pg_get_function_identity_arguments(p.oid) as argumentos
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
 order by 1;
```

Para cada função listada: ela roda com o poder do dono e **ignora RLS**. Ou
aplica o recorte por unidade/usuário por dentro, ou não deveria ser DEFINER.
Liste as funções e, se alguma for desconhecida, leia o corpo
(`pg_get_functiondef`) antes de aprovar.

### 6. Desempenho das policies — função sem InitPlan

```sql
select tablename, policyname, qual from pg_policies
 where schemaname = 'public'
   and qual ~ 'public\.[a-z_]+\(\)'
   and qual !~ '\(\s*SELECT';
```

Chamada de função em policy sem envolver em `(select ...)` é reavaliada linha
a linha — timeout até em tabela pequena. Cada linha aqui é candidata a
reescrita no padrão `using ( (select public.minha_funcao()) or ... )`.

## Relatório

Entregue um quadro com as 6 verificações, veredito de cada uma
(✅ aprovada / ⚠️ revisar / ❌ falha) e, para falhas, o SQL de correção
proposto — **sem executar** correção sem aprovação explícita, e nunca
versionando `.sql` no repositório (entregue no chat).
