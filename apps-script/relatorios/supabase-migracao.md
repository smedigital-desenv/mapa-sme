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

## 3. Tabelas

```sql
-- ── Visitas (espelho das 4 abas do formulário) ───────────────────────────────
create table if not exists public.relatorios_visitas (
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
create index if not exists idx_relat_visitas_segmento on public.relatorios_visitas (segmento);
create index if not exists idx_relat_visitas_escola   on public.relatorios_visitas (escola);
create index if not exists idx_relat_visitas_regional on public.relatorios_visitas (regional);

-- bump de sincronizado_em quando o upsert atualizar uma visita já existente
create or replace function public.tg_relat_visitas_touch()
returns trigger language plpgsql as $$
begin new.sincronizado_em := now(); return new; end $$;

drop trigger if exists trg_relat_visitas_touch on public.relatorios_visitas;
create trigger trg_relat_visitas_touch
  before update on public.relatorios_visitas
  for each row execute function public.tg_relat_visitas_touch();

-- ── Devolutivas (geradas por IA) ─────────────────────────────────────────────
create table if not exists public.relatorios_devolutivas (
  id            text primary key,            -- mesmo hash do _gerarId (regerar sobrescreve)
  tipo          text not null default 'individual', -- individual | rede | regional | sintese_global
  segmento      text,
  escola        text,
  regional      text,
  data_visita   text,                         -- string (casa com relatorios_visitas.data_visita_txt)
  visita_uid    text references public.relatorios_visitas(visita_uid) on delete set null,
  salvo_em      timestamptz not null default now(),
  dados         jsonb not null,              -- payload _dados (o mesmo que o front renderiza)
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_relat_dev_escola   on public.relatorios_devolutivas (escola);
create index if not exists idx_relat_dev_segmento on public.relatorios_devolutivas (segmento);
create index if not exists idx_relat_dev_tipo     on public.relatorios_devolutivas (tipo);

create or replace function public.tg_relat_dev_touch()
returns trigger language plpgsql as $$
begin new.atualizado_em := now(); return new; end $$;

drop trigger if exists trg_relat_dev_touch on public.relatorios_devolutivas;
create trigger trg_relat_dev_touch
  before update on public.relatorios_devolutivas
  for each row execute function public.tg_relat_dev_touch();
```

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

```sql
-- Visitas que o usuário atual pode ver. p_segmento: fundamental|infantil (base) — inclui a variante "2".
create or replace function public.relat_visitas(p_segmento text default null)
returns setof public.relatorios_visitas
language plpgsql security definer set search_path = public as $$
declare perms jsonb; admin boolean; escolas text[];
begin
  perms := to_jsonb(public.minhas_permissoes());
  if perms is null or coalesce((perms->>'autorizado')::boolean, false) = false then
    return;                                   -- sem acesso → nada
  end if;
  admin := coalesce((perms#>>'{perfil,is_super_admin}')::boolean, false);

  if admin then
    return query
      select * from public.relatorios_visitas v
      where p_segmento is null
         or v.segmento = p_segmento
         or v.segmento = p_segmento || '2';
    return;
  end if;

  select array_agg(e->>'nome')
    into escolas
    from jsonb_array_elements(coalesce(perms->'escolas', '[]'::jsonb)) e;

  return query
    select * from public.relatorios_visitas v
    where v.escola = any(coalesce(escolas, array[]::text[]))
      and ( p_segmento is null
            or v.segmento = p_segmento
            or v.segmento = p_segmento || '2' );
end $$;

-- Devolutivas que o usuário atual pode ver (individuais filtram por escola;
-- rede/regional/síntese só para super admin).
create or replace function public.relat_devolutivas()
returns setof public.relatorios_devolutivas
language plpgsql security definer set search_path = public as $$
declare perms jsonb; admin boolean; escolas text[];
begin
  perms := to_jsonb(public.minhas_permissoes());
  if perms is null or coalesce((perms->>'autorizado')::boolean, false) = false then
    return;
  end if;
  admin := coalesce((perms#>>'{perfil,is_super_admin}')::boolean, false);

  if admin then
    return query select * from public.relatorios_devolutivas;
    return;
  end if;

  select array_agg(e->>'nome')
    into escolas
    from jsonb_array_elements(coalesce(perms->'escolas', '[]'::jsonb)) e;

  return query
    select * from public.relatorios_devolutivas d
    where d.tipo = 'individual'
      and d.escola = any(coalesce(escolas, array[]::text[]));
end $$;

grant execute on function public.relat_visitas(text)  to authenticated;
grant execute on function public.relat_devolutivas()  to authenticated;
```

---

## 5. RLS

As tabelas ficam **fechadas para leitura direta**: toda leitura passa pelas RPCs acima
(que são `SECURITY DEFINER` e, portanto, ignoram o RLS de forma controlada). As
**gravações** vêm apenas do `service_role` (o sync e a carga de devolutivas), que
também ignora o RLS.

```sql
alter table public.relatorios_visitas     enable row level security;
alter table public.relatorios_devolutivas enable row level security;
-- Sem policy de SELECT/INSERT para 'authenticated' → leitura só via RPC, escrita só via service_role.
```

> Se algum dia o front precisar ler a tabela **direto** (sem RPC), aí sim crie uma
> policy de `select` para `authenticated` espelhando o filtro por escola das RPCs.

---

## 6. Rotina de sincronização (`visitas-sync.gs`)

Arquivo: `apps-script/relatorios/visitas-sync.gs` (neste repositório).

1. Planilha das visitas ▸ **Extensões ▸ Apps Script** → cole o `visitas-sync.gs`.
2. **Configurações do projeto ▸ Propriedades do script**:
   - `SUPABASE_SERVICE_KEY` = a **service_role** do Supabase (Project Settings ▸ API).
   - ⚠️ Nunca commitar nem colar no navegador — ela ignora o RLS.
3. Recarregue a planilha → menu **"🔄 MAPA · Visitas"**.
4. **Testar conexão** (valida a chave e a existência da tabela).
5. **Sincronizar agora** (primeira carga) e confira em `relatorios_visitas`.
6. **Ativar rotina automática (1x/hora)** — instala o gatilho por tempo.

A partir daí, cada resposta nova do formulário entra no Supabase em até 1 hora, sem
intervenção. Respostas editadas atualizam a mesma linha (mesmo `visita_uid`).

---

## 7. Próximo passo — leitura do front pelo Supabase

Depois que os dados estiverem fluindo, o `relatorios.html` troca a origem de leitura
(hoje Apps Script) por Supabase, reaproveitando o cliente global (`window.MAPA_SB` /
`auth.js`):

- `getDadosCompletos` → `MAPA_SB.rpc('relat_visitas', { p_segmento })`; cada linha usa
  `row.dados` como o item (o `dados` jsonb já é o objeto que o front consome hoje).
- `lerDevolutivas` → `MAPA_SB.rpc('relat_devolutivas')`; cada linha vira
  `{ ID:id, Escola:escola, Segmento:segmento, "Data da Visita":data_visita, "Salvo em":…, _tipo:tipo, _dados:dados }`.

O RLS já garante o isolamento por escola no servidor (hoje é feito no cliente).

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
