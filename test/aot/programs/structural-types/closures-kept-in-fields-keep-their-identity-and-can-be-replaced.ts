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

class Button {
  clicks: number = 0;
  label: string = "button";
  onClick: () => number = () => ++this.clicks;
  describe: () => string = () => this.label + " " + this.clicks;
  plain: (n: number) => number = function (n: number): number {
    return n * 2;
  };
  method(): number {
    return this.clicks;
  }
}

const a = new Button();
const b = new Button();

show("same closure on every read", () => a.onClick === a.onClick);
show("another instance has another closure", () => a.onClick === b.onClick);
show("typeof", () => typeof a.onClick);
show("name", () => a.onClick.name);
show("name of the function expression", () => a.plain.name);
show("length", () => a.plain.length);
show("keys", () => Object.keys(a).join());
show("own", () => Object.hasOwn(a, "onClick"));
show("JSON", () => JSON.stringify(a));
show("call", () => a.onClick());
show("taken off", () => {
  const f = a.onClick;
  return f() + f();
});
show("the other is untouched", () => b.clicks);
show("call with another this", () => a.onClick.call(b));
show("by a computed name", () => {
  const key: "onClick" | "method" = a.label.length > 0 ? "onClick" : "method";
  return a[key]();
});
show("spread copies the closure", () => {
  const copy = { ...a };
  return (copy.onClick === a.onClick) + " " + copy.onClick() + " " + copy.clicks + " " + a.clicks;
});
show("in a set", () => new Set([a.onClick, a.onClick, b.onClick]).size);
show("as a map key", () => new Map([[a.describe, "found"]]).get(a.describe));
show("handed to a built-in", () => [1, 2].map(a.plain));
show("values", () => Object.values(a).map(v => typeof v).join());

const first = a.describe;
a.describe = () => "replaced";
show("replaced", () => a.describe());
show("the old one still works", () => first());
show("the other instance", () => b.describe());

const wide: { onClick: (() => number) | number | undefined } = a;
wide.onClick = 5;
show("a number in the field: typeof", () => typeof a.onClick);
show("a number in the field: called", () => a.onClick());
wide.onClick = undefined;
show("undefined in the field: called", () => a.onClick());
show("undefined in the field: keys", () => Object.keys(a).join());
wide.onClick = () => -1;
show("a function again", () => a.onClick());

const loose: { describe?: () => string; plain?: (n: number) => number } = b;
delete loose.describe;
show("deleted: typeof", () => typeof b.describe);
show("deleted: called", () => b.describe());
show("deleted: keys", () => Object.keys(b).join());
Object.defineProperty(b, "plain", { get: () => (n: number) => n + 1000, configurable: true });
show("redefined as a getter", () => b.plain(1));

const many: Button[] = [];
for (let i = 0; i < 2000; i++) many.push(new Button());
let total = 0;
for (const button of many) total += button.onClick();
show("2000 buttons clicked once", () => total);
show("never read, still there", () => Object.keys(many[7]).join());
show("frozen", () => {
  const frozen = Object.freeze(new Button());
  return typeof frozen.onClick + " " + frozen.describe();
});
show("frozen: click", () => Object.freeze(new Button()).onClick());
