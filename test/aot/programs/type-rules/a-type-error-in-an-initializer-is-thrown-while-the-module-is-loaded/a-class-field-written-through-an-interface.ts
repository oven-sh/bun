interface Loose { size: number | null }
class Strict { size: number = 1; }
function clear(it: Loose): void { it.size = null; }
function make(): { next: number } { const strict = new Strict(); clear(strict); return { next: strict.size + 1 }; }
export const made = make();
