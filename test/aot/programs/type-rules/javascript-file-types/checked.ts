export function half(n: number) { return n / 2; }
export class Meter {
  level: number = 0;
  raise(by: number) { this.level += by; return this.level; }
}
export function label(p: { name: string }) { return p.name; }
