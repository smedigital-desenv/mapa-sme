# Migração do módulo Relatórios para o Supabase

Este documento reúne **tudo o que precisa ser aplicado** para migrar as visitas e as
devolutivas do Google Sheets/Apps Script para o Supabase, mantendo o Google Forms ativo.

> ℹ️ SQL fica versionado aqui (em blocos de código) porque `*.sql` é ignorado pelo Git.
> É schema puro, sem dados. Rode-o no **Supabase ▸ SQL Editor**.

---

## 1. Arquitetura

O formulário continua no ar; a coleta não muda. O que muda é o **destino de leitura**:

```
Google Forms ──▶ Google Sheets (Fundamental/Infantil/…2)
                      │
                      │  visitas-sync.gs  (Apps Script, GATILHO POR TEMPO — 1x/hora)
                      ▼
                 Supabase ──▶ relatorios_visitas   (upsert idempotente)
                             relatorios_devolutivas (geradas por IA)
                      ▲
                      │  relatorios.html lê via RPC (com RLS por escola)
```

- **Coleta**: Google Forms → Sheets (inalterado).
- **Sync**: `visitas-sync.gs` leva as respostas novas/alteradas para `relatorios_visitas`
  de forma incremental e idempotente (upsert por `visita_uid`). É uma **rotina agendada**.
- **Devolutivas**: passam a viver em `relatorios_devolutivas` (geradas por IA e gravadas lá).
- **Front**: `relatorios.html` lê do Supabase (RPC + RLS), como as demais telas do MAPA.

---

## 2. Ordem de execução

1. **Criar as tabelas** (seção 3) no Supabase.
2. **Criar as RPCs de leitura** (seção 4) e ligar o RLS (seção 5).
3. **Instalar a rotina de sync** (`visitas-sync.gs`, seção 6) e rodar 1x manualmente.
4. **Conferir** os dados em `relatorios_visitas`.
5. *(Passo seguinte)* Migrar a leitura do `relatorios.html` para as RPCs (seção 7).
6. *(Passo seguinte)* Carga inicial das devolutivas geradas por IA (seção 8).

---

## 3. Schema e tabelas

> As tabelas ficam no schema **`relatorios`** (não em `public`). As **funções (RPCs)
> ficam em `public`** apontando para cá — assim o `relatorios.html` segue chamando
> `MAPA_SB.rpc(...)` sem precisar saber do schema. Para trocar o nome do schema, é só
> substituir `relatorios` por outro nome neste SQL **e** no `var SCHEMA` do
> `visitas-sync.gs`.

```sql
-- ── Schema + permissões ──────────────────────────────────────────────────────
create schema if not exists relatorios;

-- O service_role (usado pelo sync via PostgREST) precisa de acesso ao schema.
grant usage on schema relatorios to service_role;
grant all privileges on all tables in schema relatorios to service_role;
alter default privileges in schema relatorios
  grant all privileges on tables to service_role;

-- ── Visitas (espelho das 4 abas do formulário) ───────────────────────────────
create table if not exists relatorios.relatorios_visitas (
  visita_uid      text primary key,          -- MD5(segmento|carimbo|escola) — estável
  segmento        text not null,             -- fundamental | infantil | fundamental2 | infantil2
  escola          text not null,
  regional        text,
  periodo         text,
  responsavel     text,
  email           text,
  data_visita     date,                       -- data da visita (parseada)
  data_visita_txt text,                       -- string original (casa com a devolutiva)
  carimbo         timestamptz,                -- timestamp da submissão do Forms
  dados           jsonb not null,             -- linha completa (o mesmo objeto que o front usa)
  sincronizado_em timestamptz not null default now()
);
create index if not exists idx_relat_visitas_segmento on relatorios.relatorios_visitas (segmento);
create index if not exists idx_relat_visitas_escola   on relatorios.relatorios_visitas (escola);
create index if not exists idx_relat_visitas_regional on relatorios.relatorios_visitas (regional);

-- bump de sincronizado_em quando o upsert atualizar uma visita já existente
create or replace function relatorios.tg_relat_visitas_touch()
returns trigger language plpgsql as $$
begin new.sincronizado_em := now(); return new; end $$;

drop trigger if exists trg_relat_visitas_touch on relatorios.relatorios_visitas;
create trigger trg_relat_visitas_touch
  before update on relatorios.relatorios_visitas
  for each row execute function relatorios.tg_relat_visitas_touch();

-- ── Cadastro oficial de escolas (EMEF/EMEI) → cobertura nas Estatísticas ──────
-- Espelha as abas EMEF/EMEI da planilha (nome + regional). Lido via RPC relat_escolas().
create table if not exists relatorios.relatorios_escolas (
  segmento text not null,                     -- fundamental | infantil (base)
  nome     text not null,
  regional text,
  primary key (segmento, nome)
);

-- ── Devolutivas (geradas por IA) ─────────────────────────────────────────────
create table if not exists relatorios.relatorios_devolutivas (
  id            text primary key,            -- mesmo hash do _gerarId (regerar sobrescreve)
  tipo          text not null default 'individual', -- individual | rede | regional | sintese_global
  segmento      text,
  escola        text,
  regional      text,
  data_visita   text,                         -- string (casa com relatorios_visitas.data_visita_txt)
  visita_uid    text references relatorios.relatorios_visitas(visita_uid) on delete set null,
  salvo_em      timestamptz not null default now(),
  dados         jsonb not null,              -- payload _dados (o mesmo que o front renderiza)
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_relat_dev_escola   on relatorios.relatorios_devolutivas (escola);
create index if not exists idx_relat_dev_segmento on relatorios.relatorios_devolutivas (segmento);
create index if not exists idx_relat_dev_tipo     on relatorios.relatorios_devolutivas (tipo);

create or replace function relatorios.tg_relat_dev_touch()
returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;

drop trigger if exists trg_relat_dev_touch on relatorios.relatorios_devolutivas;
create trigger trg_relat_dev_touch
  before update on relatorios.relatorios_devolutivas
  for each row execute function relatorios.tg_relat_dev_touch();
```

