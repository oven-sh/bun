// `Object.assign({}, source, ..)` in functions without a loop, written at several places alike. The new object is made of its first source: the last line counts that no such call fills an empty object property by property.
declare const aotOperationCount: undefined | ((name: string) => number);
interface Pair { a: number; b: string }
const typed: Pair = { a: 1, b: "b" };
const given: any = JSON.parse('{"x":1,"y":[2],"z":{"w":3}}');
const hidden: any = typed;
const rows: Record<string, () => any> = {
  literal: () => Object.assign({}, { more: 1 }),
  literalAgain: () => Object.assign({}, { more: 2 }),
  given: () => Object.assign({}, given),
  givenAgain: () => Object.assign({}, given),
  hidden: () => Object.assign({}, hidden),
  hiddenAgain: () => Object.assign({}, hidden),
  typed: () => Object.assign({}, typed),
  typedAgain: () => Object.assign({}, typed),
  givenAndLiteral: () => Object.assign({}, given, { more: 1 }),
  givenAndLiteralAgain: () => Object.assign({}, given, { more: 2 }),
  literalAndGiven: () => Object.assign({}, { x: "first" }, given),
  literalAndGivenAgain: () => Object.assign({}, { x: "once more" }, given),
  twice: () => Object.assign({}, given, given),
  twiceAgain: () => Object.assign({}, hidden, given),
  nothing: () => Object.assign({}, null, undefined),
  nothingAgain: () => Object.assign({}, undefined, null),
  primitives: () => Object.assign({}, "ab", 1, true),
  primitivesAgain: () => Object.assign({}, "cd", 2, false),
  kept: () => { const target = {}; const result = Object.assign(target, { more: 1 }); return [result === target, target]; },
  keptAgain: () => { const target = {}; const result = Object.assign(target, { more: 2 }); return [result === target, target]; },
  usedBefore: () => { const target: any = {}; target.first = 1; return Object.assign(target, { more: 1 }); },
  usedBeforeAgain: () => { const target: any = {}; target.first = 2; return Object.assign(target, { more: 2 }); },
  getter: () => { const seen: string[] = []; const result = Object.assign({}, { get a() { seen.push("a"); return 1; } }, { get b() { seen.push("b"); return 2; } }); return [result, seen]; },
  getterAgain: () => { const seen: string[] = []; const result = Object.assign({}, { get a() { seen.push("a2"); return 3; } }, { get b() { seen.push("b2"); return 4; } }); return [result, seen]; },
  throws: () => { try { return Object.assign({}, { get a(): number { throw new RangeError("no"); } }); } catch (e) { return (e as Error).name; } },
  throwsAgain: () => { try { return Object.assign({}, { get a(): number { throw new TypeError("no"); } }); } catch (e) { return (e as Error).name; } },
};
function run(row: string, count: number) { const f = rows[row]; let last: any; for (let i = count; i > 0; i--) last = f(); return last; }
for (const row of Object.keys(rows)) console.log(row + ":", JSON.stringify(run(row, 3)));
const fresh = run("given", 1);
fresh.x = 2; fresh.added = true;
console.log(JSON.stringify(given), JSON.stringify(run("given", 1)), Object.getPrototypeOf(fresh) === Object.prototype, fresh.y === given.y);
const counted = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const before = counted("operationAOTObjectAssignFrom");
for (const row of ["literal", "literalAgain", "given", "givenAgain"]) run(row, 500);
console.log(counted("operationAOTObjectAssignFrom") - before);
