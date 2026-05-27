import { describe, it, expect } from "bun:test";
import * as g from "bun:guard";

const asErr = (res: g.ParseResult<unknown>) => {
  if (res.ok) throw new Error("not a ParseError");
  return res.error;
};

const MyObj = g.object({
  a: g.number(),
  b: g.string().describe("string:b"),
  c: g.boolean().optional(),
  d: g.oneOf(g.number(), g.string()),
  e: g.number().array(),
  f: g.tuple(g.string(), g.number()),
  is: g.literal("hello"),
  h: g.allOf(g.object({ x: g.number() }), g.object({ y: g.string() })),
  rec: g.record(g.string(), g.oneOf(g.number(), g.object({ x: g.number() }))),
});
type MyObj = g.Infer<typeof MyObj>;

const MyString = g.string().brand("MyString");
type MyString = g.Infer<typeof MyString>;

const MyUnion = g.oneOf(
  g.object({ path: g.string() }).map((x) => ({ ...x, kind: "path" as const })),
  g
    .object({
      url: g.string(),
      sha256sum: g.string().optional(),
      sha1sum: g.string().optional(),
      md5sum: g.string().optional(),
    })
    .map((x) => ({ ...x, kind: "url" as const })),
);
type MyUnion = g.Infer<typeof MyUnion>;
const _ = {
  kind: "url",
  url: "https://example.com",
} satisfies MyUnion;

