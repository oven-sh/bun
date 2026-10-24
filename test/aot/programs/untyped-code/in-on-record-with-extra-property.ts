// `in`, Object.hasOwn and hasOwnProperty, asked by untyped code of typed records, without and with a property that the type does not have. Where the answer follows from the object's Structure it is cached: the question does not enter the runtime every time.
declare const aotOperationCount: undefined | ((name: string) => number);
interface Point { x: number; y: number; name: string; note?: string }
function makeTyped(i: number): Point { return { x: i, y: i + 1, name: "p" }; }
function makeMarked(i: number): Point { const made: Point = { x: i, y: i + 1, name: "p" }; (made as unknown as Record<string, number>).mark = i; return made; }
const hasMark: (p: any) => any = function (p: any): any { return "mark" in p ? 1 : 0; };
const hasX: (p: any) => any = function (p: any): any { return "x" in p ? 1 : 0; };
const hasNote: (p: any) => any = function (p: any): any { return "note" in p ? 1 : 0; };
const hasOther: (p: any) => any = function (p: any): any { return "other" in p ? 1 : 0; };
const hasByKey: (p: any, k: any) => any = function (p: any, k: any): any { return k in p ? 1 : 0; };
const ownMark: (p: any) => any = function (p: any): any { return Object.hasOwn(p, "mark") ? 1 : 0; };
const ownX: (p: any) => any = function (p: any): any { return Object.hasOwn(p, "x") ? 1 : 0; };
const ownByMethod: (p: any) => any = function (p: any): any { return p.hasOwnProperty("mark") ? 1 : 0; };
const operations = ["operationAOTInByValAndCache", "operationAOTInByVal", "operationAOTInById", "operationAOTHasOwnProperty"];
const entered = (): number => { let n = 0; if (typeof aotOperationCount === "function") for (const name of operations) n += aotOperationCount(name); return n; };
const keys: string[] = JSON.parse('["mark","x","note","other"]');
for (const [kind, make] of [["typed", makeTyped], ["marked", makeMarked]] as const) {
  const objects: Point[] = [];
  for (let i = 0; i < 100; i++) objects.push(make(i));
  const tests: [string, (p: Point) => number][] = [["mark", hasMark], ["x", hasX], ["note", hasNote], ["other", hasOther], ["key mark", p => hasByKey(p, keys[0])], ["key x", p => hasByKey(p, keys[1])], ["key other", p => hasByKey(p, keys[3])], ["own mark", ownMark], ["own x", ownX], ["method", ownByMethod]];
  for (const [name, test] of tests) {
    let total = 0;
    for (const p of objects) total += test(p);
    const before = entered();
    for (let round = 0; round < 20; round++) for (const p of objects) total += test(p);
    console.log(kind, name, total, entered() - before < 50);
  }
}
interface Changing { x: number; y: number; name: string; memo?: string }
const hasMemo: (p: any) => any = function (p: any): any { return "memo" in p ? 1 : 0; };
function makeChanging(i: number): Changing { const made: Changing = { x: i, y: i + 1, name: "c" }; (made as unknown as Record<string, number>).mark = i; return made; }
function makeUnmarked(i: number): Changing { return { x: i, y: i + 1, name: "c" }; }
const changing = makeChanging(1), other = makeChanging(2), loose: any = changing;
const answers = (p: Changing): string => [hasMark(p), hasByKey(p, keys[0]), ownMark(p), ownByMethod(p), hasX(p), hasMemo(p)].join("");
for (let i = 0; i < 5; i++) answers(changing), answers(other);
console.log(answers(changing), answers(other));
delete loose.mark;
console.log(answers(changing), answers(other));
loose.second = 1;
console.log(answers(changing), answers(other));
loose.mark = 3;
console.log(answers(changing), answers(other), Object.keys(changing).join());
loose.memo = "n";
console.log(answers(changing), answers(other));
delete loose.memo;
console.log(answers(changing), answers(other));
Object.defineProperty(other, "mark", { get() { return 1; }, configurable: true });
console.log(answers(changing), answers(other));
delete (other as any).mark;
console.log(answers(changing), answers(other), answers(makeChanging(3)), answers(makeUnmarked(4)));
