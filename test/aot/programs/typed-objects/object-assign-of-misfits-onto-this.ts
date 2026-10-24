// `Object.assign(this, given)` stores whatever it is given, as in plain Bun. A field that holds a primitive of another kind afterwards throws a TypeError at its next typed read; any object passes for a field of a class type.
class Tree {
  depth: number;
  constructor(depth: number) {
    this.depth = depth;
  }
}
class Holder {
  held!: Tree;
  name!: string;
  takeAny(given: any) {
    Object.assign(this, given);
  }
}
function say(name: string, f: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(f()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name;
  }
  console.log(name + ": " + text);
}
const misfits: [string, any][] = [
  ["a number for a Tree", { held: 5 }],
  ["a number for a string", { name: 7 }],
  ["an object whose depth is a string", { held: { depth: "deep" } }],
  ["an object that has what a Tree has", { held: { depth: 3 } }],
  ["a Map", { held: new Map() }],
  ["an array", { held: [1] }],
  ["a function", { held: () => 1 }],
  ["a fit before a misfit", { name: "stored", held: 5 }],
];
for (const [name, given] of misfits) {
  say(name, () => {
    const holder: Holder = new Holder();
    for (let i = 0; i < 3; i++) holder.takeAny({ held: new Tree(i), name: "n" });
    try {
      holder.takeAny(given);
    } catch (error) {
      return [(error as Error).constructor.name, holder.held, holder.name, Object.keys(holder).join()];
    }
    return [holder.held, holder.name, Object.keys(holder).join()];
  });
}
