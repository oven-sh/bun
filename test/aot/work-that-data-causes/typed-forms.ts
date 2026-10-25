// typed-forms.ts <form> <n>: as forms.js, for objects whose types are declared: their members come, go and are listed in orders that the data chooses.
type Ten = { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number; g?: number; h?: number; i?: number; j?: number };
type Name = keyof Ten;
const letters: Name[] = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
function order(number: number): Name[] {
  const left = [...letters];
  const out: Name[] = [];
  for (let size = left.length; size > 0; size--) {
    out.push(left.splice(number % size, 1)[0]);
    number = Math.floor(number / size);
  }
  return out;
}
const textOf = (names: string[]) => "{" + names.map((name, at) => JSON.stringify(name) + ":" + at).join(",") + "}";
const everyOrder = (n: number) => Array.from({ length: n }, (_, at) => order(at));
function madeIn(names: Name[]): Ten {
  const made: Ten = {};
  for (const name of names) made[name] = 1;
  return made;
}
const full = (): Ten => ({ a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7, i: 8, j: 9 });
class Point {
  x = 0;
  y = 0;
}
class Holder {
  a = 0;
  j = 0;
  constructor(from: Ten) {
    Object.assign(this, from);
  }
}
// An instance with n names from outside, and a field that was created again behind them: in the order of the keys the names stand between two fields.
function namesInFrontOfField(n: number) {
  const made = new Point() as Point & Record<string, number>;
  const names = Array.from({ length: n }, (_, at) => "id" + at);
  for (const name of names) made[name] = 1;
  delete (made as Partial<Point>).y;
  made.y = 1;
  return { made, names };
}
function removeAll({ made, names }: ReturnType<typeof namesInFrontOfField>, placeOf: (turn: number) => number) {
  for (let turn = 0; turn < names.length; turn++) delete made[names[placeOf(turn)]];
  return Object.keys(made).join();
}

