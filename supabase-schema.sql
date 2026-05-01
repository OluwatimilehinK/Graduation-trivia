-- Paste this entire file into the Supabase SQL Editor and click "Run".
-- It creates the three tables, opens permissive access (fine for a one-off
-- event), and enables Realtime so live updates work.

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  status text not null default 'lobby',
  current_question int not null default -1,
  question_started_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  name text not null,
  score int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists answers (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  question_index int not null,
  answer_index int not null,
  is_correct boolean not null,
  points int not null default 0,
  created_at timestamptz not null default now(),
  unique (player_id, question_index)
);

-- Enable Row Level Security but allow anonymous full access (one-off event).
alter table games enable row level security;
alter table players enable row level security;
alter table answers enable row level security;

drop policy if exists "public all games" on games;
drop policy if exists "public all players" on players;
drop policy if exists "public all answers" on answers;

create policy "public all games" on games for all using (true) with check (true);
create policy "public all players" on players for all using (true) with check (true);
create policy "public all answers" on answers for all using (true) with check (true);

-- Enable Realtime broadcasts on these tables.
alter publication supabase_realtime add table games;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table answers;
