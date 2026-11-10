import {
  collection,
  onSnapshot,
  orderBy,
  query,
  limit,
  startAfter,
  getDocs,
  doc,
  getDoc,
  where,
  type Unsubscribe,
  type QueryDocumentSnapshot,
  type DocumentData,
} from "firebase/firestore";

import { db } from "../firebase/config";
import type { Chat, ChatMessage } from "../types";

const MESSAGE_PAGE_SIZE = 50;
const CHAT_PAGE_SIZE = 50;

export async function getChatById(chatId: string): Promise<Chat | null> {
  if (!/^\d{6,20}$/.test(chatId)) return null;
  const snapshot = await getDoc(doc(db, "chats", chatId));
  if (!snapshot.exists()) return null;
  return {
    id: snapshot.id,
    ...snapshot.data(),
  } as Chat;
}

export async function getWhatsAppMessage(
  chatId: string,
  messageId: string
): Promise<ChatMessage | null> {
  if (!/^\d{6,20}$/.test(chatId) || !/^[A-Za-z0-9._:-]{1,256}$/.test(messageId)) {
    return null;
  }
  const snapshot = await getDoc(doc(db, "chats", chatId, "messages", messageId));
  if (!snapshot.exists()) return null;
  return {
    id: snapshot.id,
    ...snapshot.data(),
  } as ChatMessage;
}

export function listenToChats(
  callback: (
    chats: Chat[],
    oldestDocument: QueryDocumentSnapshot<DocumentData> | null,
    hasOlder: boolean
  ) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const chatsQuery = query(
    collection(db, "chats"),
    orderBy("lastMessageAt", "desc"),
    limit(CHAT_PAGE_SIZE)
  );

  return onSnapshot(
    chatsQuery,
    (snapshot) => {
      const chats = snapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      })) as Chat[];

      callback(chats, snapshot.docs.at(-1) || null, snapshot.size === CHAT_PAGE_SIZE);
    },
    (error) => onError?.(error)
  );
}

export async function loadOlderChats(cursor: QueryDocumentSnapshot<DocumentData>) {
  const olderQuery = query(
    collection(db, "chats"),
    orderBy("lastMessageAt", "desc"),
    startAfter(cursor),
    limit(CHAT_PAGE_SIZE)
  );
  const snapshot = await getDocs(olderQuery);
  const chats = snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  })) as Chat[];
  return {
    chats,
    cursor: snapshot.docs.at(-1) || cursor,
    hasOlder: snapshot.size === CHAT_PAGE_SIZE,
  };
}

export function listenToMessages(
  chatId: string,
  callback: (
    messages: ChatMessage[],
    oldestDocument: QueryDocumentSnapshot<DocumentData> | null,
    hasOlder: boolean
  ) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const messagesQuery = query(
    collection(db, "chats", chatId, "messages"),
    orderBy("timestamp", "desc"),
    limit(MESSAGE_PAGE_SIZE)
  );

  return onSnapshot(
    messagesQuery,
    (snapshot) => {
      const messages = snapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      })) as ChatMessage[];

      callback(messages.reverse(), snapshot.docs.at(-1) || null, snapshot.size === MESSAGE_PAGE_SIZE);
    },
    (error) => onError?.(error)
  );
}

export function listenToPinnedMessages(
  chatId: string,
  callback: (messages: ChatMessage[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const pinnedMessagesQuery = query(
    collection(db, "chats", chatId, "messages"),
    where("pinned", "==", true)
  );

  return onSnapshot(
    pinnedMessagesQuery,
    (snapshot) => {
      const messages = snapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      })) as ChatMessage[];
      callback(messages.sort((a, b) => {
        const aTime = a.timestamp instanceof Date
          ? a.timestamp.getTime()
          : a.timestamp?.toDate().getTime() || 0;
        const bTime = b.timestamp instanceof Date
          ? b.timestamp.getTime()
          : b.timestamp?.toDate().getTime() || 0;
        return aTime - bTime || a.id.localeCompare(b.id);
      }));
    },
    (error) => onError?.(error)
  );
}

export async function loadOlderMessages(
  chatId: string,
  cursor: QueryDocumentSnapshot<DocumentData>
) {
  const olderQuery = query(
    collection(db, "chats", chatId, "messages"),
    orderBy("timestamp", "desc"),
    startAfter(cursor),
    limit(MESSAGE_PAGE_SIZE)
  );
  const snapshot = await getDocs(olderQuery);
  const messages = snapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  })) as ChatMessage[];
  return {
    messages: messages.reverse(),
    cursor: snapshot.docs.at(-1) || cursor,
    hasOlder: snapshot.size === MESSAGE_PAGE_SIZE,
  };
}
