const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || "v26.0";

function normalizePhoneNumber(value) {
  return String(value || "").replace(/\D/g, "");
}

function logWhatsAppLatency(startedAt, type, outcome) {
  console.info(JSON.stringify({
    metric: "whatsapp_api_ms",
    durationMs: Math.max(0, Date.now() - startedAt),
    type,
    outcome
  }));
}

function definitiveError(message) {
  const error = new Error(message);
  error.definitive = true;
  error.retryable = false;
  return error;
}

async function readSendResponse(response, startedAt, type, fallbackMessage) {
  let result;
  try {
    result = await response.json();
  } catch (error) {
    logWhatsAppLatency(startedAt, type, "invalid_response");
    throw error;
  }
  logWhatsAppLatency(startedAt, type, response.ok ? "accepted" : "rejected");
  if (!response.ok) {
    const error = new Error(
      result?.error?.message || fallbackMessage
    );
    error.statusCode = 502;
    error.definitive = true;
    error.retryable = false;
    throw error;
  }
  return result;
}

async function sendWhatsAppText(to, text, contextMessageId) {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.PHONE_NUMBER_ID;

  if (!accessToken || !phoneNumberId) {
    throw definitiveError("WhatsApp API credentials are missing.");
  }

  const recipient = normalizePhoneNumber(to);

  if (!recipient) {
    throw definitiveError("A valid recipient phone number is required.");
  }

  if (!text || !String(text).trim()) {
    throw definitiveError("Message text cannot be empty.");
  }

  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(
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
  } catch (error) {
    logWhatsAppLatency(startedAt, "text", "network_error");
    throw error;
  }
  const result = await readSendResponse(
    response,
    startedAt,
    "text",
    "WhatsApp message could not be sent."
  );

  const messageId = result?.messages?.[0]?.id;

  if (!messageId) {
    const error = new Error("WhatsApp did not return a message ID.");
    error.retryable = true;
    throw error;
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
    throw definitiveError("WhatsApp API credentials are missing.");
  }
  if (!recipient || !mediaId) {
    throw definitiveError("A valid recipient and uploaded media ID are required.");
  }
  if (!["image", "video", "audio", "document"].includes(type)) {
    throw definitiveError("Unsupported WhatsApp media message type.");
  }

  const attachment = { id: mediaId };
  if (type !== "audio" && caption) attachment.caption = String(caption).slice(0, 1024);
  if (type === "document" && filename) {
    attachment.filename = String(filename).replace(/[\\/\r\n]/g, "_").slice(0, 180);
  }

  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(
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
  } catch (error) {
    logWhatsAppLatency(startedAt, type, "network_error");
    throw error;
  }
  const result = await readSendResponse(
    response,
    startedAt,
    type,
    "WhatsApp media message could not be sent."
  );

  const messageId = result?.messages?.[0]?.id;
  if (!messageId) {
    const error = new Error("WhatsApp did not return a message ID.");
    error.retryable = true;
    throw error;
  }
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
