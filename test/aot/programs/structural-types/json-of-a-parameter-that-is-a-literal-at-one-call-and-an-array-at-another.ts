interface Pair {
  0: string;
  1: string;
}

function json(p: Pair): string {
  return JSON.stringify(p);
}

console.log(json({ 0: "a", 1: "b" }));
console.log(json(["e", "f"]));

export {};
