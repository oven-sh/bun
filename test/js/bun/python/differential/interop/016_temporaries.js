import m from "./016_temporaries.py";
import python from "bun:python";
const builtins = python.import("builtins");
const print = (...values) => console.log(values.map(String).join(" "));

let kept;
print("a view that JS keeps:", m.view_as_argument(v => { kept = v; }));
print("  it works:", String(kept.tobytes()), m.take());
kept.release();
print("  until JS releases it:", m.take());

print("a slice that JS keeps:", m.slice_as_argument(v => { kept = v; }));
print("  it works:", String(kept.tobytes()), m.take());
kept.release();
m.take();

print("a view that JS made and keeps:", m.view_from(() => (kept = m.make_view())));
print("  it works:", String(kept.tobytes()), m.take());
print("its method:", m.method_of_view_from(() => kept));
print("  it works:", String(kept.tobytes()), m.take());
kept.release();
print("  released:", m.take());

print("a view that JS got from the type:", m.view_from(() => (kept = builtins.memoryview(m.Exporter()))));
print("  it works:", String(kept.tobytes()), m.take());
kept.release();
m.take();

let generator;
print("a generator that JS made and keeps:", m.loop_over(() => (generator = m.gen("kept by JS"))));
print("  it goes on:", builtins.next(generator), m.take());
generator.close();
print("  until JS closes it:", m.take());

print("a loop that calls JS:", m.loop_and_call(() => 1));
print("a loop that JS throws out of:", m.loop_and_raise(() => { throw new Error("no"); }));
