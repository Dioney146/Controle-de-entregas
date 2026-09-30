-- =====================================================================
-- CONTROLE DE ENTREGAS DELLY'S  —  estrutura do banco (Supabase)
-- Rode este arquivo inteiro no Supabase: SQL Editor > New query > Run
-- =====================================================================

-- ---------- VEÍCULOS (equivale à aba VEÍCULOS) ----------
create table if not exists public.veiculos (
  placa          text primary key,
  transportadora text not null default '',
  tipo           text not null default '',
  motorista      text not null default '',   -- motorista fixo da placa (opcional)
  entregador     text not null default '',   -- entregador fixo da placa (opcional)
  ativo          boolean not null default true, -- aparece na programação como "sem carga" quando não roteirizado
  obs            text not null default '',
  created_at     timestamptz not null default now()
);

-- ---------- PROGRAMAÇÃO (equivale à aba BASE DA PROGRAMAÇÃO) ----------
-- Guarda o que foi colado do RoadNet para cada data de saída.
create table if not exists public.programacao (
  id            bigserial primary key,
  data          date not null,
  rota_id       text,
  descricao     text,
  paradas       integer,
  ordens        integer,
  peso          numeric,
  valor         numeric,
  capacidade    numeric,
  placa         text,
  trabalhadores text,
  distancia     numeric,
  tipo_equip    text,
  sessao        text,
  estado        text,
  created_at    timestamptz not null default now(),
  created_by    text
);
create index if not exists programacao_data_idx on public.programacao (data);

-- ---------- SAÍDAS (FRETE + SAÍDAS + RETORNO + HISTÓRICO numa tabela só) ----------
-- status:
--   PROGRAMADO -> gerado a partir da programação (é o FRETE, ainda não saiu)
--   EM_ROTA    -> saída confirmada na portaria (vai para o HISTÓRICO)
--   RETORNOU   -> checkout do monitoramento
create table if not exists public.saidas (
  id                bigserial primary key,
  data              date not null,
  zona              text not null default '',
  placa             text not null,
  transportadora    text not null default '',
  tipo              text not null default '',
  entregas          integer,
  kg                numeric,
  valor             numeric,
  destino           text not null default '',   -- coluna INFOR
  motorista         text not null default '',
  entregador        text not null default '',
  hora_saida        timestamptz,
  status            text not null default 'PROGRAMADO'
                    check (status in ('PROGRAMADO','EM_ROTA','RETORNOU')),
  cancelados        integer not null default 0,
  reentregas        integer not null default 0,   -- coluna TRANSF
  pendentes         integer not null default 0,
  celular_devolvido boolean not null default false,
  checkout_em       timestamptz,
  checkout_por      text,
  obs               text not null default '',
  ordem             integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists saidas_data_idx   on public.saidas (data);
create index if not exists saidas_status_idx on public.saidas (status);
create index if not exists saidas_placa_idx  on public.saidas (placa);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists saidas_touch on public.saidas;
create trigger saidas_touch before update on public.saidas
for each row execute function public.touch_updated_at();

-- ---------- SEGURANÇA: só usuários logados leem/gravam ----------
alter table public.veiculos    enable row level security;
alter table public.programacao enable row level security;
alter table public.saidas      enable row level security;

drop policy if exists "logados_veiculos"    on public.veiculos;
drop policy if exists "logados_programacao" on public.programacao;
drop policy if exists "logados_saidas"      on public.saidas;

create policy "logados_veiculos"    on public.veiculos    for all to authenticated using (true) with check (true);
create policy "logados_programacao" on public.programacao for all to authenticated using (true) with check (true);
create policy "logados_saidas"      on public.saidas      for all to authenticated using (true) with check (true);

-- ---------- TEMPO REAL (retorno atualiza sozinho na tela de todos) ----------
do $$ begin
  alter publication supabase_realtime add table public.saidas;
exception when duplicate_object then null; end $$;
