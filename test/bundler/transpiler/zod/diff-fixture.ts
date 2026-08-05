// Differential fixture for the zod transform. Runs every schema below
// against every input, in whatever mode the spawning test selected via
// BUN_FEATURE_FLAG_EXPERIMENTAL_ZOD, and prints a JSON report. The test
// asserts the reports are identical with the transform on and off.
import { z } from "zod";

const LIMIT = 3;
const RE = /^a+$/;
const isEven = (n: unknown) => typeof n !== "number" || n % 2 === 0;
enum NativeEnum {
  A = "a",
  B = "b",
}

const Inner = z.object({ v: z.number() });
function makeSchema() {
  return z.string().min(1);
}
const dynamic = makeSchema();

const SCHEMAS: Record<string, any> = {
  string: z.string(),
  stringMin: z.string().min(2),
  stringChecks: z.string().min(1).max(5).startsWith("a"),
  stringEndsIncludes: z.string().endsWith("c").includes("b"),
  stringLength: z.string().length(3),
  stringTrim: z.string().trim().min(2),
  stringTrimOrder: z.string().min(2).trim(),
  stringLower: z.string().toLowerCase(),
  stringUpper: z.string().toUpperCase(),
  stringLowercaseCheck: z.string().lowercase(),
  stringUppercaseCheck: z.string().uppercase(),
  stringRegex: z.string().regex(/^a+$/),
  stringRegexFlags: z.string().regex(/^A+$/i),
  stringRegexGlobal: z.string().regex(/a/g),
  stringRegexRef: z.string().regex(RE),
  stringRefLimit: z.string().min(LIMIT),
  stringMinExpr: z.string().min(LIMIT - 1),
  literalExpr: z.literal(LIMIT * 2 - 4),
  defaultTemplate: z.string().default(`v${LIMIT}`),
  ternaryCheck: z.number().max(LIMIT > 2 ? 100 : 50),
  number: z.number(),
  numberInt: z.number().int(),
  numberChecks: z.number().gt(0).lte(100).multipleOf(0.5),
  numberMinMax: z.number().min(-5).max(5),
  numberPositive: z.number().positive(),
  numberNonneg: z.number().nonnegative(),
  numberFinite: z.number().finite(),
  intTop: z.int(),
  boolean: z.boolean(),
  bigint: z.bigint(),
  date: z.date(),
  undef: z.undefined(),
  nullSchema: z.null(),
  anySchema: z.any(),
  unknownSchema: z.unknown(),
  neverSchema: z.never(),
  voidSchema: z.void(),
  nanSchema: z.nan(),
  literal: z.literal("hi"),
  literalNum: z.literal(7),
  literalMulti: z.literal(["a", 1, true, null]),
  literalUndefined: z.literal(undefined),
  literalRef: z.literal(LIMIT),
  enumPlain: z.enum(["x", "y", "zz"]),
  optional: z.string().optional(),
  optionalOptional: z.string().optional().optional(),
  nullable: z.string().nullable(),
  nullish: z.string().nullish(),
  nullableOptional: z.string().nullable().optional(),
  optionalDefault: z.string().default("d").optional(),
  withDefault: z.string().default("dflt"),
  defaultObj: z.object({ a: z.number() }).default({ a: 1 }),
  defaultArr: z.array(z.string()).default([]),
  defaultFn: z.number().default(() => 42),
  defaultOfOptional: z.string().optional().default("x"),
  prefault: z.string().trim().prefault("  pad  "),
  catchSchema: z.number().catch(-1),
  catchFn: z.number().catch(() => -2),
  catchOptional: z.number().catch(-3).optional(),
  refine: z.number().refine(n => n % 2 === 0, "must be even"),
  refineRef: z.number().refine(isEven),
  refineChain: z
    .string()
    .min(1)
    .refine(s => s !== "nope"),
  refineDouble: z
    .number()
    .refine(n => n > 0)
    .refine(n => n < 100),
  obj: z.object({ name: z.string(), age: z.number().optional() }),
  objEmpty: z.object({}),
  objStrict: z.strictObject({ a: z.string() }),
  objLoose: z.looseObject({ a: z.string() }),
  objStrictMethod: z.object({ a: z.string() }).strict(),
  objPassthrough: z.object({ a: z.string() }).passthrough(),
  objCatchall: z.object({ a: z.string() }).catchall(z.number()),
  objCatchallOpt: z.object({ a: z.string() }).catchall(z.number().optional()),
  objNested: z.object({ o: z.object({ i: z.number() }), arr: z.array(z.string()) }),
  objOptionalKeys: z.object({
    req: z.string(),
    opt: z.string().optional(),
    def: z.string().default("d"),
    nul: z.string().nullable(),
    nish: z.number().nullish(),
  }),
  objAnyProp: z.object({ a: z.any() }),
  objUndefinedProp: z.object({ u: z.undefined() }),
  objLiteralUndefined: z.object({ u: z.literal(undefined) }),
  objExtend: z.object({ a: z.string() }).extend({ b: z.number() }),
  objExtendOverride: z.object({ a: z.string() }).extend({ a: z.number() }),
  objPick: z.object({ a: z.string(), b: z.number(), c: z.boolean() }).pick({ a: true, c: true }),
  objOmit: z.object({ a: z.string(), b: z.number() }).omit({ b: true }),
  objPartial: z.object({ a: z.string(), b: z.number() }).partial(),
  objPartialMask: z.object({ a: z.string(), b: z.number() }).partial({ a: true }),
  objRequired: z.object({ a: z.string().optional(), b: z.number().optional() }).required(),
  objRequiredMask: z.object({ a: z.string().optional(), b: z.number().optional() }).required({ a: true }),
  array: z.array(z.number()),
  arrayMin: z.array(z.number()).min(2),
  arrayMax: z.array(z.number()).max(2),
  arrayLength: z.array(z.number()).length(2),
  arrayOfObj: z.array(z.object({ k: z.string() })),
  arrayMethod: z.string().array(),
  nonempty: z.array(z.string()).nonempty(),
  tuple: z.tuple([z.string(), z.number()]),
  tupleRest: z.tuple([z.string()], z.number()),
  tupleOptionalTail: z.tuple([z.string(), z.number().optional()]),
  record: z.record(z.string(), z.number()),
  recordUnion: z.record(z.string(), z.union([z.string(), z.number()])),
  recordChecksKey: z.record(z.string().min(2), z.number()),
  union: z.union([z.string(), z.number()]),
  unionOr: z.string().or(z.number()),
  unionOverlap: z.union([z.number().int(), z.number().positive()]),
  unionObjs: z.union([z.object({ t: z.literal("a"), x: z.string() }), z.object({ t: z.literal("b"), y: z.number() })]),
  unionOptional: z.union([z.string(), z.undefined()]),
  // Inconclusive options placed before overlapping conclusive ones: the fast
  // path must delegate instead of skipping to the later option.
  unionOpaqueFirst: z.union([z.string().transform((s: string) => s.length), z.string()]),
  unionCatchFirst: z.union([z.number().catch(0), z.string()]),
  unionRefFirst: z.union([Inner, z.string()]),
  unionRefineFirst: z.union([z.number().refine(isEven), z.string()]),
  unionDefaultFirst: z.union([z.string().default("d"), z.number()]),
  unionCoerceFirst: z.union([z.coerce.string(), z.number()]),
  optionalAsyncRefine: z
    .number()
    .optional()
    .refine(async () => true)
    .optional(),
  dunion: z.discriminatedUnion("type", [
    z.object({ type: z.literal("a"), a: z.string() }),
    z.object({ type: z.literal("b"), b: z.number() }),
  ]),
  dunionEnum: z.discriminatedUnion("kind", [
    z.object({ kind: z.enum(["x", "y"]), v: z.string() }),
    z.object({ kind: z.literal("zz"), w: z.number() }),
  ]),
  dunionInObj: z.object({
    u: z
      .discriminatedUnion("type", [
        z.object({ type: z.literal("a"), a: z.string() }),
        z.object({ type: z.literal("b"), b: z.number() }),
      ])
      .optional(),
  }),
  coerceString: z.coerce.string(),
  coerceNumber: z.coerce.number(),
  coerceBoolean: z.coerce.boolean(),
  coerceDate: z.coerce.date(),
  coerceBigint: z.coerce.bigint(),
  coerceWithChecks: z.coerce.number().int().min(0),
  branded: z.string().brand<"B">(),
  embedConst: z.object({ inner: Inner, tag: z.string() }),
  embedArray: z.array(Inner),
  embedDynamic: z.object({ d: dynamic }),
  embedDynamicOptional: z.object({ d: dynamic.optional() }),
  // Opaque-at-root and opaque-children paths (wrapper without a fast parse):
  email: z.email(),
  emailInObj: z.object({ e: z.email() }),
  emailOptionalInObj: z.object({ e: z.email().optional() }),
  transform: z.string().transform(s => s.length),
  transformInObj: z.object({ t: z.string().transform(s => s.length) }),
  pipe: z.string().pipe(z.coerce.number()),
  lazySchema: z.lazy(() => z.string()),
  superRefine: z.number().superRefine((v, ctx) => {
    if (v < 0) ctx.addIssue({ code: "custom", message: "neg" });
  }),
  readonlyObj: z.object({ a: z.string() }).readonly(),
  mapSchema: z.map(z.string(), z.number()),
  setSchema: z.set(z.number()),
  intersection: z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() })),
  preprocess: z.preprocess(v => (typeof v === "string" ? v.trim() : v), z.string()),
  nativeEnum: z.nativeEnum(NativeEnum),
  // Bail paths (these stay untransformed; they must still behave):
  described: z.string().describe("a described string"),
  metaSchema: z.number().meta({ title: "count" }),
};

