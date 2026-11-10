
import { auth } from "../firebase/config";
import type { ReplyContext } from "../types";

const API_URL = import.meta.env.VITE_API_BASE_URL;
const MAX_MEDIA_BYTES = 3 * 1024 * 1024;
const MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "video/mp4",
  "video/3gpp",
  "audio/aac",
  "audio/amr",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export async function sendWhatsAppMessage(
  to: string,
  text: string,
  chatId: string,
  source: "manual" | "quick_reply" = "manual",
  replyContext?: ReplyContext
) {
  if (!API_URL) {
    throw new Error("AWS API URL is not configured.");
  }

  const user = auth.currentUser;

  if (!user) {
    throw new Error("Please sign in again.");
  }

  const idToken = await user.getIdToken();

  const response = await fetch(
    `${API_URL.replace(/\/$/, "")}/send`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        to,
        text,
        chatId,
        source,
        ...(replyContext ? {
          ...replyContext,
          contextMessageId: replyContext.replyToMessageId,
        } : {}),
      }),
    }
  );

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error || "Message could not be sent.");
  }

    return result;
  }

  export async function updateWhatsAppMessageState(
    chatId: string,
    messageId: string,
    pinned: boolean
  ) {
    if (!API_URL) throw new Error("AWS API URL is not configured.");
    if (!/^\d{6,20}$/.test(chatId) || !/^[A-Za-z0-9._:-]{1,256}$/.test(messageId)) {
      throw new Error("Conversation or message ID is invalid.");
    }
    const idToken = await getIdToken();
    const response = await fetch(`${API_URL.replace(/\/$/, "")}/message-state`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ chatId, messageId, pinned }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || "Message could not be updated.");
    }
    return result;
  }

  export async function deleteWhatsAppMessages(chatId: string, messageIds: string[]) {
    if (!API_URL) throw new Error("AWS API URL is not configured.");
    if (
      !/^\d{6,20}$/.test(chatId) ||
      messageIds.length < 1 ||
      messageIds.length > 50 ||
      messageIds.some((messageId) => !/^[A-Za-z0-9._:-]{1,256}$/.test(messageId)) ||
      new Set(messageIds).size !== messageIds.length
    ) {
      throw new Error("Select between 1 and 50 valid messages.");
    }
    const idToken = await getIdToken();
    const response = await fetch(`${API_URL.replace(/\/$/, "")}/delete-messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ chatId, messageIds }),
    });
    const result: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = result && typeof result === "object" && "error" in result
        ? String(result.error)
        : "Messages could not be deleted.";
      throw new Error(message);
    }
    if (
      !result ||
      typeof result !== "object" ||
      !("deletedMessageIds" in result) ||
      !Array.isArray(result.deletedMessageIds) ||
      !result.deletedMessageIds.every((messageId: unknown) => typeof messageId === "string")
    ) {
      throw new Error("The server returned an invalid message deletion response.");
    }
    return { deletedMessageIds: result.deletedMessageIds };
  }

export async function updateWhatsAppChatState(
  chatId: string,
  state: {
    pinned?: boolean;
    archived?: boolean;
    markRead?: boolean;
  }
) {
  if (!API_URL) {
    throw new Error("AWS API URL is not configured.");
  }

  const user = auth.currentUser;

  if (!user) {
    throw new Error("Please sign in again.");
  }

  if (!/^\+?\d{6,20}$/.test(chatId)) {
    throw new Error("Conversation phone number is invalid.");
  }

  const idToken = await user.getIdToken();
  const response = await fetch(
    `${API_URL.replace(/\/$/, "")}/chat-state`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ chatId, ...state }),
    }
  );

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error || "Conversation could not be updated.");
  }

  return result;
}

export async function deleteWhatsAppChats(chatIds: string[]) {
  if (!API_URL) {
    throw new Error("AWS API URL is not configured.");
  }
  if (
    chatIds.length < 1 ||
    chatIds.length > 50 ||
    chatIds.some((chatId) => !/^\d{6,20}$/.test(chatId)) ||
    new Set(chatIds).size !== chatIds.length
  ) {
    throw new Error("Select between 1 and 50 valid conversations.");
  }

  const idToken = await getIdToken();
  const response = await fetch(`${API_URL.replace(/\/$/, "")}/delete-chats`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ chatIds }),
  });
  const result: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = result && typeof result === "object" && "error" in result
      ? String(result.error)
      : "Selected conversations could not be deleted.";
    throw new Error(message);
  }

  const isFailure = (
    value: unknown
  ): value is { chatId: string; error: string } =>
    Boolean(
      value &&
      typeof value === "object" &&
      "chatId" in value &&
      typeof value.chatId === "string" &&
      "error" in value &&
      typeof value.error === "string"
    );
  if (
    !result ||
    typeof result !== "object" ||
    !("deletedChatIds" in result) ||
    !Array.isArray(result.deletedChatIds) ||
    !result.deletedChatIds.every((chatId: unknown) => typeof chatId === "string") ||
    !("errors" in result) ||
    !Array.isArray(result.errors) ||
    !result.errors.every(isFailure)
  ) {
    throw new Error("The server returned an invalid chat deletion response.");
  }

  return {
    deletedChatIds: result.deletedChatIds,
    errors: result.errors,
  };
}

export function validateWhatsAppAttachment(file: File): "image" | "video" | "audio" | "document" {
  const mimeType = file.type.split(";")[0].trim().toLowerCase();
  if (!MEDIA_TYPES.has(mimeType)) {
    throw new Error("Unsupported file type. Choose JPEG, PNG, MP4, audio, PDF, text, or Office media.");
  }
  if (!file.size || file.size > MAX_MEDIA_BYTES) {
    throw new Error("Attachments must be smaller than 3 MB.");
  }
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}

function getIdToken() {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in again.");
  return user.getIdToken();
}

export async function sendWhatsAppAttachment(
  to: string,
  chatId: string,
  file: File,
  caption: string,
  source: "manual" | "quick_reply",
  signal: AbortSignal,
  onProgress: (progress: number) => void,
  replyContext?: ReplyContext
) {
  if (!API_URL) throw new Error("AWS API URL is not configured.");
  const type = validateWhatsAppAttachment(file);
  if (type === "audio" && caption.trim()) {
    throw new Error("WhatsApp audio attachments cannot have a caption.");
  }
  if (caption.trim().length > 1024) {
    throw new Error("Caption is too long (maximum 1024 characters).");
  }

  const [idToken, dataUrl] = await Promise.all([
    getIdToken(),
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Attachment could not be read."));
      reader.onabort = () => reject(new DOMException("Attachment read cancelled.", "AbortError"));
      signal.addEventListener("abort", () => reader.abort(), { once: true });
      reader.onload = () => {
        if (typeof reader.result !== "string") {
          reject(new Error("Attachment could not be encoded."));
        } else {
          resolve(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }),
  ]);
  if (signal.aborted) throw new DOMException("Upload cancelled.", "AbortError");
  const fileBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const body = JSON.stringify({
    to,
    chatId,
    type,
    mimeType: file.type,
    filename: file.name,
    caption: caption.trim(),
    source,
    ...(replyContext ? {
      ...replyContext,
      contextMessageId: replyContext.replyToMessageId,
    } : {}),
    fileBase64,
  });

  return new Promise<{ success: boolean; messageId: string }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const endpoint = `${API_URL.replace(/\/$/, "")}/send-media`;
    request.open("POST", endpoint);
    request.setRequestHeader("Content-Type", "application/json");
    request.setRequestHeader("Authorization", `Bearer ${idToken}`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error("Network error while uploading attachment."));
    request.onabort = () => reject(new DOMException("Upload cancelled.", "AbortError"));
    request.onload = () => {
      let result: { success?: boolean; messageId?: string; error?: string } = {};
      try {
        result = JSON.parse(request.responseText);
      } catch {
        reject(new Error("The server returned an invalid attachment response."));
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(result.error || "Attachment could not be sent."));
        return;
      }
      if (!result.success || !result.messageId) {
        reject(new Error("The server did not confirm the attachment send."));
        return;
      }
      resolve({ success: true, messageId: result.messageId });
    };
    signal.addEventListener("abort", () => request.abort(), { once: true });
    request.send(body);
  });
}

export async function getWhatsAppMediaUrl(chatId: string, messageId: string) {
  if (!API_URL) throw new Error("AWS API URL is not configured.");
  const idToken = await getIdToken();
  const query = new URLSearchParams({ chatId, messageId });
  const response = await fetch(
    `${API_URL.replace(/\/$/, "")}/media?${query}`,
    { headers: { Authorization: `Bearer ${idToken}` } }
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.url) {
    throw new Error(result.error || "Media is not currently available.");
  }
  return { url: String(result.url), expiresAt: Number(result.expiresAt) };
}

export async function getWhatsAppConnectionStatus() {
  if (!API_URL) throw new Error("AWS API URL is not configured.");
  const idToken = await getIdToken();
  const response = await fetch(`${API_URL.replace(/\/$/, "")}/status`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || "Connection diagnostics could not be completed.");
  }
  return result as {
    whatsapp: {
      connected: boolean;
      phoneNumber?: string;
      verifiedName?: string;
      error?: { code: string | number; subcode?: string | number | null; message: string };
    };
    firestore: { connected: boolean; error?: string };
    mediaStorage: { configured: boolean };
    checkedAt: string;
  };
}

export async function getGreetingSettings() {
  if (!API_URL) throw new Error("AWS API URL is not configured.");
  const idToken = await getIdToken();
  const response = await fetch(`${API_URL.replace(/\/$/, "")}/greeting-settings`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Greeting settings could not be loaded.");
  return {
    enabled: Boolean(result.enabled),
    text: String(result.text || ""),
    trigger: "first_inbound" as const,
  };
}

export async function saveGreetingSettings(settings: { enabled: boolean; text: string }) {
  if (!API_URL) throw new Error("AWS API URL is not configured.");
  const idToken = await getIdToken();
  const response = await fetch(`${API_URL.replace(/\/$/, "")}/greeting-settings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(settings),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Greeting settings could not be saved.");
  return {
    enabled: Boolean(result.enabled),
    text: String(result.text || ""),
    trigger: "first_inbound" as const,
  };
}
