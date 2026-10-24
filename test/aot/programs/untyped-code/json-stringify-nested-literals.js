const writersFailed = () => Number(/(\d+)\tJSONWriterFailed/.exec(aotRuntimeCounters())[1]);
function measure(label, run) {
    const finished = (aotOperationCount("operationAOTJSONWriterFinish") - writersFailed());
    const handedOver = aotOperationCount("operationAOTJSONAppendValue");
    let text = "";
    for (let i = 0; i < 100; i++) text = run(i);
    console.log(label + ": " + text + ": " + ((aotOperationCount("operationAOTJSONWriterFinish") - writersFailed()) - finished) + " texts finished by compiled code, " + (aotOperationCount("operationAOTJSONAppendValue") - handedOver) + " values handed to the runtime");
}
let held;
function hold(value) { held = value; return value; }

measure("one within", i => JSON.stringify({ ok: true, data: { id: i | 0, on: (i & 1) === 0 } }));
measure("two within", i => JSON.stringify({ a: { x: i | 0 }, b: { y: (i | 0) + 1 } }));
measure("two levels down", i => JSON.stringify({ a: { b: { c: i | 0 } } }));
measure("three levels down", i => JSON.stringify({ a: { b: { c: { d: i | 0 } } } }));
measure("none within has members", () => JSON.stringify({ a: {}, b: {} }));
measure("undefined within", i => JSON.stringify({ a: { x: undefined, y: i | 0 }, b: { z: undefined } }));
measure("in constants", i => { const inner = { x: i | 0 }; const outer = { inner }; return JSON.stringify(outer); });
measure("stored to before it is held", i => { const inner = { x: i | 0 }; inner.y = 2; return JSON.stringify({ inner }); });

measure("stored to after it is held", i => { const inner = { x: i | 0 }; const outer = { inner }; inner.y = 2; return JSON.stringify(outer); });
measure("changed after it is held", i => { const inner = { x: i | 0 }; const outer = { inner }; inner.x = -1; return JSON.stringify(outer); });
measure("changed through what holds it", i => { const outer = { inner: { x: i | 0 } }; outer.inner.x = -1; return JSON.stringify(outer); });
measure("held twice", i => { const inner = { x: i | 0 }; return JSON.stringify({ a: inner, b: inner }); });
measure("kept elsewhere and changed there", i => { const inner = hold({ x: i | 0 }); held.late = 1; return JSON.stringify({ inner }); });
measure("kept elsewhere afterwards", i => { const inner = { x: i | 0 }; const text = JSON.stringify({ inner }); hold(inner); return text; });
measure("with toJSON within", i => JSON.stringify({ a: { x: i | 0, toJSON() { return "mine"; } } }));
measure("with an index within", i => JSON.stringify({ a: { b: 1, 0: i | 0 } }));
measure("with a getter within", i => JSON.stringify({ a: { get x() { return i | 0; } } }));
measure("one of two within", i => JSON.stringify({ a: i & 1 ? { odd: i | 0 } : { even: i | 0 } }));
measure("holds itself", i => { const inner = { x: i | 0 }; inner.self = inner; try { return JSON.stringify({ inner }); } catch (error) { return error.constructor.name; } });
