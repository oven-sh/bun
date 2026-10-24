interface Row { port: number; host: string; tag?: string }
interface Inner { deep: number; label: string }
interface Holder { id: number; inner?: Inner }

const out: string[] = [];
function show(name: string, value: unknown): void { out.push(name + " " + JSON.stringify(value)); }
function weigh(row: Row): number { return row.port + row.host.length + (row.tag ? row.tag.length : 0); }

async function load(text: string): Promise<Row> { return JSON.parse(text); }
async function loadAs(text: string): Promise<Row> { return JSON.parse(text) as Row; }
async function loadBound(text: string): Promise<Row> { const row: Row = JSON.parse(text); return row; }

show("plain", weigh(await load('{"port":1,"host":"a"}')));
show("as", weigh(await loadAs('{"port":2,"host":"bb","tag":"t"}')));
show("bound", weigh(await loadBound('{"port":3,"host":"ccc"}')));

const withData = await load('{"port":4,"host":"d","then":5}');
show("then is a number", [weigh(withData), (withData as any).then]);
const withObject = await load('{"port":5,"host":"e","then":{"port":6,"host":"f"}}');
show("then is an object", [weigh(withObject), weigh((withObject as any).then)]);
const withList = await load('{"port":6,"host":"f","then":[1,2,3],"extra":{"deep":1,"label":"x"}}');
show("then is a list", [weigh(withList), (withList as any).then.length, (withList as any).extra.label]);

async function settleWith(row: Row): Promise<unknown> { return row; }
const made: Row = JSON.parse('{"port":7,"host":"g"}');
(made as any).then = function (this: Row, resolve: (value: unknown) => void) {
  this.port = this.port + 100;
  (this as any).host = 12;
  delete (this as any).then;
  resolve("called on " + this.port);
};
show("a function stored under then", await settleWith(made));
show("what it did to the record", [made.port, made.host, "then" in made]);

const second: Row = JSON.parse('{"port":8,"host":"h"}');
Object.defineProperty(second, "then", {
  configurable: true,
  get(this: Row) { this.port = -1; return undefined; },
});
show("a getter under then", weigh((await settleWith(second)) as Row));

class Later {
  constructor(public value: number) {}
  then(resolve: (value: number) => void): void { resolve(this.value * 2); }
}
async function either(index: number): Promise<unknown> {
  const row: Row = JSON.parse('{"port":9,"host":"i"}');
  const choices: unknown[] = [row, new Later(21), { then(resolve: (value: string) => void) { resolve("literal"); } }, [1, 2], "text", 3];
  return choices[index];
}
for (let index = 0; index < 6; index++) show("one of several " + index, await either(index));

async function oneOfMany(index: number): Promise<unknown> {
  const rows: unknown[] = [
    JSON.parse('{"port":1,"host":"a"}') as Row, { a: 1 }, { b: 2 }, { c: 3 }, { d: 4 }, { e: 5 }, { f: 6 }, { g: 7 }, { h: 8 }, { i: 9 },
    new Later(5),
  ];
  return rows[index];
}
show("one of many, the record", await oneOfMany(0));
show("one of many, the thenable", await oneOfMany(10));

const holder: Holder = JSON.parse('{"id":1,"inner":{"deep":2,"label":"in"},"other":{"deep":3,"label":"out"}}');
show("a record inside", [holder.inner!.deep, holder.inner!.label, ((holder as any).other as Inner).deep]);
show("resolved", weigh(await Promise.resolve(JSON.parse('{"port":10,"host":"j"}') as Row)));
show("executor", weigh(await new Promise<Row>(resolve => resolve(JSON.parse('{"port":11,"host":"k"}')))));
show("reaction", weigh(await Promise.resolve(0).then((): Row => JSON.parse('{"port":12,"host":"l"}'))));
show("all", (await Promise.all([load('{"port":13,"host":"m"}'), loadAs('{"port":14,"host":"n"}')])).map(weigh));

async function* rows(): AsyncGenerator<Row> { yield JSON.parse('{"port":15,"host":"o"}'); yield JSON.parse('{"port":16,"host":"p","tag":"q"}') as Row; }
for await (const row of rows()) show("yielded", weigh(row));

console.log(out.join("\n"));
