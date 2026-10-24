class Builder {
  parts: string[] = [];
  add(part: string): Builder {
    this.parts.push(part);
    return this;
  }
  build(): string {
    return this.parts.join("");
  }
}

function copying(this: Builder, part: string): Builder {
  const next = new Builder();
  next.parts = [...this.parts, part.toUpperCase()];
  return next;
}

const spare = new Builder();

function diverting(part: string): Builder {
  spare.parts.push(part);
  return spare;
}

function chain(b: Builder): string {
  return b.add("a").add("b").add("c").build() + " / " + b.build();
}

function same(b: Builder): string {
  const r = b.add("x");
  return (r === b) + " " + r.parts.length + " " + b.parts.length;
}

function ignoring(b: Builder): string {
  b.add("p");
  b.add("q");
  return b.build();
}

function loop(b: Builder): string {
  let at = b;
  for (let i = 0; i < 4; i++) at = at.add(String(i));
  return at.build() + " / " + b.build();
}

function round(label: string): void {
  spare.parts.length = 0;
  console.log(label + ": " + chain(new Builder()) + " | " + same(new Builder()) + " | " + ignoring(new Builder()) + " | " + loop(new Builder()) + " | spare " + spare.build());
}

const original = Builder.prototype.add;
let warm = 0;
for (let i = 0; i < 2000; i++) warm += chain(new Builder()).length + same(new Builder()).length + loop(new Builder()).length;
console.log("2000 honest: " + warm);
round("the method");
round("one that returns a copy");
round("one that returns a shared builder");
round("put back");

export {};
