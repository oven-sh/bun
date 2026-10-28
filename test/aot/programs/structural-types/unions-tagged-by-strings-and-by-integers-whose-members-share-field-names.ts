// Unions told apart by a string beside the same unions told apart by an integer, and fields declared `any`, in a program that unseen code may enter.
try {
  require("late-package");
} catch {}
const world = globalThis as any;

type Sq = { kind: "sq"; s: number };
type Rect = { kind: "rect"; h: number; s: number };
type Tri = { kind: "tri"; a: number; b: number; s: number };
type Shape = Sq | Rect | Tri;

type Sq1 = { tag: 1; s: number };
type Rect1 = { tag: 2; h: number; s: number };
type Tri1 = { tag: 3; a: number; b: number; s: number };
type Shape1 = Sq1 | Rect1 | Tri1;

function makeSq(s: number): Sq {
  return { kind: "sq", s };
}
function makeRect(h: number, s: number): Rect {
  return { kind: "rect", h, s };
}
function makeTri(a: number, b: number, s: number): Tri {
  return { kind: "tri", a, b, s };
}
function makeSq1(s: number): Sq1 {
  return { tag: 1, s };
}
function makeRect1(h: number, s: number): Rect1 {
  return { tag: 2, h, s };
}
function makeTri1(a: number, b: number, s: number): Tri1 {
  return { tag: 3, a, b, s };
}

function sumOfSides(list: Sq[], rounds: number): number {
  let r = 0;
  for (let i = 0; i < rounds; i++) r = (r + list[i & 63].s) | 0;
  return r;
}
function sumOfSides1(list: Sq1[], rounds: number): number {
  let r = 0;
  for (let i = 0; i < rounds; i++) r = (r + list[i & 63].s) | 0;
  return r;
}
function area(x: Shape): number {
  switch (x.kind) {
    case "sq":
      return x.s * x.s;
    case "rect":
      return x.s * x.h;
    default:
      return x.a * x.b + x.s;
  }
}
function area1(x: Shape1): number {
  switch (x.tag) {
    case 1:
      return x.s * x.s;
    case 2:
      return x.s * x.h;
    default:
      return x.a * x.b + x.s;
  }
}
function sumOfAreas(list: Shape[], rounds: number): number {
  let r = 0;
  for (let i = 0; i < rounds; i++) r = (r + area(list[i & 63])) | 0;
  return r;
}
function sumOfAreas1(list: Shape1[], rounds: number): number {
  let r = 0;
  for (let i = 0; i < rounds; i++) r = (r + area1(list[i & 63])) | 0;
  return r;
}

// Fields declared `any`: one that every allocation fills, one that is left out and stored later.
type Asked = { url: any; extra?: any };
function makeRequest(url: any): Asked {
  return { url };
}
function tagRequest(r: Asked, v: any): void {
  r.extra = v;
}
function extraOf(r: Asked): any {
  return r.extra;
}
// The same names with another letter in front, in objects that stay at home.
type Home = { hurl: any; hextra?: any };
function makeHome(hurl: any): Home {
  return { hurl };
}
function tagHome(r: Home, v: any): void {
  r.hextra = v;
}
function hextraOf(r: Home): any {
  return r.hextra;
}

const squares: Sq[] = [];
const squares1: Sq1[] = [];
const shapes: Shape[] = [];
const shapes1: Shape1[] = [];
for (let i = 0; i < 64; i++) {
  squares.push(makeSq(i));
  squares1.push(makeSq1(i));
  shapes.push(i % 3 === 0 ? makeSq(i) : i % 3 === 1 ? makeRect(i, 2) : makeTri(i, 2, 3));
  shapes1.push(i % 3 === 0 ? makeSq1(i) : i % 3 === 1 ? makeRect1(i, 2) : makeTri1(i, 2, 3));
}
// Whatever lies on the global object is in anybody's hands.
world.squares = squares;
world.squares1 = squares1;
world.shapes = shapes;
world.shapes1 = shapes1;
world.functions = [sumOfSides, sumOfSides1, sumOfAreas, sumOfAreas1, area, area1, tagRequest, extraOf, makeRequest];

const request = makeRequest("/a");
world.request = request;
console.log(extraOf(request));
tagRequest(request, 7);
console.log(extraOf(request), extraOf(makeRequest("/b")));
const home = makeHome("/a");
console.log(hextraOf(home));
tagHome(home, 7);
console.log(hextraOf(home), hextraOf(makeHome("/b")));

const which = process.env.KERNEL ?? "";
const rounds = which === "" ? 64 : 4_000_000;
if (which === "" || which === "sides") console.log(sumOfSides(world.squares, rounds));
if (which === "" || which === "sides1") console.log(sumOfSides1(world.squares1, rounds));
if (which === "" || which === "areas") console.log(sumOfAreas(world.shapes, rounds));
if (which === "" || which === "areas1") console.log(sumOfAreas1(world.shapes1, rounds));
export {};
