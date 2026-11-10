import type { Timestamp } from "firebase/firestore";

export interface Chat {
  id: string;
  customerPhone: string;
  customerName: string;
  lastMessage: string;
  lastMessageAt: Timestamp | null;
  unreadCount: number;
  pinned: boolean;
  archived: boolean;
  lastMessageDirection?: "incoming" | "outgoing";
  greetingStatus?: "sending" | "sent" | "failed" | "outside_service_window";
  greetingLastError?: string | null;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  messageId: string;
  direction: "incoming" | "outgoing";
  type: string;
  text: string;
  timestamp: Timestamp | Date | null;
  mediaId?: string | null;
  mediaStoragePath?: string | null;
  mediaMimeType?: string | null;
  mediaSize?: number | null;
  mediaFilename?: string | null;
  mediaDownloadError?: string | null;
  status?: "received" | "sending" | "sent" | "delivered" | "read" | "failed" | "unknown";
  clientMessageId?: string;
  source?: "manual" | "quick_reply" | "whatsapp" | "webhook";
  sender?: string;
  pinned?: boolean;
  replyToMessageId?: string;
  replyToMessageText?: string;
  replyToMessageSender?: string;
  replyToMessageType?: string;
}

export interface ReplyContext {
  replyToMessageId: string;
  replyToMessageText: string;
  replyToMessageSender: string;
  replyToMessageType: string;
}

export interface QuickReply {
  id: string;
  title: string;
  shortcut: string;
  message: string;
  createdAt: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  notes?: string;
  source: "local" | "whatsapp";
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}
