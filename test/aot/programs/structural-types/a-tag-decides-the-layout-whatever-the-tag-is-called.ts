// `isRound(s)` reads the tag, and the tag says which layout the object has: the claim that the checker's narrowing brings behind the guard needs no test of its own. That holds whatever the
// tag is called. A structural type lists every layout that has its names, and the compiler's own library has layouts with a `kind` and a `name` (the context objects of decorators), which
// this program never allocates.
// The functions are also called with a value that nobody follows, so their parameters keep the types that are written.
// IRT= 0 areaByKind = TypeTest
// IRT= 0 areaByOwnName = TypeTest
interface Shape { kind: number }
interface Round extends Shape { kind: 1; r: number }
interface Wide extends Shape { kind: 2; w: number; h: number }
function isRound(s: Shape): s is Round { return s.kind === 1; }
function areaByKind(s: Shape) { return isRound(s) ? s.r * s.r * 3 : 0; }

interface Figure { tagOfFigure: number }
interface Circle extends Figure { tagOfFigure: 1; r: number }
interface Box extends Figure { tagOfFigure: 2; w: number; h: number }
function isCircle(f: Figure): f is Circle { return f.tagOfFigure === 1; }
function areaByOwnName(f: Figure) { return isCircle(f) ? f.r * f.r * 3 : 0; }

interface Named { name: string }
interface Short extends Named { name: "short"; text: string }
interface Long extends Named { name: "long"; parts: string[] }
function isShort(n: Named): n is Short { return n.name === "short"; }
function lengthByName(n: Named) { return isShort(n) ? n.text.length : -1; }

const stranger: any = JSON.parse(process.argv[2] ?? "null");
const every: any[] = [isRound, areaByKind, isCircle, areaByOwnName, isShort, lengthByName];
const strange: unknown[] = [];
if (stranger !== null) for (const f of every) strange.push(f(stranger));

const shapes: Shape[] = [], figures: Figure[] = [], names: Named[] = [];
for (let i = 0; i < 8; i++) {
  const shape: Round | Wide = i & 1 ? { kind: 1, r: i } : { kind: 2, w: i, h: 2 };
  const figure: Circle | Box = i & 1 ? { tagOfFigure: 1, r: i } : { tagOfFigure: 2, w: i, h: 2 };
  const named: Short | Long = i & 1 ? { name: "short", text: "t" + i } : { name: "long", parts: ["p"] };
  shapes.push(shape);
  figures.push(figure);
  names.push(named);
}
let sum = 0;
for (let i = 0; i < 4000; i++) sum += areaByKind(shapes[i & 7]) + areaByOwnName(figures[i & 7]) + lengthByName(names[i & 7]);
console.log(sum, strange.length);
