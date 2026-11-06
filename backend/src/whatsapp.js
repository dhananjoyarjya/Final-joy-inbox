const GRAPH_API_VERSION = "v26.0";

function normalizePhoneNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

async function sendWhatsAppText(to, text) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    throw new Error("WhatsApp API credentials are missing.");
  }

  const recipient = normalizePhoneNumber(to);

  if (!recipient) {
    throw new Error("A valid recipient phone number is required.");
  }

  if (!text || !String(text).trim()) {
    throw new Error("Message text cannot be empty.");
  }

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "text",
        text: {
          preview_url: false,
          body: String(text).trim()
        }
      })
    }
  );

  const result = await response.json();

  if (!response.ok) {
    const message =
      result?.error?.message ||
      "WhatsApp message could not be sent.";

    throw new Error(message);
  }

  const messageId = result?.messages?.[0]?.id;

  if (!messageId) {
    throw new Error(
      "WhatsApp did not return a message ID."
    );
  }

  return {
    messageId,
    response: result
  };
}

module.exports = {
  normalizePhoneNumber,
  sendWhatsAppText
};
