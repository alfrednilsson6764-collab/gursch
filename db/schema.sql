-- GURSCH – databasschema för Supabase (Alfred 2026-11-09)
-- Kör hela filen i Supabase: SQL Editor → New query → klistra in → Run. Den går att köra flera gånger.
--
-- Säkerhet: Row Level Security är påslaget. Inloggade användare får bara LÄSA sin egen rad.
-- Ingen får skriva direkt från webbläsaren – bara spelservern skriver, med den hemliga nyckeln
-- (SUPABASE_SECRET_KEY), som går förbi RLS.
--
-- Vi sparar bara användarnamn och spelstatistik här. E-postadressen sköts av Supabase Auth (auth.users).
-- När ett konto raderas i auth.users försvinner profilen och samlingen automatiskt (on delete cascade).

create table if not exists public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  username       text not null check (char_length(username) between 3 and 16),
  coins          integer not null default 0 check (coins >= 0),
  selected_deck  text not null default 'classic',
  chests_opened  integer not null default 0,
  pity_counter   integer not null default 0,
  games_played   integer not null default 0,
  wins           integer not null default 0,
  created_at     timestamptz not null default now()
);
-- användarnamn är unika oavsett stora/små bokstäver
create unique index if not exists profiles_username_unique on public.profiles (lower(username));

create table if not exists public.owned_decks (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  deck_id      text not null,
  unlocked_at  timestamptz not null default now(),
  primary key (user_id, deck_id)
);

alter table public.profiles enable row level security;
alter table public.owned_decks enable row level security;

-- bara läsning av egen data; inga insert/update/delete-policyer = ingen skrivning från klienter
drop policy if exists "Läs egen profil" on public.profiles;
create policy "Läs egen profil" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

drop policy if exists "Läs egen samling" on public.owned_decks;
create policy "Läs egen samling" on public.owned_decks
  for select to authenticated using ((select auth.uid()) = user_id);

-- extra säkerhet: ta bort skrivrättigheter för webbläsarrollerna helt
revoke insert, update, delete on public.profiles from anon, authenticated;
revoke insert, update, delete on public.owned_decks from anon, authenticated;
revoke all on public.profiles from anon;
revoke all on public.owned_decks from anon;
