// Range inputs on chart paper show their track filled up to the value (global.css reads
// --fill). Pass anything that changes with the value or bounds as the parameter.
import type { Action } from 'svelte/action';

export const rangeFill: Action<HTMLInputElement, unknown> = (node) => {
  const set = () => {
    const min = Number(node.min || 0);
    const max = Number(node.max || 100);
    const pct = ((Number(node.value) - min) / (max - min || 1)) * 100;
    node.style.setProperty('--fill', `${Math.max(0, Math.min(100, pct))}%`);
  };
  set();
  node.addEventListener('input', set);
  return {
    update: () => queueMicrotask(set),
    destroy: () => node.removeEventListener('input', set),
  };
};
