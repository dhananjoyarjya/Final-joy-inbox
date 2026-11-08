import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { auth, db } from "../firebase/config";
import type { Contact } from "../types";

function getContactsCollection(userId: string) {
  if (!auth.currentUser || auth.currentUser.uid !== userId) {
    throw new Error("You are not authorized to manage these contacts.");
  }
  return collection(db, "users", userId, "contacts");
}

export function normalizeContactPhone(value: string) {
  const clean = value.trim().replace(/[\s().-]/g, "");
  const international = clean.startsWith("00") ? `+${clean.slice(2)}` : clean;
  const normalized = international.startsWith("+") ? international : `+${international}`;

  if (!/^\+[1-9]\d{6,14}$/.test(normalized)) {
    throw new Error("Enter a valid international phone number including its country code.");
  }
  return normalized;
}

export function listenToContacts(
  userId: string,
  callback: (contacts: Contact[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const contactsQuery = query(
    getContactsCollection(userId),
    orderBy("name", "asc")
  );
  return onSnapshot(
    contactsQuery,
    (snapshot) => {
      callback(snapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      })) as Contact[]);
    },
    (error) => onError?.(error)
  );
}

export async function saveContact(
  userId: string,
  existingId: string | null,
  input: {
    name: string;
    phone: string;
    email: string;
    notes: string;
    source?: "local" | "whatsapp";
  }
) {
  const phone = normalizeContactPhone(input.phone);
  const name = input.name.trim();
  const email = input.email.trim();
  const notes = input.notes.trim();
  if (!name || name.length > 100) throw new Error("Name is required and must be 100 characters or fewer.");
  if (email.length > 254 || notes.length > 1000) throw new Error("Email or notes exceed the allowed length.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }

  const contacts = getContactsCollection(userId);
  const phoneId = phone.slice(1);
  const newRef = doc(contacts, phoneId);
  const data = {
    name,
    phone,
    email,
    notes,
    source: existingId === phoneId ? input.source || "local" : "local",
    updatedAt: serverTimestamp(),
  };
  if (existingId && existingId !== phoneId) {
    const batch = writeBatch(db);
    batch.set(newRef, { ...data, createdAt: serverTimestamp() });
    batch.delete(doc(contacts, existingId));
    await batch.commit();
  } else {
    await setDoc(newRef, {
      ...data,
      ...(existingId ? {} : { createdAt: serverTimestamp() }),
    }, { merge: true });
  }
}

export async function deleteContact(userId: string, contactId: string) {
  await deleteDoc(doc(getContactsCollection(userId), contactId));
}
