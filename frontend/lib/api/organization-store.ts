// Remembers which organization the user last selected. This is only a preference:
// the backend verifies membership on every request, so tampering grants nothing.

const KEY = "nexora.activeOrganizationId";

let current: string | null = null;

export function getActiveOrganizationId(): string | null {
  if (current) return current;
  try {
    current = window.localStorage.getItem(KEY);
  } catch {
    current = null;
  }
  return current;
}

export function setActiveOrganizationId(id: string | null): void {
  current = id;
  try {
    if (id) window.localStorage.setItem(KEY, id);
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage may be unavailable (private mode); the in-memory value still works.
  }
}
