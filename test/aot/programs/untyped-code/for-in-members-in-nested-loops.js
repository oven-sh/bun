// What is read by the key of a for-in loop is used in or behind a loop nested in the body, in code without types.
const table = { a() { return 1; }, b() { return 10; } };
let called = 0;
function callThrice(f) { for (let i = 0; i < 3; i++) called += f(); }
for (const key in table) callThrice(table[key]);
const numbers = { a: 5, b: 6 };
let sum = 0;
for (const key in numbers) { const value = numbers[key]; let i = 0; while (i < 3) { sum += value; i++; } }
var sloppy = 0;
for (var name in numbers) { var member = numbers[name]; for (var j = 0; j < 3; j++) sloppy += member; }
function total(object, laps) { let result = 0; for (const key in object) { const value = object[key]; for (let i = 0; i < laps; i++) result += value; } return result; }
function joined(object, laps) { let result = ""; for (const key in object) { if (!Object.prototype.hasOwnProperty.call(object, key)) continue; const value = object[key]; for (let i = 0; i < laps; i++) result += key + value; } return result; }
function deep(object) { let result = ""; for (const key in object) { const inner = object[key]; for (const other in inner) { const value = inner[other]; let i = 2; while (i--) result += key + other + value; } } return result; }
function Base() { this.own = 1; }
Base.prototype.inherited = 2;
function withGetter() { let reads = 0; const object = { get a() { return ++reads; }, b: 7 }; let result = ""; for (const key in object) { const value = object[key]; for (let i = 0; i < 2; i++) result += value; } return result + ":" + reads; }
function withProxy() { const seen = []; const object = new Proxy({ a: 1, b: 2 }, { get(target, key) { seen.push(String(key)); return target[key]; } }); let result = 0; for (const key in object) { const value = object[key]; for (let i = 0; i < 2; i++) result += value; } return result + ":" + seen.join(); }
function shapeChanges() { const object = { a: 1, b: 2, c: 3 }; let result = ""; for (const key in object) { const value = object[key]; for (let i = 0; i < 2; i++) { result += key + value; if (key === "a") { delete object.b; object.d = 4; } } } return result; }
console.log(called, sum, sloppy);
console.log(total({ p: 2, q: 3 }, 4), total({}, 4), total([4, 5], 2), total("ab", 2), total(null, 2), total(undefined, 2), total(new Base(), 3), total({ p: "s", q: 3 }, 2));
console.log(joined({ p: 2, q: 3 }, 2), joined(new Base(), 2), joined(Object.create({ up: 1 }), 2), deep({ a: { x: 1, y: 2 }, b: { z: 3 } }));
console.log(withGetter(), withProxy(), shapeChanges());
