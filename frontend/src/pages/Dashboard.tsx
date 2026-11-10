import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bell,
  Check,
  CheckCheck,
  ContactRound,
  CircleCheck,
  CircleX,
  Copy,
  Forward,
  Inbox,
  Loader2,
  LogOut,
  MessageCircle,
  MessageSquareText,
  MoreVertical,
  Paperclip,
  Pencil,
  Pin,
  Reply,
  Trash2,
  Search,
  Send,
  Settings,
  Sun,
  RefreshCw,
  UsersRound,
  X,
} from "lucide-react";
import { MotionConfig, motion } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import MessageMedia from "../components/MessageMedia";
import ContactsPanel from "../components/ContactsPanel";
import { useAuth } from "../context/AuthContext";
import { logout } from "../services/auth";
import {
  listenToChats,
  listenToMessages,
  listenToPinnedMessages,
  loadOlderMessages,
  loadOlderChats,
  getChatById,
  getWhatsAppMessage,
} from "../services/chats";
import {
  disablePushNotifications,
  enablePushNotifications,
  syncPushToken,
} from "../services/pushNotifications";
import { listenToContacts } from "../services/contacts";
import {
  sendWhatsAppMessage,
  sendWhatsAppAttachment,
  updateWhatsAppChatState,
  deleteWhatsAppChats,
  deleteWhatsAppMessages,
  updateWhatsAppMessageState,
  validateWhatsAppAttachment,
  getWhatsAppConnectionStatus,
  getGreetingSettings,
  saveGreetingSettings,
} from "../services/whatsapp";
import QuickReplies from "../components/QuickReplies";
import type { Chat, ChatMessage, Contact, ReplyContext } from "../types";
import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";

type View = "chats" | "contacts" | "replies" | "archived" | "settings";
type ChatFilter = "all" | "unread" | "pinned";
type Theme = "light" | "dark" | "system";
type ContactRequest = { name: string; phone: string };
type ReplyTarget = { message: ChatMessage; messageId: string };
type MessageSwipe = { messageId: string; offset: number; active: boolean; triggered: boolean };
type MessageSwipeGesture = {
  messageId: string;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  cancelled: boolean;
};
type TrackpadSwipe = { messageId: string; offset: number; lastAt: number; timeout: number };

