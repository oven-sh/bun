// A method taken off its object and handed to a callback is called without `this`: it throws a TypeError and stores nothing anywhere.
class Counter { count = 0; step = 1; bump(): number { this.count += this.step; return this.count } }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
const c = new Counter();
const handlers: (() => number)[] = [c.bump];
console.log(handlers.map(h => attempt(h)).join(), c.count);
