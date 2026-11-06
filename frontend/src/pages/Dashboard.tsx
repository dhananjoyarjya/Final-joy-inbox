import { useEffect, useState } from "react";
import {
  LogOut,
  MessageCircle,
  Search,
  Send,
  User,
  RefreshCw,
} from "lucide-react";

import { logout } from "../services/auth";
import { useAuth } from "../context/AuthContext";
import { listenToChats, listenToMessages } from "../services/chats";
import { sendWhatsAppMessage } from "../services/whatsapp";

import type { Chat, ChatMessage } from "../types";

function formatTime(value: any) {
  if (!value) return "";

  const date = value.toDate ? value.toDate() : new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Dashboard() {
  const { user } = useAuth();

  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [loadingChats, setLoadingChats] = useState(true);

  useEffect(() => {
    const unsubscribe = listenToChats(
      (items) => {
        setChats(items);
        setLoadingChats(false);

        setSelectedChat((current) => {
          if (!current) return null;
          return items.find((item) => item.id === current.id) || null;
        });
      },
      () => {
        setError("Chats load nahi ho paaye. Firestore rules check karein.");
        setLoadingChats(false);
      }
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!selectedChat) {
      setMessages([]);
      return;
    }

    const unsubscribe = listenToMessages(
      selectedChat.id,
      setMessages,
      () => setError("Messages load nahi ho paaye.")
    );

    return unsubscribe;
  }, [selectedChat?.id]);

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedChat || !message.trim() || sending) return;

    const text = message.trim();
    setSending(true);
    setError("");

    try {
      await sendWhatsAppMessage(
        selectedChat.customerPhone,
        text,
        selectedChat.id
      );

      setMessage("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Message send nahi hua."
      );
    } finally {
      setSending(false);
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } catch {
      setError("Logout failed.");
    }
  }

  const filteredChats = chats.filter((chat) => {
    const term = search.toLowerCase();

    return (
      chat.customerName?.toLowerCase().includes(term) ||
      chat.customerPhone?.includes(term)
    );
  });

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[#e9edef]">
      <header className="flex h-[64px] shrink-0 items-center justify-between bg-[#075e54] px-4 text-white shadow">
        <div className="flex items-center gap-3">
          <MessageCircle size={28} />
          <div>
            <h1 className="text-lg font-bold">Joy Inbox</h1>
            <p className="text-[11px] text-white/75">Customer support</p>
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-white/10"
        >
          <LogOut size={18} />
          Logout
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          className={`w-full shrink-0 border-r border-gray-200 bg-white md:w-[350px] ${
            selectedChat ? "hidden md:flex" : "flex"
          } flex-col`}
        >
          <div className="border-b border-gray-100 p-4">
            <h2 className="mb-3 text-lg font-semibold text-[#111b21]">
              Chats
            </h2>

            <div className="flex items-center gap-3 rounded-xl bg-[#f0f2f5] px-3">
              <Search size={18} className="text-gray-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search chats..."
                className="h-11 w-full bg-transparent text-sm outline-none"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loadingChats && (
              <div className="p-6 text-center text-sm text-gray-500">
                Loading chats...
              </div>
            )}

            {!loadingChats && filteredChats.length === 0 && (
              <div className="px-6 py-12 text-center">
                <MessageCircle
                  size={38}
                  className="mx-auto text-gray-300"
                />
                <p className="mt-3 text-sm font-medium text-gray-600">
                  No chats found
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  Incoming WhatsApp messages will appear here.
                </p>
              </div>
            )}

            {filteredChats.map((chat) => (
              <button
                key={chat.id}
                onClick={() => {
                  setSelectedChat(chat);
                  setError("");
                }}
                className={`flex w-full items-center gap-3 border-b border-gray-100 p-4 text-left transition hover:bg-gray-50 ${
                  selectedChat?.id === chat.id ? "bg-[#f0f2f5]" : ""
                }`}
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#d9fdd3] text-[#075e54]">
                  <User size={23} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-[#111b21]">
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
            ))}
          </div>
        </aside>

        <section
          className={`min-w-0 flex-1 flex-col ${
            selectedChat ? "flex" : "hidden md:flex"
          }`}
        >
          {selectedChat ? (
            <>
              <div className="flex h-[65px] shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4">
                <button
                  onClick={() => setSelectedChat(null)}
                  className="mr-1 text-sm text-[#075e54] md:hidden"
                >
                  Back
                </button>

                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d9fdd3] text-[#075e54]">
                  <User size={21} />
                </div>

                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#111b21]">
                    {selectedChat.customerName || "Customer"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {selectedChat.customerPhone}
                  </p>
                </div>
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto bg-[#efeae2] p-4">
                {messages.length === 0 && (
                  <p className="mt-10 text-center text-sm text-gray-500">
                    No messages in this conversation.
                  </p>
                )}

                {messages.map((item) => (
                  <div
                    key={item.id}
                    className={`flex ${
                      item.direction === "outgoing"
                        ? "justify-end"
                        : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-xl px-3 py-2 shadow-sm sm:max-w-[70%] ${
                        item.direction === "outgoing"
                          ? "bg-[#d9fdd3]"
                          : "bg-white"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words text-sm text-[#111b21]">
                        {item.text}
                      </p>

                      <p className="mt-1 text-right text-[10px] text-gray-500">
                        {formatTime(item.timestamp)}
                        {item.direction === "outgoing" &&
                          item.status &&
                          ` · ${item.status}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <form
                onSubmit={handleSend}
                className="flex shrink-0 items-center gap-2 bg-[#f0f2f5] p-3"
              >
                <input
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Type a message..."
                  className="h-12 min-w-0 flex-1 rounded-xl bg-white px-4 text-sm outline-none"
                />

                <button
                  type="submit"
                  disabled={!message.trim() || sending}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#075e54] text-white hover:bg-[#064c44] disabled:opacity-50"
                >
                  {sending ? (
                    <RefreshCw size={19} className="animate-spin" />
                  ) : (
                    <Send size={19} />
                  )}
                </button>
              </form>
            </>
          ) : (
            <div className="hidden flex-1 flex-col items-center justify-center text-center md:flex">
              <MessageCircle size={65} className="text-gray-300" />
              <h2 className="mt-5 text-xl font-semibold text-gray-600">
                Welcome to Joy Inbox
              </h2>
              <p className="mt-2 text-sm text-gray-500">
                Select a chat to start a conversation.
              </p>
            </div>
          )}
        </section>
      </div>

      {error && (
        <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-lg rounded-xl bg-red-600 p-3 text-sm text-white shadow-lg">
          {error}
          <button
            onClick={() => setError("")}
            className="float-right ml-3 font-bold"
          >
            ✕
          </button>
        </div>
      )}
    </main>
  );
                }
