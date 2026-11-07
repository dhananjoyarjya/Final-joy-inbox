import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  MessageSquareText,
  Check,
  Loader2,
} from "lucide-react";

import {
  addQuickReply,
  deleteQuickReply,
  listenToQuickReplies,
  updateQuickReply,
} from "../services/quickReplies";

import type { QuickReply } from "../types";

type Props = {
  userId: string;
  onSelect: (message: string) => void;
  slashQuery?: string | null;
  onSlashClose?: () => void;
};

export default function QuickReplies({
  userId,
  onSelect,
  slashQuery = null,
  onSlashClose,
}: Props) {
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [shortcut, setShortcut] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!userId) {
      setReplies([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    const unsubscribe = listenToQuickReplies(
      userId,
      (items) => {
        setReplies(items);
        setLoading(false);
      },
      (listenerError) => {
        console.error("Quick Replies listener failed:", listenerError);
        setError("Quick Replies load nahi hui.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [userId]);

  const filteredReplies = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return replies;

    return replies.filter((reply) =>
      [reply.title, reply.shortcut, reply.message]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [replies, search]);

  const slashReplies = useMemo(() => {
    if (slashQuery === null) return [];

    const term = (slashQuery || "").trim().toLowerCase();

    return replies.filter((reply) => {
      if (!term) return true;

      return [reply.title, reply.shortcut, reply.message]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [replies, slashQuery]);

  function resetForm() {
    setTitle("");
    setShortcut("");
    setMessage("");
    setEditingId(null);
    setFormOpen(false);
  }

  function startAdd() {
    setTitle("");
    setShortcut("");
    setMessage("");
    setEditingId(null);
    setError("");
    setFormOpen(true);
    setPanelOpen(true);
  }

  function startEdit(reply: QuickReply) {
    setTitle(reply.title || "");
    setShortcut(reply.shortcut || "");
    setMessage(reply.message || "");
    setEditingId(reply.id);
    setError("");
    setFormOpen(true);
    setPanelOpen(true);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!title.trim() || !message.trim()) {
      setError("Title aur message dono bharna zaroori hai.");
      return;
    }

    setSaving(true);
    setError("");

    const data = {
      title: title.trim(),
      shortcut: shortcut.trim().replace(/^\/+/, ""),
      message: message.trim(),
    };

    try {
      if (editingId) {
        await updateQuickReply(userId, editingId, data);
      } else {
        await addQuickReply(userId, data);
      }

      resetForm();
    } catch (saveError) {
      console.error("Quick Reply save failed:", saveError);
      setError("Quick Reply save nahi hui. Dobara try karo.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(replyId: string) {
    const confirmed = window.confirm(
      "Kya tum is Quick Reply ko delete karna chahte ho?"
    );

    if (!confirmed) return;

    setError("");

    try {
      await deleteQuickReply(userId, replyId);

      if (editingId === replyId) {
        resetForm();
      }
    } catch (deleteError) {
      console.error("Quick Reply delete failed:", deleteError);
      setError("Quick Reply delete nahi hui.");
    }
  }

  function chooseReply(reply: QuickReply) {
    onSelect(reply.message);
    onSlashClose?.();
    setPanelOpen(false);
  }

  return (
    <div className="relative shrink-0">
      {slashQuery !== null && (
        <div className="absolute bottom-full left-0 z-50 mb-3 w-[min(90vw,380px)] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">
                Quick Replies
              </p>
              <p className="text-xs text-gray-500">
                Reply select karo; message composer mein aa jayega.
              </p>
            </div>

            <button
              type="button"
              onClick={() => onSlashClose?.()}
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
              aria-label="Close Quick Replies"
            >
              <X size={17} />
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto p-2">
            {loading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="animate-spin text-green-600" />
              </div>
            ) : slashReplies.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-500">
                Koi matching Quick Reply nahi mili.
              </p>
            ) : (
              slashReplies.map((reply) => (
                <button
                  key={reply.id}
                  type="button"
                  onClick={() => chooseReply(reply)}
                  className="w-full rounded-xl px-3 py-3 text-left hover:bg-green-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-gray-800">
                      {reply.title}
                    </span>

                    {reply.shortcut && (
                      <span className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500">
                        /{reply.shortcut}
                      </span>
                    )}
                  </div>

                  <p className="mt-1 line-clamp-2 text-sm text-gray-500">
                    {reply.message}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          setSearch("");
          setError("");
          setFormOpen(false);
          setPanelOpen((open) => !open);
        }}
        className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <MessageSquareText size={17} />
        Quick Replies
      </button>

      {panelOpen && (
        <div className="absolute bottom-full left-0 z-40 mb-3 w-[min(90vw,380px)] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-100 p-4">
            <div>
              <h3 className="font-semibold text-gray-900">
                Saved Replies
              </h3>
              <p className="text-xs text-gray-500">
                Apne messages save aur manage karo.
              </p>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={startAdd}
                className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700"
              >
                <Plus size={15} />
                Add
              </button>

              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
                aria-label="Close panel"
              >
                <X size={17} />
              </button>
            </div>
          </div>

          {formOpen && (
            <form
              onSubmit={handleSave}
              className="space-y-3 border-b border-gray-100 p-4"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-800">
                  {editingId ? "Edit Quick Reply" : "New Quick Reply"}
                </p>

                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
                  aria-label="Close form"
                >
                  <X size={17} />
                </button>
              </div>

              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Title (e.g. Welcome)"
                maxLength={60}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-green-500"
                required
              />

              <input
                value={shortcut}
                onChange={(event) => setShortcut(event.target.value)}
                placeholder="Shortcut (e.g. hello)"
                maxLength={30}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-green-500"
              />

              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Type your saved message..."
                rows={4}
                maxLength={4096}
                className="w-full resize-y rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-green-500"
                required
              />

              <button
                type="submit"
                disabled={saving}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Check size={16} />
                )}
                {saving ? "Saving..." : "Save Quick Reply"}
              </button>
            </form>
          )}

          <div className="border-b border-gray-100 p-3">
            <div className="flex items-center gap-2 rounded-xl bg-gray-100 px-3">
              <Search size={16} className="text-gray-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search saved replies..."
                className="w-full bg-transparent py-2.5 text-sm outline-none"
              />
            </div>
          </div>

          {error && (
            <p className="px-4 pt-3 text-xs text-red-600">{error}</p>
          )}

          <div className="max-h-64 overflow-y-auto p-2">
            {loading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="animate-spin text-green-600" />
              </div>
            ) : filteredReplies.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-500">
                Abhi koi saved reply nahi hai.
              </p>
            ) : (
              filteredReplies.map((reply) => (
                <div
                  key={reply.id}
                  className="group flex items-start gap-2 rounded-xl p-3 hover:bg-gray-50"
                >
                  <button
                    type="button"
                    onClick={() => chooseReply(reply)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-gray-800">
                        {reply.title}
                      </span>

                      {reply.shortcut && (
                        <span className="text-xs text-gray-400">
                          /{reply.shortcut}
                        </span>
                      )}
                    </div>

                    <p className="mt-1 line-clamp-2 text-xs text-gray-500">
                      {reply.message}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => startEdit(reply)}
                    className="rounded-lg p-2 text-gray-400 hover:bg-green-50 hover:text-green-700"
                    aria-label="Edit reply"
                  >
                    <Pencil size={15} />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDelete(reply.id)}
                    className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    aria-label="Delete reply"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
  }
