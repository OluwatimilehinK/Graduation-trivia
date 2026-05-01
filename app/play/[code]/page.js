"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { QUESTION_DURATION_MS, getQuestion } from "@/lib/questions";

export default function PlayPage() {
  const router = useRouter();
  const params = useParams();
  const code = (params.code || "").toString().toUpperCase();

  const [playerId, setPlayerId] = useState(null);
  const [game, setGame] = useState(null);
  const [me, setMe] = useState(null);
  const [myAnswer, setMyAnswer] = useState(null);
  const [revealAnswer, setRevealAnswer] = useState(null);
  const [error, setError] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);

  // Resolve player + initial game from code
  useEffect(() => {
    const stored = sessionStorage.getItem(`player-${code}`);
    if (!stored) {
      router.replace("/play");
      return;
    }
    setPlayerId(stored);
    (async () => {
      const { data: g, error: gErr } = await supabase
        .from("games")
        .select("*")
        .eq("code", code)
        .maybeSingle();
      if (gErr) {
        setError(gErr.message);
        return;
      }
      if (!g) {
        setError("Game not found.");
        return;
      }
      setGame(g);
    })();
  }, [code, router]);

  // Subscribe to game updates + my own player record
  useEffect(() => {
    if (!game || !playerId) return;
    const channel = supabase
      .channel(`play-${game.id}-${playerId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${game.id}` },
        (payload) => setGame(payload.new)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "players", filter: `id=eq.${playerId}` },
        (payload) => setMe(payload.new)
      )
      .subscribe();

    refreshMe();
    return () => {
      supabase.removeChannel(channel);
    };

    async function refreshMe() {
      const { data } = await supabase
        .from("players")
        .select("*")
        .eq("id", playerId)
        .maybeSingle();
      setMe(data);
    }
  }, [game?.id, playerId]);

  // Reset answer state when a new question starts; fetch reveal record on reveal
  useEffect(() => {
    if (!game) return;
    if (game.status === "question") {
      setMyAnswer(null);
      setRevealAnswer(null);
      return;
    }
    if (game.status === "reveal" && playerId && game.current_question >= 0) {
      (async () => {
        const { data } = await supabase
          .from("answers")
          .select("*")
          .eq("player_id", playerId)
          .eq("question_index", game.current_question)
          .maybeSingle();
        setRevealAnswer(data || { skipped: true });
      })();
    }
  }, [game?.current_question, game?.status, playerId]);

  // Countdown timer mirror
  useEffect(() => {
    if (!game || game.status !== "question" || !game.question_started_at) {
      setTimeLeft(0);
      return;
    }
    const startedAt = new Date(game.question_started_at).getTime();
    const tick = () => {
      const remaining = Math.max(
        0,
        QUESTION_DURATION_MS - (Date.now() - startedAt)
      );
      setTimeLeft(remaining);
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [game?.status, game?.question_started_at]);

  async function submitAnswer(index) {
    if (myAnswer !== null || !game || timeLeft === 0) return;
    setMyAnswer(index);
    const { error: insErr } = await supabase.from("answers").insert({
      game_id: game.id,
      player_id: playerId,
      question_index: game.current_question,
      answer_index: index,
      is_correct: false,
      points: 0,
    });
    if (insErr) {
      setError(insErr.message);
      setMyAnswer(null);
    }
  }

  if (error) {
    return (
      <main className="flex-1 flex items-center justify-center p-6 bg-red-50">
        <p className="text-red-700">{error}</p>
      </main>
    );
  }

  if (!game || !me) {
    return (
      <main className="flex-1 flex items-center justify-center p-6 bg-indigo-700 text-white">
        <p>Loading...</p>
      </main>
    );
  }

  const currentQ = getQuestion(game);

  return (
    <main className="flex-1 flex flex-col p-4 bg-gradient-to-br from-indigo-600 to-purple-700 text-white">
      <header className="flex justify-between items-center mb-4">
        <span className="font-semibold text-lg">{me.name}</span>
        <span className="font-mono text-xl bg-white/15 px-3 py-1 rounded-full">{me.score} pts</span>
      </header>

      {game.status === "lobby" && (
        <div className="flex-1 flex items-center justify-center text-center">
          <div>
            <p className="text-2xl font-semibold mb-2">You're in!</p>
            <p className="text-indigo-100">Waiting for the host to start the game...</p>
          </div>
        </div>
      )}

      {game.status === "question" && currentQ && (
        <QuestionAnswer
          q={currentQ}
          timeLeft={timeLeft}
          myAnswer={myAnswer}
          onSubmit={submitAnswer}
        />
      )}

      {game.status === "reveal" && (
        <RevealFeedback revealAnswer={revealAnswer} totalScore={me.score} />
      )}

      {game.status === "finished" && (
        <div className="flex-1 flex items-center justify-center text-center">
          <div>
            <p className="text-3xl font-bold mb-3">Game over!</p>
            <p className="text-5xl font-bold">{me.score} pts</p>
            <p className="text-indigo-100 mt-4">Check the host screen for the leaderboard 🎓</p>
          </div>
        </div>
      )}
    </main>
  );
}

function RevealFeedback({ revealAnswer, totalScore }) {
  const noAnswer = !revealAnswer || revealAnswer.skipped;
  const isCorrect = revealAnswer && revealAnswer.is_correct;
  const points = revealAnswer ? revealAnswer.points || 0 : 0;

  return (
    <div className="flex-1 flex items-center justify-center text-center">
      <div className="space-y-6">
        {noAnswer ? (
          <>
            <p className="text-4xl font-bold text-indigo-100">⏰ No answer</p>
            <p className="text-xl text-indigo-200">+0 pts this round</p>
          </>
        ) : isCorrect ? (
          <>
            <p className="text-5xl font-bold text-green-300">✓ Correct!</p>
            <p className="text-2xl">+{points} pts this round</p>
          </>
        ) : (
          <>
            <p className="text-5xl font-bold text-red-300">✗ Wrong</p>
            <p className="text-xl text-indigo-200">+0 pts this round</p>
          </>
        )}
        <div className="pt-6 border-t border-white/20">
          <p className="text-indigo-200 text-sm uppercase tracking-wide">Your total</p>
          <p className="text-5xl font-bold mt-1">{totalScore}</p>
        </div>
        <p className="text-indigo-100 text-sm pt-2">Get ready for the next question...</p>
      </div>
    </div>
  );
}

function QuestionAnswer({ q, timeLeft, myAnswer, onSubmit }) {
  const colors = ["bg-red-500", "bg-blue-500", "bg-yellow-500", "bg-green-600"];
  const seconds = Math.ceil(timeLeft / 1000);
  const expired = timeLeft === 0;

  if (myAnswer !== null) {
    return (
      <div className="flex-1 flex items-center justify-center text-center">
        <div>
          <p className="text-2xl font-semibold mb-2">Answer locked in!</p>
          <p className="text-indigo-100">Waiting for everyone else...</p>
        </div>
      </div>
    );
  }

  if (expired) {
    return (
      <div className="flex-1 flex items-center justify-center text-center">
        <p className="text-xl text-indigo-100">Time's up!</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-3">
      <p className="text-center text-3xl font-mono">{seconds}</p>
      <p className="text-center text-indigo-100 text-sm mb-2">{q.q}</p>
      <div className="flex-1 grid grid-cols-2 gap-3">
        {q.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => onSubmit(i)}
            className={`${colors[i]} font-bold text-xl rounded-2xl p-4 shadow-lg active:scale-95 transition`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
