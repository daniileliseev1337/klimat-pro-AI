import { randomUUID as nodeRandomUUID } from "node:crypto";

export function createChangeStore({
  clock = () => Date.now(),
  randomUUID = nodeRandomUUID,
  ttlMs = 5 * 60 * 1000,
  maxPending = 1_000,
  maxPerUser = 100,
} = {}) {
  const pending = new Map();

  function create(change) {
    for (const [token, item] of pending) {
      if (item.expiresAt < clock()) pending.delete(token);
    }
    const userPending = [...pending.values()].filter(item => item.userId === change.userId).length;
    if (pending.size >= maxPending || userPending >= maxPerUser) {
      throw new Error("Слишком много ожидающих подтверждений; подтвердите, отмените или дождитесь истечения старых preview");
    }
    const confirmationToken = randomUUID();
    const confirmation = `ПОДТВЕРЖДАЮ ${confirmationToken.slice(-8)}`;
    const expiresAt = clock() + ttlMs;
    pending.set(confirmationToken, { ...change, confirmationToken, confirmation, expiresAt });
    return { confirmationToken, confirmation, expiresAt };
  }

  function consume(token, userId, confirmation) {
    const change = pending.get(token);
    if (!change) throw new Error("Код подтверждения не найден или уже использован");
    if (change.userId !== userId) throw new Error("Код подтверждения принадлежит другому пользователю");
    pending.delete(token);
    if (change.expiresAt < clock()) throw new Error("Код подтверждения истёк; сформируйте новый preview");
    if (change.confirmation !== confirmation) throw new Error("Фраза подтверждения не совпадает; код аннулирован");
    return change;
  }

  function cancel(token, userId) {
    const change = pending.get(token);
    if (!change) return false;
    if (change.userId !== userId) throw new Error("Код подтверждения принадлежит другому пользователю");
    pending.delete(token);
    return true;
  }

  return { create, consume, cancel };
}
