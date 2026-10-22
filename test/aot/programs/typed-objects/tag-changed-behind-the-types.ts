// Code that tests the tag of a union can't trust the tag: it is overwritten through `any` and through a base type, deleted, inherited, replaced by a getter, and stored between the read and the comparison.
const enum Kind {
  Circle = 1,
  Square = 2,
  Label = 3,
}

interface Base {
  kind: Kind;
  id: number;
}

interface Circle extends Base {
  kind: Kind.Circle;
  radius: number;
}

interface Square extends Base {
  kind: Kind.Square;
  side: number;
}

interface Label extends Base {
  kind: Kind.Label;
  text: string;
}

type Shape = Circle | Square | Label;

let nextId = 0;

function circle(radius: number): Circle {
  return { kind: Kind.Circle, id: nextId++, radius };
}

function square(side: number): Square {
  return { kind: Kind.Square, id: nextId++, side };
}

function label(text: string): Label {
  return { kind: Kind.Label, id: nextId++, text };
}

function describeByIf(s: Shape): string {
  if (s.kind === Kind.Circle) return "circle " + s.radius;
  if (s.kind === Kind.Square) return "square " + s.side;
  if (s.kind !== Kind.Label) return "no kind";
  return "label " + s.text;
}

function describeBySwitch(s: Shape): string {
  switch (s.kind) {
    case Kind.Circle:
      return "circle " + s.radius;
    case Kind.Square:
      return "square " + s.side;
    case Kind.Label:
      return "label " + s.text;
  }
  return "no kind";
}

function measure(s: Shape): number {
  switch (s.kind) {
    case Kind.Circle:
      return s.radius * 2;
    case Kind.Square:
      return s.side * 4;
    case Kind.Label:
      return s.text.length;
  }
}

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : "another error";
  }
}

function show(title: string, s: Shape) {
  const answers = [describeByIf(s), describeBySwitch(s), attempt(() => measure(s)), Object.keys(s).join()];
  console.log(title + ":", answers.join(" | "));
}

function storeTag(o: any, tag: any) {
  o.kind = tag;
}

function storeTagThroughBase(b: Base, kind: Kind) {
  b.kind = kind;
}

function storeBeforeComparison(s: Shape, tag: Kind): string {
  if (s.kind === (storeTag(s, tag), Kind.Circle)) return "was a circle " + s.radius + ", is " + describeBySwitch(s);
  return "was no circle, is " + describeBySwitch(s);
}

function storeBeforeCase(s: Shape, tag: Kind): string {
  switch (s.kind) {
    case (storeTag(s, tag), Kind.Circle):
      return "was a circle " + s.radius + ", is " + describeByIf(s);
    case Kind.Square:
      return "was a square " + s.side + ", is " + describeByIf(s);
  }
  return "was something else, is " + describeByIf(s);
}

const untouched: Shape[] = [circle(1), square(2), label("ab")];
for (const s of untouched) show("untouched", s);

const overwritten = circle(3);
for (const tag of [Kind.Square, Kind.Label, 4, "1", undefined, null, 1.5, Kind.Circle]) {
  (overwritten as any).kind = tag;
  show("stored " + typeof tag + " " + String(tag), overwritten);
}

const retagged = square(4);
storeTagThroughBase(retagged, Kind.Circle);
show("stored through the base type", retagged);
storeTagThroughBase(retagged, Kind.Square);
show("stored back through the base type", retagged);

const deleted = label("cd");
delete (deleted as any).kind;
show("deleted", deleted);
Object.setPrototypeOf(deleted, { kind: Kind.Square, side: 5 });
show("inherited", deleted);
(deleted as any).kind = Kind.Label;
show("stored again", deleted);

const computed = circle(6);
let reads = 0;
Object.defineProperty(computed, "kind", {
  get() {
    reads++;
    return reads % 2 === 1 ? Kind.Square : Kind.Circle;
  },
  enumerable: true,
  configurable: true,
});
show("getter", computed);
console.log("reads:", reads);
Object.defineProperty(computed, "kind", { value: Kind.Circle, writable: true, enumerable: true, configurable: true });
show("data property again", computed);

console.log(storeBeforeComparison(circle(7), Kind.Square));
console.log(storeBeforeComparison(square(7), Kind.Circle));
console.log(storeBeforeComparison(circle(7), Kind.Circle));
console.log(storeBeforeCase(circle(8), Kind.Label));
console.log(storeBeforeCase(square(8), Kind.Circle));
console.log(storeBeforeCase(label("ef"), Kind.Circle));

show("parsed", JSON.parse('{"kind":1,"id":-1,"side":9}') as Shape);
const assigned = square(9);
Object.assign(assigned, { kind: Kind.Label });
show("assigned", assigned);

class Ok {
  readonly tag = "ok";
  constructor(public value: number) {}
}

class Failure {
  readonly tag = "failure";
  constructor(public message: string) {}
}

function unwrap(result: Ok | Failure): string {
  return result.tag === "ok" ? "ok " + result.value : "failure " + result.message;
}

const outcome = new Ok(1);
console.log(unwrap(outcome), "|", unwrap(new Failure("x")));
(outcome as any).tag = "failure";
console.log(unwrap(outcome));
delete (outcome as any).tag;
console.log(unwrap(outcome));
(Ok.prototype as any).tag = "ok";
console.log(unwrap(outcome), "|", unwrap(new Failure("y")), "|", unwrap(new Ok(2)));

const many: Shape[] = [];
for (let i = 0; i < 60; i++) many.push(i % 3 === 0 ? circle(i) : i % 3 === 1 ? square(i) : label("t" + i));
for (let i = 0; i < many.length; i += 7) storeTag(many[i], (i % 4) + 1);
console.log(many.map(s => describeByIf(s)).join(";"));
console.log(many.map(s => describeBySwitch(s)).join(";"));
console.log(many.map(s => attempt(() => measure(s))).join(";"));

interface Leaf {
  type: "leaf";
  value: number;
}

interface Pair {
  type: "pair";
  left: Tree;
  right: Tree;
}

type Tree = Leaf | Pair;

function grow(depth: number): Tree {
  return depth === 0 ? { type: "leaf", value: 1 } : { type: "pair", left: grow(depth - 1), right: grow(depth - 1) };
}

function sum(tree: Tree): number {
  return tree.type === "leaf" ? tree.value : sum(tree.left) + sum(tree.right);
}

console.log("a tag that nothing changes:", sum(grow(6)));

for (const s of untouched) show("still untouched", s);
for (const s of [circle(10), square(11), label("gh")]) show("created afterwards", s);