> **Exponha o schema para o PostgREST** (necessário para o sync gravar via REST):
> Supabase ▸ **Project Settings → API → Exposed schemas** → adicione `relatorios`
> (mantendo `public`). O RLS abaixo mantém as tabelas fechadas para leitura direta
> mesmo expostas.

---

## 4. RPCs de leitura (isolamento por escola)

O padrão do MAPA é ler dados por **RPC** (como `freq_*`, `ee_*`). As funções abaixo são
`SECURITY DEFINER` e reaproveitam o `minhas_permissoes()` que o `auth.js` já usa —
assim o filtro por escola sai do **mesmo** modelo de permissão do resto do sistema,
sem duplicar regra.

> ⚠️ **Único ponto a conferir contra o seu schema:** o formato de retorno de
> `minhas_permissoes()`. O `auth.js` lê `perfil.is_super_admin` e `escolas[].nome`,
> então assumo um JSON com as chaves `perfil` e `escolas`. Se o seu retorno tiver
> outra forma (ex.: nomes de coluna diferentes), ajuste os dois `->`/`#>>` abaixo.

As funções vivem em **`public`** (o front chama `MAPA_SB.rpc(...)` normal) mas leem as
tabelas do schema `relatorios`. `search_path = relatorios, public` deixa referenciar as
tabelas sem qualificar e ainda enxergar `minhas_permissoes()` do `public`.

```sql
-- Visitas que o usuário atual pode ver. p_segmento: fundamental|infantil (base) — inclui a variante "2".
create or replace function public.relat_visitas(p_segmento text default null)
returns setof relatorios.relatorios_visitas
language plpgsql security definer set search_path = relatorios, public as $$
declare perms jsonb; admin boolean; escolas text[];
begin
  perms := to_jsonb(public.minhas_permissoes());
  if perms is null or coalesce((perms->>'autorizado')::boolean, false) = false then
    return;                                   -- sem acesso → nada
  end if;
  admin := coalesce((perms#>>'{perfil,is_super_admin}')::boolean, false);

  if admin then
    return query
      select * from relatorios.relatorios_visitas v
      where p_segmento is null
         or v.segmento = p_segmento
         or v.segmento = p_segmento || '2';
    return;
  end if;

  select array_agg(e->>'nome')
    into escolas
    from jsonb_array_elements(coalesce(perms->'escolas', '[]'::jsonb)) e;

  return query
    select * from relatorios.relatorios_visitas v
    where v.escola = any(coalesce(escolas, array[]::text[]))
      and ( p_segmento is null
            or v.segmento = p_segmento
            or v.segmento = p_segmento || '2' );
end $$;

-- Devolutivas que o usuário atual pode ver (individuais filtram por escola;
-- rede/regional/síntese só para super admin).
create or replace function public.relat_devolutivas()
returns setof relatorios.relatorios_devolutivas
language plpgsql security definer set search_path = relatorios, public as $$
declare perms jsonb; admin boolean; escolas text[];
begin
  perms := to_jsonb(public.minhas_permissoes());
  if perms is null or coalesce((perms->>'autorizado')::boolean, false) = false then
    return;
  end if;
  admin := coalesce((perms#>>'{perfil,is_super_admin}')::boolean, false);

  if admin then
    return query select * from relatorios.relatorios_devolutivas;
    return;
  end if;

  select array_agg(e->>'nome')
    into escolas
    from jsonb_array_elements(coalesce(perms->'escolas', '[]'::jsonb)) e;

  return query
    select * from relatorios.relatorios_devolutivas d
    where d.tipo = 'individual'
      and d.escola = any(coalesce(escolas, array[]::text[]));
end $$;

-- Cadastro oficial de escolas (dado de referência; qualquer autenticado pode ler).
create or replace function public.relat_escolas()
returns setof relatorios.relatorios_escolas
language sql security definer set search_path = relatorios, public as $$
  select * from relatorios.relatorios_escolas;
$$;

grant execute on function public.relat_visitas(text)  to authenticated;
grant execute on function public.relat_devolutivas()  to authenticated;
grant execute on function public.relat_escolas()      to authenticated;
```

