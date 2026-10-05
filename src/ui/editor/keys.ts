// Keyboard labels of the editor. Its shortcuts are letters matched on the character typed
// (KeyboardEvent.key), never on the key's position: B is B on AZERTY as on QWERTY, and no
// shortcut needs a digit or a sign that moves between layouts.
export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** The modifier of the standard shortcuts (undo, save): ⌘ on a Mac, Ctrl elsewhere. */
export const MOD = isMac ? '⌘' : 'Ctrl';

export function keyLabel(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
}

/** A tooltip: the action, then its key. */
export function withKey(label: string, key: string): string {
  return `${label} (${keyLabel(key)})`;
}

/** Whether the event comes from a text field (shortcuts stay out of the way of typing). */
export function typing(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable) return true;
  if (tag !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return !['range', 'checkbox', 'radio', 'button'].includes(type);
}
