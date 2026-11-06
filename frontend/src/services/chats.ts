import {
  collection,
  onSnapshot,
  orderBy,
  query,
  limit,
  type Unsubscribe,
} from "firebase/firestore";

import { db } from "../firebase/config";
import type { Chat, ChatMessage } from "../types";

export function listenToChats(
  callback: (chats: Chat[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const chatsQuery = query(
    collection(db, "chats"),
    orderBy("lastMessageAt", "desc"),
    limit(100)
  );

  return onSnapshot(
    chatsQuery,
    (snapshot) => {
      const chats = snapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      })) as Chat[];

      callback(chats);
    },
    (error) => onError?.(error)
  );
}

export function listenToMessages(
  chatId: string,
  callback: (messages: ChatMessage[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const messagesQuery = query(
    collection(db, "chats", chatId, "messages"),
    orderBy("timestamp", "asc"),
    limit(200)
  );

  return onSnapshot(
    messagesQuery,
    (snapshot) => {
      const messages = snapshot.docs.map((document) => ({
        id: document.id,
        ...document.data(),
      })) as ChatMessage[];

      callback(messages);
    },
    (error) => onError?.(error)
  );
}
