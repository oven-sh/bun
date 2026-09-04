//@ requireOptions("--validateICWatchpointLiveness=true", "--useConcurrentJIT=false", "--thresholdForJITAfterWarmUp=10", "--thresholdForOptimizeAfterWarmUp=100", "--thresholdForFTLOptimizeAfterWarmUp=1000")
// An optimized CodeBlock that is jettisoned while one of its frames is live keeps its inline cache stub routines.
// Their structure-transition watchpoints are keyed on the prototype objects the access cases were built for; those
// objects must stay live (or the routine must be dropped) for as long as the watchpoints can fire.
"use strict";

const konst = { folded: 1 }; // the optimizing JIT watches konst's structure; transitioning it jettisons hot()

function getOnProto(o) {
    return o.onProto;
}
noInline(getOnProto); // keeps hot()'s optimized graph free of references to the children's structures

function hot(o, key, v, callback) {
    o[key] = v + konst.folded + getOnProto(o); // put_by_val IC whose cases carry conditions keyed on the prototypes
    if (callback)
        callback();
    return o;
}
noInline(hot);

const base = {};
Object.defineProperty(base, "accessor", { get() { return 1; }, set(v) { }, configurable: true });
let doomedProto = Object.create(base);
doomedProto.onProto = 1;
let twinProto = Object.create(base);
twinProto.onProto = 1;
Object.create(twinProto); // both are prototypes now, so they share a Structure

const otherProto = Object.create({});
otherProto.onProto = 2;

function makeChild(proto, shape) {
    const o = Object.create(proto);
    for (let i = 0; i < shape; i++)
        o["s" + i] = i;
    return o;
}
noInline(makeChild);

function drive(n, proto) {
    for (let i = 0; i < n; i++) {
        hot(makeChild(proto, i & 3), (i & 1) ? "a" : "b", i);
        hot(makeChild(otherProto, i & 3), (i & 1) ? "a" : "b", i);
    }
}
noInline(drive);

drive(3000, doomedProto);
drive(2000, doomedProto); // fills the optimized hot()'s own ICs with cases whose conditions are keyed on doomedProto

function gcAtDepth(n) { return n <= 0 ? fullGC() : 1 + gcAtDepth(n - 1); }
noInline(gcAtDepth);

hot(makeChild(otherProto, 0), "a", 1, function () {
    konst.extra = 1;    // jettisons the optimized hot() while its frame is on the stack
    doomedProto = null; // last reference
    // Collect from several stack depths so a stale copy of a pointer in a dead stack slot cannot keep the doomed
    // objects alive in every one of them. --validateICWatchpointLiveness crashes at the end of whichever GC collects
    // doomedProto if a live stub routine still watches it.
    for (const depth of [0, 3000, 250, 1500, 700])
        gcAtDepth(depth);
    twinProto.added = 1; // fires the shared Structure's transition watchpoints
});