---

## 5. RLS

As tabelas ficam **fechadas para leitura direta**: toda leitura passa pelas RPCs acima
(que são `SECURITY DEFINER` e, portanto, ignoram o RLS de forma controlada). As
**gravações** vêm apenas do `service_role` (o sync e a carga de devolutivas), que
também ignora o RLS.

Todas as três tabelas ficam **fechadas para leitura direta**: toda leitura passa pelas
RPCs (que são `SECURITY DEFINER` e ignoram o RLS de forma controlada). As **gravações**
vêm só do `service_role` (o sync e a carga de devolutivas), que também ignora o RLS.

```sql
alter table relatorios.relatorios_visitas     enable row level security;
alter table relatorios.relatorios_devolutivas enable row level security;
alter table relatorios.relatorios_escolas     enable row level security;
-- Sem policy para 'authenticated' → leitura só via RPC (relat_*), escrita só via service_role.
```

> Como as RPCs são `SECURITY DEFINER`, elas leem as tabelas independentemente do RLS —
> o filtro por escola é feito dentro delas. O RLS aqui é a defesa em profundidade:
> ninguém lê as tabelas direto pelo PostgREST, mesmo com o schema exposto.

---

## 6. Rotina de sincronização (`visitas-sync.gs`)

Arquivo: `apps-script/relatorios/visitas-sync.gs` (neste repositório).

1. Planilha das visitas ▸ **Extensões ▸ Apps Script** → cole o `visitas-sync.gs`.
2. **Configurações do projeto ▸ Propriedades do script**:
   - `SUPABASE_SERVICE_KEY` = a **service_role** do Supabase (Project Settings ▸ API).
   - ⚠️ Nunca commitar nem colar no navegador — ela ignora o RLS.
   - Confirme que `var SCHEMA` no `visitas-sync.gs` é o mesmo nome do schema do SQL
     (padrão `relatorios`) e que ele está em **Project Settings ▸ API ▸ Exposed schemas**.
3. Recarregue a planilha → menu **"🔄 MAPA · Visitas"**.
4. **Testar conexão** (valida a chave e a existência da tabela).
5. **Sincronizar agora** (primeira carga) e confira em `relatorios_visitas`.
6. **Ativar rotina automática (1x/hora)** — instala o gatilho por tempo.

A partir daí, cada resposta nova do formulário entra no Supabase em até 1 hora, sem
intervenção. Respostas editadas atualizam a mesma linha (mesmo `visita_uid`).

---

## 7. Leitura do front pelo Supabase (já preparado, atrás de um flag)

O `relatorios.html` já tem a camada de leitura pelo Supabase escrita, **desligada por
padrão** por um flag no topo do `<script>`:

```js
const FONTE_DADOS = 'appsscript'; // troque para 'supabase' após aplicar o SQL e rodar o sync
```

Enquanto `'appsscript'`, nada muda (segue lendo do Apps Script). Ao trocar para
`'supabase'`, o front passa a ler do banco, reaproveitando o cliente global
(`window.MAPA_SB` / `auth.js`):

- **Visitas** → `MAPA_SB.rpc('relat_visitas')`; cada linha usa `row.dados` como o item
  (o `dados` jsonb já é o objeto que o front consome hoje). As escolas oficiais e o
  mapa regional vêm de `MAPA_SB.rpc('relat_escolas')`.
- **Devolutivas** → `MAPA_SB.rpc('relat_devolutivas')`; cada linha vira
  `{ ID, Escola, Segmento, "Data da Visita", "Salvo em", _tipo, _dados }`.

O RLS garante o isolamento por escola **no servidor** (hoje é feito no cliente).

**Para virar a chave:** aplique o SQL (seções 3–5), rode o sync (seção 6), confirme os
dados, e então troque `FONTE_DADOS` para `'supabase'`.

---

## 8. Próximo passo — carga inicial das devolutivas por IA

Como o formulário segue ativo e vamos **regerar todas** as devolutivas com o modelo
novo (Claude), a carga inicial é: ler `relatorios_visitas`, gerar a devolutiva de cada
visita e gravar em `relatorios_devolutivas`. As duas formas (a decidir):

- **Arquivo `INSERT`/CSV** para importar pelo painel do Supabase — não compartilha
  segredo nenhum. Recomendada.
- **Escrita direta** via API — exigiria a `service_role`.

A partir daí, a geração pode virar **rotina** (um agendamento que pega as visitas sem
devolutiva e gera). Isso passa a ser viável justamente porque, com tudo no Supabase, o
processo consegue alcançar os dados e gravar sozinho.
