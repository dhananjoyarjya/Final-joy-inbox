import { auth } from "../firebase/config";

const API_URL = import.meta.env.VITE_API_BASE_URL;

export async function sendWhatsAppMessage(
  to: string,
  text: string,
  chatId: string
) {
  if (!API_URL) {
    throw new Error("AWS API URL is not configured.");
  }

  const user = auth.currentUser;

  if (!user) {
    throw new Error("Please sign in again.");
  }

  const idToken = await user.getIdToken();

  const response = await fetch(`${API_URL.replace(/\/$/, "")}/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      to,
      text,
      chatId,
    }),
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error || "Message could not be sent.");
  }

  return result;
}
