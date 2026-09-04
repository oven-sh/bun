//@ runDefault("--validateICWatchpointLiveness=true", "--useConcurrentJIT=false", "--useAccessInlining=false", "--thresholdForJITAfterWarmUp=10", "--thresholdForOptimizeAfterWarmUp=100", "--thresholdForFTLOptimizeAfterWarmUp=1000")
"use strict";

const watched = { folded: 1 }; // the optimizing JIT watches this structure; transitioning it jettisons hot()

function getOnProto(o) {
    return o.onProto;
}
noInline(getOnProto);

function hot(o, key, v, callback) {
    o[key] = v + watched.folded + getOnProto(o); // put_by_val IC whose cases carry conditions keyed on the prototypes
    if (callback)
        callback();
    return o;
}
noInline(hot);

const base = {};
Object.defineProperty(base, "accessor", { get() { return 1; }, set(v) { }, configurable: true });
const box = { doomedProto: Object.create(base) }; // only ever referenced through the box, never from a live frame
box.doomedProto.onProto = 1;
const twinProto = Object.create(base);
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

function warmUp(n) {
    for (let i = 0; i < n; i++) {
        hot(makeChild(box.doomedProto, i & 1), (i & 1) ? "a" : "b", i);
        hot(makeChild(otherProto, i & 1), (i & 1) ? "a" : "b", i);
    }
}
noInline(warmUp);

warmUp(3000);
warmUp(2000); // fills the optimized hot()'s own ICs with cases whose conditions are keyed on doomedProto

hot(makeChild(otherProto, 0), "a", 1, function () {
    watched.extra = 1;      // jettisons the optimized hot() while its frame is on the stack
    box.doomedProto = null; // last reference
    fullGC();               // --validateICWatchpointLiveness crashes here if a live routine still watches doomedProto
    fullGC();
    twinProto.added = 1;    // fires the shared Structure's transition watchpoints
});
