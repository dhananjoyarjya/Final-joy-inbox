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
}

export interface ChatMessage {
  id: string;
  chatId: string;
  messageId: string;
  direction: "incoming" | "outgoing";
  type: "text";
  text: string;
  timestamp: Timestamp | null;
  status?: "sent" | "delivered" | "read" | "failed";
  source?: "manual" | "quick_reply" | "webhook";
}

export interface QuickReply {
  id: string;
  title: string;
  shortcut: string;
  message: string;
  createdAt: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}