// What is made ready, then the work that is timed.
const form = <Ready,>(prepare: (n: number) => Ready, work: (ready: Ready) => unknown) => (n: number) => {
  const ready = prepare(n);
  return () => work(ready);
};
const forms: Record<string, (n: number) => () => unknown> = {
  "optional members written in every order": form(n => everyOrder(n), lists => lists.map(madeIn).length),
  "members deleted and written again in every order": form(n => everyOrder(n), lists => lists.map(names => { const made = full(); for (const name of names) { delete made[name]; made[name] = 1; } return made; }).length),
  "members deleted in every order": form(n => everyOrder(n), lists => lists.map(names => { const made = full(); for (const name of names.slice(0, 5)) delete made[name]; return made; }).length),
  "JSON.parse into Ten: orders, a text an object": form(n => everyOrder(n).map(textOf), texts => texts.map((text): Ten => JSON.parse(text)).length),
  "JSON.parse as Ten[]: orders, one text": form(n => "[" + everyOrder(n).map(textOf).join(",") + "]", text => (JSON.parse(text) as Ten[]).length),
  "JSON.parse as Ten: orders": form(n => everyOrder(n).map(textOf), texts => texts.map(text => JSON.parse(text) as Ten).reduce((sum, value) => sum + value.a! + value.j!, 0)),
  "JSON.stringify: made in every order": form(n => everyOrder(n).map(madeIn), list => list.reduce((sum, value) => sum + JSON.stringify(value).length, 0)),
  "Object.keys: made in every order": form(n => everyOrder(n).map(madeIn), list => list.reduce((sum, value) => sum + Object.keys(value).length, 0)),
  "for-in: made in every order": form(n => everyOrder(n).map(madeIn), list => list.reduce((sum, value) => { for (const key in value) sum += value[key as Name]!; return sum; }, 0)),
  "spread: made in every order": form(n => everyOrder(n).map(madeIn), list => list.map((value): Ten => ({ ...value })).length),
  "rest: made in every order": form(n => everyOrder(n).map(madeIn), list => list.map(({ a, ...rest }) => rest).length),
  "Object.assign to a typed literal: orders from a text": form(n => everyOrder(n).map(names => JSON.parse(textOf(names)) as Ten), list => list.map(value => Object.assign(full(), value)).length),
  "Object.assign in a constructor: orders from a text": form(n => everyOrder(n).map(names => JSON.parse(textOf(names)) as Ten), list => list.map(value => new Holder(value)).length),
  "names from outside on instances: every order": form(n => everyOrder(n), lists => lists.map(names => { const made = new Point() as Point & Record<string, number>; for (const name of names) made[name] = 1; return made; }).length),
  "names from outside on instances: a new name each": form(n => Array.from({ length: n }, (_, at) => "id" + at), names => names.map(name => { const made = new Point() as Point & Record<string, number>; made[name] = 1; return made; }).length),
  "names from outside on one instance": form(n => Array.from({ length: n }, (_, at) => "id" + at), names => { const made = new Point() as Point & Record<string, number>; for (const name of names) made[name] = 1; return Object.keys(made).length; }),
  "a record filled with n names": form(n => Array.from({ length: n }, (_, at) => "id" + at), names => { const made: Record<string, number> = {}; for (const name of names) made[name] = 1; let sum = 0; for (const name of names) sum += made[name]; return sum; }),
  "n records of ten names in every order": form(n => everyOrder(n), lists => lists.map(names => { const made: Record<string, number> = {}; for (const name of names) made[name] = 1; return made; }).length),
  "Object.fromEntries to a record: orders": form(n => everyOrder(n).map(names => names.map((name, at): [string, number] => [name, at])), lists => lists.map((list): Record<string, number> => Object.fromEntries(list)).length),
  "read by a written name: made in every order": form(n => everyOrder(n).map(madeIn), list => list.reduce((sum, value) => sum + value.a! + value.j!, 0)),
  "Object.freeze: made in every order": form(n => everyOrder(n).map(madeIn), list => list.forEach(value => void Object.freeze(value))),
  "structuredClone: made in every order": form(n => everyOrder(n).map(madeIn), list => structuredClone(list).length),
  "names in front of a field are removed: the last one first": form(namesInFrontOfField, ready => removeAll(ready, turn => ready.names.length - 1 - turn)),
  "names in front of a field are removed: the first one first": form(namesInFrontOfField, ready => removeAll(ready, turn => turn)),
  "names in front of a field are removed: here and there": form(namesInFrontOfField, ready => removeAll(ready, turn => (turn * 7919) % ready.names.length)),
  "names in front of a field stay: another one comes and goes": form(namesInFrontOfField, ({ made, names }) => { for (const name of names) { made["late" + name] = 1; delete made["late" + name]; } return Object.keys(made).length; }),
  "a name comes and a field is created again behind it": form(n => Array.from({ length: n }, (_, at) => "id" + at), names => { const made = new Point() as Point & Record<string, number>; for (const name of names) { made[name] = 1; delete (made as Partial<Point>).y; made.y = 1; } return Object.keys(made).length; }),
  "a name comes and two fields are created again behind it": form(n => Array.from({ length: n }, (_, at) => "id" + at), names => { const made = new Point() as Point & Record<string, number>; for (const name of names) { made[name] = 1; delete (made as Partial<Point>).x; delete (made as Partial<Point>).y; made.y = 1; made["late" + name] = 1; made.x = 1; } return Object.keys(made).slice(-3).join(); }),
  "Map<string, Ten> of n names": form(n => Array.from({ length: n }, (_, at) => "id" + at), names => { const map = new Map<string, Ten>(); for (const name of names) map.set(name, full()); return map.size; }),
};

const [name, count] = process.argv.slice(2);
if (!name) {
  console.log(Object.keys(forms).join("\n"));
} else {
  const work = forms[name](Number(count));
  const began = performance.now();
  const answer = work();
  console.log((performance.now() - began).toFixed(1), String(answer));
}
