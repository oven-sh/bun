function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function failure(error: unknown): string {
  return "threw " + (error instanceof Error ? error.constructor.name : text(error));
}

class Cell {
  held: number = 1;
  label: string = "cell";
  value(): number;
  value(next: number): this;
  value(...args: [] | [number]): number | this {
    if (args.length === 0) return this.held;
    this.held = args[0];
    return this;
  }
  name(): string;
  name(next: string): this;
  name(next?: string): string | this {
    if (arguments.length === 0) return this.label;
    if (next !== undefined) this.label = next;
    else this.label = String(next);
    return this;
  }
}

interface Settable {
  value(next?: number): unknown;
  name(next?: string): unknown;
}

function describe(cell: Cell): string {
  let fixed: string;
  try {
    fixed = cell.held.toFixed(1);
  } catch (error) {
    fixed = failure(error);
  }
  return text(cell.held) + " | plus one " + text(cell.held + 1) + " | " + fixed + " | " + JSON.stringify(cell) + " | " + Object.keys(cell).join();
}

const honest = new Cell();
console.log("read: " + text(honest.value()));
console.log("store: " + (honest.value(5) === honest));
console.log("read: " + text(honest.value()));
console.log(describe(honest));

let sum = 0;
for (let i = 0; i < 2000; i++) sum += honest.value(i & 7).value();
console.log("2000 stores and reads: " + sum);

const loose: Settable = honest;
console.log("no argument through the loose view: " + text(loose.value()));
console.log("undefined through the loose view is a store: " + (loose.value(undefined) === honest));
console.log(describe(honest));
console.log("read afterwards: " + text(honest.value()));
console.log("read afterwards, doubled: " + text(honest.value() * 2));
console.log("store again: " + (honest.value(3) === honest) + " " + describe(honest));

const none: [number?] = [];
const explicit: [number?] = [undefined];
console.log("an empty tuple is spread: " + text(loose.value(...none)));
console.log("a tuple with undefined is spread: " + (loose.value(...explicit) === honest) + " " + text(honest.held));

console.log("name, read: " + text(honest.name()));
console.log("name, undefined through the loose view: " + (loose.name(undefined) === honest) + " " + text(honest.label));

function counted(a?: number, b?: string, c?: boolean): string {
  return arguments.length + ": " + [a, b, c].map(text).join(", ");
}
console.log(counted());
console.log(counted(undefined));
console.log(counted(undefined, undefined));
console.log(counted(undefined, undefined, undefined));
console.log(counted(1, undefined, true));

function lastGiven(...all: (number | undefined)[]): string {
  return all.length + " " + text(all[all.length - 1]) + " " + text(all.at(-1)) + " " + Object.keys(all).join();
}
console.log(lastGiven());
console.log(lastGiven(undefined));
console.log(lastGiven(1, undefined));
console.log(lastGiven(...[1, , 3]));
