// A read of a member that its class declares as an accessor tests nothing: the getter tests what it returns. The same read of a declared field throws.
const text: any = "text";
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}
class Gauge {
  count: number = 1;
  get level(): number { return 2; }
  get broken(): number { return text; }
}
const lookalike: any = { count: "text", level: "text" };
function readField(gauge: Gauge) { return typeof gauge.count; }
function readAccessor(gauge: Gauge) { return typeof gauge.level; }
function readAccessorIntoNumber(gauge: Gauge) { const n: number = gauge.level; return typeof n; }

attempt("a field of an instance", () => readField(new Gauge()));
attempt("an accessor of an instance", () => readAccessor(new Gauge()));
attempt("a field, and the object holds a string there", () => readField(lookalike));
attempt("an accessor, and the object holds a string there", () => readAccessor(lookalike));
attempt("the same read into an annotated variable", () => readAccessorIntoNumber(lookalike));
attempt("a getter that returns a string", () => typeof new Gauge().broken);
