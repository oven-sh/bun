interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

interface Box {
  origin: Point;
  size: Size;
  name: string;
}

function area(box: Box): number {
  return box.size.width * box.size.height;
}

function corner(box: Box): Point {
  return { x: box.origin.x + box.size.width, y: box.origin.y + box.size.height };
}

function paths(value: object, prefix: string, out: string[]): string[] {
  for (const [key, inner] of Object.entries(value)) {
    out.push(prefix + key);
    if (typeof inner === "object" && inner !== null) paths(inner, prefix + key + ".", out);
  }
  return out;
}

function move(box: Box, by: number): void {
  box.origin.x += by;
  box.origin.y += by;
}

function replaceOrigin(box: Box, origin: Point): void {
  box.origin = origin;
}

const honest: Box = { origin: { x: 1, y: 2 }, size: { width: 3, height: 4 }, name: "honest" };
const outerFlipped: Box = { name: "outer", size: { width: 5, height: 6 }, origin: { x: 7, y: 8 } };
const innerFlipped: Box = { origin: { y: 10, x: 9 }, size: { height: 12, width: 11 }, name: "inner" };
const allFlipped: Box = { size: { height: 14, width: 13 }, name: "all", origin: { y: 16, x: 15 } };
const padded = {
  id: 1,
  origin: { z: 0, x: 17, label: "o", y: 18 },
  tags: ["t"],
  size: { depth: 0, height: 20, width: 19 },
  name: "padded",
};

const boxes: Box[] = [honest, outerFlipped, innerFlipped, allFlipped, padded];

for (const box of boxes) {
  console.log(box.name + ", area: " + area(box));
  console.log(box.name + ", corner: " + JSON.stringify(corner(box)));
  console.log(box.name + ", paths: " + paths(box, "", []).join());
  console.log(box.name + ", json: " + JSON.stringify(box));
  console.log(box.name + ", shallow copy: " + JSON.stringify({ ...box }));
  console.log(box.name + ", deep copy: " + JSON.stringify({ ...box, origin: { ...box.origin }, size: { ...box.size } }));
  console.log(box.name + ", clone: " + JSON.stringify(structuredClone(box)));
}

for (const box of boxes) move(box, 100);
console.log("moved: " + JSON.stringify(boxes.map(box => box.origin)));

const shared = { y: -2, extra: true, x: -1 };
for (const box of boxes) replaceOrigin(box, shared);
console.log("one origin for all: " + boxes.map(box => corner(box).x + ":" + corner(box).y).join());
move(honest, 1);
console.log("moving one moves all: " + boxes.map(box => box.origin.x).join());
console.log("json after: " + JSON.stringify(boxes));

let sum = 0;
for (let i = 0; i < 2000; i++) sum += area(honest) + corner(honest).x;
console.log("2000 honest: " + sum);
console.log("then padded: " + area(padded) + " " + JSON.stringify(corner(padded)));
console.log("then all flipped: " + area(allFlipped) + " " + JSON.stringify(corner(allFlipped)));
