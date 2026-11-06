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

function getQuickReplyCollection() {
  const uid = auth.currentUser?.uid;

  if (!uid) {
    throw new Error("Please sign in first.");
  }

  return collection(db, "users", uid, "quickReplies");
}

export function listenToQuickReplies(
  callback: (replies: QuickReply[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const repliesQuery = query(
    getQuickReplyCollection(),
    orderBy("createdAt", "desc")
  );

  return onSnapshot(
    repliesQuery,
    (snapshot) => {
      callback(
        snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        })) as QuickReply[]
      );
    },
    (error) => onError?.(error)
  );
}

export async function addQuickReply(
  title: string,
  shortcut: string,
  message: string
) {
  if (!title.trim() || !message.trim()) {
    throw new Error("Title and message are required.");
  }

  return addDoc(getQuickReplyCollection(), {
    title: title.trim(),
    shortcut: shortcut.trim().replace(/^\/+/, "").toLowerCase(),
    message: message.trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function editQuickReply(
  id: string,
  title: string,
  shortcut: string,
  message: string
) {
  if (!title.trim() || !message.trim()) {
    throw new Error("Title and message are required.");
  }

  const uid = auth.currentUser?.uid;

  if (!uid) throw new Error("Please sign in first.");

  return updateDoc(doc(db, "users", uid, "quickReplies", id), {
    title: title.trim(),
    shortcut: shortcut.trim().replace(/^\/+/, "").toLowerCase(),
    message: message.trim(),
    updatedAt: serverTimestamp(),
  });
}

export async function removeQuickReply(id: string) {
  const uid = auth.currentUser?.uid;

  if (!uid) throw new Error("Please sign in first.");

  return deleteDoc(doc(db, "users", uid, "quickReplies", id));
}
