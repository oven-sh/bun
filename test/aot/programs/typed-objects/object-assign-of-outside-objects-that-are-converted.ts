function say(name: string, f: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(f()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name;
  }
  console.log(name + ": " + text);
}

type Point = { x: number; y: number };
type Options = { a: number; at: Point; name: string; to?: Point; list: Point[] };

function merge(into: Options, from: any): Options {
  return Object.assign(into, from);
}
function fresh(): Options {
  return { a: 1, at: { x: 0, y: 0 }, name: "n", list: [] };
}
function length(point: Point): number {
  return point.x * point.x + point.y * point.y;
}

say("an object from outside among plain values", () => {
  const made = merge(fresh(), JSON.parse('{"a":2,"at":{"x":3,"y":4},"name":"m"}'));
  return [made, length(made.at), Object.keys(made).join()];
});
say("it is the same object afterwards", () => {
  const given: any = { at: { x: 1, y: 2 }, name: "same" };
  const made = merge(fresh(), given);
  given.at.x = 10;
  return [made.at === given.at, made.at.x, length(made.at)];
});
say("the keys of the object from outside keep their order", () => {
  const made = merge(fresh(), { at: { y: 2, x: 1 } });
  return [Object.keys(made.at).join(), length(made.at)];
});
say("more than its type names", () => {
  const made = merge(fresh(), { at: { x: 1, y: 2, z: 3 }, a: 9 });
  return [made, Object.keys(made.at).join(), (made.at as any).z];
});
say("an optional field that is absent", () => {
  const made = merge(fresh(), { to: { x: 5, y: 6 }, a: 3 });
  return [Object.keys(made).join(), made.to, length(made.to!)];
});
say("arrays of objects from outside", () => {
  const made = merge(fresh(), JSON.parse('{"list":[{"x":1,"y":1},{"x":2,"y":2}],"a":4}'));
  return [made.list, made.list.map(length), made.a];
});
say("many, in turn with objects of the program", () => {
  let total = 0;
  for (let i = 0; i < 3000; i++) {
    const at: Point = { x: i, y: 1 };
    const made = merge(fresh(), i & 1 ? { a: i, at, name: "t" } : JSON.parse('{"a":1,"at":{"x":2,"y":3},"name":"outside"}'));
    total += length(made.at) + made.a + made.name.length;
  }
  return total;
});
say("what stands behind it is stored too", () => {
  const made = merge(fresh(), { at: { x: 7, y: 8 }, name: "behind", a: 11 });
  return made;
});
