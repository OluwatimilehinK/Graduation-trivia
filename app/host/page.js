"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  QUESTIONS,
  QUESTION_DURATION_MS,
  DEFAULT_NUM_QUESTIONS,
  pickQuestionOrder,
  getQuestion,
} from "@/lib/questions";

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export default function HostPage() {
  const [game, setGame] = useState(null);
  const [players, setPlayers] = useState([]);
  const [answersForCurrent, setAnswersForCurrent] = useState([]);
  const [error, setError] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [numQuestions, setNumQuestions] = useState(DEFAULT_NUM_QUESTIONS);
  const tickRef = useRef(null);

  // Create game on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const code = makeCode();
      const { data, error } = await supabase
        .from("games")
        .insert({ code, status: "lobby", current_question: -1 })
        .select()
        .single();
      if (cancelled) return;
      if (error) setError(error.message);
      else setGame(data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to players + answers + game updates
  useEffect(() => {
    if (!game) return;

    const channel = supabase
      .channel(`host-${game.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `game_id=eq.${game.id}` },
        () => refreshPlayers()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "answers", filter: `game_id=eq.${game.id}` },
        () => refreshAnswers()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${game.id}` },
        (payload) => setGame(payload.new)
      )
      .subscribe();

    refreshPlayers();
    refreshAnswers();

    return () => {
      supabase.removeChannel(channel);
    };

    async function refreshPlayers() {
      const { data } = await supabase
        .from("players")
        .select("*")
        .eq("game_id", game.id)
        .order("score", { ascending: false });
      setPlayers(data || []);
    }
    async function refreshAnswers() {
      const { data } = await supabase
        .from("answers")
        .select("*")
        .eq("game_id", game.id);
      setAnswersForCurrent(data || []);
    }
  }, [game?.id]);

  // Countdown timer for active question
  useEffect(() => {
    if (!game || game.status !== "question" || !game.question_started_at) {
      setTimeLeft(0);
      return;
    }
    const startedAt = new Date(game.question_started_at).getTime();
    const update = () => {
      const remaining = Math.max(
        0,
        QUESTION_DURATION_MS - (Date.now() - startedAt)
      );
      setTimeLeft(remaining);
      if (remaining === 0 && tickRef.current) {
        clearInterval(tickRef.current);
      }
    };
    update();
    tickRef.current = setInterval(update, 200);
    return () => clearInterval(tickRef.current);
  }, [game?.status, game?.question_started_at]);

  async function startGame() {
    const order = pickQuestionOrder(numQuestions);
    const { data, error: updErr } = await supabase
      .from("games")
      .update({
        status: "question",
        current_question: 0,
        num_questions: order.length,
        question_order: order,
        question_started_at: new Date().toISOString(),
      })
      .eq("id", game.id)
      .select()
      .single();
    if (updErr) setError(updErr.message);
    else setGame(data);
  }

  async function nextStep() {
    if (!game) return;
    if (game.status === "question") {
      await scoreCurrentQuestion();
      await supabase.from("games").update({ status: "reveal" }).eq("id", game.id);
    } else if (game.status === "reveal") {
      const next = game.current_question + 1;
      const total = game.num_questions || QUESTIONS.length;
      if (next >= total) {
        await supabase.from("games").update({ status: "finished" }).eq("id", game.id);
      } else {
        await supabase
          .from("games")
          .update({
            status: "question",
            current_question: next,
            question_started_at: new Date().toISOString(),
          })
          .eq("id", game.id);
      }
    }
  }

  async function scoreCurrentQuestion() {
    const q = getQuestion(game);
    if (!q) return;
    const startedAt = new Date(game.question_started_at).getTime();
    const relevant = answersForCurrent.filter(
      (a) => a.question_index === game.current_question
    );
    for (const a of relevant) {
      const elapsed = new Date(a.created_at).getTime() - startedAt;
      const isCorrect = a.answer_index === q.correctIndex;
      const points = isCorrect
        ? Math.max(
            500,
            Math.round(1000 - (Math.min(elapsed, QUESTION_DURATION_MS) / QUESTION_DURATION_MS) * 500)
          )
        : 0;
      await supabase
        .from("answers")
        .update({ is_correct: isCorrect, points })
        .eq("id", a.id);
      if (points > 0) {
        const player = players.find((p) => p.id === a.player_id);
        if (player) {
          await supabase
            .from("players")
            .update({ score: player.score + points })
            .eq("id", a.player_id);
        }
      }
    }
  }

  if (error) {
    return (
      <main className="flex-1 flex items-center justify-center p-6 bg-red-50">
        <div className="max-w-md text-red-700">
          <h2 className="font-bold text-lg mb-2">Could not create game</h2>
          <p className="text-sm">{error}</p>
        </div>
      </main>
    );
  }

  if (!game) {
    return (
      <main className="flex-1 flex items-center justify-center p-6 bg-indigo-50">
        <p>Setting up the game...</p>
      </main>
    );
  }

  const currentQ = getQuestion(game);
  const totalQuestions = game.num_questions || numQuestions;
  const answeredCount = answersForCurrent.filter(
    (a) => a.question_index === game.current_question
  ).length;

  return (
    <main className="flex-1 flex flex-col p-6 bg-gradient-to-br from-indigo-600 to-purple-700 text-white">
      <div className="max-w-4xl w-full mx-auto flex-1 flex flex-col gap-6">
        {game.status === "lobby" && (
          <Lobby
            game={game}
            players={players}
            numQuestions={numQuestions}
            setNumQuestions={setNumQuestions}
            maxQuestions={QUESTIONS.length}
            onStart={startGame}
          />
        )}

        {game.status === "question" && currentQ && (
          <QuestionView
            current={game.current_question}
            total={totalQuestions}
            q={currentQ}
            timeLeft={timeLeft}
            answeredCount={answeredCount}
            playerCount={players.length}
            onNext={nextStep}
          />
        )}

        {game.status === "reveal" && currentQ && (
          <RevealView
            q={currentQ}
            players={players}
            isLast={game.current_question === totalQuestions - 1}
            onNext={nextStep}
          />
        )}

        {game.status === "finished" && <FinalView players={players} />}
      </div>
    </main>
  );
}

