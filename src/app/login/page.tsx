"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = "/";
      } else {
        setError("Wrong password");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50">
      <form
        onSubmit={handleSubmit}
        className="bg-white p-8 rounded-lg shadow-sm border border-stone-200 w-full max-w-sm"
      >
        <h1 className="text-xl font-medium text-stone-800 mb-6">
          Shop AI
        </h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full px-3 py-2 border border-stone-300 rounded focus:outline-none focus:ring-2 focus:ring-stone-400"
          autoFocus
        />
        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full mt-4 bg-stone-800 text-white py-2 rounded hover:bg-stone-900 disabled:opacity-50"
        >
          {loading ? "Checking..." : "Enter"}
        </button>
      </form>
    </div>
  );
}
