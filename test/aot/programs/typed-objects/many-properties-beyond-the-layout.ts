// Objects of declared types get more properties beyond their types than lie in line in what holds them: the seventh and later ones are stored, read, replaced and deleted like the first six.
const show = (label: string, value: unknown) => console.log(label + ": " + JSON.stringify(value));

class Request {
  url: unknown = "/";
  next: Request | null = null;
}
class Full {
  first: unknown = 1;
  second: unknown = 2;
}
interface Point {
  x: number;
  y: number;
}
const makers: [string, () => any][] = [
  ["Request", () => new Request()],
  ["Full", () => new Full()],
  ["Point", (): Point => ({ x: 1, y: 2 })],
  ["plain", () => ({ plain: true })],
];
function addAll(o: any, v: number) {
  o.a = v; o.b = v + 1; o.c = v + 2; o.d = v + 3; o.e = v + 4; o.f = v + 5; o.g = v + 6;
  o.h = { held: v }; o.i = "i" + v; o.j = [v]; o.k = v + 10; o.l = null; o.m = undefined; o.n = v + 13;
}
function addOne(o: any, name: number, v: unknown) {
  switch (name) {
    case 0: o.p0 = v; break;
    case 1: o.p1 = v; break;
    case 2: o.p2 = v; break;
    case 3: o.p3 = v; break;
    case 4: o.p4 = v; break;
    case 5: o.p5 = v; break;
    case 6: o.p6 = v; break;
    case 7: o.p7 = v; break;
    case 8: o.p8 = v; break;
    default: o.p9 = v;
  }
}
function readAll(o: any): unknown[] {
  return [o.a, o.b, o.c, o.d, o.e, o.f, o.g, o.h, o.i, o.j, o.k, o.l, String(o.m), o.n, String(o.missing)];
}
function readSome(o: any): unknown[] {
  return [o.p0, o.p5, o.p6, o.p7, o.p8, o.p9].map(String);
}
for (const [label, make] of makers) {
  console.log("== " + label);
  const kept: any[] = [];
  for (let round = 0; round < 5; round++) {
    const o = make();
    addAll(o, round);
    kept.push(o);
    show("added " + round, [readAll(o), Object.keys(o).join()]);
    addAll(o, round + 100);
    show("replaced " + round, readAll(o));
  }
  for (let round = 0; round < 4; round++) {
    const o = make();
    for (let name = 0; name < 10; name++) {
      addOne(o, (name + round * 3) % 10, name);
      if (name === 6 + (round % 2)) show("partly " + round, [readSome(o), Object.keys(o).join()]);
    }
    delete o.p6;
    delete o.p0;
    show("deleted " + round, [readSome(o), Object.keys(o).join()]);
    addOne(o, 6, "again");
    addOne(o, 0, "again");
    show("added again " + round, [readSome(o), Object.keys(o).join(), JSON.stringify(o).length]);
    kept.push(o);
  }
  const many: any[] = [];
  for (let i = 0; i < 3000; i++) {
    const o = make();
    addAll(o, i);
    if (i % 3 === 0) for (let name = 0; name < 10; name++) addOne(o, name, { of: i });
    if (i % 100 === 7) many.push(o);
  }
  let sum = 0;
  for (const o of many) sum += o.a + o.g + o.h.held + o.n + Object.keys(o).length + (o.p9 ? o.p9.of : 0);
  show("many", sum);
  show("kept", kept.map(o => Object.keys(o).length));
  const frozen = make();
  addAll(frozen, 1);
  Object.freeze(frozen);
  let threw = 0;
  for (let i = 0; i < 3; i++) {
    try {
      addAll(frozen, 2);
    } catch {
      threw++;
    }
  }
  show("frozen", [threw, readAll(frozen)]);
}
