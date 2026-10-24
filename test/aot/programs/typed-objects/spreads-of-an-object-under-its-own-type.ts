// `{ ...state, count }` written under the type of `state` copies whatever `state` is at run time: its own enumerable properties in their order, getters read once, nothing of its prototype, and the source stays as it was.
interface State { count: number; label: string; note?: string }
class Counter { count = 1; label = "class"; step() { return this.count; } }
function describe(value: object) {
  return JSON.stringify(value) + " " + Object.keys(value).join() + " " + (Object.getPrototypeOf(value) === Object.prototype);
}
function increment(state: State): State { return { ...state, count: state.count + 1 }; }
function relabel(state: State, label: string): State { return { ...state, label }; }
function both(state: State): State { return { ...state, label: "both", count: 0 }; }
function withNote(state: State): State { return { ...state, note: "noted" }; }
function copyOnly(state: State): State { return { ...state }; }
function twoSpreads(first: State, second: State): State { return { ...first, ...second }; }
function spreadThenSpread(first: State, second: State): State { return { ...first, note: "between", ...second }; }
function unannotated(state: State) { const next = { ...state, count: 5 }; return next; }
function computedBehind(state: State, key: string): State { return { ...state, [key]: 7 }; }
function maybe(state?: State): Partial<State> { return { ...state, count: 3 }; }

const plain: State = { count: 1, label: "plain" };
console.log(describe(increment(plain)), describe(plain));
console.log(describe(relabel(plain, "new")), describe(both(plain)), describe(withNote(plain)), describe(copyOnly(plain)));
console.log(copyOnly(plain) === plain, increment(plain) === plain);

const otherOrder: State = { label: "first", count: 2 };
console.log(describe(increment(otherOrder)), describe(both(otherOrder)));

const noted: State = { count: 3, label: "noted", note: "n" };
console.log(describe(increment(noted)), describe(withNote(noted)));

const wider = { count: 4, label: "wider", extra: true };
console.log(describe(increment(wider)), describe(relabel(wider, "w")));

let reads = 0;
const computed: State = { get count() { reads++; return 10; }, label: "getter" };
const fromGetter = increment(computed);
console.log(describe(fromGetter), reads, Object.getOwnPropertyDescriptor(fromGetter, "count")!.writable, typeof Object.getOwnPropertyDescriptor(copyOnly(computed), "count")!.get);

console.log(describe(increment(new Counter())), "step" in increment(new Counter()));

const hidden: State = { count: 5, label: "hidden" };
Object.defineProperty(hidden, "label", { enumerable: false });
console.log(describe(increment(hidden)));

const frozen: State = Object.freeze({ count: 6, label: "frozen" });
const thawed = increment(frozen);
thawed.label = "thawed";
console.log(describe(thawed), Object.isFrozen(thawed), describe(frozen));

const grown: State = { count: 7, label: "grown" };
(grown as any).late = 1;
delete (grown as any).label;
console.log(describe(increment(grown)), describe(relabel(grown, "back")));

const symbol = Symbol("s");
const withSymbol: State = { count: 8, label: "symbol" };
(withSymbol as any)[symbol] = "held";
console.log((increment(withSymbol) as any)[symbol], describe(increment(withSymbol)));

const inherits: State = Object.create({ count: 1, label: "inherited" });
console.log(describe(increment(inherits)));

const parsed: State = JSON.parse('{"label":"parsed","count":9,"more":[1]}');
console.log(describe(increment(parsed)));

console.log(describe(twoSpreads(plain, noted)), describe(spreadThenSpread(plain, otherOrder)), describe(unannotated(plain)));
console.log(describe(computedBehind(plain, "count")), describe(computedBehind(plain, "other")), describe(maybe()), describe(maybe(plain)));

let state: State = { count: 0, label: "loop" };
for (let i = 0; i < 5000; i++) state = i & 1 ? increment(state) : relabel(state, i & 2 ? "a" : "bc");
console.log(describe(state));
