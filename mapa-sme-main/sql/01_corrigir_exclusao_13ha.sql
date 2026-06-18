-- ============================================================
-- MAPA SME — Correção pontual da série PPA 13H/A
-- Rode este script caso o Magistério II esteja aparecendo com +1 turma.
-- Seguro para rodar mais de uma vez.
-- ============================================================

create extension if not exists unaccent;

insert into public.config_series_excluidas (serie, excluido)
values ('PROJETO PROFESSOR ALFABETIZADOR - 13H/A', true)
on conflict (serie) do update
set excluido = true,
    updated_at = now();

select serie, excluido
from public.config_series_excluidas
where upper(unaccent(serie)) like '%PROJETO PROFESSOR ALFABETIZADOR%13H%';
