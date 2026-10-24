type Loose = { size?: number };
type Strict = { size: number };
function clear(it: Loose): void { it.size = undefined; }
function make(): { next: number } { const strict: Strict = { size: 1 }; clear(strict); return { next: strict.size + 1 }; }
export const made = make();
