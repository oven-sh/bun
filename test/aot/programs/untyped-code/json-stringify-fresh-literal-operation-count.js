const writersFailed = () => Number(/(\d+)\tJSONWriterFailed/.exec(aotRuntimeCounters())[1]);
function measure(label, run) {
    const finished = (aotOperationCount("operationAOTJSONWriterFinish") - writersFailed());
    let text = "";
    for (let i = 0; i < 100; i++) text = run(i);
    console.log(label + ": " + text + ": " + ((aotOperationCount("operationAOTJSONWriterFinish") - writersFailed()) - finished) + " texts finished by compiled code");
}
const names = ["zero", "one", "two \"quoted\"", "three\n", "foür", "fïve 中"];
const kept = [];
function keep(value) { kept.push(value); if (kept.length > 4) kept.length = 0; return value; }
function change(value) { value.added = true; }
function nothing() {}
let held;
function hold(value) { held = value; }

measure("numbers, strings and booleans", i => JSON.stringify({ id: i, name: names[i % 6], ok: (i & 1) === 0, score: i * 0.5 }));
measure("no members", () => JSON.stringify({}));
measure("null and undefined", i => JSON.stringify({ a: null, b: undefined, c: i }));
measure("only undefined", () => JSON.stringify({ a: undefined, b: undefined }));
measure("undefined first", i => JSON.stringify({ a: undefined, b: i }));
measure("undefined now and then", i => JSON.stringify({ a: i & 1 ? i : undefined, b: i & 2 ? "b" : undefined, c: i & 4 ? true : undefined }));
measure("a function and a symbol", i => JSON.stringify({ a: nothing, b: Symbol.iterator, c: i }));
measure("not a number, infinity, minus zero", () => JSON.stringify({ a: NaN, b: Infinity, c: -0, d: -Infinity }));
measure("large and small numbers", i => JSON.stringify({ a: 1e21 + i, b: 1e-7, c: 2 ** 31 + i, d: -(2 ** 31), e: 0.1 + 0.2 }));
measure("an object within", i => JSON.stringify({ ok: true, data: { id: i, name: names[i % 6] } }));
measure("a list within", i => JSON.stringify({ total: 2, rows: [i, i + 1] }));
measure("an object from elsewhere within", i => JSON.stringify({ ok: true, data: keep({ id: i }) }));
measure("a date within", () => JSON.stringify({ at: new Date(0) }));
measure("a member with toJSON within", i => JSON.stringify({ a: { toJSON() { return i; } } }));
measure("in a constant", i => { const body = { id: i, ok: true }; return JSON.stringify(body); });
measure("used afterwards", i => { const body = { id: i }; const text = JSON.stringify(body); body.id = -1; keep(body); return text; });
measure("written twice", i => { const body = { id: i }; return JSON.stringify(body) + JSON.stringify(body); });

measure("a member stored afterwards", i => { const body = { id: i }; body.more = i + 1; return JSON.stringify(body); });
measure("a member changed", i => { const body = { id: i }; body.id = i + 1; return JSON.stringify(body); });
measure("a member deleted", i => { const body = { id: i, gone: 1 }; delete body.gone; return JSON.stringify(body); });
measure("handed to a function first", i => { const body = { id: i }; change(body); return JSON.stringify(body); });
measure("kept first", i => { const body = { id: i }; hold(body); held.late = 1; return JSON.stringify(body); });
measure("one of two", i => { const body = i & 1 ? { odd: i } : { even: i }; return JSON.stringify(body); });
measure("changed on one path", i => { const body = { id: i }; if (i & 1) body.odd = true; return JSON.stringify(body); });
measure("made before a loop", i => { const body = { id: i }; let text = ""; for (let k = 0; k < 2; k++) { text += JSON.stringify(body); body.id++; } return text; });
measure("a name twice", i => JSON.stringify({ a: 1, b: 2, a: i }));
measure("names that are indexes", i => JSON.stringify({ b: 1, 2: i, a: 3, 1: 4 }));
measure("a computed name", i => JSON.stringify({ ["k" + (i & 1)]: i, z: 1 }));
measure("a spread", i => JSON.stringify({ a: 1, ...{ b: i }, c: 3 }));
measure("a getter", i => JSON.stringify({ a: 1, get b() { return i; } }));
measure("a method", i => JSON.stringify({ a: i, b() {} }));
measure("__proto__ as a prototype", i => JSON.stringify({ a: i, __proto__: { inherited: 1 } }));
measure("__proto__ computed", i => JSON.stringify({ a: i, ["__proto__"]: 2 }));
measure("a member named toJSON", i => JSON.stringify({ a: i, toJSON() { return "mine"; } }));
measure("a name that must be escaped", i => JSON.stringify({ "a\"b": i, "c\n": 1, "é": 2 }));
measure("with a replacer", i => JSON.stringify({ a: i, b: 2 }, ["b"]));
measure("with a space", i => JSON.stringify({ a: i }, null, 1));
measure("a bigint throws", i => { try { return JSON.stringify({ a: i, b: 1n }); } catch (error) { return error.constructor.name; } });
measure("members evaluated in order", i => { const order = []; const text = JSON.stringify({ a: (order.push("a"), i), b: (order.push("b"), 2) }); return text + order.join(""); });
