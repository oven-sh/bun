class Stepper {
  position = 0;
  step: () => string = () => "first " + ++this.position;
  walk(rounds: number): string[] {
    const seen: string[] = [];
    for (let i = 0; i < rounds; i++) seen.push(this.step());
    return seen;
  }
}

function walk(s: Stepper, rounds: number): string[] {
  const seen: string[] = [];
  for (let i = 0; i < rounds; i++) seen.push(s.step());
  return seen;
}

function selfReplacing(s: Stepper): () => string {
  const first = s.step;
  const second = (): string => {
    s.step = first;
    return "second " + ++s.position;
  };
  return () => {
    s.step = second;
    return "replacing " + ++s.position;
  };
}

const a = new Stepper();
a.step = selfReplacing(a);
console.log("by itself, from outside: " + walk(a, 5).join(", "));

const b = new Stepper();
b.step = selfReplacing(b);
console.log("by itself, from a method: " + b.walk(5).join(", "));

const c = new Stepper();
const seen: string[] = [];
for (let i = 0; i < 6; i++) {
  seen.push(c.step());
  if (i === 1) c.step = () => "loop " + i;
  if (i === 3) c.step = () => "loop again " + i;
}
console.log("by the loop's own body: " + seen.join(", "));

class Chain {
  hops = 0;
  next: () => Chain = () => {
    this.hops++;
    if (this.hops === 3) this.next = () => other;
    return this;
  };
}

const other = new Chain();
let at = new Chain();
const start = at;
const path: string[] = [];
for (let i = 0; i < 7; i++) {
  at = at.next();
  path.push((at === start ? "start" : at === other ? "other" : "unknown") + " " + at.hops);
}
console.log("the receiver changes too: " + path.join(", "));

const late = new Stepper();
let last = "";
for (let i = 0; i < 2004; i++) {
  last = late.step();
  if (i === 2000) late.step = () => "late " + late.position;
  if (i > 2000) console.log("round " + i + ": " + last);
}

const list = [new Stepper(), new Stepper(), new Stepper()];
const rounds: string[] = [];
for (const each of list) {
  rounds.push(each.step());
  for (const all of list) all.step = () => "replaced for all";
}
console.log("elements replaced while the list is walked: " + rounds.join(", "));

const wide: { step: (() => string) | undefined } = new Stepper();
const narrow = new Stepper();
const alias: { step: (() => string) | undefined } = narrow;
const results: string[] = [];
for (let i = 0; i < 3; i++) {
  try {
    results.push(narrow.step());
  } catch (error) {
    results.push("threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
  alias.step = i === 0 ? undefined : wide.step;
}
console.log("undefined in between, through a wider view: " + results.join(", "));

export {};
