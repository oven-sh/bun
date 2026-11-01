//@ requireOptions("--useDollarVM=1")
if (!$vm.useJIT()) quit();
// #2: FTL CallFFI stores topCallFrame but no CallSiteIndex. A callback invoked from inside the
// native call that THROWS then unwinds using the frame's STALE callSiteIndex (left by the last
// operation call in this FTL function). If an earlier try{} region installed a handler at that
// stale index, the exception is delivered to the WRONG catch -- one that does not enclose the call.
const callCbVoid = $vm.ffiFunction({ args: ["ptr"], returns: "void" }, $vm.ffiFixture("ffi_call_cb_void"), "call_cb_void");
const boom = $vm.ffiCallback({ args: [], returns: "void" }, () => { throw new RangeError("from-callback"); });
noInline(f);
function f(mode) {
  // An earlier try/catch that becomes an FTL exception-handler region + call site.
  try {
    if (mode === "early") throw new TypeError("early");   // exercises this handler
    JSON.parse('{"ok":true}');                             // an operation call inside the try (sets a callSiteIndex)
  } catch (e) {
    return "EARLY_HANDLER:" + e.constructor.name;           // must NEVER see the callback's RangeError
  }
  // The FFI call is OUTSIDE the try. Its callback throws. Correct behavior: it propagates OUT of f.
  callCbVoid(boom.ptr);
  return "no-exception";
}
let out;
for (let i = 0; i < 100000; ++i) {
  try {
    out = f("normal");
  } catch (e) {
    out = "PROPAGATED:" + e.constructor.name;               // <-- the ONLY correct outcome
  }
  if (out !== "PROPAGATED:RangeError") {
    throw new Error("WRONG at iteration " + i + ": " + out +
        "  (EARLY_HANDLER means the exception was routed to the try's stale handler)");
  }
}
if (out === "PROPAGATED:RangeError") print("OK: callback exception propagated correctly in all tiers");
