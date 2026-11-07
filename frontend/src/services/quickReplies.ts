
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  type Unsubscribe,
} from "firebase/firestore";

import { auth, db } from "../firebase/config";
import type { QuickReply } from "../types";

function getQuickReplyCollection(userId: string) {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error("Please sign in first.");
  }

  if (currentUser.uid !== userId) {
    throw new Error("You are not authorized to access these replies.");
  }

  return collection(db, "users", userId, "quickReplies");
}

function getQuickReplyDocument(userId: string, replyId: string) {
  if (!replyId.trim()) {
    throw new Error("Quick Reply ID is required.");
  }

  return doc(getQuickReplyCollection(userId), replyId);
}

function validateQuickReply(data: {
  title: string;
  shortcut: string;
  message: string;
}) {
  const title = data.title.trim();
  const shortcut = data.shortcut.trim().replace(/^\/+/, "").toLowerCase();
  const message = data.message.trim();

  if (!title || !message) {
    throw new Error("Title and message are required.");
  }

  if (title.length > 60 || shortcut.length > 30 || message.length > 4096) {
    throw new Error("Quick Reply is longer than the allowed limit.");
  }

  return { title, shortcut, message };
}

export function listenToQuickReplies(
  userId: string,
  callback: (replies: QuickReply[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const repliesQuery = query(
    getQuickReplyCollection(userId),
    orderBy("createdAt", "desc")
  );

  return onSnapshot(
    repliesQuery,
    (snapshot) => {
      const replies = snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      })) as QuickReply[];

      callback(replies);
    },
    (error) => onError?.(error)
  );
}

export async function addQuickReply(
  userId: string,
  data: {
    title: string;
    shortcut: string;
    message: string;
  }
) {
  const validData = validateQuickReply(data);

  return addDoc(getQuickReplyCollection(userId), {
    ...validData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateQuickReply(
  userId: string,
  replyId: string,
  data: {
    title: string;
    shortcut: string;
    message: string;
  }
) {
  const validData = validateQuickReply(data);

  return updateDoc(
    getQuickReplyDocument(userId, replyId),
    {
      ...validData,
      updatedAt: serverTimestamp(),
    }
  );
}

export async function deleteQuickReply(
  userId: string,
  replyId: string
) {
  return deleteDoc(getQuickReplyDocument(userId, replyId));
}