describe("guard", () => {
  it("should validate numbers", () => {
    const n = g.number();
    expect(n.safeParse(1)).toEqual(g.ok(1, false));
    expect(n.safeParse("1").ok).toBe(false);
    expect(n.outputSchema).toEqual({ type: "number" });
  });

  it("should validate strings", () => {
    const s = g.string();
    expect(s.safeParse("1")).toEqual(g.ok("1", false));
    expect(s.safeParse(1).ok).toBe(false);
    expect(s.outputSchema).toEqual({ type: "string" });
  });

  it("should validate regex", () => {
    const r = g.regex(/^[0-9]+$/);
    expect(r.safeParse("123")).toEqual(g.ok("123", false));
    expect(r.safeParse("abc").ok).toBe(false);
    expect(r.outputSchema).toEqual({ type: "string", pattern: "^[0-9]+$" });
  });

  it("regex with global flag should not mutate lastIndex", () => {
    const r = g.regex(/a/g);
    expect(r.is("a")).toBe(true);
    expect(r.is("a")).toBe(true);
    expect(r.is("a")).toBe(true);
  });

  it("should validate tuples", () => {
    {
      const t = g.tuple(g.number(), g.string());
      expect(t.safeParse([1, "2"]).ok).toBe(true);
      expect(t.safeParse([1, 2]).ok).toBe(false);
      expect(t.safeParse([1, 2, "3"]).ok).toBe(false);
      expect(t.outputSchema).toEqual({
        type: "array",
        items: [{ type: "number" }, { type: "string" }],
        additionalItems: false,
      });
    }

    {
      const t = g.tuple(g.intoNumber(), g.string());
      expect(t.safeParse([1, "2"])).toEqual(g.ok([1, "2"], false));
      expect(t.safeParse(["1", "2"])).toEqual(g.ok([1, "2"], true));
    }
  });

  it("should validate arrays", () => {
    const a = g.number().array();
    expect(a.safeParse([1, 2, 3]).ok).toBe(true);
    expect(a.safeParse([1, 2, "3"]).ok).toBe(false);
    expect(a.outputSchema).toEqual({
      type: "array",
      items: { type: "number" },
      description: undefined,
    });
    const aFromNullish = g.number().array({ fromNullish: true });
    expect(aFromNullish.safeParse(null)).toEqual(g.ok([], true));
    expect(aFromNullish.safeParse(undefined)).toEqual(g.ok([], true));
  });

  it("should validate non-empty arrays", () => {
    const A = g.number().arrayNonEmpty();
    expect(A.safeParse([1, 2, 3]).ok).toBe(true);
    expect(A.safeParse([]).ok).toBe(false);
    expect(A.outputSchema).toEqual({
      type: "array",
      items: { type: "number" },
      description: undefined,
    });
  });

  it("should validate alternates", () => {
    const t = g.oneOf(g.string(), g.number());
    expect(t.safeParse(true).ok).toBe(false);
    expect(t.safeParse(1).ok).toBe(true);
    expect(t.safeParse("1").ok).toBe(true);
    expect(t.outputSchema).toEqual({
      anyOf: [{ type: "string" }, { type: "number" }],
    });
  });

  it("should validate optionals", () => {
    const o = g.string().optional();
    expect(o.safeParse(true).ok).toBe(false);
    expect(o.safeParse(undefined).ok).toBe(true);
    expect(o.safeParse("1").ok).toBe(true);
    expect(o.outputSchema).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
      description: undefined,
    });
  });

  it("should validate objects", () => {
    const o = g.object({
      a: g.string(),
      b: g.number(),
      c: g.boolean(),
      d: g.boolean().optional(),
    });
    expect(o.safeParse(null)).toEqual(g.err(null, "Expected object"));

    expect(o.safeParse({})).toEqual(
      g.err({}, [
        { message: "Expected string", path: ["a"] },
        { message: "Expected number", path: ["b"] },
        { message: "Expected boolean", path: ["c"] },
      ]),
    );

    expect(o.safeParse({ a: "string", b: 123, c: true, extraProperty: 123 }).ok).toBe(true);

    expect(o.outputSchema).toEqual({
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "number" },
        c: { type: "boolean" },
        d: { type: "boolean" },
      },
      required: ["a", "b", "c"],
      additionalProperties: true,
    });

    {
      class Xclass {
        abc: string | number;
        constructor(abc: string | number) {
          this.abc = abc;
        }
      }
      const X = g.object({ abc: g.intoNumber() }).and(g.instanceOf(Xclass));
      const x = X.parse(new Xclass("123"));
      expect(x instanceof Xclass).toBe(true);
      expect(x.abc).toBe(123);
    }
  });

  it("should validate objects: strict", () => {
    const X = g.object({ a: g.string() }, { strict: true });
    expect(X.parse({ a: "hello" })).toEqual({ a: "hello" });
    expect(X.safeParse({ a: "hello", b: 123 })).toEqual(
      g.err({ a: "hello", b: 123 }, [{ message: "Unexpected key: b", path: ["b"] }]),
    );
  });

  it("should validate objects: passthrough", () => {
    {
      const X = g.object({ a: g.string() }, { passthrough: true });
      const o = { a: "hello", b: 123 };
      expect(X.parse(o)).toEqual({
        a: "hello",
        b: 123,
      });
    }

    {
      const X = g.object({ a: g.string() }, { passthrough: false });
      const o = { a: "hello", b: 123 };
      expect(X.parse(o)).toEqual({ a: "hello" });
    }

    expect(() => g.object({}, { strict: true, passthrough: true })).toThrow(
      'Cannot set "strict" and "passthrough" at the same time',
    );
  });

  it("should validate records", () => {
    const R = g.record(g.string(), g.oneOf(g.number(), g.object({ x: g.number() })));
    expect(R.safeParse({ someKey: 123 })).toEqual(g.ok({ someKey: 123 }, false));
    expect(R.safeParse({ someKey: "123" }).ok).toBe(false);
    expect(asErr(R.safeParse({ someKey: "123" })).problems).toEqual([
      { message: "Expected one of the options", path: ["someKey"] },
    ]);
    {
      const R = g.record(
        g.string().invariant((s) => s === "456", 'key should only be "456"'),
        g.oneOf(g.number(), g.object({ x: g.number() })),
      );
      expect(asErr(R.safeParse({ someKey: 123 })).problems).toEqual([
        {
          message: 'Key failed validation: key should only be "456"',
          path: ["someKey"],
        },
      ]);
    }
    expect(R.safeParse({ someKey: { x: 123 } })).toEqual(g.ok({ someKey: { x: 123 } }, false));
  });

  it("should validate literals", () => {
    const l = g.literal("hello", 1, true);
    expect(l.safeParse("hello").ok).toBe(true);
    expect(l.safeParse(1).ok).toBe(true);
    expect(l.safeParse(true).ok).toBe(true);

    expect(l.safeParse("world").ok).toBe(false);
    expect(l.safeParse(2).ok).toBe(false);
    expect(l.safeParse(false).ok).toBe(false);

    expect(l.outputSchema).toEqual({
      anyOf: [{ const: "hello" }, { const: 1 }, { const: true }],
    });
  });

  it("should validate unions", () => {
    const one = g.object({ x: g.number() });
    const two = g.object({ x: g.string() });
    const either = one.or(two);

    expect(either.safeParse({ x: 1 }).ok).toBe(true);
    expect(either.safeParse({ x: "1" }).ok).toBe(true);
    expect(either.safeParse({ x: false }).ok).toBe(false);

    expect(either.outputSchema).toEqual({
      anyOf: [
        {
          type: "object",
          properties: { x: { type: "number" } },
          required: ["x"],
          additionalProperties: true,
        },
        {
          type: "object",
          properties: { x: { type: "string" } },
          required: ["x"],
          additionalProperties: true,
        },
      ],
    });
  });

  it("should validate intersections", () => {
    const one = g.object({ x: g.number() });
    const two = g.object({ y: g.string() });
    const both = one.and(two);

    expect(both.safeParse({ x: 1 }).ok).toBe(false);
    expect(both.safeParse({ y: "2" }).ok).toBe(false);
    expect(both.safeParse({ x: 1, y: "2" }).ok).toBe(true);

    expect(both.outputSchema).toEqual({
      allOf: [
        {
          type: "object",
          properties: { x: { type: "number" } },
          required: ["x"],
          additionalProperties: true,
        },
        {
          type: "object",
          properties: { y: { type: "string" } },
          required: ["y"],
          additionalProperties: true,
        },
      ],
    });

    const CoercingAllOf = g.allOf(g.object({ x: g.intoNumber() }), g.object({ y: g.string() }));

    expect(CoercingAllOf.safeParse({ x: "123", y: "s" })).toEqual(g.ok({ x: 123, y: "s" }, true));

    {
      const obj = { x: 123, y: "s" };
      const parsed = CoercingAllOf.safeParse(obj);
      expect(parsed).toEqual(g.ok(obj, false));
      expect(parsed.ok ? parsed.value : {}).toBe(obj);
    }
  });

  it("should check instanceof", () => {
    class XYZ {}
    class ABC {}

    const xyz = new XYZ();
    expect(g.instanceOf(XYZ).safeParse(xyz)).toEqual(g.ok(xyz, false));
    expect(g.instanceOf(ABC).safeParse(xyz).ok).toBe(false);
    expect(g.instanceOf(ABC).safeParse(1234).ok).toBe(false);
    expect(g.instanceOf(ABC).safeParse(null).ok).toBe(false);
    expect(g.instanceOf(ABC).safeParse(undefined).ok).toBe(false);
    expect(g.instanceOf(ABC).safeParse({}).ok).toBe(false);
  });

  it("jsonSchema: g.string().describe(...)", () => {
    const StringAsserter = g.string().describe("string:myString");
    expect(StringAsserter.outputSchema).toEqual({
      type: "string",
      description: "string:myString",
    });
  });

  it("nested errors should be reported", () => {
    const o = g.object({
      a: g.object({
        b: g.number().array(),
      }),
    });

    expect(o.safeParse({ a: { b: [1, 2, "3"] } })).toEqual(
      g.err({ a: { b: [1, 2, "3"] } }, [{ message: "Expected number", path: ["a", "b", "2"] }]),
    );

    expect(o.safeParse({ a: { b: 1 } })).toEqual(
      g.err({ a: { b: 1 } }, [{ message: "Expected array", path: ["a", "b"] }]),
    );
  });

  it("jsonSchema", () => {
    const MassiveAsserter = g.object({
      a: g.string(),
      b: g.number().describe("number:b"),
      c: g.boolean(),
      d: g.string().optional(),
      e: g.oneOf(g.string(), g.number()),
      f: g.number().array(),
      is: g.tuple(g.string(), g.number()),
    });

    expect(MassiveAsserter.outputSchema).toEqual({
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "number", description: "number:b" },
        c: { type: "boolean" },
        d: { type: "string" },
        e: { anyOf: [{ type: "string" }, { type: "number" }] },
        f: { type: "array", items: { type: "number" }, description: undefined },
        is: {
          type: "array",
          items: [{ type: "string" }, { type: "number" }],
          additionalItems: false,
        },
      },
      required: ["a", "b", "c", "e", "f", "is"],
      additionalProperties: true,
    });
  });

  it("dual schemas: inputSchema differs from outputSchema for coercion", () => {
    const n = g.intoNumber();
    expect(n.outputSchema).toEqual({ type: "number" });
    expect(n.inputSchema).toEqual({
      anyOf: [{ type: "string" }, { type: "number" }],
    });

    const obj = g.object({ total: g.intoNumber() });
    expect(obj.outputSchema).toEqual({
      type: "object",
      properties: { total: { type: "number" } },
      required: ["total"],
      additionalProperties: true,
    });
    expect(obj.inputSchema).toEqual({
      type: "object",
      properties: {
        total: { anyOf: [{ type: "string" }, { type: "number" }] },
      },
      required: ["total"],
      additionalProperties: true,
    });

    const s = g.string();
    expect(s.inputSchema).toEqual(s.outputSchema);
  });

  it("dual schemas: describe is immutable", () => {
    const A = g.string();
    const B = A.describe("described");
    expect(A.outputSchema).toEqual({ type: "string" });
    expect(B.outputSchema).toEqual({ type: "string", description: "described" });
    expect(A).not.toBe(B);
  });

  it("map", () => {
    expect(
      g
        .number()
        .map((x) => x * 2)
        .parse(2),
    ).toBe(4);

    {
      const x = {};
      const X = g.object({});
      expect(X.map((x) => x).safeParse(x)).toEqual(g.ok(x, false));

      expect(
        g
          .number()
          .map((x) => g.ok(x))
          .safeParse(2),
      ).toEqual(g.ok(2, true));

      expect(
        g
          .number()
          .map((x) => g.ok(x * 2))
          .safeParse(2),
      ).toEqual(g.ok(4, true));

      expect(
        g
          .intoNumber()
          .map((x) => x)
          .is("1"),
      ).toEqual(false);
    }

    expect(
      g
        .number()
        .map((x) => g.ok(`result ${x}`))
        .parse(2),
    ).toBe("result 2");
  });

  it("parse with default", () => {
    expect(g.string().parse(123 as any, "default")).toBe("default");
  });

  describe("parsers/coercion", () => {
    it("should parse numbers", () => {
      const n = g.intoNumber();
      expect(n.safeParse(1)).toEqual(g.ok(1, false));
      expect(n.safeParse("1")).toEqual(g.ok(1, true));
      expect(n.safeParse("-1")).toEqual(g.ok(-1, true));
      expect(n.safeParse("+1")).toEqual(g.ok(1, true));
      expect(n.safeParse(".1")).toEqual(g.ok(0.1, true));
      expect(n.safeParse("1000.1")).toEqual(g.ok(1000.1, true));
      expect(n.safeParse("-1000.1")).toEqual(g.ok(-1000.1, true));
      expect(n.safeParse("+1000.1")).toEqual(g.ok(+1000.1, true));

      const regexErrorMessage = "Expected string matching number format";
      expect(n.safeParse("")).toEqual(g.err("", regexErrorMessage));
      expect(n.safeParse("1abc")).toEqual(g.err("1abc", regexErrorMessage));
      expect(n.safeParse(".")).toEqual(g.err(".", regexErrorMessage));
      expect(n.safeParse("+")).toEqual(g.err("+", regexErrorMessage));
      expect(n.safeParse("-")).toEqual(g.err("-", regexErrorMessage));
    });

    it("should perform regex matching", () => {
      const r = g.fromRegex(/^([^=]+)=(.*)$/);

      {
        const result = r.safeParse("key=value");
        expect(result).toEqual(
          g.ok(
            Object.assign(["key=value", "key", "value"], {
              index: 0,
              input: "key=value",
              groups: undefined,
            }) as RegExpExecArray,
            true,
          ),
        );
      }

      {
        const result = r.safeParse("nomatch");
        expect(result).toEqual(g.err("nomatch", "Expected string matching regex"));
      }
    });

    it("should parse JSON", () => {
      const j = g.fromJson(g.object({ looseNum: g.intoNumber(), s: g.string() }));

      {
        const result = j.safeParse(JSON.stringify({ looseNum: "nope" }));
        expect(result).toEqual(
          g.err({ looseNum: "nope" }, [
            {
              message: "Expected string matching number format",
              path: ["looseNum"],
            },
            { message: "Expected string", path: ["s"] },
          ]),
        );
      }

      {
        const str = "[{}{}]";
        const result = j.safeParse(str);
        expect(result).toEqual(
          g.err(str, "JSON Parse error: Expected ']'"),
        );
      }

      {
        const result = j.safeParse(JSON.stringify({ looseNum: "123", s: "astring" }));
        expect(result).toEqual(g.ok({ looseNum: 123, s: "astring" }, true));
      }
    });

    it("orFromJson", () => {
      const j = g
        .object({
          looseNum: g.intoNumber(),
          s: g.string(),
        })
        .orFromJson();

      const x = { looseNum: 123, s: "hello" };
      expect(j.safeParse(x)).toEqual(g.ok(x, false));
      expect(j.safeParse(JSON.stringify({ looseNum: 123, s: "hello" }))).toEqual(g.ok(x, true));
    });

    it("should not alter the object unless necessary", () => {
      const MyObj = g.object({ a: g.intoNumber(), b: g.number() });
      const MyArr = g.intoNumber().array();

      {
        const result = MyObj.safeParse({ a: 1, b: 2 });
        expect(result).toEqual(g.ok({ a: 1, b: 2 }, false));
      }

      {
        const result = MyArr.safeParse([1, 2]);
        expect(result).toEqual(g.ok([1, 2], false));
        expect(MyArr.is([1, 2])).toBe(true);
      }
    });

    it("successful parse does not imply `x is T`", () => {
      const MyArr = g.intoNumber().array();
      expect(MyArr.is([1, 2])).toBe(true);
      expect(MyArr.safeParse(["1", 2]).ok).toBe(true);
      expect(MyArr.is(["1", 2])).toBe(false);

      const MyObj = g.object({ a: g.intoNumber() });
      expect(MyObj.is({ a: 1 })).toBe(true);
      expect(MyObj.safeParse({ a: "1" }).ok).toBe(true);
      expect(MyObj.is({ a: "1" })).toBe(false);
    });

    it("JWT exp extractor", () => {
      let shouldPassInvariant = true;
      const JwtExpExtractor = g
        .fromRegex(/^[^.]+\.([^.]+)\.[^.]+$/)
        .invariant((groups) => groups.length === 2, "Invalid JWT format")
        .invariant(() => shouldPassInvariant, "arbitrary check")
        .map((groups) => atob(groups[1]!))
        .map(g.fromJson(g.object({ exp: g.number() })))
        .map(({ exp }) => exp);

      const payload = btoa(JSON.stringify({ exp: 123 }));
      const jwt = `header.${payload}.signature`;
      expect(JwtExpExtractor.safeParse(jwt)).toEqual(g.ok(123, true));
      expect(JwtExpExtractor.parse(jwt)).toBe(123);

      shouldPassInvariant = false;
      expect(JSON.stringify(JwtExpExtractor.safeParse(jwt))).toBe(
        JSON.stringify(g.err(Object.assign([jwt, payload]), "arbitrary check")),
      );
    });

    it("JWT parser", () => {
      const Jwt = g
        .fromRegex(/^([^.]+)\.([^.]+)\.([^.]+)$/)
        .invariant((groups) => groups.length === 4, "Invalid JWT format")
        .map((groups) => ({
          header: atob(groups[1]!),
          payload: atob(groups[2]!),
          signature: Buffer.from(groups[3]!, "base64"),
        }))
        .map(
          g.object({
            header: g.fromJson(g.unknown()),
            payload: g.fromJson(g.unknown()),
            signature: new g.Guard((x) =>
              Buffer.isBuffer(x) ? g.ok(x, true) : g.err(x, "Expected a Buffer"),
            ),
          }),
        );

      const header = btoa(JSON.stringify({ alg: "none" }));
      const payload = btoa(JSON.stringify({ exp: 123 }));
      const jwt = `${header}.${payload}.${btoa("signature")}`;
      expect(Jwt.safeParse(jwt)).toEqual(
        g.ok(
          {
            header: { alg: "none" },
            payload: { exp: 123 },
            signature: Buffer.from("signature"),
          },
          true,
        ),
      );
    });

    it("Authorization header parser", () => {
      const Jwt = g
        .fromRegex(/^([^.]+)\.([^.]+)\.([^.]+)$/)
        .invariant((groups) => groups.length === 4, "Invalid JWT format")
        .map((groups) => ({
          header: atob(groups[1]!),
          payload: atob(groups[2]!),
          signature: Buffer.from(groups[3]!, "base64"),
        }))
        .map(
          g.object({
            header: g.fromJson(g.unknown()),
            payload: g.fromJson(g.unknown()),
            signature: new g.Guard((x) =>
              Buffer.isBuffer(x) ? g.ok(x, true) : g.err(x, "Expected a Buffer"),
            ),
          }),
        );

      const AuthBearerHeader = g
        .fromRegex(/^Bearer (.+)$/i)
        .invariant((groups) => groups.length === 2, "Invalid header")
        .map((groups) => groups[1])
        .map(Jwt);

      const jwtParts = {
        header: btoa(JSON.stringify({ alg: "none" })),
        payload: btoa(JSON.stringify({ exp: 123 })),
      };
      const jwt = `${jwtParts.header}.${jwtParts.payload}.${btoa("signature")}`;
      const header = `Bearer ${jwt}`;

      expect(AuthBearerHeader.safeParse(header)).toEqual(
        g.ok(
          {
            header: { alg: "none" },
            payload: { exp: 123 },
            signature: Buffer.from("signature"),
          },
          true,
        ),
      );
    });

    it("synthetic unions driven by predicates", () => {
      const SmallOrder = g
        .object({ total: g.intoNumber() })
        .invariant((x) => x.total < 100, "order is too big")
        .map((x) => ({ ...x, size: "small" as const }));

      const LargeOrder = g.object({ total: g.intoNumber() }).map((x) => {
        if (x.total < 100) return g.err(x, `order is too small: ${x.total}`);

        return g.ok({ ...x, size: "large" as const });
      });

      const Order = g.oneOf(SmallOrder, LargeOrder);
      const Order2 = g.oneOf(LargeOrder, SmallOrder);

      expect(Order.parse({ total: 50 })).toEqual({
        size: "small",
        total: 50,
      });
      expect(Order2.parse({ total: 50 })).toEqual({
        size: "small",
        total: 50,
      });

      expect(Order.parse({ total: "150" })).toEqual({
        size: "large",
        total: 150,
      });
      expect(Order2.parse({ total: "150" })).toEqual({
        size: "large",
        total: 150,
      });
    });

    it("date", () => {
      const D = g.intoDate();
      expect(D.safeParse(123)).toEqual(g.ok(new Date(123), true));
      expect(D.safeParse(new Date(123))).toEqual(g.ok(new Date(123), false));
      expect(D.safeParse("2024-06-02T21:15:05.994Z")).toEqual(
        g.ok(new Date("2024-06-02T21:15:05.994Z"), true),
      );
      const ts = new Date("2024-06-02T21:15:05.994Z").getTime();
      expect(D.safeParse(ts)).toEqual(g.ok(new Date(ts), true));

      expect(D.safeParse(false).ok).toBe(false);
      expect(D.safeParse(Number.NaN).ok).toBe(false);
      expect(D.safeParse("NaN").ok).toBe(false);
    });
  });

  it("should validate bigint", () => {
    const b = g.bigint();
    expect(b.safeParse(1n)).toEqual(g.ok(1n, false));
    expect(b.safeParse(1).ok).toBe(false);
    expect(b.safeParse("1").ok).toBe(false);
  });

  it("should validate symbol", () => {
    const s = g.symbol();
    const sym = Symbol("test");
    expect(s.safeParse(sym)).toEqual(g.ok(sym, false));
    expect(s.safeParse("sym").ok).toBe(false);
    expect(s.safeParse(1).ok).toBe(false);
  });

  it("should validate integers", () => {
    const i = g.int();
    expect(i.safeParse(42)).toEqual(g.ok(42, false));
    expect(i.safeParse(0)).toEqual(g.ok(0, false));
    expect(i.safeParse(-1)).toEqual(g.ok(-1, false));
    expect(i.safeParse(3.14).ok).toBe(false);
    expect(i.safeParse(NaN).ok).toBe(false);
    expect(i.safeParse(Infinity).ok).toBe(false);
    expect(i.safeParse("42").ok).toBe(false);
  });

  it("should validate finite numbers", () => {
    const f = g.finite();
    expect(f.safeParse(42)).toEqual(g.ok(42, false));
    expect(f.safeParse(3.14)).toEqual(g.ok(3.14, false));
    expect(f.safeParse(0)).toEqual(g.ok(0, false));
    expect(f.safeParse(Infinity).ok).toBe(false);
    expect(f.safeParse(-Infinity).ok).toBe(false);
    expect(f.safeParse(NaN).ok).toBe(false);
    expect(f.safeParse("42").ok).toBe(false);
  });

  it("should validate NaN", () => {
    const n = g.nan();
    expect(n.safeParse(NaN)).toEqual(g.ok(NaN, false));
    expect(n.safeParse(42).ok).toBe(false);
    expect(n.safeParse(Infinity).ok).toBe(false);
    expect(n.safeParse("hello").ok).toBe(false);
  });

  it("should validate sets", () => {
    const s = g.set(g.number());
    expect(s.safeParse(new Set([1, 2, 3]))).toEqual(g.ok(new Set([1, 2, 3]), false));
    expect(s.safeParse(new Set([1, "two", 3])).ok).toBe(false);
    expect(s.safeParse([1, 2, 3]).ok).toBe(false);
    expect(s.safeParse({}).ok).toBe(false);
  });

  it("should validate sets with coercion", () => {
    const s = g.set(g.intoNumber());
    const result = s.safeParse(new Set(["1", 2, "3"]));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(new Set([1, 2, 3]));
      expect(result.altered).toBe(true);
    }
  });

  it("should validate maps", () => {
    const m = g.map(g.string(), g.number());
    expect(
      m.safeParse(
        new Map([
          ["a", 1],
          ["b", 2],
        ]),
      ),
    ).toEqual(
      g.ok(
        new Map([
          ["a", 1],
          ["b", 2],
        ]),
        false,
      ),
    );
    {
      const badMap: Map<string, number> = new Map();
      (badMap as any).set("a", 1).set(2, "b");
      expect(m.safeParse(badMap).ok).toBe(false);
    }
    expect(m.safeParse([["a", 1]]).ok).toBe(false);
    expect(m.safeParse({}).ok).toBe(false);
  });

  it("should validate maps with coercion", () => {
    const m = g.map(g.string(), g.intoNumber());
    const result = m.safeParse(
      new Map([
        ["a", "1"],
        ["b", "2"],
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(
        new Map([
          ["a", 1],
          ["b", 2],
        ]),
      );
      expect(result.altered).toBe(true);
    }
  });

  it("nullable should propagate input type", () => {
    const n = g.intoNumber().nullable();
    expect(n.parse("123")).toBe(123);
    expect(n.parse(123)).toBe(123);
    expect(n.parse(null)).toBe(null);
    expect(() => n.parse(undefined)).toThrow();
    expect(() => n.parse(false)).toThrow();
  });

  it("nullish should propagate input type", () => {
    const n = g.intoNumber().nullish();
    expect(n.parse("123")).toBe(123);
    expect(n.parse(123)).toBe(123);
    expect(n.parse(null)).toBe(null);
    expect(n.parse(undefined)).toBe(undefined);
    expect(() => n.parse(false)).toThrow();
  });

  it("notNullish should propagate input type", () => {
    const n = g.intoNumber().notNullish();
    expect(n.parse("123")).toBe(123);
    expect(n.parse(123)).toBe(123);
    expect(() => n.parse(null as any)).toThrow();
    expect(() => n.parse(undefined as any)).toThrow();
  });

  it("optional should propagate input type", () => {
    const n = g.intoNumber().optional();
    expect(n.parse("123")).toBe(123);
    expect(n.parse(undefined)).toBe(undefined);
    expect(() => n.parse(null as any)).toThrow();
    expect(() => n.parse(false)).toThrow();
  });

  it("brand should preserve input type", () => {
    const BrandedNumber = g.intoNumber().brand("my-brand");
    expect(BrandedNumber.parse("42")).toBe(42);
    expect(BrandedNumber.parse(42)).toBe(42);
    expect(() => BrandedNumber.parse(false)).toThrow();
  });

  it("should parse date from bigint", () => {
    const D = g.intoDate();
    const ts = 1717791600000n;
    expect(D.safeParse(ts)).toEqual(g.ok(new Date(Number(ts)), true));
  });

  it("ParseError.verbose() should include actual values", () => {
    const n = g.number();
    const result = n.safeParse("not a number");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    const verbose = result.error.verbose();
    expect(verbose.message).toContain('"not a number"');

    const obj = g.object({ a: g.object({ b: g.number() }) });
    const objResult = obj.safeParse({ a: { b: "bad" } });
    expect(objResult.ok).toBe(false);
    if (objResult.ok) throw new Error("expected failure");
    const objVerbose = objResult.error.verbose();
    expect(objVerbose.message).toContain('"bad"');

    const tricky: any = {};
    Object.defineProperty(tricky, "x", {
      get() {
        throw new Error("nope");
      },
      enumerable: false,
    });
    const trickyError = new g.ParseError(tricky, [{ message: "test", path: ["x"] }], false);
    const trickyVerbose = trickyError.verbose();
    expect(trickyVerbose.message).toContain("null");
  });

  it("Guard.fromSimple should wrap a native type guard", () => {
    const isArrayOfStrings = g.Guard.fromSimple(
      (x): x is string[] => Array.isArray(x) && x.every((i) => typeof i === "string"),
      { type: "array", items: { type: "string" } },
    );
    expect(isArrayOfStrings.safeParse(["a", "b"])).toEqual(g.ok(["a", "b"], false));
    expect(isArrayOfStrings.safeParse([1, 2]).ok).toBe(false);
    expect(isArrayOfStrings.outputSchema).toEqual({ type: "array", items: { type: "string" } });

    const isEven = g.Guard.fromSimple((x, report): x is number => {
      if (typeof x !== "number") {
        report(["value"], "not a number");
        return false;
      }
      if (x % 2 !== 0) {
        report([], "not even");
        return false;
      }
      return true;
    });
    expect(isEven.safeParse(4)).toEqual(g.ok(4, false));
    expect(isEven.safeParse(3).ok).toBe(false);
    {
      const r = isEven.safeParse(3);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.problems).toEqual([{ path: [], message: "not even" }]);
    }
  });

  it("nul() should reject non-null values", () => {
    const n = g.nul();
    expect(n.safeParse(null)).toEqual(g.ok(null, false));
    expect(n.safeParse(0).ok).toBe(false);
    expect(n.safeParse(undefined).ok).toBe(false);
    expect(n.safeParse("null").ok).toBe(false);
  });

  it("undef() should reject non-undefined values", () => {
    const u = g.undef();
    expect(u.safeParse(undefined)).toEqual(g.ok(undefined, false));
    expect(u.safeParse(null).ok).toBe(false);
    expect(u.safeParse(0).ok).toBe(false);
    expect(u.safeParse("undefined").ok).toBe(false);
  });

  it("record() should reject undefined input", () => {
    const R = g.record(g.string(), g.number());
    expect(R.safeParse(undefined).ok).toBe(false);
  });

  it("tuple() should reject wrong-length arrays", () => {
    const t = g.tuple(g.number(), g.string());
    expect(t.safeParse([1]).ok).toBe(false);
    expect(t.safeParse([1, "2", 3]).ok).toBe(false);
    expect(t.safeParse([]).ok).toBe(false);
  });

  it("intoString() should coerce various types", () => {
    const s = g.intoString();
    expect(s.safeParse("hello")).toEqual(g.ok("hello", false));
    expect(s.safeParse(42)).toEqual(g.ok("42", true));
    expect(s.safeParse(1n)).toEqual(g.ok("1", true));
    expect(s.safeParse(true)).toEqual(g.ok("true", true));
    expect(s.safeParse(false)).toEqual(g.ok("false", true));
    const sym = Symbol("symdesc");
    expect(s.safeParse(sym)).toEqual(g.ok("symdesc", true));
    const symNoDesc = Symbol();
    const symResult = s.safeParse(symNoDesc);
    expect(symResult.ok).toBe(true);
    if (symResult.ok) {
      expect(typeof symResult.value).toBe("string");
    }
    const d = new Date("2024-01-01T00:00:00.000Z");
    expect(s.safeParse(d)).toEqual(g.ok(d.toISOString(), true));
    expect(s.safeParse({}).ok).toBe(false);
    expect(s.safeParse(null).ok).toBe(false);
  });

  it("fromJson() should report structured error messages", () => {
    const j = g.fromJson(g.number());
    expect(j.safeParse("not-json-at-all").ok).toBe(false);
    const result = j.safeParse("{invalid");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.problems.length).toBeGreaterThan(0);
    }
  });

  it("intoJson() should serialize and reject", () => {
    const j = g.intoJson();
    expect(j.safeParse({ a: 1 })).toEqual(g.ok('{"a":1}', true));
    expect(j.safeParse([1, 2])).toEqual(g.ok("[1,2]", true));
    expect(j.safeParse("hello")).toEqual(g.ok('"hello"', true));
    expect(j.safeParse(42)).toEqual(g.ok("42", true));
    expect(j.safeParse(null)).toEqual(g.ok("null", true));
    const circular: any = {};
    circular.self = circular;
    expect(j.safeParse(circular).ok).toBe(false);
  });

  it("tuple() should include element index in error paths", () => {
    const t = g.tuple(g.number(), g.string(), g.boolean());
    const result = t.safeParse([1, 2, true]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.problems).toEqual([{ message: "Expected string", path: ["1"] }]);
    }
  });

  it("object() schema: nullable property should be required (allow null)", () => {
    const o = g.object({ a: g.string().nullable() });
    expect(o.safeParse({ a: null }).ok).toBe(true);
    expect(o.outputSchema).toEqual({
      type: "object",
      properties: { a: { anyOf: [{ type: "string" }, { type: "null" }], description: undefined } },
      required: ["a"],
      additionalProperties: true,
    });
  });

  it("object() schema: nullish property should be optional but allow null", () => {
    const o = g.object({ a: g.string().nullish() });
    expect(o.safeParse({ a: null }).ok).toBe(true);
    expect(o.outputSchema).toEqual({
      type: "object",
      properties: { a: { anyOf: [{ type: "string" }, { type: "null" }], description: undefined } },
      required: [],
      additionalProperties: true,
    });
  });

  it("should support lazy recursive schemas", () => {
    type Tree = { value: number; children: Tree[] };
    const Tree: g.Guard<Tree> = g.Guard.lazy(() =>
      g.object({
        value: g.number(),
        children: g.array(Tree),
      }),
    );

    const valid = {
      value: 1,
      children: [
        { value: 2, children: [] },
        { value: 3, children: [{ value: 4, children: [] }] },
      ],
    };
    expect(Tree.safeParse(valid)).toEqual(g.ok(valid, false));

    const invalid = {
      value: 1,
      children: [{ value: "two", children: [] }],
    };
    expect(Tree.safeParse(invalid).ok).toBe(false);
  });
});
