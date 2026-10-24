const log: string[] = [];

class Hidden {
  n = 1;
  static [Symbol.hasInstance](value: unknown): boolean {
    log.push("asked");
    return false;
  }
}

class Open {
  m = "open";
}

class Below extends Hidden {
  extra = 2;
}

function which(value: Hidden | Open): string {
  if (value instanceof Hidden) return "hidden " + value.n;
  return "open " + typeof value.m + " " + value.m;
}

function whichBelow(value: Hidden): string {
  return value instanceof Below ? "below " + value.extra : "not below " + value.n;
}

function fresh(): string {
  const made = new Hidden();
  return made instanceof Hidden ? "its own instance" : "not its own instance";
}

function negated(value: Hidden | Open): string {
  if (!(value instanceof Hidden)) return "open " + typeof value.m;
  return "hidden " + value.n;
}

function line(label: string, value: string): void {
  console.log(label + ": " + value + " [" + log.length + " asked]");
  log.length = 0;
}

line("an instance", which(new Hidden()));
line("an open one", which(new Open()));
line("a subclass instance", which(new Below()));
line("the subclass inherits the answer", whichBelow(new Below()));
line("made in the same function", fresh());
line("negated", negated(new Hidden()) + " | " + negated(new Open()));

let count = 0;
for (let i = 0; i < 2000; i++) if (new Hidden() instanceof Hidden) count++;
line("2000 checks, yes", String(count));

const list: (Hidden | Open)[] = [new Hidden(), new Open(), new Below()];
line("filter", String(list.filter(v => v instanceof Hidden).length));
line("elements", list.map(which).join(", "));

class Counting {
  static asked = 0;
  id = 5;
  static [Symbol.hasInstance](value: unknown): boolean {
    return ++Counting.asked % 2 === 1;
  }
}

function twice(value: Counting | Open): string {
  const first = value instanceof Counting;
  const second = value instanceof Counting;
  return first + " " + second;
}

function guarded(value: Counting | Open): string {
  if (value instanceof Counting && value instanceof Counting) return "both " + value.id;
  if (value instanceof Counting) return "the third time " + value.id;
  return "open " + typeof value.m;
}

line("an answer that alternates", twice(new Counting()) + " | " + twice(new Open()));
line("three checks in one function", guarded(new Counting()) + " | " + guarded(new Open()) + " | " + guarded(new Counting()));
line("asked", String(Counting.asked));

export {};
