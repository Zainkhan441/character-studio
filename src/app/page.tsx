export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <h1 className="text-5xl font-bold tracking-tight">Character Studio</h1>
      <p className="mt-4 text-lg text-neutral-600">
        M0a — repo + deploy live.
      </p>
      <p className="mt-2 max-w-xl text-neutral-500">
        A character-consistent animation studio for faceless YouTube channels.
        A character is data, not a picture. The parametric character renderer
        is coming next.
      </p>
      <a
        href="/creator"
        className="mt-6 rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700"
      >
        Open the Character Creator →
      </a>
    </main>
  );
}