const protoKeyInput = JSON.parse('{"__proto__": {"polluted": 1}, "a": "s"}');
const nullProtoRecord = Object.assign(Object.create(null), { k: 1 });
class Klass {
  k = 1;
}
const inherited = Object.create({ inheritedKey: 2 });
inherited.a = "s";
const withNonEnumerable = { k: 1 } as Record<string, unknown>;
Object.defineProperty(withNonEnumerable, "hidden", { value: 9, enumerable: false });
const sparse: unknown[] = [];
sparse[2] = "a";

const INPUTS: [string, unknown][] = [
  ["str-hi", "hi"],
  ["str-a", "a"],
  ["str-aaa", "aaa"],
  ["str-empty", ""],
  ["str-abc", "abc"],
  ["str-AAA", "AAA"],
  ["str-pad", "  pad  "],
  ["str-mixedcase", "AbC"],
  ["str-nope", "nope"],
  ["str-x", "x"],
  ["str-numlike", "42"],
  ["num-0", 0],
  ["num-1", 1],
  ["num-2", 2],
  ["num-2.5", 2.5],
  ["num-neg", -1],
  ["num-42", 42],
  ["num-100", 100],
  ["num-float", 3.14],
  ["num-nan", NaN],
  ["num-inf", Infinity],
  ["num-neginf", -Infinity],
  ["num-negzero", -0],
  ["num-big", 1e21],
  ["num-unsafe", 9007199254740993],
  ["bool-true", true],
  ["bool-false", false],
  ["null", null],
  ["undefined", undefined],
  ["obj-empty", {}],
  ["obj-name", { name: "n" }],
  ["obj-name-age", { name: "n", age: 3 }],
  ["obj-name-age-undef", { name: "n", age: undefined }],
  ["obj-name-bad", { name: 7 }],
  ["obj-a", { a: "s" }],
  ["obj-a-extra", { a: "s", extra: 1 }],
  ["obj-a-extranum", { a: "s", extra: 2 }],
  ["obj-a-num", { a: 1 }],
  ["obj-ab", { a: "s", b: 2 }],
  ["obj-ab-bad", { a: 1, b: 2 }],
  ["obj-t-a", { t: "a", x: "s" }],
  ["obj-type-a", { type: "a", a: "s" }],
  ["obj-type-b", { type: "b", b: 1 }],
  ["obj-type-c", { type: "c" }],
  ["obj-type-bad-payload", { type: "a", a: 7 }],
  ["obj-kind-x", { kind: "x", v: "s" }],
  ["obj-kind-zz", { kind: "zz", w: 2 }],
  ["obj-req", { req: "r" }],
  ["obj-req-optundef", { req: "r", opt: undefined }],
  ["obj-req-nul", { req: "r", nul: null }],
  ["obj-req-full", { req: "r", opt: "o", def: "x", nul: "n", nish: 5 }],
  ["obj-u-undef", { u: undefined }],
  ["obj-u-dunion", { u: { type: "a", a: "s" } }],
  ["obj-nested", { o: { i: 1 }, arr: ["a"] }],
  ["obj-inner", { inner: { v: 1 }, tag: "t" }],
  ["obj-inner-bad", { inner: { v: "x" }, tag: "t" }],
  ["obj-d", { d: "x" }],
  ["obj-d-empty", { d: "" }],
  ["obj-e", { e: "someone@example.com" }],
  ["obj-e-bad", { e: "nope" }],
  ["obj-e-empty", {}],
  ["obj-v", { v: 1 }],
  ["obj-constructor-num", { constructor: 7 }],
  ["obj-proto-key", protoKeyInput],
  ["obj-null-proto", nullProtoRecord],
  ["obj-class-instance", new Klass()],
  ["obj-inherited", inherited],
  ["obj-non-enumerable", withNonEnumerable],
  ["obj-t", { t: "s" }],
  ["arr-empty", []],
  ["arr-a", ["a"]],
  ["arr-ab", ["a", "b"]],
  ["arr-nums", [1, 2]],
  ["arr-nums3", [1, 2, 3]],
  ["arr-tuple", ["s", 1]],
  ["arr-tuple-extra", ["s", 1, 2]],
  ["arr-objs", [{ k: "v" }]],
  ["arr-mixed", [1, "x"]],
  ["arr-sparse", sparse],
  ["arr-undef-hole", [undefined]],
  ["date-valid", new Date(1700000000000)],
  ["date-invalid", new Date(NaN)],
  ["bigint-10", 10n],
  ["rec-nums", { x: 1, y: 2 }],
  ["rec-mixed", { x: 1, y: "s" }],
];

