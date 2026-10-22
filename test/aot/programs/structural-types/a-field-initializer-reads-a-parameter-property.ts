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

class Size {
  doubled: number = this.readWidth() * 2;
  kind: string = typeof this.readWidth();
  keysSoFar: string = Object.keys(this).join("+");
  titleLength: number = this.safeTitleLength();
  constructor(
    public width: number,
    public title: string,
  ) {
    this.inBody = this.width * 2;
  }
  inBody: number;
  readWidth(): number {
    return this.width;
  }
  safeTitleLength(): number {
    try {
      return this.title.length;
    } catch (error) {
      return -1;
    }
  }
}

const size = new Size(4, "four");
show("doubled", () => size.doubled);
show("kind", () => size.kind);
show("keysSoFar", () => size.keysSoFar);
show("titleLength", () => size.titleLength);
show("inBody", () => size.inBody);
show("width", () => size.width);
show("keys", () => Object.keys(size).join());

class Base {
  baseField: number = 1;
}
class Sub extends Base {
  copied: number = this.readN();
  baseSeen: number = this.baseField;
  constructor(public n: number) {
    super();
  }
  readN(): number {
    return this.n;
  }
}
const sub = new Sub(6);
show("sub copied", () => sub.copied);
show("sub copied + 1", () => sub.copied + 1);
show("sub baseSeen", () => sub.baseSeen);
show("sub n", () => sub.n);
show("sub keys", () => Object.keys(sub).join());

let total = 0;
for (let i = 0; i < 100; i++) total += new Size(i, "t").inBody;
show("100 made", () => total);
