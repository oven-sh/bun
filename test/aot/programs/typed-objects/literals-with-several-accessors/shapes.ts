export type Counter = { start: number; readonly next: number; label: string; twice: number; readonly third: string; last: boolean; only: number };
export function makeCounter(start: number): Counter {
  return {
    start,
    get next() {
      return this.start + 1;
    },
    label: "c",
    get twice() {
      return this.start * 2;
    },
    set twice(value: number) {
      this.start = value / 2;
    },
    get third() {
      return this.label + this.start;
    },
    last: true,
    set only(value: number) {
      this.start = value;
    },
  };
}
export type One = { start: number; readonly next: number };
export function makeOne(start: number): One {
  return {
    start,
    get next() {
      return this.start + 1;
    },
  };
}
export type Many = { readonly a: number; readonly b: number; readonly c: number; readonly d: number; readonly e: number; readonly f: number; readonly g: number; readonly h: number; readonly i: number; readonly j: number; start: number };
export function makeMany(start: number): Many {
  return {
    get a() { return start; },
    get b() { return start + 1; },
    get c() { return start + 2; },
    get d() { return start + 3; },
    get e() { return start + 4; },
    get f() { return start + 5; },
    get g() { return start + 6; },
    get h() { return start + 7; },
    get i() { return start + 8; },
    get j() { return start + 9; },
    start,
  };
}
export function sumOfCounter(counter: Counter): number {
  return counter.next + counter.twice + counter.third.length;
}
export function sumOfMany(many: Many): number {
  return many.a + many.b + many.c + many.d + many.e + many.f + many.g + many.h + many.i + many.j + many.start;
}
