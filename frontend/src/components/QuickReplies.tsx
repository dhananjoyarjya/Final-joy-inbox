import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  X,
  MessageSquareText,
  Check,
} from "lucide-react";

import type { QuickReply } from "../types";
import {
  listenToQuickReplies,
  addQuickReply,
  editQuickReply,
  removeQuickReply,
} from "../services/quickReplies";

interface Props {
  onSelect: (message: string) => void;
}

export default function QuickReplies({ onSelect }: Props) {
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [shortcut, setShortcut] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      return listenToQuickReplies(
        setReplies,
        () => setError("Quick replies load nahi ho paaye.")
      );
    } catch {
      setError("Please login again.");
    }
  }, []);

  const filteredReplies = useMemo(() => {
    const term = search.toLowerCase();

    return replies.filter(
      (reply) =>
        reply.title.toLowerCase().includes(term) ||
        reply.shortcut.toLowerCase().includes(term) ||
        reply.message.toLowerCase().includes(term)
    );
  }, [replies, search]);

  function resetForm() {
    setTitle("");
    setShortcut("");
    setMessage("");
    setEditingId(null);
    setError("");
  }

  function startEdit(reply: QuickReply) {
    setEditingId(reply.id);
    setTitle(reply.title);
    setShortcut(reply.shortcut);
    setMessage(reply.message);
    setError("");
  }

  async function handleSave() {
    setError("");

    if (!title.trim() || !message.trim()) {
      setError("Title aur message dono bharna zaroori hai.");
      return;
    }

    setSaving(true);

    try {
      if (editingId) {
        await editQuickReply(editingId, title, shortcut, message);
      } else {
        await addQuickReply(title, shortcut, message);
      }

      resetForm();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Save nahi ho paya."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Is quick reply ko delete karna hai?")) return;

    try {
      await removeQuickReply(id);
    } catch {
      setError("Delete nahi ho paya.");
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
          resetForm();
        }}
        title="Quick replies"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-[#075e54] hover:bg-gray-50"
      >
        <MessageSquareText size={20} />
      </button>

      {open && (
        <div className="absolute bottom-14 left-0 z-50 flex max-h-[75vh] w-[min(340px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b p-4">
            <h3 className="font-semibold text-gray-800">
              Quick Replies
            </h3>

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-gray-500 hover:text-gray-800"
            >
              <X size={19} />
            </button>
          </div>

          <div className="border-b p-3">
            <div className="flex items-center gap-2 rounded-lg bg-gray-100 px-3">
              <Search size={17} className="text-gray-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search replies..."
                className="h-10 w-full bg-transparent text-sm outline-none"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {filteredReplies.length === 0 && (
              <p className="py-6 text-center text-sm text-gray-400">
                No quick replies found.
              </p>
            )}

            {filteredReplies.map((reply) => (
              <div
                key={reply.id}
                className="mb-2 rounded-lg border border-gray-100 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-800">
                      {reply.title}
                    </p>

                    {reply.shortcut && (
                      <p className="mt-1 text-xs text-[#075e54]">
                        /{reply.shortcut}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(reply)}
                      title="Edit"
                      className="text-gray-500 hover:text-[#075e54]"
                    >
                      <Pencil size={16} />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDelete(reply.id)}
                      title="Delete"
                      className="text-gray-500 hover:text-red-600"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-gray-600">
                  {reply.message}
                </p>

                <button
                  type="button"
                  onClick={() => {
                    onSelect(reply.message);
                    setOpen(false);
                  }}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[#e7f5e5] py-2 text-xs font-semibold text-[#075e54] hover:bg-[#d9fdd3]"
                >
                  <Check size={15} />
                  Insert into message
                </button>
              </div>
            ))}
          </div>

          <div className="border-t p-3">
            <button
              type="button"
              onClick={() => {
                resetForm();
                setEditingId(null);
                setTitle("");
                setShortcut("");
                setMessage("");
              }}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#075e54] py-2.5 text-sm font-semibold text-white"
            >
              <Plus size={17} />
              Add Quick Reply
            </button>

            {(editingId !== null || title || shortcut || message) && (
              <div className="mt-3 space-y-2 border-t pt-3">
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Reply title"
                  className="w-full rounded-lg border p-2 text-sm outline-none focus:border-[#075e54]"
                />

                <input
                  value={shortcut}
                  onChange={(event) => setShortcut(event.target.value)}
                  placeholder="Shortcut (e.g. welcome)"
                  className="w-full rounded-lg border p-2 text-sm outline-none focus:border-[#075e54]"
                />

                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Write your reply..."
                  rows={4}
                  className="w-full resize-y rounded-lg border p-2 text-sm outline-none focus:border-[#075e54]"
                />

                {error && (
                  <p className="text-xs text-red-600">{error}</p>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="flex-1 rounded-lg border py-2 text-sm"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleSave}
                    className="flex-1 rounded-lg bg-[#075e54] py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {saving ? "Saving..." : editingId ? "Update" : "Save"}
                  </button>
                </div>
              </div>
            )}

            {error && !editingId && !title && !message && (
              <p className="mt-2 text-xs text-red-600">{error}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
      }
