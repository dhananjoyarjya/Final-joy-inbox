import { LogOut, MessageCircle } from "lucide-react";
import { logout } from "../services/auth";
import { useAuth } from "../context/AuthContext";

export default function Dashboard() {
  const { user } = useAuth();

  async function handleLogout() {
    try {
      await logout();
    } catch {
      alert("Logout failed. Please try again.");
    }
  }

  return (
    <main className="min-h-screen bg-[#f0f2f5]">
      <header className="flex items-center justify-between bg-[#075e54] px-5 py-4 text-white shadow">
        <div className="flex items-center gap-3">
          <MessageCircle size={27} />
          <h1 className="text-xl font-bold">Joy Inbox</h1>
        </div>

        <button
          onClick={handleLogout}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-white/10"
        >
          <LogOut size={18} />
          Logout
        </button>
      </header>

      <section className="mx-auto max-w-5xl p-6">
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-800">
            Welcome to Joy Inbox
          </h2>

          <p className="mt-2 text-sm text-gray-500">
            Logged in as: {user?.email}
          </p>

          <div className="mt-8 rounded-xl border border-dashed border-gray-300 p-8 text-center">
            <MessageCircle
              size={42}
              className="mx-auto text-[#075e54]"
            />

            <h3 className="mt-4 font-semibold text-gray-700">
              Your inbox interface is coming next
            </h3>

            <p className="mt-2 text-sm text-gray-500">
              Chat list, messages and quick replies will be added in the next batches.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
