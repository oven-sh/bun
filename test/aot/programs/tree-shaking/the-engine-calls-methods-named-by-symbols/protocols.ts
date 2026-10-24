export const log: string[] = [];
function* upTo(n: number) { for (let i = 0; i < n; i++) yield i; }
async function* ticks() { yield "tick"; yield "tock"; }
function hinted(hint: string) { return hint === "number" ? 7 : "hint " + hint; }
function isEven(value: unknown) { return typeof value === "number" && value % 2 === 0; }
function closed(name: string) { log.push("closed " + name); }

export class Range {
  constructor(public end: number) {}
  [Symbol.iterator]() { return upTo(this.end); }
}
export class Ticks {
  [Symbol.asyncIterator]() { return ticks(); }
}
export class Amount {
  [Symbol.toPrimitive](hint: string) { return hinted(hint); }
}
export class Even {
  static [Symbol.hasInstance](value: unknown) { return isEven(value); }
}
export class Resource {
  constructor(public name: string) {}
  [Symbol.dispose]() { closed(this.name); }
  async [Symbol.asyncDispose]() { closed(this.name); }
}
export class Comma {
  [Symbol.split](text: string) { return "split " + text; }
  [Symbol.replace](text: string, by: string) { return "replace " + text + " " + by; }
}
export class Tagged {
  get [Symbol.toStringTag]() { return "Custom"; }
}
