// One function per place where an expression hides inside something that is not an expression: defaults and computed keys of patterns, of parameters, of a catch clause and a for-of head; the heritage, the keys, the fields, the static blocks and the accessors of a class.
const log: string[] = [];
function d1() { return "variable default"; } function d2() { return "array default"; } function d3() { return "k"; } function d4() { return "assignment default"; }
function d5() { return "parameter default"; } function d6() { return "k"; } function d7() { return "catch default"; } function d8() { return "for-of default"; }
function d9() { return "nested default"; } function d10() { return "k"; }
function c1() { return class { base() { return "heritage"; } }; } function c2() { return "computedMethod"; } function c3() { return "field"; } function c4() { return "static field"; }
function c5() { log.push("static block"); } function c6() { return "computedField"; } function c7() { return "accessor field"; } function c8() { return "computedGetter"; }
function c9() { return "private field"; } function c10() { return "parameter property"; }

const { a = d1() } = {} as { a?: string };
const [b = d2()] = [] as string[];
const { [d3()]: c } = { k: "computed key of a pattern" } as Record<string, string>;
let e: string | undefined;
({ e = d4() } = {} as { e?: string });
function f(value = d5(), { [d6()]: g }: Record<string, string> = { k: "computed key of a parameter" }) { return value + ", " + g; }
log.push(a, b, c, e!, f());
try { throw {}; } catch ({ message = d7() }: any) { log.push(message); }
for (const { h = d8() } of [{}] as { h?: string }[]) log.push(h);
const { i: { j = d9() } = {} } = {} as { i?: { j?: string } };
let l: string | undefined;
({ [d10()]: l } = { k: "computed key of an assignment" } as Record<string, string>);
log.push(j, l!);

class Everything extends c1() {
  [c2()]() { return "computed method"; }
  field = c3();
  static field = c4();
  static { c5(); }
  // @ts-ignore
  [c6()] = "computed field";
  accessor auto = c7();
  get [c8()]() { return "computed getter"; }
  #hidden = c9();
  hidden() { return this.#hidden; }
  constructor(public property = c10()) { super(); }
}
const all = new Everything() as any;
log.push(all.base(), all.computedMethod(), all.field, Everything.field, all.computedField, all.auto, all.computedGetter, all.hidden(), all.property);
console.log(log.join("\n"));
