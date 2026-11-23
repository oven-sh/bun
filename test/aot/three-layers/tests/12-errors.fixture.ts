import { check } from "../src/show";
import { thrower, guarded, PkgError } from "fake-shapes";
import { describeUnknown } from "fake-typed";
import { AppError } from "../src/models";
const F = "12";
class TestError extends AppError { constructor() { super("from the test", { at: "test" }); this.name = "TestError"; } }
const frames = (e: unknown) => String((e as Error).stack).split("\n").slice(0, 4).map(line => line.replace(/\(.*[\\/]/, "(").replace(/at .*[\\/]/, "at ").replace(/:\d+:\d+/g, ":L:C").trim());
check(F, "kinds", () => ["pkg", "type", "range", "deep", "none"].map(kind => { try { return thrower(kind); } catch (e) { return [e instanceof PkgError, e instanceof Error, (e as Error).name, (e as Error).constructor.name]; } }));
check(F, "values that are no errors", () => [1, "s", null, undefined, { a: 1 }, Symbol.for("x")].map(v => { try { return thrower("value", v); } catch (e) { return [e === v, typeof e]; } }));
check(F, "subclasses", () => { const e = new TestError(); return [e, e.summary, e.code, e.layer, e.detail, e instanceof TestError, e instanceof AppError, e instanceof PkgError, e instanceof Error, String(e), Object.prototype.toString.call(e), describeUnknown(e), Object.keys(e)]; });
check(F, "through the package and back", () => { const log: string[] = []; try { guarded(() => guarded(() => { throw new TestError(); }, log), log); } catch (e) { log.push("outer " + (e as Error).name); } return log; });
check(F, "a callback that throws under package frames", () => { try { return thrower("callback", () => { throw new AppError("cb", { at: "cb" }); }); } catch (e) { return [(e as AppError).summary, frames(e).length > 1]; } });
check(F, "names in the stack", () => { try { thrower("deep"); } catch (e) { return frames(e); } });
check(F, "names in the stack from here", () => { function outer() { return inner(); } function inner() { return thrower("pkg"); } try { outer(); } catch (e) { return frames(e); } });
check(F, "cause", () => { const inner = new PkgError("inner", 1); const e = new PkgError("outer", 2, { cause: inner }); return [e, e.cause === inner, new Error("x", { cause: new TestError() })]; });
check(F, "finally overrides", () => { const f = () => { try { return thrower("pkg"); } finally { return "from finally"; } }; const g = () => { for (const kind of ["pkg", "none"]) { try { return thrower(kind); } catch { continue; } finally { /* goes on */ } } return "end"; }; return [f(), g()]; });
check(F, "captureStackTrace and stackTraceLimit", () => { const o: { stack?: string } = {}; Error.captureStackTrace(o, check); const old = Error.stackTraceLimit; Error.stackTraceLimit = 1; let lines = 0; try { thrower("deep"); } catch (e) { lines = String((e as Error).stack).split("\n").length; } Error.stackTraceLimit = old; return [typeof o.stack, lines]; });
check(F, "stack overflow is caught", () => { const f = (n: number): number => thrower("callback", () => f(n + 1)) + 1; try { return f(0); } catch (e) { return [(e as Error).name, e instanceof RangeError]; } });
