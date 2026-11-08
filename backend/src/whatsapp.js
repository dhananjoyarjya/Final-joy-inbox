const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || "v26.0";

function normalizePhoneNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

async function sendWhatsAppText(to, text, contextMessageId) {
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
        ...(contextMessageId ? { context: { message_id: contextMessageId } } : {}),
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

async function sendWhatsAppMedia(to, type, mediaId, caption, filename, contextMessageId) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.PHONE_NUMBER_ID;
  const recipient = normalizePhoneNumber(to);

  if (!accessToken || !phoneNumberId) {
    throw new Error("WhatsApp API credentials are missing.");
  }
  if (!recipient || !mediaId) {
    throw new Error("A valid recipient and uploaded media ID are required.");
  }
  if (!["image", "video", "audio", "document"].includes(type)) {
    throw new Error("Unsupported WhatsApp media message type.");
  }

  const attachment = { id: mediaId };
  if (type !== "audio" && caption) attachment.caption = String(caption).slice(0, 1024);
  if (type === "document" && filename) {
    attachment.filename = String(filename).replace(/[\\/\r\n]/g, "_").slice(0, 180);
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
        type,
        ...(contextMessageId ? { context: { message_id: contextMessageId } } : {}),
        [type]: attachment
      })
    }
  );
  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      result?.error?.message || "WhatsApp media message could not be sent."
    );
  }

  const messageId = result?.messages?.[0]?.id;
  if (!messageId) throw new Error("WhatsApp did not return a message ID.");
  return { messageId, response: result };
}

async function checkWhatsAppConnection() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.PHONE_NUMBER_ID;
  if (!accessToken || !phoneNumberId) {
    return {
      connected: false,
      error: { code: "MISSING_CONFIGURATION", message: "WhatsApp Cloud API credentials are not configured." }
    };
  }

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const result = await response.json();
  if (!response.ok) {
    return {
      connected: false,
      error: {
        code: result?.error?.code || response.status,
        subcode: result?.error?.error_subcode || null,
        message: String(result?.error?.message || "WhatsApp Cloud API check failed.").slice(0, 300)
      }
    };
  }

  return {
    connected: true,
    phoneNumber: String(result.display_phone_number || ""),
    verifiedName: String(result.verified_name || "")
  };
}

module.exports = {
  normalizePhoneNumber,
  sendWhatsAppText,
  sendWhatsAppMedia,
  checkWhatsAppConnection
};
