function throwsValue() { throw 1; }
function catchesValue() { try { throwsValue(); } catch (e) { return 1; } return 0; }
// Only the throws are timed, not the calls that lead down to them.
function atDepth(depth, count) {
    if (depth > 0)
        return atDepth(depth - 1, count) + 0;
    const start = preciseTime();
    let sum = 0;
    for (let i = 0; i < count; i++)
        sum += catchesValue();
    if (sum !== count)
        throw new Error("wrong count");
    return preciseTime() - start;
}
function secondsFor(depth) {
    let best = Infinity;
    for (let i = 0; i < 3; i++)
        best = Math.min(best, atDepth(depth, 20000));
    return best;
}
const shallow = secondsFor(200);
const deep = secondsFor(20000);
if (deep > shallow * 6)
    throw new Error("a throw costs " + (deep / shallow).toFixed(1) + " times as much below 20000 frames as below 200");
console.log("passed");
