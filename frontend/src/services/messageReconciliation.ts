import type { ChatMessage } from "../types";

function hasSameIdentity(first: ChatMessage, second: ChatMessage): boolean {
  if (first.direction !== second.direction) return false;
  if (first.id && second.id && first.id === second.id) return true;
  if (first.messageId && second.messageId && first.messageId === second.messageId) return true;

  if (first.direction !== "outgoing") return false;
  if (
    first.clientMessageId &&
    second.clientMessageId &&
    first.clientMessageId === second.clientMessageId
  ) {
    return true;
  }

  const firstIds = [first.id, first.messageId].filter((id): id is string => Boolean(id));
  const secondIds = new Set(
    [second.id, second.messageId].filter((id): id is string => Boolean(id))
  );
  return firstIds.some((id) => secondIds.has(id));
}

export function mergeChatMessages(...groups: ChatMessage[][]): ChatMessage[] {
  const merged: ChatMessage[] = [];

  for (const group of groups) {
    for (const message of group) {
      const existingIndex = merged.findIndex((item) => hasSameIdentity(item, message));
      if (existingIndex < 0) {
        merged.push(message);
        continue;
      }

      const existing = merged[existingIndex];
      merged[existingIndex] = {
        ...existing,
        ...message,
        clientMessageId: message.clientMessageId || existing.clientMessageId,
      };
    }
  }

  return merged;
}
