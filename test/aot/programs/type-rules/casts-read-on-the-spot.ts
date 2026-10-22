// `(x as T).p`, read on the spot, where T holds external data: the cast makes no view of x that outlives the read, so the type of x keeps its layout.
// IR+ ^layout L\d+ .*name="Message" .* representation=Typed
// IR+ ^layout L\d+ .*name="Note" .* representation=Typed
// IR+ ^layout L\d+ .*name="Crate" .* representation=Typed
// IR- ^layout L\d+ .*name="Lining" .* representation=Typed
// IR- ^layout L\d+ .*name="Letter" .* representation=Typed
// IR- ^layout L\d+ .*name="Parcel" .* representation=Typed
// IR- ^layout L\d+ .*name="Basket" .* representation=Typed
// IR- ^layout L\d+ .*name="Tool" .* representation=Typed
const say = (label: string, f: () => unknown): void => { let r: string; try { r = String(f()); } catch (e) { r = "throws " + (e as Error).name; } console.log(label + " ==> " + r); };
type Dictionary = Record<string, unknown>;
const parsed = JSON.parse('{"a":1}') as Dictionary;
say("external data of the type that is cast to", () => parsed.a);

interface Message { id: number; count: number }
const message: Message = { id: 7, count: 1 };
function countOfMessage(from: Message) { return from.count + 1; }
say("a primitive property is read through two casts", () => (message as unknown as Dictionary).id);
say("by a literal key", () => (message as unknown as Dictionary)["id"]);
say("through an optional chain", () => (message as unknown as Dictionary)?.id);
say("the type that was cast", () => countOfMessage(message));

type Note = { id: number; count: number; text: string };
const note: Note = { id: 8, count: 2, text: "n" };
function countOfNote(from: Note) { return from.count + 1; }
say("through one cast", () => (note as Dictionary).text);
say("the type that was cast once", () => countOfNote(note));

interface Crate { id: number; inner: Lining }
interface Lining { depth: number }
const crate: Crate = { id: 7, inner: { depth: 2 } };
function depthOfLining(from: Lining) { return from.depth + 1; }
say("an object is read through the cast and changed", () => { const lining = (crate as unknown as Dictionary).inner; (lining as Dictionary).depth = 5; return depthOfLining(crate.inner) + crate.id; });

interface Letter { id: number; count: number }
const letter: Letter = { id: 7, count: 1 };
function countOfLetter(from: Letter) { return from.count + 1; }
say("a store through the cast", () => { (letter as unknown as Dictionary).count = 5; return countOfLetter(letter); });

interface Parcel { id: number; count: number }
const parcel: Parcel = { id: 7, count: 1 };
function countOfParcel(from: Parcel) { return from.count + 1; }
const fill = (into: Dictionary) => { into.count = 5; };
say("the cast is passed on", () => { fill(parcel as unknown as Dictionary); return countOfParcel(parcel); });

interface Basket { id: number }
interface FullBasket extends Basket { extra: Lid }
interface Lid { size: number }
const full: FullBasket = { id: 7, extra: { size: 3 } };
const basket: Basket = full;
function sizeOfLid(from: Lid) { return from.size + 1; }
say("a property that the type does not declare", () => { const lid = (basket as unknown as Dictionary).extra; (lid as Dictionary).size = 5; return sizeOfLid(full.extra); });

interface Tool { id: number; use(): number }
const tool: Tool = { id: 7, use() { return this.id + 1; } };
type Calls = Record<string, () => unknown>;
const parsedCalls = JSON.parse("{}") as Calls;
say("external data of the type with calls", () => Object.keys(parsedCalls).length);
say("a method is called through the cast", () => (tool as unknown as Calls).use());
