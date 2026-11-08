import { useEffect, useState } from "react";
import { Download, Loader2, RotateCw } from "lucide-react";
import { getWhatsAppMediaUrl } from "../services/whatsapp";
import type { ChatMessage } from "../types";

type Props = {
  chatId: string;
  message: ChatMessage;
};

export default function MessageMedia({ chatId, message }: Props) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    if (!message.mediaStoragePath) {
      setUrl("");
      setError(message.mediaDownloadError || "Media is not available in storage.");
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setError("");
    getWhatsAppMediaUrl(chatId, message.id || message.messageId)
      .then(({ url: mediaUrl }) => {
        if (active) setUrl(mediaUrl);
      })
      .catch((mediaError: unknown) => {
        if (!active) return;
        console.error("Media URL request failed:", mediaError);
        setError(mediaError instanceof Error ? mediaError.message : "Media could not be opened.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    attempt,
    chatId,
    message.id,
    message.mediaDownloadError,
    message.mediaStoragePath,
    message.messageId,
  ]);

  if (loading) {
    return <span className="media-state"><Loader2 className="spin" size={16} /> Loading attachment…</span>;
  }
  if (error) {
    return (
      <span className="media-state media-error">
        <span>{error}</span>
        {message.mediaStoragePath && (
          <button type="button" className="media-retry" onClick={() => setAttempt((value) => value + 1)}>
            <RotateCw size={14} /> Retry
          </button>
        )}
      </span>
    );
  }
  if (!url) return null;

  const mimeType = message.mediaMimeType || "";
  const filename = message.mediaFilename || `${message.type} attachment`;

  if (mimeType.startsWith("image/")) {
    return (
      <a className="media-image-link" href={url} target="_blank" rel="noreferrer" aria-label="Open image attachment">
        <img className="media-image" src={url} alt={filename} loading="lazy" />
      </a>
    );
  }
  if (mimeType.startsWith("video/")) {
    return <video className="media-video" src={url} controls preload="metadata" aria-label={filename} />;
  }
  if (mimeType.startsWith("audio/")) {
    return <audio className="media-audio" src={url} controls preload="none" aria-label={filename} />;
  }

  return (
    <a className="media-document" href={url} target="_blank" rel="noreferrer" download={filename}>
      <Download size={17} />
      <span>{filename}</span>
    </a>
  );
}
