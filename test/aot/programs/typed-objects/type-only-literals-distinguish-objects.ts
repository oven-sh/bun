// Objects are made as the parts of a union whose string literal types no expression of the program spells: the texts are put together while the program runs. Plain data and wider records that hold such a text are told apart by it. A text that is none of the union's is read as it is.
const shift = Date.now() < 1 ? 1 : 0;
function spell(reversed: string): string {
  let text = "";
  for (let i = reversed.length - 1; i >= 0; i--) text += String.fromCharCode(reversed.charCodeAt(i) + shift);
  return text;
}
const square = spell("erauqs-delaes");
const triangle = spell("elgnairt-delaes");
const accented = spell("éfac-delaes");
const arrow = spell("→-delaes");

type Circle = { kind: "circle"; size: number };
type Square = { kind: "sealed-square"; size: number; side: number };
type Triangle = { kind: "sealed-triangle"; size: number; side: number; height: number };
type Accented = { kind: "sealed-café"; size: number; side: number };
type Arrow = { kind: "sealed-→"; size: number; side: number };
type Shape = Circle | Square | Triangle | Accented | Arrow;

function describe(shape: Shape): string {
  if (shape.kind === "circle") return "circle " + shape.size;
  const rest = "height" in shape ? "height " + shape.height : "flat";
  return shape.kind + " " + shape.size + " " + shape.side + " " + rest;
}
const circle: Circle = { kind: "circle", size: 1 };
const madeHere: Shape[] = [
  circle,
  { kind: square as "sealed-square", size: 2, side: 3 },
  { kind: triangle as "sealed-triangle", size: 4, side: 5, height: 6 },
  { kind: accented as "sealed-café", size: 7, side: 8 },
  { kind: arrow as "sealed-→", size: 10, side: 11 },
];
for (const shape of madeHere) console.log(describe(shape));

const parsed: any[] = JSON.parse(
  JSON.stringify([
    { kind: square, size: 1, side: 2 },
    { kind: "circle", size: 3 },
    { kind: triangle, size: 4, side: 5, height: 6 },
    { size: 7, side: 8, kind: square },
    { kind: accented, size: 9, side: 10 },
    { kind: arrow, size: 12, side: 13 },
  ]),
);
for (const one of parsed) console.log(describe(one), Object.keys(one).join());

class Holder {
  shape: Shape = circle;
}
const holder = new Holder();
const forms: string[] = [square, square.slice(0, 3) + square.slice(3), (arrow + square).slice(arrow.length), ("<" + square + ">").slice(1, -1)];
for (const kind of forms) {
  const typedStore: any = { kind, size: 1, side: 2 };
  holder.shape = typedStore;
  console.log(describe(holder.shape), holder.shape.kind === square);
  (holder as any).shape = { kind, size: 3, side: 4 };
  console.log(describe(holder.shape));
}
for (const kind of [accented, arrow, accented.slice(0, 2) + accented.slice(2), (arrow + accented).slice(arrow.length), arrow.slice(0, 2) + arrow.slice(2)]) {
  const data: any = { kind, size: 5, side: 6 };
  holder.shape = data;
  console.log(describe(holder.shape), JSON.stringify(holder.shape).length);
  console.log(describe(loose(kind, 7) as Shape));
}
const withHeight: any = { kind: triangle, size: 5, side: 6, height: 7 };
holder.shape = withHeight;
console.log(describe(holder.shape));

function loose(kind: string, size: number) {
  return { kind, size, side: size + 1 };
}
console.log(describe(loose(square, 3) as Shape));
console.log(describe(loose(forms[1], 4) as Shape));
try { console.log((loose(spell("erauqs-delaet"), 5) as Shape).kind.length); } catch (e) { console.log("a kind with another first letter:", (e as Error).constructor.name); }
try { console.log((loose(spell("erauqs-delae"), 6) as Shape).kind.length); } catch (e) { console.log("a kind without its first letter:", (e as Error).constructor.name); }

interface Tagged {
  tag: "sealed-tag";
  count: number;
}
const tag = spell("gat-delaes");
function show(tagged: Tagged): string {
  return tagged.tag + " " + tagged.count + " " + (tagged.tag === tag);
}
const tagged: Tagged = { tag: tag as "sealed-tag", count: 1 };
console.log(show(tagged));
(tagged as any).tag = tag.slice(0, 4) + tag.slice(4);
console.log(show(tagged));
(tagged as any).tag = spell("gat-delaet");
try { console.log(show(tagged)); } catch (e) { console.log("a tag with another first letter:", (e as Error).constructor.name); }

const stored = madeHere[1];
(stored as any).kind = forms[1];
console.log(describe(stored), describe({ ...stored }), describe(Object.assign({}, stored) as Shape));
