// One property name is a string in three classes with different fields in front of it, a number in a fourth, never stored in a fifth and added late to a literal; it is read, tested, stored and deleted through unions of them. The output is that of plain Bun.
class First { value?: string; constructor(value?: string) { if (value !== undefined) this.value = value; } }
class Second { a = 1; value?: string; constructor(value?: string) { if (value !== undefined) this.value = value; } }
class Third { a = 1; b = 2; value?: string; constructor(value?: string) { if (value !== undefined) this.value = value; } }
class Count { value?: number; constructor(value?: number) { if (value !== undefined) this.value = value; } }
class NeverStored { a = 1; value?: string; }
interface Late { a: number; value?: string | number }
type Any = First | Second | Third | Count | NeverStored | Late;

function makeLate(value: string | number | undefined): Late { const o: Late = { a: 1 }; if (value !== undefined) o.value = value; return o; }
function read(o: Any): string { const v = o.value; return v === undefined ? "none" : typeof v + ":" + v; }
function has(o: Any): boolean { return o.value !== undefined; }
function owns(o: Any): boolean { return "value" in o; }
function readTexts(o: First | Second | Third): string { return o.value ?? "none"; }
function storeText(o: First | Second | Third, text: string | undefined): void { o.value = text; }
function storeAny(o: First | Second | Third | Count, index: number): void { if (o instanceof Count) o.value = index; else o.value = "s" + index; }

function make(): Any[] {
  return [
    new First("f"), new First(), new Second("s"), new Second(), new Third("t"), new Third(), new Count(7), new Count(0.5), new Count(), new NeverStored(),
    makeLate("l"), makeLate(3), makeLate(undefined),
  ];
}

let lines: string[] = [];
for (let round = 0; round < 300; round++) {
  lines = [];
  const objects = make();
  for (const o of objects) lines.push(read(o) + " " + has(o) + " " + owns(o));
  for (let i = 0; i < 6; i++) storeText(objects[i] as First | Second | Third, i % 3 === 0 ? undefined : "x" + i);
  for (let i = 0; i < 6; i++) lines.push(readTexts(objects[i] as First | Second | Third) + " " + Object.keys(objects[i]!).join());
  for (let i = 0; i < 9; i++) storeAny(objects[i] as First | Second | Third | Count, i);
  delete (objects[2] as Second).value;
  delete (objects[6] as Count).value;
  Object.freeze(objects[4]);
  try { storeText(objects[4] as Third, "frozen"); } catch (error) { lines.push((error as Error).constructor.name); }
  for (const o of objects) lines.push(read(o) + " " + owns(o) + " " + JSON.stringify(o));
}
console.log(lines.join("\n"));
