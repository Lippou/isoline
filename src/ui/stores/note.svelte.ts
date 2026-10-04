// The cursor note (1.10.0): the immediate answer to the player's own order — a refused
// attack, no coast to land on, a view that cannot be lifted, a setting just switched —
// printed small beside the pointer for two seconds (CursorNote.svelte). Everything else the
// game has to say goes to the journal (game.svelte.ts: toast), whose dock button counts
// what is unread: nothing is laid over the alliance offers any more.
export interface Note {
  id: number;
  text: string;
  level: 'info' | 'good' | 'warn' | 'danger';
  /** Where the pointer was (CSS pixels of the window). */
  x: number;
  y: number;
}

/** How long a note stays (ms). */
export const NOTE_MS = 2200;

export const notes = $state<{ current: Note | null }>({ current: null });

let id = 1;
let timer: ReturnType<typeof setTimeout> | null = null;
/** The last place of the pointer (the note is printed there, and does not follow it). */
const pointer = { x: -1, y: -1 };
if (typeof window !== 'undefined')
  window.addEventListener(
    'pointermove',
    (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    },
    { passive: true, capture: true },
  );

/** A short note beside the pointer (the last one replaces the one before). */
export function note(text: string, level: Note['level'] = 'warn'): void {
  if (timer) clearTimeout(timer);
  const x = pointer.x >= 0 ? pointer.x : (typeof window !== 'undefined' ? window.innerWidth : 1600) / 2;
  const y = pointer.y >= 0 ? pointer.y : (typeof window !== 'undefined' ? window.innerHeight : 900) / 2;
  const n: Note = { id: id++, text, level, x, y };
  notes.current = n;
  timer = setTimeout(() => {
    if (notes.current?.id === n.id) notes.current = null;
  }, NOTE_MS);
}

export function clearNote(): void {
  if (timer) clearTimeout(timer);
  notes.current = null;
}
