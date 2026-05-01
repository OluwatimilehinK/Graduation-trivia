-- Run this in the Supabase SQL Editor.
-- Adds support for the host choosing how many questions to play,
-- and storing a shuffled question order per game.

alter table games
  add column if not exists num_questions int not null default 10;

alter table games
  add column if not exists question_order jsonb;
