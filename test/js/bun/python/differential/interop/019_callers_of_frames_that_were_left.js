// The caller of a frame of Python's that an exception has left, with functions of JS among the callers. A frame of JS is not in the chain of f_back.
import m from "./019_callers_of_frames_that_were_left.py";
const print = (...values) => console.log(values.map(String).join(" "));
const through = f => f();
const throughTwo = f => through(f);
const rethrows = f => { try { f(); } catch (e) { throw e; } };
const withFinally = f => { try { f(); } finally { print("finally"); } };
for (const js of [through, throughTwo, rethrows, withFinally]) {
    for (const f of [m.raises, m.through_two]) {
        print(m.named(js, f));
        print(m.not_looked_at_then_named(js, f));
        print(m.asked_for(js, f));
    }
}
// JS catches.
for (const f of [m.raises, m.through_two, () => m.calls(through, m.through_two)]) {
    try {
        f();
    } catch (e) {
        print(m.look(e));
    }
}
// Python catches, does not look, and JS goes on.
print(m.catches_and_does_not_look(m.through_two), m.catches_and_does_not_look(() => through(m.through_two)));
