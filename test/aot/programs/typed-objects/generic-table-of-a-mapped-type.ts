// A table typed by a mapped type over a union of names is filled by spreading the results of a generic helper.
type Name = "a.one" | "a.two" | "b.one" | "b.two" | "c.one";
interface Arguments { "a.one": { n: number }; "a.two": { s: string }; "b.one": { n: number; s: string }; "b.two": {}; "c.one": { flag: boolean } }
interface Entry<E extends Name> { readonly key: E; readonly kind: "plain" | "checked" | "own"; check(args: Arguments[E]): boolean }
function plainEntry<E extends Name>(key: E): Entry<E> { return { key, kind: "plain", check: () => true }; }
function checkedEntry<E extends Name>(key: E): Entry<E> { return { key, kind: "checked", check: args => args !== undefined }; }
function tableOf<K extends Name>(names: readonly K[], make: <E extends K>(key: E) => Entry<E>): { readonly [E in K]: Entry<E> } {
  const table: { [name: string]: Entry<K> } = {};
  for (const name of names) table[name] = make(name);
  return table as { readonly [E in K]: Entry<E> };
}
const PLAIN = ["a.one", "a.two"] as const;
const CHECKED = ["b.one", "b.two"] as const;
const OWN: Entry<"c.one"> = { key: "c.one", kind: "own", check: args => args.flag };
export const TABLE: { readonly [E in Name]: Entry<E> } = {
  ...tableOf(PLAIN, plainEntry),
  ...tableOf(CHECKED, checkedEntry),
  "c.one": OWN,
};
function entryOf<E extends Name>(key: E): Entry<E> { return TABLE[key]; }
console.log(Object.keys(TABLE).join(), TABLE["a.two"].key, TABLE["b.one"].kind, entryOf("c.one").check({ flag: true }), entryOf("a.one").check({ n: 1 }));
