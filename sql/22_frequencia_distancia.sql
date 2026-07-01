-- ============================================================================
-- FREQUÊNCIA x DISTÂNCIA — analisa presença/ausência do aluno vs. a distância
-- que ele mora da unidade, agrupando em faixas de 500 m.
-- Cria: tabela freq_distancia (1 linha por aluno, pivotada) + RPC de resumo
-- (agrega no servidor -> pouco egress + isolamento por unidade) + tela.
-- Pré-requisito: sql/07,08,12 (norm_escola). Idempotente.
-- Depois: importe o CSV freq_distancia_import.csv pela aba Table Editor.
-- ============================================================================

create table if not exists public.freq_distancia (
  id            bigint generated always as identity primary key,
  ra            text,
  unidade       text,
  tipo_unidade  text,
  ciclo         text,
  turma         text,
  distancia     numeric,          -- metros
  ano           text,
  presenca      int not null default 0,
  ausencia      int not null default 0,   -- falta NÃO justificada
  justificada   int not null default 0,   -- falta justificada
  created_at    timestamptz not null default now()
);
create index if not exists idx_freq_unidade on public.freq_distancia (unidade);
alter table public.freq_distancia disable row level security;
grant select, insert, update, delete on public.freq_distancia to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: resumo por faixa de distância (500 m), com KPIs e lista por unidade.
--   p_unidade  = filtra uma unidade (usado pelo isolamento da escola). NULL = rede.
--   p_faixa    = tamanho da faixa em metros (padrão 500).
--   p_teto     = distância a partir da qual tudo cai na última faixa (padrão 10000).
-- ---------------------------------------------------------------------------
create or replace function public.freq_dist_resumo(
  p_unidade text default null, p_faixa int default 500, p_teto int default 10000)
returns json language sql stable security definer set search_path = public as $$
  with base as (
    select unidade, distancia,
           presenca, ausencia, justificada,
           (presenca + ausencia + justificada) as total,
           least((floor(distancia / p_faixa)::int) * p_faixa, p_teto) as faixa
    from public.freq_distancia
    where distancia is not null
      and (presenca + ausencia + justificada) > 0
      and (p_unidade is null or public.norm_escola(unidade) = public.norm_escola(p_unidade))
  ),
  fx as (
    select faixa, count(*) alunos,
           sum(presenca) pre, sum(ausencia) aus, sum(justificada) jus, sum(total) tot,
           avg(distancia) distm
    from base group by faixa
  ),
  un as (
    select unidade, count(*) alunos, sum(presenca) pre, sum(total) tot, avg(distancia) distm
    from base group by unidade
  )
  select json_build_object(
    'geral', (select json_build_object(
        'alunos', count(*), 'presenca', sum(presenca), 'ausencia', sum(ausencia),
        'justificada', sum(justificada), 'total', sum(total),
        'freq_pct', round(100.0*sum(presenca)/nullif(sum(total),0), 1),
        'aus_pct',  round(100.0*sum(ausencia)/nullif(sum(total),0), 1),
        'jus_pct',  round(100.0*sum(justificada)/nullif(sum(total),0), 1),
        'dist_media', round(avg(distancia)::numeric, 0),
        'unidades', count(distinct unidade)) from base),
    'faixas', coalesce((select json_agg(json_build_array(
        faixa, alunos,
        round(100.0*pre/nullif(tot,0),1),
        round(100.0*aus/nullif(tot,0),1),
        round(100.0*jus/nullif(tot,0),1),
        round(distm::numeric,0)) order by faixa) from fx), '[]'::json),
    'por_unidade', coalesce((select json_agg(json_build_array(
        unidade, alunos, round(100.0*pre/nullif(tot,0),1), round(distm::numeric,0))
        order by round(100.0*pre/nullif(tot,0),1)) from un), '[]'::json)
  );
$$;
grant execute on function public.freq_dist_resumo(text,int,int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Catálogo: tela 'frequencia' (o front bloqueia telas cujo slug não é liberado).
-- Escola já recebe todas as telas exceto relatorios/boletim, então herda esta.
-- ---------------------------------------------------------------------------
insert into public.telas (sistema_id, slug, nome, ordem)
select s.id, 'frequencia', 'Frequência × Distância', 8
from public.sistemas s where s.slug = 'mapa'
on conflict (sistema_id, slug) do update set nome = excluded.nome, ordem = excluded.ordem;

insert into public.papel_permissoes (papel_id, tela_id, pode_ver, pode_editar, pode_exportar)
select pa.id, t.id, true, false, false
from public.papeis pa
join public.sistemas s on s.id = pa.sistema_id and s.slug = 'mapa'
join public.telas t on t.sistema_id = s.id and t.slug = 'frequencia'
on conflict (papel_id, tela_id) do update set pode_ver = excluded.pode_ver;

-- Conferência:
-- select public.freq_dist_resumo();
