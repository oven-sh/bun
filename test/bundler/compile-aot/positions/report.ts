import { first, gen, viaCallbacks, capture, tagged } from "./lib/flow.ts";
import { Thing, thrower, Boom } from "./lib/shapes.ts";
const tidy = (s: unknown) => String(s).split("\n").map(l => l.trim()).filter(l => !/node:|native|bun:/.test(l)).join(" < ");
export async function report(): Promise<string[]> {
  const out: string[] = [];
  const t = async (name: string, f: () => unknown) => { try { await f(); out.push(name + " did not throw"); } catch (e: any) { out.push(name + " " + tidy(e.stack)); } };
  for (const kind of ["plain", "type", "range", "other"]) await t("sync-" + kind, () => thrower(kind));
  await t("async", () => first("plain"));
  await t("generator", () => [...gen(2)]);
  await t("callbacks", () => viaCallbacks([1, 2, 3]));
  await t("getter", () => Thing.make(0).broken);
  await t("ctor", () => new Thing({ depth: -1 }));
  await t("ctor-multiline", () =>
    new
      Thing(
        { depth: -2 }));
  await t("tagged", () => tagged`a${1}b`);
  await t("json", () => JSON.parse("{"));
  await t("nested-new", () => new (class Inner { constructor() { new Thing({ depth: -3 }); } })());
  await t("tdz", () => { const f = () => later; f(); let later = 1; });
  await t("rethrow", () => { try { thrower("plain"); } catch (e) { throw new Boom("again", 3); } });
  out.push("capture " + tidy(capture()));
  const prepare = Error.prepareStackTrace;
  Error.prepareStackTrace = (_e, sites) => sites.slice(0, 5).map(s => `${s.getFunctionName()}@${String(s.getFileName()).split("/").slice(-2).join("/")}:${s.getLineNumber()}:${s.getColumnNumber()}`).join(" | ");
  await t("callsite-new", () => new Thing({ depth: -1 }));
  await t("callsite-multiline", () => new
    Thing({ depth: -1 }));
  await t("callsite-method", () => Thing.make(1).method(1));
  await t("callsite-async", () => first("type"));
  Error.prepareStackTrace = prepare;
  const e: any = (() => { try { thrower("plain"); } catch (e) { return e; } })();
  out.push("props " + [e.line, e.column, String(e.sourceURL).split("/").slice(-2).join("/")].join());
  out.push("inspect " + tidy(Bun.inspect(e)).slice(0, 400));
  return out;
}
