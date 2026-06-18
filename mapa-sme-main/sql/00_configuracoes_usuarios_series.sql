-- ============================================================
-- MAPA SME — Configurações, usuários e séries excluídas
-- Versão v9: inclui tela Configurações + exclusão PPA 13H/A
-- Rode no Supabase SQL Editor antes de testar a tela Configurações.
-- Este script é seguro para rodar mais de uma vez.
-- ============================================================

create extension if not exists unaccent;

alter table public.usuarios add column if not exists perfil text default 'ESCOLA';
alter table public.usuarios add column if not exists ativo boolean default true;
alter table public.usuarios add column if not exists acesso_turmas boolean default true;
alter table public.usuarios add column if not exists acesso_avaliacoes boolean default true;
alter table public.usuarios add column if not exists acesso_rede boolean default true;
alter table public.usuarios add column if not exists acesso_configuracoes boolean default false;
alter table public.usuarios add column if not exists observacao text;
alter table public.usuarios add column if not exists updated_at timestamptz default now();

create table if not exists public.config_series_excluidas (
  id bigserial primary key,
  serie text unique not null,
  excluido boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.config_series_excluidas enable row level security;
alter table public.usuarios enable row level security;

drop policy if exists "config_series_select_public" on public.config_series_excluidas;
drop policy if exists "config_series_insert_public" on public.config_series_excluidas;
drop policy if exists "config_series_update_public" on public.config_series_excluidas;
drop policy if exists "config_series_delete_public" on public.config_series_excluidas;
create policy "config_series_select_public" on public.config_series_excluidas for select using (true);
create policy "config_series_insert_public" on public.config_series_excluidas for insert with check (true);
create policy "config_series_update_public" on public.config_series_excluidas for update using (true) with check (true);
create policy "config_series_delete_public" on public.config_series_excluidas for delete using (true);

drop policy if exists "usuarios_select_public" on public.usuarios;
drop policy if exists "usuarios_insert_public" on public.usuarios;
drop policy if exists "usuarios_update_public" on public.usuarios;
drop policy if exists "usuarios_delete_public" on public.usuarios;
create policy "usuarios_select_public" on public.usuarios for select using (true);
create policy "usuarios_insert_public" on public.usuarios for insert with check (true);
create policy "usuarios_update_public" on public.usuarios for update using (true) with check (true);
create policy "usuarios_delete_public" on public.usuarios for delete using (true);

insert into public.config_series_excluidas (serie, excluido) values
  ('PROJETO PROFESSOR ALFABETIZADOR - 13H/A', true),
  ('PROFESSOR APOIO PEDAGOGICO-10H/A', true),
  ('PROFESSOR APOIO PEDAGOGICO 3H/A', true),
  ('PROFESSOR APOIO PEDAGOGICO-5H/A', true),
  ('PROFESSOR APOIO PEDAGOGICO-1H/A', true),
  ('PROFESSOR APOIO PEDAGOGICO-11H/A', true),
  ('PROFESSOR APOIO PEDAGOGICO-8H/A', true),
  ('PROFESSOR APOIO PEDAGOGICO 6H', true),
  ('AULA EVENTUAL SL REC. A.E.E. 12H/A', true),
  ('AULA EVENTUAL SL REC. A.E.E. 6H/A', true),
  ('AULA EVENTUAL SL REC. A.E.E. 11H/A', true),
  ('AULA EVENTUAL SL REC. A.E.E. 7H/A', true),
  ('AULA EVENTUAL SL REC. A.E.E. 10H/A', true),
  ('ARTESANATO', true),
  ('TÉC. AGRÍCOLA', true),
  ('CULINÁRIA', true),
  ('GUARDAR CARROS', true),
  ('LAVAR CARROS', true),
  ('COSTURA', true),
  ('PADEIRO/CONFEITEIRO', true),
  ('ELÉTRICA', true),
  ('PEDREIRO', true),
  ('INFORMÁTICA', true),
  ('MECÂNICA', true)
on conflict (serie) do update
set excluido = excluded.excluido,
    updated_at = now();

select 'usuarios' as tabela, count(*) as total from public.usuarios
union all
select 'config_series_excluidas' as tabela, count(*) as total from public.config_series_excluidas;
