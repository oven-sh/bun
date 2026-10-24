class Version {
  readonly major = 1;
  readonly minor: number;
  readonly tag: string = "stable";
  static readonly latest = 9;
  constructor(minor: number) {
    this.minor = minor;
  }
  text(): string {
    return this.major + "." + this.minor + "-" + this.tag;
  }
  isFirst(): boolean {
    return this.major === 1;
  }
  newerThan(other: Version): boolean {
    return this.major > other.major || (this.major === other.major && this.minor > other.minor);
  }
}

interface Editable {
  major: number;
  minor: number;
  tag: string;
}

function edit(e: Editable, major: number): void {
  e.major = major;
  e.minor += 1;
  e.tag = "edited";
}

const v = new Version(2);
console.log("before: " + v.text() + " " + v.isFirst() + " " + v.major);
edit(v, 3);
console.log("after: " + v.text() + " " + v.isFirst() + " " + v.major + " " + (v.major === 1));
console.log("a fresh one: " + new Version(0).text() + " " + new Version(0).isFirst());
console.log("compared: " + v.newerThan(new Version(100)) + " " + new Version(100).newerThan(v));

const statics: { latest: number } = Version;
statics.latest = 10;
console.log("a static: " + Version.latest + " " + (Version.latest === 9));

let firsts = 0;
const stable = new Version(1);
for (let i = 0; i < 2000; i++) if (stable.isFirst()) firsts++;
console.log("2000 honest: " + firsts);
edit(stable, 2);
console.log("then edited: " + stable.isFirst() + " " + stable.text());

const many: Version[] = [];
for (let i = 0; i < 5; i++) many.push(new Version(i));
edit(many[2], 7);
console.log("one of five edited: " + many.map(x => x.text()).join() + " " + many.map(x => x.isFirst()).join());

let sum = 0;
const looped = new Version(0);
for (let i = 0; i < 2000; i++) {
  sum += looped.major;
  if (i === 1499) edit(looped, 100);
}
console.log("edited in the middle of a loop: " + sum);

class Pinned {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}
  sum(): number {
    return this.x + this.y;
  }
}

const pinned = new Pinned(1, 2);
const open: { x: number; y: number } = pinned;
[open.x, open.y] = [open.y * 10, open.x * 10];
console.log("parameter properties: " + pinned.sum() + " " + JSON.stringify(pinned));

Object.assign(pinned, { x: -1 });
console.log("Object.assign: " + pinned.sum());
Reflect.set(pinned, "y", -2);
console.log("Reflect.set: " + pinned.sum());
Object.defineProperty(pinned, "x", { value: 50 });
console.log("defineProperty: " + pinned.sum());

export {};
