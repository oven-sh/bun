export class Queue { items = []; last = null; add(n: number): number { this.items.push(n); this.last = n; return this.items.length; } }
export let shared = [];
export function remember(n: number): number { shared.push(n); return shared.length; }
export function collect(n: number, into = []) { into.push(n); return into; }
function empty() { return []; }
export function one(n: number) { const made = empty(); made.push(n); return made; }
export function state(n: number) { const kept = { last: null, list: [] }; kept.last = n; kept.list.push(n); return kept; }
export function either(n: number, c: boolean) { const kept = c ? { last: null } : { list: [] }; if (kept.list) kept.list.push(n); else kept.last = n; return kept; }
