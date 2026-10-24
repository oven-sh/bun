// `{ ...state, label }` written under the type of `state` copies the record. One such copy in the program takes nothing from the objects that plain literals make: a read through the type has no test for an empty slot.
// IRT= 0 readState IsSlotFilled
// IRT= 0 readState GetSlotOrUndefined
// IRT= 0 readState = TypeTest
interface State { count: number; label: string }
function makeState(count: number, label: string): State { return { count, label }; }
function relabel(state: State, label: string): State { return { ...state, label }; }
function readState(state: State) { return state.count + state.label.length; }

const stranger: any = JSON.parse(process.argv[2] ?? "null");
try { console.log(readState(stranger)); } catch { console.log("threw"); }
const states: State[] = [];
for (let i = 0; i < 300; i++) states.push(makeState(i, i & 1 ? "ab" : "abc"));
states[0] = relabel(makeState(0, "a"), "abcd");
let sum = 0;
for (let round = 0; round < 20; round++) {
  for (let i = 0; i < 300; i++) sum += readState(states[i]);
}
console.log(sum, JSON.stringify(states[0]), Object.keys(states[0]).join());