function ser(v: unknown, depth = 0): unknown {
  if (depth > 8) return "$deep";
  if (v === undefined) return "$undef";
  if (typeof v === "number") {
    if (Number.isNaN(v)) return "$nan";
    if (v === Infinity) return "$inf";
    if (v === -Infinity) return "$-inf";
    if (Object.is(v, -0)) return "$-0";
    return v;
  }
  if (typeof v === "bigint") return "$bigint:" + v.toString();
  if (typeof v === "function") return "$fn";
  if (typeof v === "symbol") return "$sym:" + String(v);
  if (v === null || typeof v !== "object") return v;
  if (v instanceof Date) return "$date:" + v.getTime();
  if (v instanceof RegExp) return "$re:" + v.source;
  if (v instanceof Map) return { $map: [...v.entries()].map(e => ser(e, depth + 1)) };
  if (v instanceof Set) return { $set: [...v.values()].map(e => ser(e, depth + 1)) };
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (let i = 0; i < v.length; i++) {
      out.push(i in v ? ser(v[i], depth + 1) : "$hole");
    }
    return out;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) {
    // Schema instances and other exotic objects inside issue lists:
    // identify by constructor name only.
    const name = proto?.constructor?.name;
    if (name && name !== "Object") return "$class:" + name;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(v)) {
    out[key] = ser((v as Record<string, unknown>)[key], depth + 1);
  }
  return out;
}

