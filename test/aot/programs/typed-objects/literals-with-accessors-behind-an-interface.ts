// An object literal that mixes data properties and accessors, known to the rest of the program only through an interface.
interface Place { readonly start: string; readonly top: string }
interface Root { readonly owner: Owner; readonly id: string; readonly place: Place | null; readonly notes: string[]; level: number }
class Owner { readonly name = "owner"; count = 0; bump(): number { return ++this.count; } }

let reads = 0;
function makeRoot(owner: Owner, id: string): Root {
  const held: { place: { start: string; top: string } | null; level: number } = { place: { start: "/a", top: "/a/b" }, level: 1 };
  const place: Place = { get start() { reads++; return held.place!.start; }, get top() { return held.place!.top; } };
  const root: Root = {
    owner,
    get id() { reads++; return id; },
    get place() { return held.place === null ? null : place; },
    notes: [],
    get level() { return held.level; },
    set level(value: number) { held.level = value * 2; },
  };
  return root;
}
let binding: Root = makeRoot(new Owner(), "r1");
function current(): Root { return binding; }
function idOf(root: Root): string { return root.id; }
function startOf(root: Root): string | null { return root.place === null ? null : root.place.start; }
function raise(root: Root, by: number): number { root.level = root.level + by; return root.level; }

let sum = 0;
for (let i = 0; i < 1000; i++) { sum += idOf(current()).length + (startOf(current()) ?? "").length + current().owner.bump(); }
console.log("read in a loop", sum, reads, current().owner.count);
console.log("a setter", raise(current(), 1), raise(current(), 1), current().level);
console.log("keys", Object.keys(current()).join(), JSON.stringify(current()));
console.log("descriptors", typeof Object.getOwnPropertyDescriptor(current(), "id")!.get, Object.getOwnPropertyDescriptor(current(), "id")!.set, Object.getOwnPropertyDescriptor(current(), "owner")!.writable, Object.getOwnPropertyDescriptor(current(), "level")!.enumerable);
const copy: Root = { ...current() };
console.log("a copy holds values", typeof Object.getOwnPropertyDescriptor(copy, "id")!.get, copy.id, copy.level, copy.owner === current().owner, copy.place === current().place);
copy.level = 100;
console.log("a store to the copy", copy.level, current().level);
const heir: Root = Object.create(current());
console.log("inherited", heir.id, heir.level, Object.keys(heir).length, "id" in heir, Object.hasOwn(heir, "id"));
heir.level = 3;
console.log("the setter through an heir", heir.level, current().level, Object.hasOwn(heir, "level"));
const self = { base: 5, get twice() { return this.base * 2; }, get self() { return this; } };
const seen: { readonly base: number; readonly twice: number } = self;
console.log("this in a getter", seen.twice, self.self === self, Object.create(self, { base: { value: 7 } }).twice);
Object.defineProperty(current(), "id", { get() { return "redefined"; }, configurable: true, enumerable: true });
console.log("redefined", idOf(current()), current().id);
Object.defineProperty(current(), "id", { value: "plain", writable: true, configurable: true, enumerable: true });
console.log("made a data property", idOf(current()), Object.keys(current()).join());
delete (current() as { id?: string }).id;
console.log("deleted", idOf(current()), "id" in current(), Object.keys(current()).join());
const thrower: { readonly value: number } = { get value(): number { throw new RangeError("no value"); } };
try { console.log(thrower.value); } catch (error) { console.log("a getter that throws", (error as Error).name, (error as Error).message); }
const two: Root[] = [makeRoot(new Owner(), "a"), { owner: new Owner(), id: "b", place: null, notes: ["n"], level: 9 }];
console.log("beside a literal of data alone", two.map(idOf).join(), two.map(startOf).join(), two.map(root => raise(root, 1)).join(), two.map(root => root.notes.length).join());
binding = two[1]!;
console.log("the binding holds the other", idOf(current()), startOf(current()), current().level);
Object.freeze(two[0]);
console.log("frozen", Object.isFrozen(two[0]), two[0]!.id, raise(two[0]!, 1));
