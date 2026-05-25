export function logInteraction(type: string, payload: Record<string, unknown> = {}) {
  window.gameSpark?.logInteraction?.({ type, payload }).catch(() => undefined);
}