function Lobby({ game, players, numQuestions, setNumQuestions, maxQuestions, onStart }) {
  const joinUrl = typeof window !== "undefined" ? `${window.location.origin}/play` : "";
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center gap-8">
      <div>
        <p className="text-indigo-200 mb-1">Join at</p>
        <p className="text-2xl font-mono font-semibold break-all">{joinUrl}</p>
      </div>
      <div>
        <p className="text-indigo-200 mb-2">with code</p>
        <p className="text-7xl md:text-9xl font-bold tracking-widest font-mono bg-white/10 px-8 py-4 rounded-2xl">
          {game.code}
        </p>
      </div>
      <div>
        <p className="text-2xl mb-3">{players.length} player{players.length === 1 ? "" : "s"} joined</p>
        <div className="flex flex-wrap gap-2 justify-center max-w-2xl">
          {players.map((p) => (
            <span key={p.id} className="bg-white/20 px-3 py-1 rounded-full">
              {p.name}
            </span>
          ))}
        </div>
      </div>

      <div className="bg-white/10 rounded-2xl px-6 py-4 flex items-center gap-4">
        <label className="text-indigo-100">Questions per round:</label>
        <input
          type="number"
          min={3}
          max={maxQuestions}
          value={numQuestions}
          onChange={(e) =>
            setNumQuestions(
              Math.max(3, Math.min(maxQuestions, Number(e.target.value) || 0))
            )
          }
          className="w-24 text-center text-2xl font-bold bg-white text-indigo-900 rounded-lg px-3 py-2 outline-none"
        />
        <span className="text-indigo-200 text-sm">(max {maxQuestions})</span>
      </div>

      <button
        onClick={onStart}
        disabled={players.length === 0}
        className="bg-white text-indigo-700 font-bold text-xl px-10 py-4 rounded-2xl shadow-lg hover:scale-[1.02] transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Start game
      </button>
    </div>
  );
}

function QuestionView({ current, total, q, timeLeft, answeredCount, playerCount, onNext }) {
  const seconds = Math.ceil(timeLeft / 1000);
  return (
    <div className="flex-1 flex flex-col gap-6">
      <div className="flex justify-between items-center text-indigo-100">
        <span>Question {current + 1} / {total}</span>
        <span className="font-mono text-2xl">{seconds}s</span>
        <span>{answeredCount} / {playerCount} answered</span>
      </div>
      <h2 className="text-3xl md:text-5xl font-bold text-center my-8">{q.q}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xl">
        {q.options.map((opt, i) => (
          <div
            key={i}
            className={`p-5 rounded-xl font-semibold ${
              ["bg-red-500", "bg-blue-500", "bg-yellow-500", "bg-green-600"][i]
            }`}
          >
            {opt}
          </div>
        ))}
      </div>
      <button
        onClick={onNext}
        className="mt-auto self-end bg-white text-indigo-700 font-bold px-6 py-3 rounded-xl shadow"
      >
        Reveal answer
      </button>
    </div>
  );
}

function RevealView({ q, players, isLast, onNext }) {
  const top = [...players].sort((a, b) => b.score - a.score).slice(0, 10);
  return (
    <div className="flex-1 flex flex-col gap-6">
      <h2 className="text-2xl md:text-3xl font-semibold text-center">{q.q}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xl">
        {q.options.map((opt, i) => (
          <div
            key={i}
            className={`p-5 rounded-xl font-semibold ${
              i === q.correctIndex
                ? "bg-green-500 ring-4 ring-white"
                : "bg-white/15 opacity-60"
            }`}
          >
            {opt} {i === q.correctIndex && "✓"}
          </div>
        ))}
      </div>
      <div className="bg-white/10 rounded-2xl p-5 mt-4">
        <h3 className="text-lg font-semibold mb-3">Leaderboard</h3>
        <ol className="space-y-2">
          {top.map((p, i) => (
            <li key={p.id} className="flex justify-between bg-white/10 px-4 py-2 rounded-lg">
              <span>{i + 1}. {p.name}</span>
              <span className="font-mono">{p.score}</span>
            </li>
          ))}
        </ol>
      </div>
      <button
        onClick={onNext}
        className="self-end bg-white text-indigo-700 font-bold px-6 py-3 rounded-xl shadow"
      >
        {isLast ? "See final results" : "Next question"}
      </button>
    </div>
  );
}

function FinalView({ players }) {
  const ranked = [...players].sort((a, b) => b.score - a.score);
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center">
      <h2 className="text-5xl font-bold">Final results</h2>
      <div className="w-full max-w-md space-y-2">
        {ranked.map((p, i) => (
          <div
            key={p.id}
            className={`flex justify-between px-5 py-3 rounded-xl text-lg ${
              i === 0
                ? "bg-yellow-400 text-indigo-900 font-bold text-xl"
                : i === 1
                ? "bg-gray-200 text-indigo-900 font-semibold"
                : i === 2
                ? "bg-amber-700/80"
                : "bg-white/15"
            }`}
          >
            <span>{i + 1}. {p.name}</span>
            <span className="font-mono">{p.score}</span>
          </div>
        ))}
      </div>
      <p className="text-indigo-100 mt-6">🎓 Congratulations, graduates! 🎓</p>
    </div>
  );
}