function asDate(value: unknown): Date | null {
  if (!value) return null;
  const date =
    typeof (value as { toDate?: () => Date }).toDate === "function"
      ? (value as { toDate: () => Date }).toDate()
      : new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(value: unknown): string {
  const date = asDate(value);
  if (!date) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function initials(name?: string, phone?: string): string {
  const value = (name && name !== phone ? name : phone) || "?";
  return value.trim().slice(0, 1).toUpperCase();
}

function displayName(chat: Chat): string {
  return chat.customerName && chat.customerName !== chat.customerPhone
    ? chat.customerName
    : chat.customerPhone;
}

function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function statusLabel(status?: ChatMessage["status"]): string {
  if (status === "sending") return "Sending…";
  if (status === "delivered") return "Delivered";
  if (status === "read") return "Read";
  if (status === "failed") return "Failed";
  if (status === "sent") return "Sent";
  return "";
}

function playSendSound() {
  if (!("AudioContext" in window)) return;

  try {
    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    const volume = audioContext.createGain();
    const startTime = audioContext.currentTime;

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(660, startTime);
    oscillator.frequency.setValueAtTime(880, startTime + 0.045);
    volume.gain.setValueAtTime(0.0001, startTime);
    volume.gain.exponentialRampToValueAtTime(0.045, startTime + 0.012);
    volume.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.12);
    oscillator.connect(volume);
    volume.connect(audioContext.destination);
    oscillator.onended = () => {
      void audioContext.close().catch((soundError: unknown) => {
        console.error("Send sound audio context could not be closed:", soundError);
      });
    };
    oscillator.start(startTime);
    oscillator.stop(startTime + 0.13);
    if (audioContext.state === "suspended") {
      void audioContext.resume().catch((soundError: unknown) => {
        console.error("Send sound could not be played:", soundError);
      });
    }
  } catch (soundError) {
    console.error("Send sound could not be played:", soundError);
  }
}

export default function Dashboard() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [chats, setChats] = useState<Chat[]>([]);
  const [recentChats, setRecentChats] = useState<Chat[]>([]);
  const [olderChats, setOlderChats] = useState<Chat[]>([]);
  const [chatCursor, setChatCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasOlderChats, setHasOlderChats] = useState(false);
  const [loadingOlderChats, setLoadingOlderChats] = useState(false);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessage[]>([]);
  const [pinnedMessages, setPinnedMessages] = useState<ChatMessage[]>([]);
  const [recentMessages, setRecentMessages] = useState<ChatMessage[]>([]);
  const [olderMessages, setOlderMessages] = useState<ChatMessage[]>([]);
  const [messageCursor, setMessageCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [message, setMessage] = useState("");
  const [messageSource, setMessageSource] = useState<"manual" | "quick_reply">("manual");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [search, setSearch] = useState("");
  const [messageSearch, setMessageSearch] = useState("");
  const [showPinnedMessages, setShowPinnedMessages] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [messageSelectionMenuOpen, setMessageSelectionMenuOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [messageSwipe, setMessageSwipe] = useState<MessageSwipe | null>(null);
  const [forwardMessageIds, setForwardMessageIds] = useState<string[] | null>(null);
  const [forwardingMessages, setForwardingMessages] = useState(false);
  const [forwardSearch, setForwardSearch] = useState("");
  const [forwardContacts, setForwardContacts] = useState<Contact[]>([]);
  const [forwardContactsLoading, setForwardContactsLoading] = useState(true);
  const [forwardContactsError, setForwardContactsError] = useState("");
  const [contactRequest, setContactRequest] = useState<ContactRequest | null>(null);
  const [deletingMessages, setDeletingMessages] = useState(false);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [busyAction, setBusyAction] = useState(false);
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set());
  const [deletingChats, setDeletingChats] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [mobileListOpen, setMobileListOpen] = useState(true);
  const [view, setView] = useState<View>("chats");
  const [filter, setFilter] = useState<ChatFilter>("all");
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("unlimited-sender-theme") as Theme) || "system"
  );
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    () =>
      localStorage.getItem("unlimited-sender-notifications") === "enabled" &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
  );
  const [notificationsBusy, setNotificationsBusy] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<Awaited<ReturnType<typeof getWhatsAppConnectionStatus>> | null>(null);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [greetingEnabled, setGreetingEnabled] = useState(false);
  const [greetingText, setGreetingText] = useState("");
  const [greetingLoading, setGreetingLoading] = useState(false);
  const [greetingSaving, setGreetingSaving] = useState(false);
  const [greetingError, setGreetingError] = useState("");
  const [greetingSaved, setGreetingSaved] = useState(false);
  const messageDraftRef = useRef(message);
  const messageSourceRef = useRef(messageSource);
  const attachmentDraftRef = useRef(attachment);
  const replyDraftRef = useRef(replyTo);
  messageDraftRef.current = message;
  messageSourceRef.current = messageSource;
  attachmentDraftRef.current = attachment;
  replyDraftRef.current = replyTo;
  const uploadController = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const conversationPanelRef = useRef<HTMLElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const chatLongPressTimer = useRef<number | null>(null);
  const chatLongPressPoint = useRef<{ x: number; y: number } | null>(null);
  const suppressChatClick = useRef(false);
  const messageLongPressTimer = useRef<number | null>(null);
  const messageLongPressPoint = useRef<{ x: number; y: number } | null>(null);
  const messageSwipeGesture = useRef<MessageSwipeGesture | null>(null);
  const trackpadSwipe = useRef<TrackpadSwipe | null>(null);
  const messageElements = useRef(new Map<string, HTMLDivElement>());
  const selectionMenuRef = useRef<HTMLDivElement>(null);
  const pendingQuotedMessageId = useRef<string | null>(null);
  const pendingSendAttempts = useRef(new Map<string, string>());
  const attachmentRequestIds = useRef(new WeakMap<File, string>());
  const selectedChatId = useRef<string | null>(selectedChat?.id || null);
  const suppressMessageClick = useRef<string | null>(null);
  const pendingChatDeletionIds = useRef<Set<string>>(new Set());
  const slashKeyHandler = useRef<((key: string) => boolean) | null>(null);
  selectedChatId.current = selectedChat?.id || null;

  const messages = useMemo(() => {
    if (!selectedChat) return [];
    const allMessages = new Map<string, ChatMessage>();
    for (const item of [...optimisticMessages, ...olderMessages, ...recentMessages]) {
      if (item.chatId && item.chatId !== selectedChat.id) continue;
      const key = item.clientMessageId
        ? `client:${item.clientMessageId}`
        : `document:${item.id || item.messageId}`;
      allMessages.set(key, item);
    }
    return [...allMessages.values()].sort((a, b) => {
      const aTime = asDate(a.timestamp)?.getTime() || 0;
      const bTime = asDate(b.timestamp)?.getTime() || 0;
      return aTime - bTime || (a.id || a.messageId).localeCompare(b.id || b.messageId);
    });
  }, [olderMessages, optimisticMessages, recentMessages, selectedChat?.id]);

  function registerSlashKeyHandler(handler: ((key: string) => boolean) | null) {
    slashKeyHandler.current = handler;
  }

  useEffect(() => () => {
    uploadController.current?.abort();
    if (chatLongPressTimer.current !== null) {
      window.clearTimeout(chatLongPressTimer.current);
    }
    if (messageLongPressTimer.current !== null) {
      window.clearTimeout(messageLongPressTimer.current);
    }
    if (trackpadSwipe.current) window.clearTimeout(trackpadSwipe.current.timeout);
  }, []);

  useEffect(() => {
    if (!messageSelectionMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !selectionMenuRef.current?.contains(event.target)) {
        setMessageSelectionMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMessageSelectionMenuOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [messageSelectionMenuOpen]);

  useEffect(() => {
    const panel = conversationPanelRef.current;
    const viewport = window.visualViewport;
    if (!panel || !viewport) return;

    const syncConversationViewport = () => {
      if (window.matchMedia("(max-width: 680px)").matches) {
        panel.style.setProperty("--chat-viewport-height", `${viewport.height}px`);
        panel.style.setProperty("--chat-viewport-offset-top", `${viewport.offsetTop}px`);
      } else {
        panel.style.removeProperty("--chat-viewport-height");
        panel.style.removeProperty("--chat-viewport-offset-top");
      }
    };

    syncConversationViewport();
    viewport.addEventListener("resize", syncConversationViewport);
    viewport.addEventListener("scroll", syncConversationViewport);
    window.addEventListener("resize", syncConversationViewport);

    return () => {
      viewport.removeEventListener("resize", syncConversationViewport);
      viewport.removeEventListener("scroll", syncConversationViewport);
      window.removeEventListener("resize", syncConversationViewport);
      panel.style.removeProperty("--chat-viewport-height");
      panel.style.removeProperty("--chat-viewport-offset-top");
    };
  }, []);

  useEffect(() => {
    const unsubscribe = listenToChats(
      (items, cursor, hasOlder) => {
        for (const chatId of pendingChatDeletionIds.current) {
          if (!items.some((chat) => chat.id === chatId)) {
            pendingChatDeletionIds.current.delete(chatId);
          }
        }
        setRecentChats(items.filter((chat) => !pendingChatDeletionIds.current.has(chat.id)));
        setChatCursor((current) => current || cursor);
        setHasOlderChats(hasOlder);
        setLoadingChats(false);
        setListError("");
        setSelectedChat((current) =>
          current ? items.find((chat) => chat.id === current.id) || current : current
        );
      },
      (listenerError) => {
        console.error("Chat list listener failed:", listenerError);
        setListError("Chats could not be loaded. Check your connection and retry.");
        setLoadingChats(false);
      }
    );
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user || !notificationsEnabled) return;

    let active = true;
    let syncing = false;
    const synchronizeToken = () => {
      if (syncing) return;
      syncing = true;
      void syncPushToken()
        .then(() => {
          if (active) setNotificationError("");
        })
        .catch((syncError: unknown) => {
          console.error("Push token refresh failed:", syncError);
          if (active) {
            setNotificationError(
              syncError instanceof Error
                ? syncError.message
                : "Push notification registration could not be refreshed."
            );
          }
        })
        .finally(() => {
          syncing = false;
        });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") synchronizeToken();
    };

    synchronizeToken();
    const refreshTimer = window.setInterval(synchronizeToken, 12 * 60 * 60 * 1000);
    window.addEventListener("focus", synchronizeToken);
    window.addEventListener("online", synchronizeToken);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", synchronizeToken);
      window.removeEventListener("online", synchronizeToken);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [notificationsEnabled, user?.uid]);

  useEffect(() => {
    const notificationChatId = searchParams.get("chatId");
    if (!notificationChatId || loadingChats) return;

    let active = true;
    const openChat = async () => {
      const chat =
        chats.find((item) => item.id === notificationChatId) ||
        (await getChatById(notificationChatId));
      if (!active) return;

      if (chat) {
        void selectChat(chat);
      } else {
        setError("The conversation opened from this notification could not be found.");
      }

      setSearchParams((current) => {
        current.delete("chatId");
        current.delete("messageId");
        return current;
      }, { replace: true });
    };

    void openChat().catch((openError: unknown) => {
      console.error("Could not open notification conversation:", openError);
      if (active) {
        setError(
          openError instanceof Error
            ? openError.message
            : "The conversation opened from this notification could not be loaded."
        );
        setSearchParams((current) => {
          current.delete("chatId");
          current.delete("messageId");
          return current;
        }, { replace: true });
      }
    });
    return () => {
      active = false;
    };
  }, [chats, loadingChats, searchParams, setSearchParams]);

  useEffect(() => {
    const allChats = new Map<string, Chat>();
    for (const chat of [...recentChats, ...olderChats]) allChats.set(chat.id, chat);
    setChats([...allChats.values()]);
  }, [olderChats, recentChats]);

  useEffect(() => {
    pendingQuotedMessageId.current = null;
    if (!selectedChat?.id) {
      setRecentMessages([]);
      setOlderMessages([]);
      setPinnedMessages([]);
      setMessageCursor(null);
      setHasOlderMessages(false);
      return;
    }

    setLoadingMessages(true);
    setOlderMessages([]);
    setMessageCursor(null);
    setHasOlderMessages(false);
    const unsubscribe = listenToMessages(
      selectedChat.id,
      (items, cursor, hasOlder) => {
        setRecentMessages(items);
        setMessageCursor((current) => current || cursor);
        setHasOlderMessages(hasOlder);
        setLoadingMessages(false);
        setError("");
      },
      (listenerError) => {
        console.error("Message history listener failed:", listenerError);
        setError("Messages could not be loaded. Check access and connection.");
        setLoadingMessages(false);
      }
    );
    const unsubscribePinned = listenToPinnedMessages(
      selectedChat.id,
      setPinnedMessages,
      (listenerError) => {
        console.error("Pinned message listener failed:", listenerError);
        setError("Pinned messages could not be loaded.");
      }
    );
    return () => {
      unsubscribe();
      unsubscribePinned();
    };
  }, [selectedChat?.id]);

  useEffect(() => {
    const confirmedClientIds = new Set(
      recentMessages
        .map((item) => item.clientMessageId)
        .filter((id): id is string => Boolean(id))
    );
    if (!confirmedClientIds.size) return;
    setOptimisticMessages((current) =>
      current.filter((item) => !item.clientMessageId || !confirmedClientIds.has(item.clientMessageId))
    );
    for (const [fingerprint, clientMessageId] of pendingSendAttempts.current) {
      if (confirmedClientIds.has(clientMessageId)) {
        pendingSendAttempts.current.delete(fingerprint);
      }
    }
  }, [recentMessages]);

  useEffect(() => {
    const messageId = pendingQuotedMessageId.current;
    if (!messageId) return;
    const element = messageElements.current.get(messageId);
    if (!element) return;
    pendingQuotedMessageId.current = null;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    element.classList.add("message-quote-target");
    window.setTimeout(() => element.classList.remove("message-quote-target"), 1500);
  }, [messageSearch, messages, showPinnedMessages]);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      root.dataset.theme = theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("unlimited-sender-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (view !== "settings" || !user?.uid) return;
    let active = true;
    setGreetingLoading(true);
    setGreetingError("");
    getGreetingSettings()
      .then((settings) => {
        if (!active) return;
        setGreetingEnabled(settings.enabled);
        setGreetingText(settings.text);
      })
      .catch((settingsError: unknown) => {
        if (!active) return;
        console.error("Greeting settings load failed:", settingsError);
        setGreetingError(settingsError instanceof Error ? settingsError.message : "Greeting settings could not be loaded.");
      })
      .finally(() => {
        if (active) setGreetingLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user?.uid, view]);

  useEffect(() => {
    if (!user?.uid) {
      setForwardContacts([]);
      setForwardContactsLoading(false);
      setForwardContactsError("");
      return;
    }

    setForwardContactsLoading(true);
    setForwardContactsError("");
    return listenToContacts(
      user.uid,
      (items) => {
        setForwardContacts(items);
        setForwardContactsLoading(false);
      },
      (listenerError) => {
        console.error("Saved contacts listener failed:", listenerError);
        setForwardContactsError("Saved contact names could not be loaded.");
        setForwardContactsLoading(false);
      }
    );
  }, [user?.uid]);

  const visibleChats = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return chats.filter((chat) => {
      if (view === "archived" ? !chat.archived : chat.archived) return false;
      if (view === "contacts") {
        return !term || `${chat.customerName} ${chat.customerPhone}`.toLowerCase().includes(term);
      }
      if (filter === "unread" && !chat.unreadCount) return false;
      if (filter === "pinned" && !chat.pinned) return false;
      return (
        !term ||
        `${chat.customerName} ${chat.customerPhone} ${chat.lastMessage}`
          .toLocaleLowerCase()
          .includes(term)
      );
    }).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
  }, [chats, filter, search, view]);

  const forwardContactsByPhone = useMemo(() => {
    const contactsByPhone = new Map<string, Contact>();
    forwardContacts.forEach((contact) => {
      const phone = phoneDigits(contact.phone);
      if (phone) contactsByPhone.set(phone, contact);
    });
    return contactsByPhone;
  }, [forwardContacts]);

  const forwardRecipients = useMemo(() => {
    const term = forwardSearch.trim().toLocaleLowerCase();
    const numberTerm = phoneDigits(forwardSearch);
    return chats.filter((chat) => {
      if (chat.archived) return false;
      if (!term) return true;

      const savedContact = forwardContactsByPhone.get(phoneDigits(chat.customerPhone));
      const names = `${chat.customerName} ${savedContact?.name || ""}`.toLocaleLowerCase();
      const phone = chat.customerPhone.toLocaleLowerCase();
      return (
        names.includes(term) ||
        phone.includes(term) ||
        Boolean(numberTerm && phoneDigits(chat.customerPhone).includes(numberTerm))
      );
    });
  }, [chats, forwardContactsByPhone, forwardSearch]);

  const visibleMessages = useMemo(() => {
    const source = showPinnedMessages ? pinnedMessages : messages;
    const term = messageSearch.trim().toLocaleLowerCase();
    if (!term) return source;
    return source.filter((item) => (item.text || "").toLocaleLowerCase().includes(term));
  }, [messages, messageSearch, pinnedMessages, showPinnedMessages]);
  const selectedMessages = [...selectedMessageIds]
    .map(findMessageById)
    .filter((item): item is ChatMessage => Boolean(item));
  const selectedMessagesCanCopy = selectedMessages.some((item) => Boolean(item.text?.trim()));
  const selectedMessagesCanForward =
    selectedMessages.length === selectedMessageIds.size &&
    selectedMessages.every((item) => item.type === "text" && Boolean(item.text?.trim()));

  async function loadEarlierMessages() {
    if (!selectedChat || !messageCursor || loadingOlderMessages) return;
    setLoadingOlderMessages(true);
    setError("");
    try {
      const page = await loadOlderMessages(selectedChat.id, messageCursor);
      setOlderMessages((current) => [...page.messages, ...current]);
      setMessageCursor(page.cursor);
      setHasOlderMessages(page.hasOlder);
    } catch (historyError) {
      console.error("Older message history load failed:", historyError);
      setError(historyError instanceof Error ? historyError.message : "Earlier messages could not be loaded.");
    } finally {
      setLoadingOlderMessages(false);
    }
  }

  async function loadEarlierChats() {
    if (!chatCursor || loadingOlderChats) return;
    setLoadingOlderChats(true);
    setListError("");
    try {
      const page = await loadOlderChats(chatCursor);
      setOlderChats((current) => [...current, ...page.chats]);
      setChatCursor(page.cursor);
      setHasOlderChats(page.hasOlder);
    } catch (historyError) {
      console.error("Older conversation load failed:", historyError);
      setListError(historyError instanceof Error ? historyError.message : "Older conversations could not be loaded.");
    } finally {
      setLoadingOlderChats(false);
    }
  }

  function getMessageDocumentId(item: ChatMessage) {
    return item.id || item.messageId;
  }

  function findMessageById(messageId: string) {
    return (
      messages.find((item) => getMessageDocumentId(item) === messageId) ||
      pinnedMessages.find((item) => getMessageDocumentId(item) === messageId)
    );
  }

  function cancelMessageLongPress() {
    if (messageLongPressTimer.current !== null) {
      window.clearTimeout(messageLongPressTimer.current);
      messageLongPressTimer.current = null;
    }
    messageLongPressPoint.current = null;
  }

  function startMessageLongPress(
    item: ChatMessage,
    event: ReactPointerEvent<HTMLDivElement>
  ) {
    suppressMessageClick.current = null;
    if (
      event.target instanceof Element &&
      event.target.closest("button, a, input, video, audio")
    ) {
      return;
    }
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    cancelMessageLongPress();
    messageLongPressPoint.current = { x: event.clientX, y: event.clientY };
    messageLongPressTimer.current = window.setTimeout(() => {
      messageLongPressTimer.current = null;
      messageLongPressPoint.current = null;
      suppressMessageClick.current = getMessageDocumentId(item);
      selectMessage(item);
    }, 500);
  }

  function startMessageSwipe(item: ChatMessage, event: ReactPointerEvent<HTMLDivElement>) {
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      selectedMessageIds.size > 0 ||
      selectedMessageIds.has(getMessageDocumentId(item)) ||
      (event.target instanceof Element &&
        event.target.closest("button, a, input, video, audio, [contenteditable='true']"))
    ) {
      messageSwipeGesture.current = null;
      return;
    }

    messageSwipeGesture.current = {
      messageId: getMessageDocumentId(item),
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      cancelled: false,
    };
    if (event.pointerType === "mouse") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function moveMessageSwipe(item: ChatMessage, event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = messageSwipeGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.cancelled) return;

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (!gesture.active) {
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 8) return;
      if (deltaX <= 0 || Math.abs(deltaY) >= Math.abs(deltaX)) {
        gesture.cancelled = true;
        return;
      }

      gesture.active = true;
      cancelMessageLongPress();
      suppressMessageClick.current = gesture.messageId;
    }

    if (deltaX <= 0 || Math.abs(deltaY) >= deltaX) {
      gesture.cancelled = true;
      setMessageSwipe(null);
      return;
    }

    event.preventDefault();
    const offset = Math.min(deltaX, 116);
    setMessageSwipe({
      messageId: getMessageDocumentId(item),
      offset,
      active: true,
      triggered: offset >= 72,
    });
  }

  function finishMessageSwipe(item: ChatMessage, event: ReactPointerEvent<HTMLDivElement>) {
    cancelMessageLongPress();
    const gesture = messageSwipeGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const shouldReply =
      gesture.active &&
      deltaX >= 72 &&
      Math.abs(deltaY) < deltaX &&
      !gesture.cancelled;
    messageSwipeGesture.current = null;
    setMessageSwipe(null);
    if (shouldReply) {
      suppressMessageClick.current = gesture.messageId;
      beginReply(item);
    }
  }

  function cancelMessageSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    cancelMessageLongPress();
    if (messageSwipeGesture.current?.pointerId !== event.pointerId) return;
    messageSwipeGesture.current = null;
    setMessageSwipe(null);
  }

  function handleMessageWheel(item: ChatMessage, event: ReactWheelEvent<HTMLDivElement>) {
    if (Math.abs(event.deltaY) >= Math.abs(event.deltaX) && trackpadSwipe.current) {
      window.clearTimeout(trackpadSwipe.current.timeout);
      trackpadSwipe.current = null;
      setMessageSwipe(null);
    }

    if (
      event.deltaX >= 0 ||
      Math.abs(event.deltaX) <= Math.abs(event.deltaY) ||
      selectedMessageIds.size > 0 ||
      selectedMessageIds.has(getMessageDocumentId(item)) ||
      (event.target instanceof Element &&
        event.target.closest("button, a, input, video, audio, [contenteditable='true']"))
    ) {
      return;
    }

    event.preventDefault();
    const itemId = getMessageDocumentId(item);
    const now = Date.now();
    const previous = trackpadSwipe.current;
    const offset =
      previous?.messageId === itemId && now - previous.lastAt < 220
        ? Math.min(previous.offset + Math.abs(event.deltaX), 116)
        : Math.min(Math.abs(event.deltaX), 116);

    if (previous) window.clearTimeout(previous.timeout);
    if (offset >= 72) {
      trackpadSwipe.current = null;
      setMessageSwipe(null);
      suppressMessageClick.current = itemId;
      beginReply(item);
      return;
    }

    const timeout = window.setTimeout(() => {
      trackpadSwipe.current = null;
      setMessageSwipe(null);
    }, 180);
    trackpadSwipe.current = { messageId: itemId, offset, lastAt: now, timeout };
    setMessageSwipe({ messageId: itemId, offset, active: true, triggered: false });
  }

  function moveMessageLongPress(event: ReactPointerEvent<HTMLDivElement>) {
    const point = messageLongPressPoint.current;
    if (
      point &&
      (Math.abs(event.clientX - point.x) > 10 || Math.abs(event.clientY - point.y) > 10)
    ) {
      cancelMessageLongPress();
    }
  }

  function toggleMessageSelection(item: ChatMessage) {
    const id = getMessageDocumentId(item);
    setSelectedMessageIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectMessage(item: ChatMessage) {
    const id = getMessageDocumentId(item);
    setSelectedMessageIds((current) => current.has(id) ? current : new Set(current).add(id));
  }

  function handleMessageClick(item: ChatMessage) {
    if (suppressMessageClick.current === getMessageDocumentId(item)) {
      suppressMessageClick.current = null;
      return;
    }
    suppressMessageClick.current = null;
    if (selectedMessageIds.size > 0) toggleMessageSelection(item);
  }

  function cancelMessageSelection() {
    setSelectedMessageIds(new Set());
    setMessageSelectionMenuOpen(false);
  }

  async function setSelectedMessagesPinned(items: ChatMessage[]) {
    if (!selectedChat || busyAction || !items.length) return;
    const shouldPin = items.some((item) => !item.pinned);
    let updatedCount = 0;
    setBusyAction(true);
    setMessageSelectionMenuOpen(false);
    setError("");
    try {
      for (const item of items) {
        await updateWhatsAppMessageState(
          selectedChat.id,
          getMessageDocumentId(item),
          shouldPin
        );
        updatedCount++;
      }
    } catch (actionError) {
      console.error("Message pin state update failed:", actionError);
      const detail = actionError instanceof Error ? actionError.message : "Messages could not be updated.";
      setError(updatedCount
        ? `${updatedCount} message${updatedCount === 1 ? "" : "s"} updated; the remaining messages could not be updated. ${detail}`
        : detail);
    } finally {
      setBusyAction(false);
    }
  }

  async function deleteMessagesFromInbox(messageIds: string[], confirm: boolean) {
    if (!selectedChat || deletingMessages || !messageIds.length) return;
    if (
      confirm &&
      !window.confirm(
        `Permanently delete ${messageIds.length} selected message${messageIds.length === 1 ? "" : "s"} from this inbox? This does not delete messages from the customer's WhatsApp.`
      )
    ) {
      return;
    }

    setDeletingMessages(true);
    setMessageSelectionMenuOpen(false);
    setError("");
    const deletedIds = new Set<string>();
    try {
      for (let index = 0; index < messageIds.length; index += 50) {
        const batch = messageIds.slice(index, index + 50);
        const result = await deleteWhatsAppMessages(selectedChat.id, batch);
        if (!batch.every((id) => result.deletedMessageIds.includes(id))) {
          throw new Error("The server did not confirm deletion of every selected message.");
        }
        batch.forEach((id) => deletedIds.add(id));
        setRecentMessages((current) =>
          current.filter((item) => !deletedIds.has(getMessageDocumentId(item)))
        );
        setOlderMessages((current) =>
          current.filter((item) => !deletedIds.has(getMessageDocumentId(item)))
        );
        setPinnedMessages((current) =>
          current.filter((item) => !deletedIds.has(getMessageDocumentId(item)))
        );
        setSelectedMessageIds((current) =>
          new Set([...current].filter((id) => !deletedIds.has(id)))
        );
      }
      setSelectedMessageIds(new Set());
    } catch (deleteError) {
      console.error("Message deletion failed:", deleteError);
      setError(
        deletedIds.size
          ? `${deletedIds.size} message${deletedIds.size === 1 ? "" : "s"} deleted; remaining messages could not be deleted. ${deleteError instanceof Error ? deleteError.message : ""}`
          : deleteError instanceof Error
            ? deleteError.message
            : "Messages could not be deleted."
      );
    } finally {
      setDeletingMessages(false);
    }
  }

  function beginReply(item: ChatMessage) {
    setReplyTo({ message: item, messageId: getMessageDocumentId(item) });
    setMessageSource("manual");
    window.setTimeout(() => composerInputRef.current?.focus(), 0);
  }

  function getReplyContext(target: ReplyTarget | null, chat: Chat): ReplyContext | undefined {
    if (!target) return undefined;
    const original = target.message;
    return {
      replyToMessageId: target.messageId,
      replyToMessageText: original.text || "",
      replyToMessageSender: original.direction === "outgoing"
        ? "You"
        : original.sender || chat.customerPhone,
      replyToMessageType: original.type || "unknown",
    };
  }

  async function openQuotedMessage(messageId: string) {
    if (!selectedChat) return;
    const chatId = selectedChat.id;
    setShowPinnedMessages(false);
    setMessageSearch("");
    pendingQuotedMessageId.current = messageId;

    if (messageElements.current.has(messageId)) {
      const element = messageElements.current.get(messageId);
      if (element) {
        pendingQuotedMessageId.current = null;
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        element.classList.add("message-quote-target");
        window.setTimeout(() => element.classList.remove("message-quote-target"), 1500);
      }
      return;
    }

    try {
      const originalMessage = await getWhatsAppMessage(chatId, messageId);
      if (selectedChatId.current !== chatId) return;
      if (!originalMessage) {
        pendingQuotedMessageId.current = null;
        setError("The original quoted message is no longer available.");
        return;
      }
      setOlderMessages((current) =>
        current.some((item) => getMessageDocumentId(item) === messageId)
          ? current
          : [...current, originalMessage]
      );
    } catch (quoteError) {
      if (selectedChatId.current !== chatId) return;
      pendingQuotedMessageId.current = null;
      console.error("Quoted message load failed:", quoteError);
      setError(
        quoteError instanceof Error
          ? quoteError.message
          : "The original quoted message could not be loaded."
      );
    }
  }

  function beginForward(messageIds: string[]) {
    const selected = messageIds.map(findMessageById);
    if (
      selected.some((item) => !item || item.type !== "text" || !item.text?.trim())
    ) {
      setError("Only text messages can be forwarded. Media forwarding is not supported.");
      return;
    }
    setMessageSelectionMenuOpen(false);
    setForwardSearch("");
    setForwardMessageIds(messageIds);
  }

  async function forwardMessagesToChat(chat: Chat) {
    if (!forwardMessageIds?.length || forwardingMessages) return;
    const selected = forwardMessageIds.map(findMessageById);
    if (selected.some((item) => !item || item.type !== "text" || !item.text?.trim())) {
      setError("The selected text is no longer available to forward.");
      setForwardMessageIds(null);
      return;
    }

    setForwardingMessages(true);
    setError("");
    let sentCount = 0;
    try {
      for (const item of selected) {
        await sendWhatsAppMessage(
          chat.customerPhone,
          item!.text,
          chat.id,
          "manual"
        );
        sentCount++;
      }
      setForwardMessageIds(null);
      setSelectedMessageIds(new Set());
    } catch (forwardError) {
      console.error("Message forwarding failed:", forwardError);
      setError(
        sentCount
          ? `${sentCount} message${sentCount === 1 ? "" : "s"} forwarded; the next message could not be sent. ${forwardError instanceof Error ? forwardError.message : ""}`
          : forwardError instanceof Error
            ? forwardError.message
            : "The selected messages could not be forwarded."
      );
    } finally {
      setForwardingMessages(false);
    }
  }

  async function copySelectedMessages() {
    const text = selectedMessages
      .map((item) => item.text?.trim())
      .filter((value): value is string => Boolean(value))
      .join("\n");
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setSelectedMessageIds(new Set());
      setMessageSelectionMenuOpen(false);
      setError("");
    } catch (copyError) {
      console.error("Selected message copy failed:", copyError);
      setError("Selected message text could not be copied.");
    }
  }

  function openContactRequest() {
    if (!selectedChat) return;
    setContactRequest({
      name: displayName(selectedChat),
      phone: selectedChat.customerPhone,
    });
    setSelectedMessageIds(new Set());
    setMessageSelectionMenuOpen(false);
    setSearch("");
    setView("contacts");
    setMobileListOpen(true);
  }

  async function selectChat(chat: Chat) {
    setSelectedChatIds(new Set());
    setSelectedMessageIds(new Set());
    setMessageSelectionMenuOpen(false);
    setReplyTo(null);
    setShowPinnedMessages(false);
    setDeleteError("");
    uploadController.current?.abort();
    uploadController.current = null;
    setAttachment(null);
    setUploadProgress(0);
    setSelectedChat(chat);
    setMobileListOpen(false);
    setView("chats");
    setError("");
    setMessageSearch("");
    if (chat.unreadCount > 0) {
      try {
        await updateWhatsAppChatState(chat.id, { markRead: true });
      } catch (actionError) {
        console.error("Mark conversation read failed:", actionError);
        setError("Conversation opened, but its unread count could not be cleared.");
      }
    }
  }

  async function updateChat(
    chat: Chat,
    state: { pinned?: boolean; archived?: boolean }
  ) {
    if (busyAction) return;
    setBusyAction(true);
    setError("");
    try {
      await updateWhatsAppChatState(chat.id, state);
    } catch (actionError) {
      console.error("Conversation update failed:", actionError);
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Conversation could not be updated."
      );
    } finally {
      setBusyAction(false);
    }
  }

  function cancelChatLongPress() {
    if (chatLongPressTimer.current !== null) {
      window.clearTimeout(chatLongPressTimer.current);
      chatLongPressTimer.current = null;
    }
    chatLongPressPoint.current = null;
  }

  function startChatLongPress(chatId: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (
      (view !== "chats" && view !== "archived") ||
      selectedChatIds.size > 0 ||
      deletingChats ||
      event.button !== 0
    ) return;
    cancelChatLongPress();
    chatLongPressPoint.current = { x: event.clientX, y: event.clientY };
    chatLongPressTimer.current = window.setTimeout(() => {
      chatLongPressTimer.current = null;
      chatLongPressPoint.current = null;
      suppressChatClick.current = true;
      setDeleteError("");
      setSelectedChatIds((current) => new Set(current).add(chatId));
    }, 500);
  }

  function moveChatLongPress(event: ReactPointerEvent<HTMLButtonElement>) {
    const point = chatLongPressPoint.current;
    if (
      point &&
      (Math.abs(event.clientX - point.x) > 10 || Math.abs(event.clientY - point.y) > 10)
    ) {
      cancelChatLongPress();
    }
  }

  function handleChatRowClick(chat: Chat) {
    if (deletingChats) return;
    if (suppressChatClick.current) {
      suppressChatClick.current = false;
      return;
    }
    if (selectedChatIds.size > 0) {
      setSelectedChatIds((current) => {
        const next = new Set(current);
        if (next.has(chat.id)) next.delete(chat.id);
        else next.add(chat.id);
        return next;
      });
      setDeleteError("");
      return;
    }
    void selectChat(chat);
  }

  async function deleteSelectedChats() {
    const chatIds = [...selectedChatIds];
    if (!chatIds.length || deletingChats) return;
    const confirmed = window.confirm(
      `Permanently delete ${chatIds.length} selected conversation${chatIds.length === 1 ? "" : "s"} and all their messages? Contacts, quick replies, and greeting settings will remain.`
    );
    if (!confirmed) return;

    setDeleteError("");
    setDeletingChats(true);

    const deletedIds = new Set<string>();
    const failureMessages = new Map<string, string>();
    for (let index = 0; index < chatIds.length; index += 50) {
      const batch = chatIds.slice(index, index + 50);
      try {
        const result = await deleteWhatsAppChats(batch);
        const batchIds = new Set(batch);
        const newlyDeletedIds = result.deletedChatIds.filter(
          (chatId) => batchIds.has(chatId) && !deletedIds.has(chatId)
        );
        for (const chatId of newlyDeletedIds) {
          deletedIds.add(chatId);
          pendingChatDeletionIds.current.add(chatId);
        }
        if (newlyDeletedIds.length) {
          const newlyDeletedSet = new Set(newlyDeletedIds);
          setRecentChats((current) => current.filter((chat) => !newlyDeletedSet.has(chat.id)));
          setOlderChats((current) => current.filter((chat) => !newlyDeletedSet.has(chat.id)));
          if (selectedChat?.id && newlyDeletedSet.has(selectedChat.id)) {
            setSelectedChat(null);
            setMobileListOpen(true);
          }
        }
        for (const failure of result.errors) {
          if (batchIds.has(failure.chatId) && !deletedIds.has(failure.chatId)) {
            failureMessages.set(failure.chatId, failure.error);
          }
        }
        for (const chatId of batch) {
          if (!deletedIds.has(chatId) && !failureMessages.has(chatId)) {
            failureMessages.set(chatId, "Conversation could not be deleted.");
          }
        }
      } catch (deleteError) {
        const messageText = deleteError instanceof Error
          ? deleteError.message
          : "Conversation could not be deleted.";
        for (const chatId of batch) {
          if (!deletedIds.has(chatId)) failureMessages.set(chatId, messageText);
        }
        for (const chatId of chatIds.slice(index + batch.length)) {
          failureMessages.set(chatId, "Conversation was not deleted.");
        }
        break;
      }
    }

    const failedIds = chatIds.filter((chatId) => !deletedIds.has(chatId));
    if (failedIds.length) {
      const failedIdSet = new Set(failedIds);
      setSelectedChatIds(failedIdSet);
      const firstError = failureMessages.get(failedIds[0]);
      setDeleteError(
        `${failedIds.length} conversation${failedIds.length === 1 ? "" : "s"} could not be deleted.${firstError ? ` ${firstError}` : ""}`
      );
    } else {
      setSelectedChatIds(new Set());
      setDeleteError("");
    }
    setDeletingChats(false);
  }

  function handleComposerChange(value: string) {
    setMessage(value);
    setMessageSource("manual");
    setError("");
    setSlashQuery(value.startsWith("/") ? value.slice(1) : null);
  }

  function insertQuickReply(value: string) {
    setMessage(value);
    setMessageSource("quick_reply");
    setSlashQuery(null);
    setError("");
    if (view === "replies") setView("chats");
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedChat || (!message.trim() && !attachment) || sending) return;
    playSendSound();
    const chat = selectedChat;
    const text = message.trim();
    const currentAttachment = attachment;
    const currentSource = messageSource;
    const currentReplyTo = replyTo;
    const replyContext = getReplyContext(currentReplyTo, chat);
    let attachmentRequestId: string | null = null;
    if (currentAttachment) {
      attachmentRequestId = attachmentRequestIds.current.get(currentAttachment) || crypto.randomUUID();
      attachmentRequestIds.current.set(currentAttachment, attachmentRequestId);
    }
    const fingerprint = JSON.stringify({
      chatId: chat.id,
      text,
      source: currentSource,
      attachment: attachmentRequestId,
      replyToMessageId: replyContext?.replyToMessageId || null
    });
    const clientMessageId = pendingSendAttempts.current.get(fingerprint) || crypto.randomUUID();
    pendingSendAttempts.current.set(fingerprint, clientMessageId);
    const optimisticMessage: ChatMessage = {
      id: clientMessageId,
      messageId: clientMessageId,
      clientMessageId,
      chatId: chat.id,
      direction: "outgoing",
      type: currentAttachment ? validateWhatsAppAttachment(currentAttachment) : "text",
      text,
      timestamp: new Date(),
      status: "sending",
      source: currentSource,
      sender: "owner",
      ...(currentAttachment ? {
        mediaFilename: currentAttachment.name,
        mediaMimeType: currentAttachment.type,
        mediaSize: currentAttachment.size
      } : {}),
      ...(replyContext ? {
        replyToMessageId: replyContext.replyToMessageId,
        replyToMessageText: replyContext.replyToMessageText,
        replyToMessageSender: replyContext.replyToMessageSender,
        replyToMessageType: replyContext.replyToMessageType
      } : {})
    };
    setOptimisticMessages((current) => [
      ...current.filter((item) => item.clientMessageId !== clientMessageId),
      optimisticMessage
    ]);
    setShowPinnedMessages(false);
    const startedAt = performance.now();
    window.requestAnimationFrame(() => {
      console.info(JSON.stringify({
        metric: "frontend_optimistic_render_ms",
        durationMs: Math.max(0, Math.round(performance.now() - startedAt))
      }));
    });
    setSending(true);
    setError("");
    try {
      let result: { success: boolean; messageId?: string; pending?: boolean };
      if (currentAttachment) {
        uploadController.current = new AbortController();
        result = await sendWhatsAppAttachment(
          chat.customerPhone,
          chat.id,
          currentAttachment,
          text,
          currentSource,
          uploadController.current.signal,
          setUploadProgress,
          replyContext,
          clientMessageId
        );
      } else {
        result = await sendWhatsAppMessage(
          chat.customerPhone,
          text,
          chat.id,
          currentSource,
          replyContext,
          clientMessageId
        );
      }
      console.info(JSON.stringify({
        metric: "frontend_send_elapsed_ms",
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        media: Boolean(currentAttachment),
        pending: Boolean(result.pending)
      }));
      setOptimisticMessages((current) =>
        current.map((item) => item.clientMessageId === clientMessageId
          ? {
              ...item,
              ...(result.messageId ? { messageId: result.messageId } : {}),
              status: "sending"
            }
          : item)
      );
      if (messageDraftRef.current === text && messageSourceRef.current === currentSource) {
        setMessage("");
        setMessageSource("manual");
        setSlashQuery(null);
      }
      if (currentReplyTo?.messageId === replyDraftRef.current?.messageId) {
        setReplyTo(null);
      }
      if (currentAttachment && attachmentDraftRef.current === currentAttachment) {
        setAttachment(null);
        if (fileInput.current) fileInput.current.value = "";
      }
      if (!result.pending) pendingSendAttempts.current.delete(fingerprint);
    } catch (sendError) {
      if (sendError instanceof DOMException && sendError.name === "AbortError") {
        setError("Attachment upload cancelled.");
      } else {
        console.error("Message send failed:", sendError);
        const retryable =
          sendError instanceof Error &&
          "retryable" in sendError &&
          sendError.retryable === false
            ? false
            : true;
        if (!retryable) {
          setOptimisticMessages((current) =>
            current.map((item) => item.clientMessageId === clientMessageId
              ? { ...item, status: "failed" }
              : item)
          );
        }
        setError(retryable
          ? "Delivery is not confirmed. Retry this send to check its status safely."
          : sendError instanceof Error
            ? sendError.message
            : "Message could not be sent.");
      }
    } finally {
      setSending(false);
      setUploadProgress(0);
      uploadController.current = null;
    }
  }

  function chooseAttachment(file?: File) {
    if (!file) return;
    setError("");
    try {
      validateWhatsAppAttachment(file);
      setAttachment(file);
    } catch (validationError) {
      setAttachment(null);
      setError(validationError instanceof Error ? validationError.message : "Attachment is invalid.");
    }
  }

  function cancelUpload() {
    uploadController.current?.abort();
  }

  async function handleLogout() {
    try {
      await logout();
    } catch (logoutError) {
      console.error("Logout failed:", logoutError);
      setError("Sign out could not be completed. Please try again.");
    }
  }

  async function enableNotifications() {
    setNotificationsBusy(true);
    setNotificationError("");
    try {
      await enablePushNotifications();
      setNotificationsEnabled(true);
      localStorage.setItem("unlimited-sender-notifications", "enabled");
    } catch (notificationError) {
      console.error("Browser notification permission request failed:", notificationError);
      setNotificationError(
        notificationError instanceof Error
          ? notificationError.message
          : "Push notifications could not be enabled."
      );
    } finally {
      setNotificationsBusy(false);
    }
  }

  async function turnOffNotifications() {
    setNotificationsBusy(true);
    setNotificationError("");
    try {
      await disablePushNotifications();
      setNotificationsEnabled(false);
      localStorage.setItem("unlimited-sender-notifications", "disabled");
    } catch (notificationError) {
      console.error("Push notification removal failed:", notificationError);
      setNotificationError(
        notificationError instanceof Error
          ? notificationError.message
          : "Push notifications could not be disabled."
      );
    } finally {
      setNotificationsBusy(false);
    }
  }

  async function checkConnection() {
    setCheckingConnection(true);
    setConnectionError("");
    try {
      setConnectionStatus(await getWhatsAppConnectionStatus());
    } catch (statusError) {
      console.error("Connection check failed:", statusError);
      setConnectionError(statusError instanceof Error ? statusError.message : "Connection diagnostics failed.");
    } finally {
      setCheckingConnection(false);
    }
  }

  async function saveGreeting() {
    setGreetingSaving(true);
    setGreetingError("");
    setGreetingSaved(false);
    try {
      const settings = await saveGreetingSettings({
        enabled: greetingEnabled,
        text: greetingText,
      });
      setGreetingEnabled(settings.enabled);
      setGreetingText(settings.text);
      setGreetingSaved(true);
    } catch (saveError) {
      console.error("Greeting settings save failed:", saveError);
      setGreetingError(saveError instanceof Error ? saveError.message : "Greeting settings could not be saved.");
    } finally {
      setGreetingSaving(false);
    }
  }

  const navItems: { key: View; label: string; icon: typeof Inbox }[] = [
    { key: "chats", label: "Chats", icon: Inbox },
    { key: "contacts", label: "Contacts", icon: ContactRound },
    { key: "replies", label: "Quick replies", icon: MessageSquareText },
    { key: "archived", label: "Archived", icon: Archive },
    { key: "settings", label: "Settings", icon: Settings },
  ];

  const openConversation = view === "chats" && Boolean(selectedChat) && !mobileListOpen;

  return (
    <MotionConfig reducedMotion="user">
      <div className="app-shell">
        <aside className={`side-rail ${mobileListOpen ? "" : "mobile-hidden"}`} aria-label="Main navigation">
          <div className="rail-brand" aria-label="JOY INBOX">
            <MessageCircle size={23} strokeWidth={2.2} />
          </div>
          <nav className="rail-nav">
            {navItems.map(({ key, label, icon: Icon }) => (
              <button
                type="button"
                key={key}
                className={`rail-button ${view === key ? "active" : ""}`}
                disabled={deletingChats}
                onClick={() => {
                  setView(key);
                  setSearch("");
                  setSelectedChatIds(new Set());
                  setDeleteError("");
                  setMobileListOpen(true);
                  setError("");
                }}
                aria-label={label}
                aria-current={view === key ? "page" : undefined}
                title={label}
              >
                <Icon size={21} strokeWidth={1.8} />
                <span>{label}</span>
                {key === "chats" && chats.some((chat) => chat.unreadCount > 0) && (
                  <i className="rail-unread" aria-label="Unread chats" />
                )}
              </button>
            ))}
          </nav>
          <div className="rail-account">
            <button type="button" className="rail-button" onClick={handleLogout} aria-label="Sign out" title="Sign out">
              <LogOut size={20} />
              <span>Sign out</span>
            </button>
            <div className="account-avatar" title={user?.email || "Signed in"} aria-label={user?.email || "Signed in"}>
              {(user?.displayName || user?.email || "U").slice(0, 1).toUpperCase()}
            </div>
          </div>
        </aside>

        <section className={`list-panel ${openConversation ? "mobile-hidden" : ""}`}>
          <header className="list-header">
            <div>
              <p className="eyebrow">Made by Dhananjoy</p>
              <h1>
                {view === "chats" ? "Chats" : view === "contacts" ? "Contacts" : view === "archived" ? "Archived chats" : view === "replies" ? "Quick replies" : "Settings"}
              </h1>
            </div>
            <span className={`connection-indicator ${listError ? "offline" : ""}`} title="Conversation updates use a Firestore listener">
              <i /> {listError ? "Offline" : loadingChats ? "Connecting" : "Live updates"}
            </span>
          </header>

          {selectedChatIds.size > 0 && (
            <div className="chat-selection-toolbar" aria-live="polite">
              <span>{deletingChats ? `Deleting ${selectedChatIds.size}…` : `${selectedChatIds.size} selected`}</span>
              <div>
                <button
                  type="button"
                  className="delete-selected-button"
                  onClick={() => void deleteSelectedChats()}
                  disabled={deletingChats}
                >
                  {deletingChats ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
                  Delete
                </button>
                <button
                  type="button"
                  className="cancel-selection-button"
                  onClick={() => {
                    setSelectedChatIds(new Set());
                    setDeleteError("");
                  }}
                  disabled={deletingChats}
                >
                  Cancel
                </button>
              </div>
              {deleteError && <p role="alert">{deleteError}</p>}
            </div>
          )}

          {(view === "chats" || view === "contacts" || view === "archived") && (
            <>
              <label className="search-field">
                <Search size={17} aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={view === "contacts" ? "Search contacts" : "Search chats"}
                  aria-label={view === "contacts" ? "Search contacts by name or number" : "Search chats"}
                />
              </label>

              {view === "chats" && (
                <div className="filter-tabs" role="group" aria-label="Filter chats">
                  {(["all", "unread", "pinned"] as ChatFilter[]).map((item) => (
                    <button
                      type="button"
                      key={item}
                      className={filter === item ? "selected" : ""}
                      onClick={() => setFilter(item)}
                      aria-pressed={filter === item}
                    >
                      {item === "all" ? "All" : item === "unread" ? "Unread" : "Pinned"}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="conversation-list" aria-live="polite">
            {loadingChats ? (
              <div className="center-state"><Loader2 className="spin" size={22} />Loading conversations…</div>
            ) : listError ? (
              <div className="empty-state">
                <p>{listError}</p>
                <button type="button" className="text-button" onClick={() => window.location.reload()}>Reload inbox</button>
              </div>
            ) : view === "replies" ? (
              <div className="replies-page">
                <p>Save approved responses for quick insertion. Selecting a reply prepares a draft; it never sends automatically.</p>
                {user?.uid && (
                  <QuickReplies
                    userId={user.uid}
                    managementMode
                    onSelect={insertQuickReply}
                    slashQuery={null}
                    registerSlashKeyHandler={registerSlashKeyHandler}
                    onSlashActiveIndexChange={setSlashActiveIndex}
                  />
                )}
              </div>
            ) : view === "contacts" && user?.uid ? (
              <ContactsPanel
                userId={user.uid}
                search={search}
                chats={chats}
                onOpenChat={(chat) => void selectChat(chat)}
                contactRequest={contactRequest}
                onContactRequestHandled={() => setContactRequest(null)}
              />
            ) : view === "settings" ? (
              <div className="settings-list">
                <p className="settings-section-title">Appearance</p>
                <label className="setting-select">
                  <span><Sun size={17} /> Theme</span>
                  <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                    <option value="system">System default</option>
                  </select>
                </label>
                <p className="settings-section-title">Notifications</p>
                <div className="setting-row">
                  <span><Bell size={17} /> Push notifications</span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      if (notificationsEnabled) void turnOffNotifications();
                      else void enableNotifications();
                    }}
                    disabled={notificationsBusy}
                  >
                    {notificationsBusy
                      ? "Please wait…"
                      : notificationsEnabled
                        ? "Disable"
                        : "Enable"}
                  </button>
                </div>
                <p className="helper-text">Enable push notifications to receive new incoming WhatsApp text messages while Joy Inbox is in the background. Browser and Android notification settings control sound.</p>
                {notificationError && <p className="contacts-error" role="alert">{notificationError}</p>}
                <p className="settings-section-title">Connection</p>
                <button type="button" className="connection-check-button" onClick={checkConnection} disabled={checkingConnection}>
                  {checkingConnection ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
                  {checkingConnection ? "Checking…" : "Check connections"}
                </button>
                {connectionError && <p className="contacts-error" role="alert">{connectionError}</p>}
                {connectionStatus && (
                  <>
                    <div className="diagnostic-row">
                      <span className="diagnostic-title">{connectionStatus.whatsapp.connected ? <CircleCheck size={17} /> : <CircleX size={17} />} WhatsApp Cloud API</span>
                      <strong>{connectionStatus.whatsapp.connected ? "Connected" : "Unavailable"}</strong>
                      {connectionStatus.whatsapp.phoneNumber && <small>{connectionStatus.whatsapp.phoneNumber}{connectionStatus.whatsapp.verifiedName ? ` · ${connectionStatus.whatsapp.verifiedName}` : ""}</small>}
                      {connectionStatus.whatsapp.error && <small className="diagnostic-error">Error {connectionStatus.whatsapp.error.code}: {connectionStatus.whatsapp.error.message}</small>}
                    </div>
                    <div className="diagnostic-row">
                      <span className="diagnostic-title">{connectionStatus.firestore.connected ? <CircleCheck size={17} /> : <CircleX size={17} />} Firestore</span>
                      <strong>{connectionStatus.firestore.connected ? "Connected" : "Unavailable"}</strong>
                      {connectionStatus.firestore.error && <small className="diagnostic-error">{connectionStatus.firestore.error}</small>}
                    </div>
                    <div className="diagnostic-row">
                      <span className="diagnostic-title">{connectionStatus.mediaStorage.configured ? <CircleCheck size={17} /> : <CircleX size={17} />} Media storage</span>
                      <strong>{connectionStatus.mediaStorage.configured ? "Configured" : "Not configured"}</strong>
                    </div>
                    <p className="helper-text">Checked {new Date(connectionStatus.checkedAt).toLocaleString()}. These are live backend checks. Credentials stay on the server.</p>
                  </>
                )}
                {!connectionStatus && !connectionError && <p className="helper-text">Run a live backend check to view the WhatsApp API, Firestore, and media-storage configuration status.</p>}
                <p className="settings-section-title">Greeting message</p>
                {greetingLoading ? (
                  <div className="center-state"><Loader2 className="spin" size={18} />Loading greeting settings…</div>
                ) : (
                  <>
                    <label className="setting-row greeting-toggle">
                      <span>Send a greeting on first inbound message</span>
                      <input
                        type="checkbox"
                        checked={greetingEnabled}
                        onChange={(event) => {
                          setGreetingEnabled(event.target.checked);
                          setGreetingSaved(false);
                        }}
                        aria-label="Enable greeting message"
                      />
                    </label>
                    <textarea
                      className="greeting-editor"
                      value={greetingText}
                      onChange={(event) => {
                        setGreetingText(event.target.value);
                        setGreetingSaved(false);
                      }}
                      maxLength={1024}
                      rows={4}
                      placeholder="Write a short welcome message…"
                      aria-label="Greeting message text"
                    />
                    <p className="helper-text">Sent only once per conversation after an inbound message opens the 24-hour customer-service window. Approved templates are not used; no greeting is sent outside that window.</p>
                    <div className="greeting-preview">
                      <strong>Preview</strong>
                      <p>{greetingText.trim() || "Your greeting preview will appear here."}</p>
                    </div>
                    {greetingError && <p className="contacts-error" role="alert">{greetingError}</p>}
                    {greetingSaved && <p className="settings-saved" role="status">Greeting settings saved.</p>}
                    <button
                      type="button"
                      className="contact-save-button"
                      disabled={greetingSaving || greetingLoading || (greetingEnabled && !greetingText.trim())}
                      onClick={saveGreeting}
                    >
                      {greetingSaving ? <Loader2 className="spin" size={16} /> : null}
                      {greetingSaving ? "Saving…" : "Save greeting"}
                    </button>
                  </>
                )}
                <button type="button" className="signout-button" onClick={handleLogout}><LogOut size={17} /> Sign out</button>
              </div>
            ) : visibleChats.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">{view === "contacts" ? <UsersRound size={25} /> : <MessageCircle size={25} />}</div>
                <h2>{view === "contacts" ? "No contacts found" : view === "archived" ? "No archived chats" : "No conversations yet"}</h2>
                <p>{view === "contacts" ? "Contacts appear here when customers message your business." : view === "archived" ? "Archived conversations will appear here." : "New customer messages will appear here when delivered to your webhook."}</p>
              </div>
            ) : (
              <>
                {visibleChats.map((chat) => (
                  <button
                    type="button"
                    className={`chat-row ${selectedChat?.id === chat.id && view === "chats" ? "current" : ""} ${selectedChatIds.has(chat.id) ? "selected" : ""}`}
                    key={chat.id}
                    onPointerDown={(event) => startChatLongPress(chat.id, event)}
                    onPointerMove={moveChatLongPress}
                    onPointerUp={cancelChatLongPress}
                    onPointerCancel={cancelChatLongPress}
                    onPointerLeave={cancelChatLongPress}
                    onContextMenu={(event) => event.preventDefault()}
                    onClick={() => handleChatRowClick(chat)}
                    aria-pressed={selectedChatIds.has(chat.id)}
                  >
                    <span className={`avatar ${selectedChatIds.has(chat.id) ? "selected-avatar" : ""}`}>
                      {selectedChatIds.has(chat.id)
                        ? <Check size={20} aria-hidden="true" />
                        : initials(chat.customerName, chat.customerPhone)}
                    </span>
                    <span className="chat-row-copy">
                      <span className="chat-row-top">
                        <strong>{displayName(chat)}</strong>
                        <time>{formatTime(chat.lastMessageAt)}</time>
                      </span>
                      <span className="chat-row-bottom">
                        <span className="preview">{view === "contacts" ? chat.customerPhone : chat.lastMessage || chat.customerPhone}</span>
                        <span className="row-indicators">
                          {chat.pinned && <Pin size={13} aria-label="Pinned" />}
                          {chat.unreadCount > 0 && <span className="unread-badge">{chat.unreadCount}</span>}
                        </span>
                      </span>
                    </span>
                  </button>
                ))}
                {hasOlderChats && view !== "contacts" && (
                  <button type="button" className="load-older-button" onClick={loadEarlierChats} disabled={loadingOlderChats}>
                    {loadingOlderChats ? <Loader2 className="spin" size={15} /> : null}
                    {loadingOlderChats ? "Loading older conversations…" : "Load older conversations"}
                  </button>
                )}
              </>
            )}
          </div>
          <footer className="list-footer">
            <span className="account-avatar small">{(user?.displayName || user?.email || "U").slice(0, 1).toUpperCase()}</span>
            <span className="signed-in-copy">{user?.displayName || user?.email || "Signed in"}</span>
            <button type="button" className="icon-button footer-settings" onClick={() => setView("settings")} aria-label="Settings"><Settings size={18} /></button>
          </footer>
        </section>

        <main ref={conversationPanelRef} className={`conversation-panel ${mobileListOpen ? "mobile-hidden" : ""}`}>
          {view === "settings" ? (
            <section className="welcome-panel">
              <div className="welcome-card">
                <div className="welcome-icon"><Settings size={27} /></div>
                <h2>Settings</h2>
                <p>Choose your preferred appearance and push notification settings from the settings panel.</p>
              </div>
            </section>
          ) : view === "replies" ? (
            <section className="welcome-panel">
              <div className="welcome-card">
                <div className="welcome-icon"><MessageSquareText size={27} /></div>
                <h2>Quick replies</h2>
                <p>Create and organize saved text responses. Choose a conversation to prepare a reply draft.</p>
              </div>
            </section>
          ) : selectedChat && view === "chats" ? (
            <>
              {selectedMessageIds.size > 0 ? (
                <header className="conversation-header message-selection-toolbar" aria-live="polite">
                  <button
                    type="button"
                    className="icon-button selection-cancel"
                    onClick={cancelMessageSelection}
                    aria-label="Cancel message selection"
                    title="Cancel selection"
                  ><X size={20} /></button>
                  <strong>{selectedMessageIds.size} selected</strong>
                  <button
                    type="button"
                    className="selection-action"
                    onClick={() => void deleteMessagesFromInbox([...selectedMessageIds], true)}
                    disabled={deletingMessages || forwardingMessages}
                    aria-label="Delete selected messages"
                    title="Delete"
                  >{deletingMessages ? <Loader2 className="spin" size={20} /> : <Trash2 size={20} />}</button>
                  <button
                    type="button"
                    className="selection-action"
                    onClick={() => void copySelectedMessages()}
                    disabled={!selectedMessagesCanCopy}
                    aria-label="Copy selected message text"
                    title="Copy"
                  ><Copy size={20} /></button>
                  <button
                    type="button"
                    className="selection-action"
                    onClick={() => beginForward([...selectedMessageIds])}
                    disabled={!selectedMessagesCanForward || forwardingMessages || deletingMessages}
                    aria-label="Forward selected messages"
                    title="Forward"
                  ><Forward size={20} /></button>
                  <div className="selection-overflow" ref={selectionMenuRef}>
                    <button
                      type="button"
                      className="selection-action"
                      onClick={() => setMessageSelectionMenuOpen((current) => !current)}
                      aria-label="More message actions"
                      aria-haspopup="menu"
                      aria-expanded={messageSelectionMenuOpen}
                      title="More options"
                    ><MoreVertical size={21} /></button>
                    {messageSelectionMenuOpen && (
                      <div className="selection-overflow-menu" role="menu" aria-label="More message actions">
                        <button
                          type="button"
                          role="menuitem"
                          disabled
                          title="Message editing is not supported by the WhatsApp Cloud API."
                        ><Pencil size={17} />Edit message</button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={busyAction || selectedMessages.length !== selectedMessageIds.size}
                          onClick={() => void setSelectedMessagesPinned(selectedMessages)}
                        >
                          <Pin size={17} />
                          {selectedMessages.length === 1
                            ? selectedMessages[0].pinned ? "Unpin message" : "Pin message"
                            : selectedMessages.some((item) => !item.pinned) ? "Pin selected messages" : "Unpin selected messages"}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={forwardContactsLoading}
                          onClick={openContactRequest}
                        >
                          <ContactRound size={17} />
                          {forwardContactsLoading
                            ? "Loading contact…"
                            : forwardContactsByPhone.has(phoneDigits(selectedChat.customerPhone))
                              ? "Edit contact"
                              : "Add to contact"}
                        </button>
                        <p className="selection-menu-note">
                          Message editing is not supported by the WhatsApp Cloud API.
                        </p>
                      </div>
                    )}
                  </div>
                </header>
              ) : (
                <header className="conversation-header">
                <button type="button" className="icon-button back-button" onClick={() => setMobileListOpen(true)} aria-label="Back to conversations">
                  <ArrowLeft size={20} />
                </button>
                <span className="avatar">{initials(selectedChat.customerName, selectedChat.customerPhone)}</span>
                <div className="contact-heading">
                  <h2>{displayName(selectedChat)}</h2>
                  <a href={`tel:+${selectedChat.customerPhone}`} aria-label={`Call ${selectedChat.customerPhone}`}>{selectedChat.customerPhone}</a>
                </div>
                <div className="header-actions">
                  <label className="conversation-search">
                    <Search size={16} />
                    <input
                      type="search"
                      value={messageSearch}
                      onChange={(event) => setMessageSearch(event.target.value)}
                      placeholder="Search messages"
                      aria-label="Search messages in this conversation"
                    />
                  </label>
                  <button
                    type="button"
                    className={`pinned-filter-button ${showPinnedMessages ? "active" : ""}`}
                    onClick={() => {
                      setShowPinnedMessages((current) => !current);
                      setSelectedMessageIds(new Set());
                    }}
                    aria-pressed={showPinnedMessages}
                    title={showPinnedMessages ? "Show all messages" : "Show pinned messages"}
                  >
                    <Pin size={16} />
                    <span>{showPinnedMessages ? "All" : `Pinned${pinnedMessages.length ? ` (${pinnedMessages.length})` : ""}`}</span>
                  </button>
                  <button
                    type="button"
                    className={`icon-button ${selectedChat.pinned ? "action-active" : ""}`}
                    onClick={() => updateChat(selectedChat, { pinned: !selectedChat.pinned })}
                    disabled={busyAction}
                    aria-label={selectedChat.pinned ? "Unpin conversation" : "Pin conversation"}
                    title={selectedChat.pinned ? "Unpin conversation" : "Pin conversation"}
                  ><Pin size={18} /></button>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => updateChat(selectedChat, { archived: !selectedChat.archived })}
                    disabled={busyAction}
                    aria-label={selectedChat.archived ? "Restore conversation" : "Archive conversation"}
                    title={selectedChat.archived ? "Restore conversation" : "Archive conversation"}
                  >{selectedChat.archived ? <ArchiveRestore size={18} /> : <Archive size={18} />}</button>
                </div>
              </header>
              )}

              <section className="message-history" aria-label={`Messages with ${displayName(selectedChat)}`}>
                {(selectedChat.greetingStatus === "failed" || selectedChat.greetingStatus === "outside_service_window") && (
                  <p className="greeting-warning" role="status">
                    Greeting was not sent: {selectedChat.greetingLastError || "check the greeting settings and WhatsApp connection."}
                  </p>
                )}
                {hasOlderMessages && (
                  <button type="button" className="load-older-button" onClick={loadEarlierMessages} disabled={loadingOlderMessages}>
                    {loadingOlderMessages ? <Loader2 className="spin" size={15} /> : null}
                    {loadingOlderMessages ? "Loading earlier messages…" : "Load earlier messages"}
                  </button>
                )}
                {loadingMessages ? (
                  <div className="center-state"><Loader2 className="spin" size={22} />Loading messages…</div>
                ) : visibleMessages.length === 0 ? (
                  <div className="empty-state message-empty">
                    <div className="empty-icon"><MessageCircle size={25} /></div>
                    <h2>{messageSearch ? "No matching messages" : showPinnedMessages ? "No pinned messages" : "Start the conversation"}</h2>
                    <p>{messageSearch ? "Try another search phrase." : showPinnedMessages ? "Pin a message to keep it easy to find here." : "Messages from this customer will appear here."}</p>
                  </div>
                ) : (
                  visibleMessages.map((item) => {
                    const outgoing = item.direction === "outgoing";
                    const itemId = getMessageDocumentId(item);
                    const replyToMessageId = item.replyToMessageId;
                    const isSelected = selectedMessageIds.has(itemId);
                    const repliedMessage = replyToMessageId
                      ? messages.find((messageItem) => getMessageDocumentId(messageItem) === replyToMessageId)
                      : null;
                    const replyPreviewText =
                      item.replyToMessageText ||
                      repliedMessage?.text ||
                      "";
                    const replyPreviewType =
                      item.replyToMessageType || repliedMessage?.type || "unknown";
                    const replyPreviewSender =
                      repliedMessage?.direction === "outgoing"
                        ? "You"
                        : repliedMessage
                          ? displayName(selectedChat)
                          : item.replyToMessageSender === selectedChat.customerPhone
                            ? displayName(selectedChat)
                            : item.replyToMessageSender || displayName(selectedChat);
                    return (
                      <motion.div
                        key={itemId}
                        ref={(element) => {
                          if (element) messageElements.current.set(itemId, element);
                          else messageElements.current.delete(itemId);
                        }}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.16 }}
                        className={`message-line ${outgoing ? "outgoing" : "incoming"} ${isSelected ? "message-selected" : ""} ${messageSwipe?.messageId === itemId ? "message-swiping" : ""}`}
                        onPointerDown={(event) => {
                          startMessageLongPress(item, event);
                          startMessageSwipe(item, event);
                        }}
                        onPointerMove={(event) => {
                          moveMessageLongPress(event);
                          moveMessageSwipe(item, event);
                        }}
                        onPointerUp={(event) => finishMessageSwipe(item, event)}
                        onPointerCancel={cancelMessageSwipe}
                        onPointerLeave={cancelMessageLongPress}
                        onWheel={(event) => handleMessageWheel(item, event)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          selectMessage(item);
                        }}
                        onClick={(event) => {
                          if (event.target instanceof Element && event.target.closest("button, a, video, audio")) return;
                          handleMessageClick(item);
                        }}
                      >
                        <div className="message-swipe-content">
                          <span className={`message-swipe-reply ${messageSwipe?.messageId === itemId && messageSwipe.triggered ? "ready" : ""}`} aria-hidden="true">
                            <Reply size={18} />
                          </span>
                          <article
                            className={`message-bubble ${outgoing ? "sent" : "received"} ${isSelected ? "selected" : ""}`}
                            style={{
                              transform: `translateX(${messageSwipe?.messageId === itemId ? messageSwipe.offset : 0}px)`,
                              transition:
                                messageSwipe?.messageId === itemId && messageSwipe.active
                                  ? "none"
                                  : undefined,
                            }}
                            tabIndex={0}
                            role="group"
                            aria-label={`${outgoing ? "Sent" : "Received"} message${isSelected ? ", selected" : ""}`}
                            onKeyDown={(event) => {
                              if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                                event.preventDefault();
                                selectMessage(item);
                              }
                            }}
                          >
                            {replyToMessageId && (
                              <button
                                type="button"
                                className="message-quote"
                                aria-label={`Jump to message from ${replyPreviewSender}: ${replyPreviewText || `${replyPreviewType} message`}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void openQuotedMessage(replyToMessageId);
                                }}
                              >
                                <strong>{replyPreviewSender}</strong>
                                <span>{replyPreviewText || `${replyPreviewType} message`}</span>
                              </button>
                            )}
                            {item.pinned && <span className="message-pinned-indicator"><Pin size={12} />Pinned</span>}
                            {item.status === "sending" && item.type !== "text" ? (
                              <p className="media-unavailable">{item.mediaFilename || `${item.type} attachment`} · Sending</p>
                            ) : item.mediaStoragePath || item.mediaId ? (
                              <MessageMedia chatId={selectedChat.id} message={item} />
                            ) : item.type !== "text" ? (
                              <p className="media-unavailable">{item.mediaDownloadError || `${item.type} attachment is unavailable.`}</p>
                            ) : null}
                            <p>{item.text || "This message type is not available in this inbox yet."}</p>
                            <div className="message-meta">
                              <time>{formatTime(item.timestamp)}</time>
                              {outgoing && statusLabel(item.status) && (
                                <span className={item.status === "failed" ? "failed-status" : ""}>
                                  {item.status === "sending" ? <Loader2 className="spin" size={13} /> : null}
                                  {item.status === "read" || item.status === "delivered" ? <CheckCheck size={14} /> : null}
                                  {statusLabel(item.status)}
                                </span>
                              )}
                            </div>
                          </article>
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </section>

              {error && <div className="inline-error" role="alert">{error}</div>}
              <form className="composer" onSubmit={handleSend}>
                {replyTo && (
                  <div className="reply-composer-banner">
                    <Reply size={16} />
                    <span><strong>Replying to {replyTo.message.direction === "outgoing" ? "your message" : displayName(selectedChat)}</strong>{replyTo.message.text || `${replyTo.message.type} message`}</span>
                    <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><X size={17} /></button>
                  </div>
                )}
                {user?.uid && (
                  <QuickReplies
                    userId={user.uid}
                    draftMessage={message}
                    onSelect={insertQuickReply}
                    slashQuery={slashQuery}
                    onSlashClose={() => setSlashQuery(null)}
                    registerSlashKeyHandler={registerSlashKeyHandler}
                    onSlashActiveIndexChange={setSlashActiveIndex}
                  />
                )}
                <input
                  ref={fileInput}
                  className="visually-hidden"
                  type="file"
                  accept="image/jpeg,image/png,video/mp4,video/3gpp,audio/aac,audio/amr,audio/mpeg,audio/mp4,audio/ogg,application/pdf,text/plain,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                  aria-label="Choose image, video, audio, or document"
                  onChange={(event) => chooseAttachment(event.target.files?.[0])}
                />
                <textarea
                  ref={composerInputRef}
                  value={message}
                  onChange={(event) => handleComposerChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      slashQuery !== null &&
                      !event.shiftKey &&
                      slashKeyHandler.current?.(event.key)
                    ) {
                      event.preventDefault();
                      return;
                    }
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                    if (event.key === "Escape") setSlashQuery(null);
                  }}
                  placeholder="Message"
                  aria-label="Message"
                  aria-haspopup={slashQuery !== null ? "listbox" : undefined}
                  aria-controls={slashQuery !== null ? "quick-reply-listbox" : undefined}
                  aria-activedescendant={slashQuery !== null ? `quick-reply-option-${slashActiveIndex}` : undefined}
                  rows={1}
                  maxLength={4096}
                  disabled={sending && Boolean(attachment)}
                />
                <button
                  type="button"
                  className="attachment-button"
                  onClick={() => fileInput.current?.click()}
                  disabled={sending}
                  aria-label="Attach media or document"
                >
                  <Paperclip size={19} />
                </button>
                <motion.button
                  type="submit"
                  className="send-button"
                  disabled={sending || (!message.trim() && !attachment)}
                  aria-label="Send message"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.9 }}
                  transition={{ type: "spring", stiffness: 420, damping: 17 }}
                >
                  {sending ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
                </motion.button>
              </form>
              {(attachment || sending) && (
                <div className="attachment-status" aria-live="polite">
                  {attachment && <span>{attachment.name} · {(attachment.size / 1024 / 1024).toFixed(1)} MB</span>}
                  {sending && attachment && <span>Uploading {uploadProgress}%</span>}
                  {attachment && !sending && (
                    <button type="button" className="icon-button" onClick={() => setAttachment(null)} aria-label="Remove attachment"><Trash2 size={16} /></button>
                  )}
                  {sending && attachment && (
                    <button type="button" className="text-button" onClick={cancelUpload}>Cancel upload</button>
                  )}
                </div>
              )}
            </>
          ) : (
            <section className="welcome-panel">
              <div className="welcome-card">
                <div className="welcome-icon"><MessageCircle size={27} /></div>
                <h2>Welcome to JOY INBOX</h2>
                <p>Select a conversation to read customer messages and reply through your connected WhatsApp Business account.</p>
                {error && <p className="welcome-error" role="alert">{error}</p>}
                <div className="welcome-details">
                  <span><UsersRound size={16} /> {chats.filter((chat) => !chat.archived).length} conversations</span>
                  <span><Bell size={16} /> Incoming messages sync live</span>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
      {forwardMessageIds && (
        <div className="contact-modal-backdrop" onClick={() => !forwardingMessages && setForwardMessageIds(null)}>
          <section
            className="contact-modal message-forward-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="message-forward-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <h2 id="message-forward-title">Forward text messages</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Close forward dialog"
                disabled={forwardingMessages}
                onClick={() => setForwardMessageIds(null)}
              ><X size={18} /></button>
            </header>
            <p className="helper-text">
              Selected text will be sent as new messages. WhatsApp Cloud API does not forward media or mark these as forwarded.
            </p>
            <div className="message-forward-search">
              <Search size={18} aria-hidden="true" />
              <input
                type="text"
                value={forwardSearch}
                onChange={(event) => setForwardSearch(event.target.value)}
                placeholder="Search name or number"
                aria-label="Search recipients by name or number"
                autoComplete="off"
              />
              {forwardSearch && (
                <button
                  type="button"
                  className="message-forward-search-clear"
                  aria-label="Clear recipient search"
                  onClick={() => setForwardSearch("")}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <div className="message-forward-destinations">
              {forwardRecipients.map((chat) => {
                const savedContact = forwardContactsByPhone.get(phoneDigits(chat.customerPhone));
                const chatName = displayName(chat);
                const recipientName =
                  chatName === chat.customerPhone && savedContact?.name
                    ? savedContact.name
                    : chatName;
                return (
                  <button
                    type="button"
                    key={chat.id}
                    disabled={forwardingMessages}
                    onClick={() => void forwardMessagesToChat(chat)}
                  >
                    <span className="avatar">{initials(recipientName, chat.customerPhone)}</span>
                    <span>{recipientName}</span>
                    {forwardingMessages && <Loader2 className="spin" size={16} />}
                  </button>
                );
              })}
              {forwardRecipients.length === 0 && (
                <p>
                  {forwardContactsLoading
                    ? "Loading contacts…"
                    : forwardSearch.trim()
                      ? "No contacts found."
                      : chats.some((chat) => !chat.archived)
                        ? "No contacts found."
                        : "No active conversations are available."}
                </p>
              )}
            </div>
            {forwardContactsError && <p className="contacts-error" role="alert">{forwardContactsError}</p>}
            {error && <p className="contacts-error" role="alert">{error}</p>}
          </section>
        </div>
      )}
    </MotionConfig>
  );
}
