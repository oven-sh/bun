// A table typed by a mapped type over a union of names is filled by spreading the results of a generic helper.
type Name = "a.one" | "a.two" | "b.one" | "b.two" | "c.one";
interface ArgsOf { "a.one": { n: number }; "a.two": { s: string }; "b.one": { n: number; s: string }; "b.two": {}; "c.one": { flag: boolean } }
interface Site<E extends Name> { readonly event: E; readonly kind: "op" | "classic" | "own"; check(args: ArgsOf[E]): boolean }
function opSite<E extends Name>(event: E): Site<E> { return { event, kind: "op", check: () => true }; }
function classicSite<E extends Name>(event: E): Site<E> { return { event, kind: "classic", check: args => args !== undefined }; }
function tableOf<K extends Name>(names: readonly K[], make: <E extends K>(event: E) => Site<E>): { readonly [E in K]: Site<E> } {
  const table: { [name: string]: Site<K> } = {};
  for (const name of names) table[name] = make(name);
  return table as { readonly [E in K]: Site<E> };
}
const OPS = ["a.one", "a.two"] as const;
const CLASSIC = ["b.one", "b.two"] as const;
const OWN: Site<"c.one"> = { event: "c.one", kind: "own", check: args => args.flag };
export const RULES: { readonly [E in Name]: Site<E> } = {
  ...tableOf(OPS, opSite),
  ...tableOf(CLASSIC, classicSite),
  "c.one": OWN,
};
function siteOf<E extends Name>(event: E): Site<E> { return RULES[event]; }
console.log(Object.keys(RULES).join(), RULES["a.two"].event, RULES["b.one"].kind, siteOf("c.one").check({ flag: true }), siteOf("a.one").check({ n: 1 }));
