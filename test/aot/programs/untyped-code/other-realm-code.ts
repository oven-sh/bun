// Code that runs in another realm (node:vm contexts, ShadowRealm) has built-ins of its own and works beside the compiled program. One row differs from plain Bun: a ShadowRealm cannot import a module that was compiled, and Bun's own modules are: importValue throws a TypeError.
import vm from "node:vm";
import path from "node:path";
const out: string[] = [];
out.push("vm " + vm.runInNewContext("[1,2,3].map(x => x * k).join()", { k: 3 }));
const ctx = vm.createContext({ n: 2, log: (s: string) => out.push("fromctx " + s) });
vm.runInContext("function f(a) { return a * n } log(String(f(21))); class C { m() { return 'm' + n } } log(new C().m())", ctx);
out.push("script " + new vm.Script("n + 1").runInContext(ctx));
try { const r = new (globalThis as any).ShadowRealm(); out.push("shadow " + r.evaluate("[1,2,3].reduce((a, b) => a + b, 0)")); const f = r.evaluate("(x) => x * 2"); out.push("shadowfn " + f(21)); } catch (e: any) { out.push("shadow threw " + e?.name); }
try { const r = new (globalThis as any).ShadowRealm(); const v = await r.importValue("node:path", "sep"); out.push("shadowimport " + v); } catch (e: any) { out.push("shadowimport threw " + e?.name); }
out.push("path " + path.posix.join("a", "b"));
console.log(out.join("\n"));
