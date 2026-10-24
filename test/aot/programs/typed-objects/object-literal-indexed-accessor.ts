// An object literal may have a getter and a setter under an index. Such an object is an ordinary one.
const both = { _0: 2, get 0() { return this._0; }, set 0(x: number) { this._0 = x; } };
both[0] **= both[0];
console.log(both[0], both._0, Object.keys(both).join());

const getterAlone = { held: "a", get 1() { return this.held + "!"; } };
console.log(getterAlone[1], getterAlone.held, Object.keys(getterAlone).join(), typeof Object.getOwnPropertyDescriptor(getterAlone, 1)!.get);

const seen: number[] = [];
const setterAlone = { n: 1, set 2(x: number) { seen.push(x); } };
setterAlone[2] = 5;
console.log(seen.join(), setterAlone[2], setterAlone.n);

function make(start: number) { return { count: start, get 0() { return ++this.count; }, name: "made" }; }
const made = [make(1), make(10)];
console.log(made.map(one => one[0] + one[0]).join(), made.map(one => one.count + one.name).join());

interface Pair { first: number; readonly 0: number; }
const typed: Pair = { first: 7, get 0() { return this.first * 2; } };
function read(pair: Pair) { return pair.first + pair[0]; }
console.log(read(typed), read({ first: 1, 0: 1 }));

const named = { _x: 1, get x() { return this._x; }, set x(v: number) { this._x = v; } };
named.x += 4;
console.log(named.x, named._x, Object.keys(named).join());
