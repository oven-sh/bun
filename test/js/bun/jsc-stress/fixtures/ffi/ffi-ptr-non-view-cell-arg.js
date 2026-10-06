//@ requireOptions("--useDollarVM=1")
// Pointer-family arguments that are cells but not typed array views (ArrayBuffer, BigInt, strings,
// objects with a `ptr` property) must take the generic conversion path in every tier. The FTL
// inline path used to load JSArrayBufferView::m_mode from the argument before checking that it
// was a view, reading past the end of smaller cells (and off the end of the MarkedBlock when the
// cell was the last one in it). Feed freshly allocated small cells through an FTL-hot call site
// and compare against a noDFG oracle.
if (!$vm.useJIT()) quit();

const identity = $vm.ffiFunction({ args: ["ptr"], returns: "ptr" }, $vm.ffiFixture("ffi_ptr_identity"), "ffi_ptr_identity");
function ref(v) { try { return identity(v); } catch (e) { return "threw:" + e.constructor.name; } }
function hot(v) { try { return identity(v); } catch (e) { return "threw:" + e.constructor.name; } }
noDFG(ref); noInline(ref); noInline(hot);

let failures = 0;
const check = (l, got, want) => { if (!Object.is(got, want)) { print(`FAIL ${l}: got ${String(got)} want ${String(want)}`); if (++failures > 8) throw new Error("too many"); } };

// Warm the call site with a view so the optimizing tiers emit the inline view path.
const view = new Uint8Array(16);
for (let i = 0; i < testLoopCount; ++i)
    check(`warm#${i}`, hot(view), ref(view));

const keep = [];
for (let round = 0; round < 40; ++round) {
    // Many small cells so plenty of them end up as the last cell of a MarkedBlock; drop most and
    // collect so neighbouring blocks can be released.
    const buffers = [];
    for (let i = 0; i < 20000; ++i)
        buffers.push(new ArrayBuffer(8));
    for (let i = 0; i < buffers.length; ++i) {
        if (i % 8)
            buffers[i] = null;
    }
    gc();
    for (let i = 0; i < buffers.length; i += 8)
        check(`arraybuffer#${round}.${i}`, hot(buffers[i]), ref(buffers[i]));
    check(`bigint#${round}`, hot(4294967297n), ref(4294967297n));
    check(`object#${round}`, hot({ ptr: 16 }), ref({ ptr: 16 }));
    check(`string#${round}`, hot("not a pointer"), ref("not a pointer"));
    keep.push(buffers[0]);
}
if (failures) throw new Error(`${failures} failure(s)`);
