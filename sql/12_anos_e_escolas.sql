-- ============================================================================
-- (1) Limpeza de anos escolares + (2) alinhar nomes de escola ao padrão da
--     tabela `turmas` (canônica). Idempotente.
-- Rode DEPOIS de atualizar a tabela `turmas` com o relatório novo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Normalização de nome de escola igual à do front (auth.js normEscola):
--   maiúsculas, sem acento, só alfanumérico, espaços colapsados.
-- ---------------------------------------------------------------------------
create or replace function public.norm_escola(t text)
returns text language sql immutable as $$
  select trim(regexp_replace(
    regexp_replace(
      upper(translate(coalesce(t,''),
        'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
        'AAAAAEEEEIIIIOOOOOUUUUCAAAAAEEEEIIIIOOOOOUUUUC')),
      '[^A-Z0-9]+', ' ', 'g'),
    '\s+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------------------
-- (1) Anos escolares distintos (para a tela de limpeza), com contagem.
-- ---------------------------------------------------------------------------
create or replace function public.anos_escolares()
returns table(ano_escolar text, qtd bigint)
language sql stable security definer set search_path = public as $$
  select ano_escolar, count(*)::bigint
  from public.turmas
  where coalesce(trim(ano_escolar),'') <> ''
  group by ano_escolar
  order by ano_escolar;
$$;
grant execute on function public.anos_escolares() to authenticated, anon;

-- Tabela de anos escolares a ESCONDER (reaproveita o nome usado pelo sistema).
create table if not exists public.config_series_excluidas (
  serie     text primary key,
  excluido  boolean not null default true
);
alter table public.config_series_excluidas disable row level security;
grant select, insert, update, delete on public.config_series_excluidas to authenticated, anon;

-- ---------------------------------------------------------------------------
-- (2)/(3) Alinhar o cadastro `escolas` ao nome CANÔNICO das `turmas`.
--   Os nomes vieram de `unidades` (grafia divergente). Aqui corrigimos a grafia
--   onde o nome normalizado bate, SEM mexer nos vínculos (perfil_escola é por id).
-- ---------------------------------------------------------------------------
update public.escolas e
   set nome = t.nome_unidade
  from (select distinct nome_unidade from public.turmas
        where coalesce(trim(nome_unidade),'') <> '') t
 where public.norm_escola(e.nome) = public.norm_escola(t.nome_unidade)
   and e.nome is distinct from t.nome_unidade;

-- Garante uma linha de escola para CADA unidade das turmas (para poder vincular).
insert into public.escolas (nome)
select distinct t.nome_unidade
from public.turmas t
where coalesce(trim(t.nome_unidade),'') <> ''
  and not exists (
    select 1 from public.escolas e
    where public.norm_escola(e.nome) = public.norm_escola(t.nome_unidade));

-- Conferência (opcional):
-- select count(*) from public.escolas;
-- select * from public.anos_escolares();
