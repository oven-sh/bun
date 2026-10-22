interface Fixed {
  readonly size: number;
  readonly label: string;
}

interface Loose {
  size: number;
  label: string;
}

function read(f: Fixed): string {
  return f.label + f.size;
}

function change(l: Loose, size: number): void {
  l.size = size;
  l.label = "changed";
}

function readAroundACall(f: Fixed, act: () => void): string {
  const before = f.size;
  act();
  const after = f.size;
  return before + " -> " + after;
}

function sumWhileChanging(f: Fixed, l: Loose): number {
  let sum = 0;
  for (let i = 0; i < 2000; i++) {
    sum += f.size;
    if (i === 999) l.size = 2;
  }
  return sum;
}

const local: Fixed = { size: 1, label: "local" };
const alias: Loose = local;
console.log("before: " + read(local));
alias.size = 5;
console.log("stored through the alias: " + read(local) + " " + local.size);
change(local, 6);
console.log("stored by a callee: " + read(local));
console.log("around a call: " + readAroundACall(local, () => change(local, 7)));

const looped: Fixed = { size: 1, label: "looped" };
console.log("changed in the middle of a loop: " + sumWhileChanging(looped, looped));

class Holder {
  constructor(readonly fixed: Fixed) {}
  size(): number {
    return this.fixed.size;
  }
}

const held: Fixed = { label: "held", size: 10 };
const holder = new Holder(held);
console.log("field, before: " + holder.size());
change(held, 11);
console.log("field, after: " + holder.size());
const looseHolder: { fixed: Fixed } = holder;
looseHolder.fixed = { size: 12, label: "replaced" };
console.log("the readonly field itself replaced: " + holder.size() + " " + holder.fixed.label);

const list: readonly Fixed[] = [{ size: 20, label: "a" }, { size: 21, label: "b" }];
const sizes = () => list.map(f => f.size).join();
console.log("elements, before: " + sizes());
for (const f of list) change(f, f.size + 100);
console.log("elements, after: " + sizes());

function make(): Fixed {
  return { size: 30, label: "made" };
}
const made = make();
const capturedRead = () => made.size;
console.log("captured, before: " + capturedRead());
change(made, 31);
console.log("captured, after: " + capturedRead());

const constant: { readonly kind: "on"; readonly level: 3 } = { kind: "on", level: 3 };
const wider: { kind: string; level: number } = constant;
wider.kind = "off";
wider.level = 4;
console.log("literal types: " + constant.kind + " " + constant.level + " " + (constant.kind === "on") + " " + (constant.level === 3));
console.log("in a switch: " + (() => {
  switch (constant.kind) {
    case "on":
      return "the on branch";
    default:
      return "the default branch";
  }
})());

const mapped: Readonly<Loose> = { size: 40, label: "mapped" };
change(mapped, 41);
console.log("Readonly<T>: " + read(mapped));

export {};
