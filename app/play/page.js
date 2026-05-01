"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function join(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const trimmedCode = code.trim().toUpperCase();
      const trimmedName = name.trim().slice(0, 20);
      if (!trimmedCode || !trimmedName) {
        setError("Enter a code and a name");
        return;
      }
      const { data: game, error: gameErr } = await supabase
        .from("games")
        .select("id, status")
        .eq("code", trimmedCode)
        .maybeSingle();
      if (gameErr) throw gameErr;
      if (!game) {
        setError("Game not found. Check the code.");
        return;
      }
      if (game.status !== "lobby") {
        setError("This game has already started.");
        return;
      }
      const { data: player, error: playerErr } = await supabase
        .from("players")
        .insert({ game_id: game.id, name: trimmedName })
        .select()
        .single();
      if (playerErr) throw playerErr;
      // Persist identity for this game so reloads keep the player.
      sessionStorage.setItem(`player-${trimmedCode}`, player.id);
      router.push(`/play/${trimmedCode}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex-1 flex items-center justify-center p-6 bg-gradient-to-br from-indigo-600 to-purple-700 text-white">
      <form onSubmit={join} className="w-full max-w-sm space-y-4">
        <h1 className="text-3xl font-bold text-center mb-6">Join a game</h1>
        <input
          autoFocus
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck="false"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="GAME CODE"
          maxLength={6}
          className="w-full text-center text-3xl font-mono tracking-widest bg-white text-indigo-900 px-4 py-4 rounded-2xl outline-none"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={20}
          className="w-full text-xl bg-white text-indigo-900 px-4 py-4 rounded-2xl outline-none"
        />
        {error && <p className="text-red-200 text-center text-sm">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-white text-indigo-700 font-bold text-xl py-4 rounded-2xl shadow-lg disabled:opacity-50"
        >
          {busy ? "Joining..." : "Join"}
        </button>
      </form>
    </main>
  );
}
