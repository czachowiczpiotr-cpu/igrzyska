-- IGRZYSKA — schemat bazy (Supabase). Wklej całość w SQL Editor i uruchom.
-- Tabele mają prefiks ig_, więc mogą współdzielić projekt z innymi rzeczami.
-- Admini: po uruchomieniu dodaj maile adminów:
--   insert into ig_admins(email) values ('twoj@mail.pl'), ('olek@mail.pl');

create table if not exists ig_admins (email text primary key);
alter table ig_admins enable row level security; -- brak polityk = nikt z klienta nie czyta

create or replace function ig_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from ig_admins where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;

create or replace function ig_is_real_user() returns boolean
language sql stable as $$
  select auth.uid() is not null and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
$$;

-- Profile (imię i nazwisko + ksywa). Maila nie trzymamy publicznie.
create table if not exists ig_profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 40),
  nickname text check (nickname is null or char_length(nickname) <= 30),
  is_player boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists ig_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  emoji text,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists ig_rounds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ord int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists ig_duels (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references ig_rounds on delete cascade,
  ord int not null default 0,
  p1 uuid references ig_profiles on delete set null,
  p2 uuid references ig_profiles on delete set null,
  category_id uuid references ig_categories on delete set null,
  status text not null default 'pending' check (status in ('pending', 'live', 'done')),
  winner uuid references ig_profiles on delete set null,
  score1 text, score2 text, note text, when_at text,
  tips_locked boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists ig_predictions (
  duel_id uuid not null references ig_duels on delete cascade,
  user_id uuid not null default auth.uid() references ig_profiles on delete cascade,
  pick uuid not null references ig_profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (duel_id, user_id)
);

alter table ig_profiles enable row level security;
alter table ig_categories enable row level security;
alter table ig_rounds enable row level security;
alter table ig_duels enable row level security;
alter table ig_predictions enable row level security;

-- Czytać może każdy (strona publiczna), pisać: admini, a profil/typy — właściciel.
create policy ig_profiles_read on ig_profiles for select using (true);
create policy ig_profiles_ins on ig_profiles for insert with check (id = auth.uid() and ig_is_real_user() and is_player = false);
create policy ig_profiles_upd on ig_profiles for update using (id = auth.uid() or ig_is_admin());
create policy ig_profiles_del on ig_profiles for delete using (ig_is_admin());

create or replace function ig_guard_profile() returns trigger language plpgsql as $$
begin
  if new.is_player is distinct from old.is_player and not ig_is_admin() then
    raise exception 'Tylko admin może zmienić status zawodnika';
  end if;
  return new;
end $$;
drop trigger if exists ig_guard_profile on ig_profiles;
create trigger ig_guard_profile before update on ig_profiles for each row execute function ig_guard_profile();

create policy ig_cat_read on ig_categories for select using (true);
create policy ig_cat_write on ig_categories for all using (ig_is_admin()) with check (ig_is_admin());
create policy ig_round_read on ig_rounds for select using (true);
create policy ig_round_write on ig_rounds for all using (ig_is_admin()) with check (ig_is_admin());
create policy ig_duel_read on ig_duels for select using (true);
create policy ig_duel_write on ig_duels for all using (ig_is_admin()) with check (ig_is_admin());

create policy ig_pred_read on ig_predictions for select using (true);
create policy ig_pred_ins on ig_predictions for insert with check (
  user_id = auth.uid() and exists (select 1 from ig_duels d where d.id = duel_id and d.status <> 'done' and not d.tips_locked));
create policy ig_pred_upd on ig_predictions for update using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from ig_duels d where d.id = duel_id and d.status <> 'done' and not d.tips_locked));
create policy ig_pred_del on ig_predictions for delete using (user_id = auth.uid() or ig_is_admin());

-- Na żywo (realtime)
do $$ begin
  begin alter publication supabase_realtime add table ig_profiles; exception when others then null; end;
  begin alter publication supabase_realtime add table ig_categories; exception when others then null; end;
  begin alter publication supabase_realtime add table ig_rounds; exception when others then null; end;
  begin alter publication supabase_realtime add table ig_duels; exception when others then null; end;
  begin alter publication supabase_realtime add table ig_predictions; exception when others then null; end;
end $$;

-- Dostęp przez API (nowe projekty nie dają go automatycznie); RLS dalej pilnuje, kto co może.
grant usage on schema public to anon, authenticated;
grant select on ig_profiles, ig_categories, ig_rounds, ig_duels, ig_predictions to anon, authenticated;
grant insert, update, delete on ig_profiles, ig_categories, ig_rounds, ig_duels, ig_predictions to authenticated;
grant execute on function ig_is_admin() to anon, authenticated;
