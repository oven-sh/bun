const out = typeof print === "function" ? print : console.log;
const s = v => JSON.stringify(v);
// Angle B option-free repro: deep nesting forces a JIT bail AFTER mirroring/renumbering.
const D = "(?:".repeat(20000) + "a" + ")".repeat(20000);
let r;
try { r = new RegExp("(?<=xy(?=z)z)!|" + D).exec("xyz!"); out("deep-nest fallback (?<=xy(?=z)z)!  -> " + s(r && [r.index, r[0]])); } catch (e) { out("deep-nest THREW " + e.message); }
try { r = new RegExp("(?<=xyz)!|" + D).exec("xyz!"); out("deep-nest control (?<=xyz)!     -> " + s(r && [r.index, r[0]])); } catch (e) { out("control THREW " + e.message); }