const report: Record<string, unknown> = {};
for (const name of Object.keys(SCHEMAS)) {
  const schema = SCHEMAS[name];
  const rows: Record<string, unknown> = {};
  for (const [inputName, input] of INPUTS) {
    let out: unknown;
    try {
      const r = schema.safeParse(input);
      out = r.success
        ? { ok: true, data: ser(r.data) }
        : { ok: false, issues: ser(r.error.issues), msg: r.error.message };
    } catch (e: any) {
      out = { threw: (e?.constructor?.name || "Error") + ": " + (e?.message || "") };
    }
    rows[inputName] = out;
  }
  report[name] = rows;
}

// Semantics that matter beyond per-call results:
const extra: Record<string, unknown> = {};
{
  // Defaults are cloned per parse (zod's defaultValue getter shallow-clones).
  const a = SCHEMAS.defaultObj.parse(undefined);
  const b = SCHEMAS.defaultObj.parse(undefined);
  extra.defaultCloned = a !== b && JSON.stringify(a) === JSON.stringify(b);
  const c = SCHEMAS.defaultArr.parse(undefined);
  const d = SCHEMAS.defaultArr.parse(undefined);
  extra.defaultArrCloned = c !== d;
}
{
  // Object parse returns a fresh object; any/unknown pass through identity.
  const input = { name: "n" };
  extra.objFresh = SCHEMAS.obj.parse(input) !== input;
  const anyInput = { x: 1 };
  extra.anyIdentity = SCHEMAS.anySchema.parse(anyInput) === anyInput;
}
{
  // parse() throw path produces a ZodError with the same message as safeParse.
  let thrown: any;
  try {
    SCHEMAS.stringMin.parse("");
  } catch (e) {
    thrown = e;
  }
  extra.parseThrow = {
    name: thrown?.constructor?.name,
    isZodError: thrown instanceof z.ZodError,
    msg: thrown?.message,
  };
}
{
  // Async parse parity, including an async refinement forcing the async path.
  const asyncSchema = z.number().refine(async n => n > 0);
  const ok = await asyncSchema.safeParseAsync(5);
  const bad = await asyncSchema.safeParseAsync(-5);
  extra.asyncRefine = { ok: ok.success && ok.data === 5, bad: bad.success, badIssues: ser(bad.error?.issues) };
  const syncViaAsync = await SCHEMAS.obj.safeParseAsync({ name: "n" });
  extra.syncViaAsync = { ok: syncViaAsync.success, data: ser(syncViaAsync.data) };
  // Sync parse of an async refinement must throw the async error.
  let syncOfAsync: unknown;
  try {
    syncOfAsync = { result: asyncSchema.safeParse(5).success };
  } catch (e: any) {
    syncOfAsync = { threw: (e?.constructor?.name || "Error") + ": " + (e?.message || "") };
  }
  extra.syncOfAsync = syncOfAsync;
}
{
  // Introspection after use: shape access, instanceof, unwrap.
  extra.shapeParse = SCHEMAS.obj.shape.name.parse("s");
  extra.instanceofObject = SCHEMAS.obj instanceof z.ZodObject;
  extra.instanceofType = SCHEMAS.union instanceof z.ZodType;
  extra.optionalUnwrap = SCHEMAS.optional.unwrap().parse("s");
  extra.described = (SCHEMAS.described as any).description;
  extra.meta = SCHEMAS.metaSchema.meta();
  // toJSONSchema exercises zod's own registry + def walking.
  extra.toJSONSchema = z.toJSONSchema(SCHEMAS.objOptionalKeys, { io: "input" });
  // Runtime composition with a transformed schema as a part.
  const composed = z.object({ part: SCHEMAS.stringMin });
  extra.composed = ser(composed.safeParse({ part: "ab" }));
  extra.composedBad = ser(composed.safeParse({ part: "x" }).success);
  const extended = (SCHEMAS.obj as any).extend({ more: z.boolean() });
  extra.runtimeExtend = ser(extended.safeParse({ name: "n", more: true }));
}

report.$extra = extra;
console.log(JSON.stringify(report));
