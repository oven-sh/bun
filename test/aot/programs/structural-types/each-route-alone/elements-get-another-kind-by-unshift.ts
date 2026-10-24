function say(label: string, value: unknown): void {
  console.log(label + " | " + typeof value + " | " + String(value));
}

class Leaf {
  weight = 7;
}

const values: (number | string)[] = [1, 2, 3];
const leaves: (Leaf | null)[] = [new Leaf(), new Leaf(), new Leaf()];

function describe(v: number | string): string {
  return typeof v === "number" ? "number " + (v + 1) : "string " + v.length;
}

function weigh(l: Leaf | null): string {
  return l === null ? "null" : "leaf " + l.weight;
}

function change(): void {
  values.unshift("text");
  leaves.unshift(null);
}

say("before", describe(values[0]) + ", " + weigh(leaves[0]));
if (typeof values[0] === "number" && leaves[0] !== null) {
  change();
  say("the first value", values[0]);
  say("the first value plus one", values[0] + 1);
  say("the first leaf", leaves[0] === null ? "null" : "a leaf");
}
say("described", describe(values[0]) + ", " + weigh(leaves[0]));
say("some value is a string", values.some(v => typeof v === "string"));
say("every value is a number", values.every(v => typeof v === "number"));
say("numbers kept by filter", values.filter(v => typeof v === "number").length);
say("the index of the first string", values.findIndex(v => typeof v === "string"));
say("some leaf is null", leaves.some(l => l === null));
say("leaves kept by filter", leaves.filter(l => l !== null).length);
let text = "";
for (const v of values) text += typeof v + " ";
for (const l of leaves) text += weigh(l) + " ";
say("walked", text);
