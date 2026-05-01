import Link from "next/link";

export default function Home() {
  return (
    <main className="flex-1 flex items-center justify-center p-6 bg-gradient-to-br from-indigo-600 to-purple-700 text-white">
      <div className="max-w-md w-full text-center space-y-8">
        <div>
          <h1 className="text-5xl font-bold mb-2">Graduation Trivia</h1>
          <p className="text-indigo-100">Live game. Play on your phone.</p>
        </div>
        <div className="space-y-3">
          <Link
            href="/play"
            className="block w-full bg-white text-indigo-700 font-bold text-xl py-4 rounded-2xl shadow-lg hover:scale-[1.02] transition"
          >
            Join a game
          </Link>
          <Link
            href="/host"
            className="block w-full bg-indigo-900/40 border border-white/30 text-white font-semibold py-3 rounded-2xl hover:bg-indigo-900/60 transition"
          >
            Host a game
          </Link>
        </div>
      </div>
    </main>
  );
}
