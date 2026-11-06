import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, Lock, MessageCircle } from "lucide-react";

import {
  loginWithEmail,
  loginWithGoogle,
} from "../services/auth";

export default function Login() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleEmailLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await loginWithEmail(email, password);
      navigate("/", { replace: true });
    } catch {
      setError("Login failed. Email aur password check karo.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
    setError("");
    setLoading(true);

    try {
      await loginWithGoogle();
      navigate("/", { replace: true });
    } catch {
      setError("Google login failed. Dobara try karo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#eef2f3] px-4 py-8">
      <section className="w-full max-w-md rounded-2xl bg-white p-7 shadow-lg sm:p-9">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#075e54] text-white">
            <MessageCircle size={34} />
          </div>

          <h1 className="text-3xl font-bold text-[#075e54]">
            Joy Inbox
          </h1>

          <p className="mt-2 text-sm text-gray-500">
            Sign in to your customer support inbox
          </p>
        </div>

        <form onSubmit={handleEmailLogin} className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Email address
            </label>

            <div className="flex items-center gap-3 rounded-xl border border-gray-200 px-4">
              <Mail size={18} className="text-gray-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Enter your email"
                className="h-12 w-full bg-transparent text-sm outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Password
            </label>

            <div className="flex items-center gap-3 rounded-xl border border-gray-200 px-4">
              <Lock size={18} className="text-gray-400" />
              <input
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                className="h-12 w-full bg-transparent text-sm outline-none"
              />
            </div>
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-[#075e54] py-3 font-semibold text-white transition hover:bg-[#064c44] disabled:opacity-60"
          >
            {loading ? "Please wait..." : "Sign in"}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-gray-200" />
          <span className="text-xs text-gray-400">OR</span>
          <div className="h-px flex-1 bg-gray-200" />
        </div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full rounded-xl border border-gray-200 py-3 font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
        >
          Continue with Google
        </button>

        <p className="mt-6 text-center text-xs text-gray-400">
          Private access · Joy Inbox
        </p>
      </section>
    </main>
  );
}
