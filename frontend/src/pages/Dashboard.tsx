import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Send,
  LogOut,
  MessageCircle,
  Menu,
  X,
  Loader2
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { logout } from "../services/auth";
import {
  listenToChats,
  listenToMessages
} from "../services/chats";
import { sendWhatsAppMessage } from "../services/whatsapp";
import QuickReplies from "../components/QuickReplies";

type AnyRecord = Record<string, any>;

function formatTime(value: any): string {
  if (!value) return "";

  const date =
    typeof value?.toDate === "function"
      ? value.toDate()
      : new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getMessageText(message: AnyRecord): string {
  return message.text || message.message || "";
}

export default function Dashboard() {
  const { user } = useAuth();

  const [chats, setChats] = useState<AnyRecord[]>([]);
  const [selectedChat, setSelectedChat] = useState<AnyRecord | null>(null);
  const [messages, setMessages] = useState<AnyRecord[]>([]);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [mobileListOpen, setMobileListOpen] = useState(true);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = listenToChats((items: AnyRecord[]) => {
      setChats(items);
      setLoadingChats(false);

      setSelectedChat((current) => {
        if (!current) return current;

        return (
          items.find((chat) => chat.id === current.id) || current
        );
      });
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!selectedChat?.id) {
      setMessages([]);
      return;
    }

    setLoadingMessages(true);

    const unsubscribe = listenToMessages(
      selectedChat.id,
      (items: AnyRecord[]) => {
        setMessages(items);
        setLoadingMessages(false);
      }
    );

    return () => unsubscribe();
  }, [selectedChat?.id]);

  const filteredChats = useMemo(() => {
    const term = search.trim().toLowerCase();

    if (!term) return chats;

    return chats.filter((chat) =>
      [
        chat.customerName,
        chat.customerPhone,
        chat.lastMessage
      ]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [chats, search]);

  function handleComposerChange(value: string) {
    setMessage(value);
    setError("");

    if (value.startsWith("/")) {
      setSlashQuery(value.slice(1));
    } else {
      setSlashQuery(null);
    }
  }

  function insertQuickReply(value: string) {
    setMessage(value);
    setSlashQuery(null);
  }

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedChat || !message.trim() || sending) return;

    const text = message.trim();
    const phone = selectedChat.customerPhone;

    if (!phone) {
      setError("Is chat ka customer phone number nahi mila.");
      return;
    }

    setSending(true);
    setError("");

    try {
      await sendWhatsAppMessage(
        phone,
        text,
        selectedChat.id
      );

      setMessage("");
      setSlashQuery(null);
    } catch (err) {
      console.error("Message send failed:", err);
      setError(
        "Message send nahi hua. Number aur WhatsApp connection check karo."
      );
    } finally {
      setSending(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } catch (err) {
      console.error("Logout failed:", err);
      setError("Logout nahi ho paya. Dobara try karo.");
    }
  }

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-gray-100 text-gray-900">
      <aside
        className={`${
          mobileListOpen ? "flex" : "hidden"
        } w-full flex-col border-r border-gray-200 bg-white md:flex md:w-[340px] md:shrink-0`}
      >
        <header className="flex items-center justify-between border-b border-gray-100 px-4 py-4">
          <div>
            <h1 className="text-xl font-bold text-green-700">
              Joy Inbox
            </h1>
            <p className="text-xs text-gray-500">
              WhatsApp Business Inbox
            </p>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="rounded-xl p-2 text-gray-500 hover:bg-gray-100"
            aria-label="Logout"
            title="Logout"
          >
            <LogOut size={19} />
          </button>
        </header>

        <div className="border-b border-gray-100 p-3">
          <div className="flex items-center gap-2 rounded-xl bg-gray-100 px-3">
            <Search size={17} className="text-gray-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search chats..."
              className="w-full bg-transparent py-3 text-sm outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadingChats ? (
            <div className="flex justify-center py-10">
              <Loader2 className="animate-spin text-green-600" />
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <MessageCircle
                size={34}
                className="mx-auto mb-3 text-gray-300"
              />
              <p className="text-sm font-medium text-gray-600">
                No chats found
              </p>
              <p className="mt-1 text-xs text-gray-400">
                Incoming WhatsApp messages will appear here.
              </p>
            </div>
          ) : (
            filteredChats.map((chat) => (
              <button
                type="button"
                key={chat.id}
                onClick={() => {
                  setSelectedChat(chat);
                  setMobileListOpen(false);
                  setError("");
                }}
                className={`flex w-full items-center gap-3 border-b border-gray-100 px-4 py-4 text-left transition hover:bg-green-50 ${
                  selectedChat?.id === chat.id
                    ? "bg-green-50"
                    : "bg-white"
                }`}
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-100 font-semibold text-green-800">
                  {(chat.customerName || chat.customerPhone || "?")
                    .charAt(0)
                    .toUpperCase()}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold">
                      {chat.customerName || chat.customerPhone}
                    </p>
                    <span className="shrink-0 text-[10px] text-gray-400">
                      {formatTime(chat.lastMessageAt)}
                    </span>
                  </div>

                  <p className="mt-1 truncate text-xs text-gray-500">
                    {chat.lastMessage || chat.customerPhone}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>

        <footer className="border-t border-gray-100 px-4 py-3">
          <p className="truncate text-xs text-gray-500">
            Signed in: {user?.email || "Owner"}
          </p>
        </footer>
      </aside>

      <main
        className={`${
          mobileListOpen ? "hidden" : "flex"
        } min-w-0 flex-1 flex-col bg-[#efeae2] md:flex`}
      >
        {selectedChat ? (
          <>
            <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-3 py-3 md:px-5">
              <button
                type="button"
                onClick={() => setMobileListOpen(true)}
                className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 md:hidden"
                aria-label="Back to chats"
              >
                <Menu size={20} />
              </button>

              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 font-semibold text-green-800">
                {(selectedChat.customerName ||
                  selectedChat.customerPhone ||
                  "?")
                  .charAt(0)
                  .toUpperCase()}
              </div>

              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {selectedChat.customerName ||
                    selectedChat.customerPhone}
                </p>
                <p className="truncate text-xs text-gray-500">
                  {selectedChat.customerPhone}
                </p>
              </div>
            </header>

            <section className="flex-1 space-y-3 overflow-y-auto px-3 py-5 md:px-8">
              {loadingMessages ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="animate-spin text-green-700" />
                </div>
              ) : messages.length === 0 ? (
                <div className="mt-12 text-center text-sm text-gray-500">
                  No messages in this conversation yet.
                </div>
              ) : (
                messages.map((item) => {
                  const outgoing =
                    item.direction === "outgoing";

                  return (
                    <div
                      key={item.id || item.messageId}
                      className={`flex ${
                        outgoing ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-3 py-2 shadow-sm md:max-w-[70%] ${
                          outgoing
                            ? "rounded-br-sm bg-[#d9fdd3]"
                            : "rounded-bl-sm bg-white"
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words text-sm">
                          {getMessageText(item)}
                        </p>
                        <div className="mt-1 flex items-center justify-end gap-1">
                          <span className="text-[10px] text-gray-500">
                            {formatTime(item.timestamp)}
                          </span>
                          {outgoing && (
                            <span className="text-[10px] text-gray-500">
                              {item.status || "sent"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </section>

            {error && (
              <p className="bg-red-50 px-4 py-2 text-center text-xs text-red-600">
                {error}
              </p>
            )}

            <form
              onSubmit={handleSend}
              className="relative flex items-end gap-2 border-t border-gray-200 bg-white p-3 md:px-5"
            >
              {user?.uid && (
                <QuickReplies
                  userId={user.uid}
                  onSelect={insertQuickReply}
                  slashQuery={slashQuery}
                  onSlashClose={() => setSlashQuery(null)}
                />
              )}

              <textarea
                value={message}
                onChange={(event) =>
                  handleComposerChange(event.target.value)
                }
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }

                  if (event.key === "Escape") {
                    setSlashQuery(null);
                  }
                }}
                placeholder="Type a message... (type / for Quick Replies)"
                rows={1}
                className="max-h-32 min-h-11 min-w-0 flex-1 resize-y rounded-2xl bg-gray-100 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-green-200"
              />

              <button
                type="submit"
                disabled={sending || !message.trim()}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-600 text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Send message"
              >
                {sending ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Send size={18} />
                )}
              </button>
            </form>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-sm">
              <MessageCircle size={36} className="text-green-600" />
            </div>
            <h2 className="text-lg font-semibold text-gray-700">
              Welcome to Joy Inbox
            </h2>
            <p className="mt-2 max-w-sm text-sm text-gray-500">
              Select a conversation to view messages and reply to your customers.
            </p>
            <button
              type="button"
              onClick={() => setMobileListOpen(true)}
              className="mt-5 rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white md:hidden"
            >
              Open Chats
            </button>
          </div>
        )}
      </main>
    </div>
  );
              }
