function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

enum Level {
  Low,
  High,
}
class Link {
  value: number = 1;
}

const early: string[] = [];
function note(label: string, run: () => unknown): void {
  try {
    early.push(label + ": " + text(run()));
  } catch (error) {
    early.push(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Base {
  constructor() {
    this.init();
  }
  init(): void {}
}

class Packed extends Base {
  flag: boolean = false;
  on: boolean = true;
  digit: 0 | 1 | 2 = 0;
  level: Level = Level.Low;
  mode: "a" | "b" = "a";
  small: number = 0;
  byte: number = 255;
  ratio: number = 0;
  big: bigint = 0n;
  next: Link | null = null;
  maybe: Link | undefined = undefined;
  key: symbol = Symbol.iterator;
  init(): void {
    note("flag", () => this.flag);
    note("flag === false", () => this.flag === false);
    note("!flag", () => !this.flag);
    note("on", () => this.on);
    note("digit", () => this.digit);
    note("digit === 0", () => this.digit === 0);
    note("level", () => this.level);
    note("level === Low", () => this.level === Level.Low);
    note("name of level", () => Level[this.level]);
    note("mode", () => this.mode);
    note("mode === 'a'", () => this.mode === "a");
    note("small", () => this.small);
    note("small === 0", () => this.small === 0);
    note("small + 1", () => this.small + 1);
    note("byte", () => this.byte);
    note("ratio", () => this.ratio);
    note("ratio === 0", () => this.ratio === 0);
    note("big", () => this.big);
    note("big + 1n", () => this.big + 1n);
    note("next", () => this.next);
    note("next === null", () => this.next === null);
    note("next == null", () => this.next == null);
    note("next?.value", () => this.next?.value);
    note("maybe", () => this.maybe);
    note("key", () => typeof this.key);
  }
  bump(): void {
    this.small++;
    this.byte = (this.byte + 1) & 255;
    this.flag = !this.flag;
  }
}

const packed = new Packed();
for (const entry of early) console.log("early " + entry);
early.length = 0;
packed.init();
for (const entry of early) console.log("late " + entry);
for (let i = 0; i < 2001; i++) packed.bump();
show("small after 2001 bumps", () => packed.small);
show("byte after 2001 bumps", () => packed.byte);
show("flag after 2001 bumps", () => packed.flag);

class Unset {
  flag!: boolean;
  digit!: 0 | 1 | 2;
  level!: Level;
  mode!: "a" | "b";
  small!: number;
  next!: Link | null;
}
const unset = new Unset();
show("unset flag", () => unset.flag);
show("unset flag === false", () => unset.flag === false);
show("unset digit", () => unset.digit);
show("unset level", () => unset.level);
show("unset mode", () => unset.mode);
show("unset small", () => unset.small);
show("unset small++", () => unset.small++);
show("unset small afterwards", () => unset.small);
show("unset next", () => unset.next);
show("unset next === null", () => unset.next === null);
show("unset JSON", () => JSON.stringify(unset));
show("unset keys", () => Object.keys(unset).join());
