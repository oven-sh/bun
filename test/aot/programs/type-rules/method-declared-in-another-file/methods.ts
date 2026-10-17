export interface Tally { count: number; inner: { a: number }; reset(this: Tally, to: number): number }
export function reset(this: Tally, to: number): number { this.count = to; return this.count + 1; }
export interface Gauge { level: number; inner: { a: number }; fill(this: Gauge, to: number): number }
function fillTo(this: Gauge, to: number): number { this.level = to; return this.level * 2; }
export { fillTo as fill };
