export type AppToast = {
  readonly id: number;
  readonly message: string;
  readonly outcome: 'success' | 'error' | 'info';
  readonly title: string;
};

let nextId = 0;
let snapshot: AppToast | null = null;
const listeners = new Set<() => void>();

export function readAppToast(): AppToast | null {
  return snapshot;
}

export function subscribeAppToast(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function showAppToast(input: Omit<AppToast, 'id'>): void {
  snapshot = { ...input, id: nextId++ };
  emit();
}

export function dismissAppToast(id?: number): void {
  if (snapshot === null || (id !== undefined && snapshot.id !== id)) return;
  snapshot = null;
  emit();
}

function emit(): void {
  for (const listener of listeners) listener();
}
