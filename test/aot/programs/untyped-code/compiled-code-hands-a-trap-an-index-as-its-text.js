// proxy[index] hands the get trap the index as a string. Compiled code takes the strings of small indexes from where they are kept and calls the trap itself. It asks the run time the first time, behind a collection, and for an index that is large, negative or no integer.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const asked = () => count("operationAOTGetByVal") + count("operationAOTGetByValAndCache") + count("operationAOTGetWithProxyTrap");
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const readAt = (object, index) => object[index];

function attempt(label, work) {
  let answer;
  try { answer = String(work()); } catch (error) { answer = "threw " + error.constructor.name + ": " + error.message; }
  console.log(label + ": " + answer);
}
function measure(label, read, bound) {
  for (let i = 0; i < 40; i++) read(i);
  const before = asked();
  let text = "";
  for (let i = 0; i < 1000; i++) text = String(read(i));
  console.log(label + ": " + text + " | " + (asked() - before <= bound));
}

const numbers = [10, 11, 12, 13, 14, 15, 16, 17];
const seen = new Set;
const noting = new Proxy(numbers, { get(target, key, receiver) { seen.add(typeof key + " " + String(key)); return target[key]; } });
measure("the trap reads the target", i => readAt(noting, i & 7) + readAt(noting, (i + 1) & 7), 20);
console.log([...seen].sort().join());
const handingOn = new Proxy(numbers, { get(target, key, receiver) { return Reflect.get(target, key, receiver); } });
measure("the trap hands on", i => readAt(handingOn, i & 7), 20);
measure("the trap answers by the key", i => readAt(measure.echo ??= new Proxy({}, { get(target, key) { return key + key.length; } }), i % 40), 20);
measure("a loop over a list behind a proxy", i => { let sum = 0; for (let at = 0; at < handingOn.length; at++) sum += handingOn[at]; return sum; }, 20);
measure("a constant index", i => handingOn[3] + noting[0], 20);
const many = new Proxy({}, { get(target, key) { return typeof key + key; } });
for (const index of [0, 9, 10, 99, 1023, 1024, 1025, 65536, 2147483647, 2147483648, 4294967294, 4294967295, 4294967296, -1, -0, 0.5, 1e21, NaN, Infinity, 7n, "7", "07", true, null])
  attempt("index " + (Object.is(index, -0) ? "-0" : typeof index + " " + String(index)), () => { let answer; for (let i = 0; i < 40; i++) answer = readAt(many, index); return answer; });
attempt("one string a small index", () => { const keys = []; const keeper = new Proxy({}, { get(target, key) { keys.push(key); return 0; } }); for (let i = 0; i < 40; i++) readAt(keeper, 5); return keys.every(key => key === "5") + " " + keys.length; });
attempt("behind collections", () => { let sum = 0; for (let round = 0; round < 5; round++) { collect(); for (let i = 0; i < 300; i++) sum += readAt(handingOn, i & 7) + Number(readAt(many, 200 + i).slice(6)); } return sum; });

// Whatever a proxy can be.
const bare = new Proxy(numbers, {});
measure("no trap", i => readAt(bare, i & 7), 2000);
attempt("no trap, past the end", () => [readAt(bare, 8), readAt(bare, 1000), readAt(new Proxy([, 1], {}), 0)].join());
const { proxy: revocable, revoke } = Proxy.revocable(numbers, { get(target, key) { return target[key]; } });
attempt("before it is revoked", () => { let sum = 0; for (let i = 0; i < 40; i++) sum += readAt(revocable, i & 7); return sum; });
revoke();
for (let round = 0; round < 3; round++) attempt("revoked", () => readAt(revocable, 1));
const frozen = new Proxy(Object.freeze([1, 2]), { get(target, key) { return key === "1" ? 5 : target[key]; } });
for (let round = 0; round < 3; round++) { attempt("a frozen target, the same value", () => readAt(frozen, 0)); attempt("a frozen target, another value", () => readAt(frozen, 1)); }
attempt("a trap that throws", () => { let caught = 0; const thrower = new Proxy([], { get(target, key) { throw new RangeError("no " + key); } }); for (let i = 0; i < 40; i++) try { readAt(thrower, i & 3); } catch (error) { if (error.message === "no " + (i & 3)) caught++; } return caught; });
attempt("a trap that is no function", () => readAt(new Proxy([], { get: 1 }), 0));
attempt("a proxy of a proxy", () => { let answer; const outer = new Proxy(noting, { get(target, key, receiver) { return target[key] + 100; } }); for (let i = 0; i < 40; i++) answer = readAt(outer, i & 7); return answer; });
attempt("a proxy above the receiver", () => { let answer; const heir = Object.create(many); for (let i = 0; i < 40; i++) answer = readAt(heir, i & 7); return answer; });
attempt("a proxy above an array", () => { let answer; const list = [1, , 3]; Object.setPrototypeOf(list, many); for (let i = 0; i < 40; i++) answer = [readAt(list, 0), readAt(list, 1), readAt(list, 5)].join(); return answer; });
attempt("bytes behind a proxy", () => { let sum = 0; const bytes = new Proxy(new Uint8Array([1, 2, 3]), { get(target, key) { return target[key]; } }); for (let i = 0; i < 40; i++) sum += readAt(bytes, i % 3); return sum + " " + readAt(bytes, 3); });
attempt("a text behind a proxy", () => { let text = ""; const letters = new Proxy(new String("abc"), { get(target, key) { return target[key]; } }); for (let i = 0; i < 40; i++) text = readAt(letters, i % 3) + readAt(letters, 3); return text; });
attempt("the same site meets other things", () => [readAt(numbers, 1), readAt("text", 1), readAt({ 1: "own" }, 1), readAt(noting, 1), readAt(new Uint8Array([4, 5]), 1), readAt(many, 1)].join());
