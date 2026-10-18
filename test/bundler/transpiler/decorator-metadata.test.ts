import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "node:path";
import "reflect-metadata";

describe("decorator metadata", () => {
  test("type serialization", () => {
    function d1() {}
    class Known {}
    class Swag {}
    class A_1 {}

    // @ts-ignore
    @d1
    class A {
      constructor(
        p0: any,
        p1: unknown,
        p2: never,
        p3: void,
        p4: null,
        p5: undefined,
        p6: number,
        p7: string,
        p8: boolean,
        p9: symbol,
        p10: bigint,
        p11: object,
        p12: () => {},
        p13: [],
        p14: {},
        p15: 123,
        p16: 123n,
        p17: "123",
        p18: `123`,
        p19: true,
        p20: false,
        // @ts-ignore
        p21: Map,
        // @ts-ignore
        p22: Set,
        p23: Known,
        // @ts-ignore
        p24: Unknown,
        p25: never & string,
        p26: string & never,
        p27: null & string,
        p28: string & null,
        p29: undefined & string,
        p30: string & undefined,
        p31: void & string,
        p32: string & void,
        p33: unknown & string,
        p34: string & unknown,
        p35: any & string,
        p36: string & any,
        p37: never | string,
        p38: string | never,
        p39: null | string,
        p40: string | null,
        p41: undefined | string,
        p42: string | undefined,
        p43: void | string,
        p44: string | void,
        p45: unknown | string,
        p46: string | unknown,
        p47: any | string,
        p48: string | any,
        p49: string | string,
        p50: string & string,
        p51: Known | Swag,
        p52: Swag | Known,
        p53: Known & Swag,
        p54: Swag & Known,
        p55: never | Swag,
        p56: Swag | never,
        p57: null | Swag,
        p58: Swag | null,
        p59: undefined | Swag,
        p60: Swag | undefined,
        p61: void | Swag,
        p62: Swag | void,
        p63: unknown | Swag,
        p64: Swag | unknown,
        p65: any | Swag,
        p66: Swag | any,
        p67: never & Swag,
        p68: Swag & never,
        p69: null & Swag,
        p70: Swag & null,
        p71: undefined & Swag,
        p72: Swag & undefined,
        p73: void & Swag,
        p74: Swag & void,
        p75: unknown & Swag,
        p76: Swag & unknown,
        p77: any & Swag,
        p78: Swag & any,
        p79: Swag | Swag,
        p80: Swag & Swag,
        // @ts-ignore
        p81: Unknown | Known,
        // @ts-ignore
        p82: Known | Unknown,
        // @ts-ignore
        p83: Unknown & Known,
        // @ts-ignore
        p84: Known & Unknown,
        // @ts-ignore
        p85: Unknown | Unknown,
        // @ts-ignore
        p86: Unknown & Unknown,
        p87: never | never,
        p88: never & never,
        p89: null | null,
        p90: null & null,
        p91: undefined | undefined,
        p92: undefined & undefined,
        p93: void | void,
        p94: void & void,
        p95: unknown | unknown,
        p96: unknown & unknown,
        p97: any | any,
        p98: any & any,
        p99: never | void,
        p100: void | never,
        p101: null | void,
        p102: void | null,
        p103: undefined | void,
        p104: void | undefined,
        p105: void | void,
        p106: void & void,
        p107: unknown | void,
        p108: void | unknown,
        p109: any | void,
        p110: void | any,
        p111: never | unknown,
        p112: unknown | never,
        p113: null | unknown,
        p114: unknown | null,
        p115: undefined | unknown,
        p116: unknown | undefined,
        p117: void | unknown,
        p118: unknown | void,
        p119: unknown | unknown,
        p120: unknown & unknown,
        p121: any | unknown,
        p122: unknown | any,
        p123: never | any,
        p124: any | never,
        p125: null | any,
        p126: any | null,
        p127: undefined | any,
        p128: any | undefined,
        p129: void | any,
        p130: any | void,
        p131: unknown | any,
        p132: any | unknown,
        p133: any | any,
        p134: never & void,
        p135: void & never,
        p136: null & void,
        p137: void & null,
        p138: undefined & void,
        p139: void & undefined,
        p140: void & void,
        p141: void | void,
        p142: unknown & void,
        p143: void & unknown,
        p144: any & void,
        p145: void & any,
        p146: never & unknown,
        p147: unknown & never,
        p148: null & unknown,
        p149: unknown & null,
        p150: undefined & unknown,
        p151: unknown & undefined,
        p152: void & unknown,
        p153: unknown & void,
        p154: unknown & unknown,
        p155: unknown | unknown,
        p156: any & unknown,
        p157: unknown & any,
        p158: never & any,
        p159: any & never,
        p160: null & any,
        p161: any & null,
        p162: undefined & any,
        p163: any & undefined,
        p164: void & any,
        p165: any & void,
        p166: unknown & any,
        p167: any & unknown,
        p168: any & any,
        p169: string & number & boolean & never & symbol,
        p170: "foo" | A_1,
        p171: true | boolean,
        p172: "foo" | boolean,
        p173: A_1 | "foo",
      ) {}
    }

    const received = Reflect.getMetadata("design:paramtypes", A);
    expect(received.length).toBe(174);
    expect(received[0]).toBe(Object);
    expect(received[1]).toBe(Object);
    expect(received[2]).toBe(void 0);
    expect(received[3]).toBe(void 0);
    expect(received[4]).toBe(void 0);
    expect(received[5]).toBe(void 0);
    expect(received[6]).toBe(Number);
    expect(received[7]).toBe(String);
    expect(received[8]).toBe(Boolean);
    expect(received[9]).toBe(typeof Symbol === "function" ? Symbol : Object);
    expect(received[10]).toBe(typeof BigInt === "function" ? BigInt : Object);
    expect(received[11]).toBe(Object);
    expect(received[12]).toBe(Function);
    expect(received[13]).toBe(Array);
    expect(received[14]).toBe(Object);
    expect(received[15]).toBe(Number);
    expect(received[16]).toBe(typeof BigInt === "function" ? BigInt : Object);
    expect(received[17]).toBe(String);
    expect(received[18]).toBe(String);
    expect(received[19]).toBe(Boolean);
    expect(received[20]).toBe(Boolean);
    expect(received[21]).toBe(Map);
    expect(received[22]).toBe(Set);
    expect(received[23]).toBe(Known);
    expect(received[24]).toBe(Object);
    expect(received[25]).toBe(void 0);
    expect(received[26]).toBe(void 0);
    expect(received[27]).toBe(String);
    expect(received[28]).toBe(String);
    expect(received[29]).toBe(String);
    expect(received[30]).toBe(String);
    expect(received[31]).toBe(Object);
    expect(received[32]).toBe(Object);
    expect(received[33]).toBe(String);
    expect(received[34]).toBe(String);
    expect(received[35]).toBe(Object);
    expect(received[36]).toBe(Object);
    expect(received[37]).toBe(String);
    expect(received[38]).toBe(String);
    expect(received[39]).toBe(String);
    expect(received[40]).toBe(String);
    expect(received[41]).toBe(String);
    expect(received[42]).toBe(String);
    expect(received[43]).toBe(Object);
    expect(received[44]).toBe(Object);
    expect(received[45]).toBe(Object);
    expect(received[46]).toBe(Object);
    expect(received[47]).toBe(Object);
    expect(received[48]).toBe(Object);
    expect(received[49]).toBe(String);
    expect(received[50]).toBe(String);
    expect(received[51]).toBe(Object);
    expect(received[52]).toBe(Object);
    expect(received[53]).toBe(Object);
    expect(received[54]).toBe(Object);
    expect(received[55]).toBe(Swag);
    expect(received[56]).toBe(Swag);
    expect(received[57]).toBe(Swag);
    expect(received[58]).toBe(Swag);
    expect(received[59]).toBe(Swag);
    expect(received[60]).toBe(Swag);
    expect(received[61]).toBe(Object);
    expect(received[62]).toBe(Object);
    expect(received[63]).toBe(Object);
    expect(received[64]).toBe(Object);
    expect(received[65]).toBe(Object);
    expect(received[66]).toBe(Object);
    expect(received[67]).toBe(void 0);
    expect(received[68]).toBe(void 0);
    expect(received[69]).toBe(Swag);
    expect(received[70]).toBe(Swag);
    expect(received[71]).toBe(Swag);
    expect(received[72]).toBe(Swag);
    expect(received[73]).toBe(Object);
    expect(received[74]).toBe(Object);
    expect(received[75]).toBe(Swag);
    expect(received[76]).toBe(Swag);
    expect(received[77]).toBe(Object);
    expect(received[78]).toBe(Object);
    expect(received[79]).toBe(Swag);
    expect(received[80]).toBe(Swag);
    expect(received[81]).toBe(Object);
    expect(received[82]).toBe(Object);
    expect(received[83]).toBe(Object);
    expect(received[84]).toBe(Object);
    expect(received[85]).toBe(Object);
    expect(received[86]).toBe(Object);
    expect(received[87]).toBe(void 0);
    expect(received[88]).toBe(void 0);
    expect(received[89]).toBe(void 0);
    expect(received[90]).toBe(void 0);
    expect(received[91]).toBe(void 0);
    expect(received[92]).toBe(void 0);
    expect(received[93]).toBe(void 0);
    expect(received[94]).toBe(void 0);
    expect(received[95]).toBe(Object);
    expect(received[96]).toBe(void 0);
    expect(received[97]).toBe(Object);
    expect(received[98]).toBe(Object);
    expect(received[99]).toBe(void 0);
    expect(received[100]).toBe(void 0);
    expect(received[101]).toBe(void 0);
    expect(received[102]).toBe(void 0);
    expect(received[103]).toBe(void 0);
    expect(received[104]).toBe(void 0);
    expect(received[105]).toBe(void 0);
    expect(received[106]).toBe(void 0);
    expect(received[107]).toBe(Object);
    expect(received[108]).toBe(Object);
    expect(received[109]).toBe(Object);
    expect(received[110]).toBe(Object);
    expect(received[111]).toBe(Object);
    expect(received[112]).toBe(Object);
    expect(received[113]).toBe(Object);
    expect(received[114]).toBe(Object);
    expect(received[115]).toBe(Object);
    expect(received[116]).toBe(Object);
    expect(received[117]).toBe(Object);
    expect(received[118]).toBe(Object);
    expect(received[119]).toBe(Object);
    expect(received[120]).toBe(void 0);
    expect(received[121]).toBe(Object);
    expect(received[122]).toBe(Object);
    expect(received[123]).toBe(Object);
    expect(received[124]).toBe(Object);
    expect(received[125]).toBe(Object);
    expect(received[126]).toBe(Object);
    expect(received[127]).toBe(Object);
    expect(received[128]).toBe(Object);
    expect(received[129]).toBe(Object);
    expect(received[130]).toBe(Object);
    expect(received[131]).toBe(Object);
    expect(received[132]).toBe(Object);
    expect(received[133]).toBe(Object);
    expect(received[134]).toBe(void 0);
    expect(received[135]).toBe(void 0);
    expect(received[136]).toBe(void 0);
    expect(received[137]).toBe(void 0);
    expect(received[138]).toBe(void 0);
    expect(received[139]).toBe(void 0);
    expect(received[140]).toBe(void 0);
    expect(received[141]).toBe(void 0);
    expect(received[142]).toBe(void 0);
    expect(received[143]).toBe(void 0);
    expect(received[144]).toBe(Object);
    expect(received[145]).toBe(Object);
    expect(received[146]).toBe(void 0);
    expect(received[147]).toBe(void 0);
    expect(received[148]).toBe(void 0);
    expect(received[149]).toBe(void 0);
    expect(received[150]).toBe(void 0);
    expect(received[151]).toBe(void 0);
    expect(received[152]).toBe(void 0);
    expect(received[153]).toBe(void 0);
    expect(received[154]).toBe(void 0);
    expect(received[155]).toBe(Object);
    expect(received[156]).toBe(Object);
    expect(received[157]).toBe(Object);
    expect(received[158]).toBe(void 0);
    expect(received[159]).toBe(Object);
    expect(received[160]).toBe(Object);
    expect(received[161]).toBe(Object);
    expect(received[162]).toBe(Object);
    expect(received[163]).toBe(Object);
    expect(received[164]).toBe(Object);
    expect(received[165]).toBe(Object);
    expect(received[166]).toBe(Object);
    expect(received[167]).toBe(Object);
    expect(received[168]).toBe(Object);
    expect(received[169]).toBe(Object);
    expect(received[170]).toBe(Object);
    expect(received[171]).toBe(Boolean);
    expect(received[172]).toBe(Object);
    expect(received[173]).toBe(Object);
  });
  test("design: type, paramtypes, returntype", () => {
    function d1() {}
    // @ts-ignore
    @d1
    class A {
      // @ts-ignore
      constructor(@d1 arg1: string) {}
      // @ts-ignore
      @d1
      // @ts-ignore
      method1(@d1 arg1: number): boolean {
        return true;
      }
      // @ts-ignore
      @d1
      prop1!: () => {};
      // @ts-ignore
      @d1
      prop2: "foo" = "foo";
      // @ts-ignore
      @d1
      prop3!: symbol;
    }

    expect(Reflect.getMetadata("design:type", A)).toBeUndefined();
    expect(Reflect.getMetadata("design:paramtypes", A)[0]).toBe(String);
    expect(Reflect.getMetadata("design:returntype", A)).toBeUndefined();

    expect(Reflect.getMetadata("design:type", A.prototype)).toBeUndefined();
    expect(Reflect.getMetadata("design:paramtypes", A.prototype)).toBeUndefined();
    expect(Reflect.getMetadata("design:returntype", A.prototype)).toBeUndefined();

    expect(Reflect.getMetadata("design:type", A.prototype.method1)).toBeUndefined();
    expect(Reflect.getMetadata("design:paramtypes", A.prototype.method1)).toBeUndefined();
    expect(Reflect.getMetadata("design:returntype", A.prototype.method1)).toBeUndefined();

    expect(Reflect.getMetadata("design:type", A.prototype, "method1")).toBe(Function);
    expect(Reflect.getMetadata("design:paramtypes", A.prototype, "method1")[0]).toBe(Number);
    expect(Reflect.getMetadata("design:returntype", A.prototype, "method1")).toBe(Boolean);

    expect(Reflect.getMetadata("design:type", A.prototype, "prop1")).toBe(Function);
    expect(Reflect.getMetadata("design:paramtypes", A.prototype, "prop1")).toBeUndefined();
    expect(Reflect.getMetadata("design:returntype", A.prototype, "prop1")).toBeUndefined();

    expect(Reflect.getMetadata("design:type", A.prototype, "prop2")).toBe(String);
    expect(Reflect.getMetadata("design:paramtypes", A.prototype, "prop2")).toBeUndefined();
    expect(Reflect.getMetadata("design:returntype", A.prototype, "prop2")).toBeUndefined();

    expect(Reflect.getMetadata("design:type", A.prototype, "prop3")).toBe(Symbol);
    expect(Reflect.getMetadata("design:paramtypes", A.prototype, "prop3")).toBeUndefined();
    expect(Reflect.getMetadata("design:returntype", A.prototype, "prop3")).toBeUndefined();
  });

  test("class with only constructor argument decorators", () => {
    function d1() {}
    class A {
      // @ts-ignore
      constructor(@d1 arg1: string) {}
    }

    expect(Reflect.getMetadata("design:type", A)).toBeUndefined();
    expect(Reflect.getMetadata("design:paramtypes", A)[0]).toBe(String);
    expect(Reflect.getMetadata("design:returntype", A)).toBeUndefined();
  });

  test("more types", () => {
    type B = "hello" | "world";
    const b = 2;
    const c = ["hello", "world"] as const;
    type Loser = `hello ${B}`; // "hello hello" | "hello world"
    function d1() {}

    class A {
      constructor(
        // @ts-ignore
        @d1 p0: `hello ${B}`,
        // @ts-ignore
        p1: keyof Something,
        p2: typeof b,
        p3: readonly ["hello", "world"],
        p4: typeof c,
        p5: readonly [number, string],
        // prettier-ignore
        p6: (string | string),
        // prettier-ignoreormat ignore
        p7: string & string,
        p8: boolean extends true ? "a" : "b",
        // @ts-ignore
        p9: Loser extends Loser ? string : Foo,
        p10: { [keyof in string]: number },
        // @ts-ignore
        p11: blah extends blahblah ? number : void,
      ) {}

      // @ts-ignore
      @d1
      async method1() {
        return true;
      }
    }

    const paramtypes = Reflect.getMetadata("design:paramtypes", A);
    expect(paramtypes[0]).toBe(String);
    expect(paramtypes[1]).toBe(Object);
    expect(paramtypes[2]).toBe(Object);
    expect(paramtypes[3]).toBe(Array);
    expect(paramtypes[4]).toBe(Object);
    expect(paramtypes[5]).toBe(Array);
    expect(paramtypes[6]).toBe(String);
    expect(paramtypes[7]).toBe(String);
    expect(paramtypes[8]).toBe(String);
    expect(paramtypes[9]).toBe(Object);
    expect(paramtypes[10]).toBe(Object);
    expect(paramtypes[11]).toBe(Object);

    expect(Reflect.getMetadata("design:returntype", A.prototype, "method1")).toBe(Promise);
  });

  test("rest parameters and defaults", () => {
    function d1(target: any) {}
    function d2(target: any, key: string) {}

    @d1
    class A {
      @d2
      // @ts-ignore
      prop0: any[];

      // @ts-ignore
      constructor(a0) {}

      @d2
      // @ts-ignore
      prop1;

      @d2
      method1() {}

      @d2
      // @ts-ignore
      method2(...a0) {}

      @d2
      method3(a0: number, ...a1: []) {}

      @d2
      method4(...a0: any[]) {}
    }

    expect(Reflect.getMetadata("design:type", A.prototype, "prop0")).toBe(Array);
    expect(Reflect.getMetadata("design:type", A.prototype, "prop1")).toBe(Object);

    expect(Reflect.getMetadata("design:paramtypes", A.prototype, "method1")).toHaveLength(0);
    expect(Reflect.getMetadata("design:type", A.prototype, "method1")).toBe(Function);
    expect(Reflect.getMetadata("design:returntype", A.prototype, "method1")).toBeUndefined();

    expect(Reflect.getMetadata("design:paramtypes", A.prototype, "method2")[0]).toBe(Object);
    expect(Reflect.getMetadata("design:type", A.prototype, "method2")).toBe(Function);
    expect(Reflect.getMetadata("design:returntype", A.prototype, "method2")).toBeUndefined();

    expect(Reflect.getMetadata("design:paramtypes", A.prototype, "method3")[0]).toBe(Number);
    expect(Reflect.getMetadata("design:paramtypes", A.prototype, "method3")[1]).toBe(Object);
    expect(Reflect.getMetadata("design:type", A.prototype, "method3")).toBe(Function);
    expect(Reflect.getMetadata("design:returntype", A.prototype, "method3")).toBeUndefined();

    expect(Reflect.getMetadata("design:paramtypes", A.prototype, "method4")[0]).toBe(Object);
    expect(Reflect.getMetadata("design:type", A.prototype, "method4")).toBe(Function);
    expect(Reflect.getMetadata("design:returntype", A.prototype, "method4")).toBeUndefined();
  });

  // tsc emits design:type for a decorated `declare` field the same way it does for a
  // regular or `abstract` field, while the field itself is still erased.
  test("declare and abstract fields", () => {
    const types: Record<string, unknown> = {};
    // The design:type metadata decorator is appended after the user's decorators and
    // decorators apply last to first, so the metadata is visible from inside d1. This
    // is how reflect-metadata consumers (TypeORM, class-transformer, ...) read it.
    function d1(target: object, key: string) {
      types[key] = Reflect.getMetadata("design:type", target, key);
    }
    class Known {}

    class A {
      @d1
      declare prop0: string;
      @d1
      declare prop1: Known;
      @d1
      declare prop2?: number;
      @d1
      // @ts-ignore
      declare prop3;
      @d1
      declare readonly prop4: boolean;
      @d1
      declare private prop5: Known[];
      @d1
      // @ts-ignore
      declare ["prop" + 6]: Known;
      @d1
      declare static prop7: symbol;
      // The other modifier order is parsed differently; prettier would rewrite it to `declare static`.
      // prettier-ignore
      @d1
      static declare prop8: bigint;
      @d1
      prop9: string = "";
    }

    abstract class B {
      @d1
      abstract abstract0: string;
      @d1
      abstract abstract1: Known;
    }

    const expected = {
      prop0: String,
      prop1: Known,
      prop2: Number,
      prop3: Object,
      prop4: Boolean,
      prop5: Array,
      prop6: Known,
      prop7: Symbol,
      prop8: BigInt,
      prop9: String,
      abstract0: String,
      abstract1: Known,
    };
    expect(Object.keys(types).sort()).toEqual(Object.keys(expected).sort());
    // Compared by identity: toEqual does not tell builtin constructors such as Array and Object apart.
    for (const [key, type] of Object.entries(expected)) {
      expect(types[key], key).toBe(type);
    }

    // A declare field is a field, not a method: it gets design:type and nothing else.
    expect(Reflect.getOwnMetadataKeys(A.prototype, "prop0")).toEqual(["design:type"]);
    expect(Reflect.getOwnMetadataKeys(A, "prop7")).toEqual(["design:type"]);
    expect(Reflect.getOwnMetadataKeys(B.prototype, "abstract0")).toEqual(["design:type"]);

    // The erased fields stay erased.
    expect(Object.keys(new A())).toEqual(["prop9"]);
    expect(Object.getOwnPropertyNames(A.prototype)).toEqual(["constructor"]);
    expect(Object.getOwnPropertyNames(A)).not.toContain("prop7");
    expect(Object.getOwnPropertyNames(A)).not.toContain("prop8");
  });
});

// The parse pass stores the name of a type. The name is bound to a symbol when the class is
// lowered, once every declaration of the file is in its scope.
describe("decorator metadata binds a type name when the class is lowered", () => {
  const tsconfig = JSON.stringify({
    compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true },
  });

  // `seen` lists the `design:` entries that reach a decorated member, in the order that the
  // decorators run.
  const collect = /* ts */ `
    export const seen: string[] = [];
    const show = (v: any): string =>
      Array.isArray(v) ? "[" + v.map(show).join(",") + "]" : typeof v === "function" ? v.name : String(v);
    (Reflect as any).metadata = (key: string, value: any) => () => {
      seen.push(key.slice("design:".length) + "=" + show(value));
    };
    export const d: any = () => {};
  `;
  const head = `import { d, seen } from "./collect";\n`;
  const tail = `\nconsole.log(seen.join(" "));\n`;

  // What a fixture prints, or the error that stops it.
  type Prints = string | { error: string };
  type Fixture = [name: string, index: string, prints: Prints];

  // `c ? (x) : y => { ... }` is first parsed as the arrow function `(x): y => { ... }`. That
  // parse is thrown away, so it must leave nothing behind for the names in its body.
  const conditional: Fixture[] = [
    [
      "types declared later as classes",
      `const c = false, x = 0;
       const make: any = c ? (x) : y => { class K { @d m(a: Bar): Baz { return a } } return K; };
       class Bar {}
       class Baz {}
       make(1);`,
      "returntype=Baz paramtypes=[Bar] type=Function\n",
    ],
    [
      "a type declared later as a function",
      `const c = false, x = 0;
       const make: any = c ? (x) : y => { class K { @d m(a: Bar) {} } return K; };
       function Bar() {}
       make(1);`,
      "returntype=undefined paramtypes=[Bar] type=Function\n",
    ],
    [
      "a member of a namespace declared later",
      `const c = false, x = 0;
       const make: any = c ? (x) : y => { class K { @d m(a: ns.Bar) {} } return K; };
       namespace ns { export class Bar {} }
       make(1);`,
      "returntype=undefined paramtypes=[Bar] type=Function\n",
    ],
    [
      "three types",
      `const c = false, x = 0;
       const make: any = c ? (x) : y => { class K { @d m(a: Bar, b: Baz, c: Qux) {} } return K; };
       class Bar {}
       class Baz {}
       class Qux {}
       make(1);`,
      "returntype=undefined paramtypes=[Bar,Baz,Qux] type=Function\n",
    ],
    [
      "a constructor parameter and a later let",
      `const c = false, x = 0;
       const make: any = c ? (x) : y => { @d class K { constructor(a: Bar) {} } return K; };
       let Bar = class Later {};
       make(1);`,
      "paramtypes=[Later]\n",
    ],
    [
      "a type imported after the conditional",
      `const c = false, x = 0;
       const make: any = c ? (x) : y => { class K { @d m(a: Svc) {} } return K; };
       import { Svc } from "./svc";
       make(1);`,
      "returntype=undefined paramtypes=[Svc] type=Function\n",
    ],
    [
      "decorated fields",
      `const c = false, x = 0;
       const make: any = c ? (x) : y => { class K { @d p: Bar; @d static q: Baz; } return K; };
       class Bar {}
       class Baz {}
       make(1);`,
      "type=Bar type=Baz\n",
    ],
    [
      "a global type",
      `const c = false, x = 0;
       const make: any = c ? (x) : y => { class K { @d m(a: Date) {} } return K; };
       make(1);
       console.log(new Date(0).getTime());`,
      "0\nreturntype=undefined paramtypes=[Date] type=Function\n",
    ],
    [
      "the arrow function is kept",
      `const c = true;
       const make: any = c ? (x): any => { class K { @d m(a: Bar): Baz { return a } } return K; } : null;
       class Bar {}
       class Baz {}
       make(1);`,
      "returntype=Baz paramtypes=[Bar] type=Function\n",
    ],
    [
      "the arrow function is kept and its parameter has the name of a type-only import",
      `import { IFoo } from "./types";
       const c = true;
       const make: any = c ? (IFoo): any => { class K { @d m(a: IFoo) {} } return K; } : null;
       make(class Param {});`,
      "returntype=undefined paramtypes=[Param] type=Function\n",
    ],
    [
      "async (x)",
      `const c = false, x = 0;
       declare const async: any;
       const make: any = c ? async (x) : y => { class K { @d m(a: Bar): Baz { return a } } return K; };
       class Bar {}
       class Baz {}
       make(1);`,
      "returntype=Baz paramtypes=[Bar] type=Function\n",
    ],
    [
      "a conditional inside the arrow body",
      `const c = false, x = 0;
       const make: any = c ? (x) : y => c ? (x) : z => { class K { @d m(a: Bar): Baz { return a } } return K; };
       class Bar {}
       class Baz {}
       make(1)(2);`,
      "returntype=Baz paramtypes=[Bar] type=Function\n",
    ],
    [
      "an export of another block of the namespace",
      `const c = false, x = 0;
       namespace ns { export class Bar {} }
       namespace ns {
         export const make: any = c ? (x) : y => { class K { @d m(a: Bar) {} } return K; };
         export const same = Bar;
       }
       ns.make(1);
       console.log(ns.same === ns.Bar);`,
      "true\nreturntype=undefined paramtypes=[Bar] type=Function\n",
    ],
    [
      "a qualified name with a part that is not defined",
      `const c = false, x = 0;
       namespace a { export namespace b { export class C {} } }
       const make: any = c ? (x) : y => { class K { @d m(p: a.b.C, q: a.missing.C, r: Express.Multer.File) {} } return K; };
       make(1);`,
      "returntype=undefined paramtypes=[C,Object,Object] type=Function\n",
    ],
    [
      "a type name written with an escape",
      `const c = false, x = 0;
       const make: any = c ? (x) : y => { class K { @d m(a: B\\u0061r, b: n\\u0073.Baz) {} } return K; };
       class Bar {}
       namespace ns { export class Baz {} }
       make(1);`,
      "returntype=undefined paramtypes=[Bar,Baz] type=Function\n",
    ],
  ];

  // These need no conditional. A name that is declared after the class binds to that
  // declaration. A name that the metadata does not print is not a use, so a type-only import
  // with that name is removed.
  const declarationOrder: Fixture[] = [
    [
      "an import after the class",
      `class K { @d m(a: Svc) {} }
       import { Svc } from "./svc";`,
      "returntype=undefined paramtypes=[Svc] type=Function\n",
    ],
    [
      "an export of another block of the namespace",
      `namespace ns { export class Bar {} }
       namespace ns {
         export class K { @d m(a: Bar) {} }
         export const same = Bar;
       }
       console.log(ns.same === ns.Bar);`,
      "true\nreturntype=undefined paramtypes=[Bar] type=Function\n",
    ],
    [
      "an import alias that a namespace exports",
      `namespace lib { export class Bar {} }
       namespace ns {
         export import Bar = lib.Bar;
         export class K { @d m(a: Bar) {} }
       }`,
      "returntype=undefined paramtypes=[Bar] type=Function\n",
    ],
    [
      "a declare field",
      `import { Svc } from "./svc";
       class K { @d declare p: Svc; }`,
      "type=Svc\n",
    ],
    [
      "a type-only import that only a folded type names",
      `import { IFoo } from "./types";
       class K { @d m(a: IFoo[], b: IFoo | string, c: IFoo & { y: 1 }): void {} }`,
      "returntype=undefined paramtypes=[Array,Object,Object] type=Function\n",
    ],
    [
      "a type-only import with the name of a later part of a qualified name",
      `import { File } from "./types";
       namespace Express { export namespace Multer { export class File {} } }
       class K { @d f!: Express.Multer.File; }
       const unused: File | undefined = undefined;`,
      "type=File\n",
    ],
    [
      "a type-only import that only a declare class names",
      `import { IFoo } from "./types";
       declare class D { @d m(a: IFoo): void; }`,
      "\n",
    ],
    [
      "a type-only import that only an overload signature names",
      `import { IFoo } from "./types";
       class K { @d m(a: IFoo): void; m(a: any) {} }`,
      "\n",
    ],
    [
      "a type-only import that only an abstract member names",
      `import { IFoo } from "./types";
       abstract class K { @d abstract m(a: IFoo): void; }`,
      "\n",
    ],
    [
      "two union members with the same name",
      `class Bar {}
       namespace ns { export class A {} export class B {} }
       class K { @d m(a: Bar | Bar, b: Bar & Bar, c: Bar | null, d: undefined | Bar, e: Bar | Date) {} }
       class L { @d m(a: ns.A | ns.A, b: ns.A | ns.B, c: ns.A & ns.B) {} }`,
      "returntype=undefined paramtypes=[Bar,Bar,Bar,Bar,Object] type=Function " +
        "returntype=undefined paramtypes=[A,Object,Object] type=Function\n",
    ],
    [
      "a type predicate",
      `import { IFoo } from "./types";
       class Bar {}
       class K {
         @d a(IFoo: any): IFoo is Bar { return true }
         @d b(): this is Bar { return true }
         @d c(x: any): asserts x is Bar {}
         @d e(x: any): asserts x {}
       }`,
      "returntype=Boolean paramtypes=[Object] type=Function returntype=Boolean paramtypes=[] type=Function " +
        "returntype=undefined paramtypes=[Object] type=Function returntype=undefined paramtypes=[Object] type=Function\n",
    ],
    [
      "a type with the name of a CommonJS variable",
      `interface module { id: string }
       class K {
         @d m(a: module, b: exports, c: require, e: __dirname) {}
         @d isLoaded(module: unknown): module is K { return true }
       }`,
      "returntype=undefined paramtypes=[Object,Object,Object,Object] type=Function " +
        "returntype=Boolean paramtypes=[Object] type=Function\n",
    ],
    [
      "a value import that only an array type names",
      `import { Tag } from "./tag";
       class K { @d tags: Tag[]; }`,
      "type=Array\n",
    ],
  ];

  // The limits of this change. `tscPrints` and `bundlePrints` below have what the output of tsc
  // and the bundle print for each of these.
  const limits: Fixture[] = [
    // A type has no symbol in Bun, so the name of a type parameter binds to a value.
    [
      "a type parameter with the name of a class declared later",
      `class Repo<Entity> { @d save(e: Entity) {} }
       class Entity {}`,
      "returntype=undefined paramtypes=[Entity] type=Function\n",
    ],
    // Bun declares the alias with `const`. tsc declares it with `var`.
    [
      "an import alias written after the class",
      `namespace lib { export class Bar {} }
       class K { @d m(a: Alias) {} }
       import Alias = lib.Bar;`,
      { error: "Cannot access 'Alias' before initialization" },
    ],
    // No metadata names `Tag`, so its import is not a use.
    [
      "a decorator after export default, which Bun does not apply",
      `import { Tag } from "./tag";
       export default @d class { constructor(a: Tag) {} }`,
      "\n",
    ],
    // https://github.com/oven-sh/bun/pull/41984 renames the argument of the namespace closure.
    [
      "a parameter with the name of the namespace that exports the type",
      `namespace ns { export class Bar {} }
       namespace ns { export function f(ns: any) { class K { @d m(a: Bar) {} } return K; } }
       ns.f({ Bar: class Other {} });`,
      "returntype=undefined paramtypes=[Other] type=Function\n",
    ],
  ];

  const files = {
    "tsconfig.json": tsconfig,
    "collect.ts": collect,
    "svc.ts": `export class Svc {}\n`,
    "tag.ts": `console.log("tag.ts is evaluated");\nexport class Tag {}\n`,
    "types.ts": `export interface IFoo { x: number }\nexport interface File { x: number }\n`,
  };

  test.concurrent("Bun.Transpiler transforms and scans a conditional's arrow body", async () => {
    const script = /* js */ `
      const transpiler = new Bun.Transpiler({ loader: "ts", tsconfig: ${tsconfig} });
      // The names that the metadata of the output reads.
      const names = code => [...code.matchAll(/typeof (\\w+) === "undefined" \\? Object : \\1/g)].map(m => m[1]);
      const twoTypes = "const v = c ? (x) : y => { class K { @dec m(a: A): B {} } };";
      const laterFunction = "const a = c ? (x) : y => { class K { @d m(a: Bar) {} } return 1 };\\nfunction Bar() {}";
      console.log(JSON.stringify({
        transformSync: names(transpiler.transformSync(twoTypes)),
        scan: transpiler.scan(twoTypes),
        laterFunction: names(transpiler.transformSync(laterFunction)),
      }));
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      transformSync: ["A", "B"],
      scan: { exports: [], imports: [] },
      laterFunction: ["Bar"],
    });
    expect(exitCode).toBe(0);
  });

  // A type with the name of a global of bun:test is not a use of that global, and does not hide it.
  test.concurrent("a type with the name of a bun:test global", async () => {
    using dir = tempDir("decorator-metadata-jest", {
      "tsconfig.json": tsconfig,
      "globals.test.ts": `
        const d: any = () => {};
        interface Repo { find(): void }
        @d class Consumer { constructor(readonly repo: jest.Mocked<Repo>) {} }
        class K { @d field: jest.Mock; @d m(a: describe.Each, b: expect) {} }
        test("the globals are bound", () => {
          const fn = jest.fn();
          fn(new Consumer(null!), new K());
          expect(fn).toHaveBeenCalledTimes(1);
          expect(typeof describe).toBe("function");
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "./globals.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(" 1 pass");
    expect(exitCode).toBe(0);
  });

  async function run(cmd: string[], cwd: string) {
    await using proc = Bun.spawn({ cmd, env: bunEnv, cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  function expectPrints({ stdout, stderr, exitCode }: Awaited<ReturnType<typeof run>>, prints: Prints) {
    if (typeof prints === "string") {
      if (exitCode !== 0) expect(stderr).toBe("");
      expect(stdout).toBe(prints);
      expect(exitCode).toBe(0);
    } else {
      expect(stderr).toContain(prints.error);
      expect(exitCode).not.toBe(0);
    }
  }

  describe.each([
    ["in a conditional's arrow body", conditional],
    ["outside a conditional", declarationOrder],
    ["where Bun and tsc differ", limits],
  ] as const)("%s", (_group, fixtures) => {
    test.concurrent.each(fixtures)("%s", async (_name, index, prints) => {
      using dir = tempDir("decorator-metadata-names", { ...files, "index.ts": head + index + tail });
      expectPrints(await run([bunExe(), "index.ts"], String(dir)), prints);
    });
  });

  // What the output of tsc 6.0 prints where it is not what `bun index.ts` prints.
  const tscPrints: Record<string, Prints> = {
    // tsc keeps the import of the interface. The interface has no export at run time.
    "the arrow function is kept and its parameter has the name of a type-only import": {
      error: "Export named 'IFoo' not found",
    },
    // tsc reads `exports` where it is defined. Bun takes a file that names `exports` for CommonJS.
    "a type with the name of a CommonJS variable": {
      error: "Cannot use import statement with CommonJS-only features",
    },
    "a type parameter with the name of a class declared later":
      "returntype=undefined paramtypes=[Object] type=Function\n",
    "an import alias written after the class": "returntype=undefined paramtypes=[undefined] type=Function\n",
    "a decorator after export default, which Bun does not apply": "tag.ts is evaluated\nparamtypes=[Tag]\n",
    "a parameter with the name of the namespace that exports the type":
      "returntype=undefined paramtypes=[Bar] type=Function\n",
  };

  // What the bundle prints where it is not what `bun index.ts` prints. Bun moves a class to the
  // top of a file that it runs. The bundle keeps the order, and its renamer tells `ns` from `ns`.
  const bundlePrints: Record<string, Prints> = {
    "a type parameter with the name of a class declared later": {
      error: "Cannot access 'Entity' before initialization",
    },
    "an import alias written after the class": "returntype=undefined paramtypes=[Object] type=Function\n",
    "a parameter with the name of the namespace that exports the type":
      "returntype=undefined paramtypes=[Bar] type=Function\n",
  };

  // The same fixtures, transpiled by tsc and bundled by `bun build`. A debug build needs about
  // 20 seconds to load the TypeScript compiler and seconds to run `bun check`, so these run on
  // release builds.
  describe.skipIf(isDebug || isASAN)("the same as", () => {
    const all = [...conditional, ...declarationOrder, ...limits];

    test.concurrent.each(all)("the output of tsc: %s", async (name, index, prints) => {
      const ts: typeof import("typescript") = require("typescript");
      const sources = { ...files, "index.ts": head + index + tail };
      const transpiled: Record<string, string> = {};
      for (const [file, source] of Object.entries(sources)) {
        if (!file.endsWith(".ts")) continue;
        transpiled[file.replace(/\.ts$/, ".js")] = ts.transpileModule(source, {
          compilerOptions: {
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            strictNullChecks: false,
            target: ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.ESNext,
          },
        }).outputText;
      }
      using dir = tempDir("decorator-metadata-tsc", transpiled);
      expectPrints(await run([bunExe(), "index.js"], String(dir)), tscPrints[name] ?? prints);
    });

    test.concurrent.each(all)("a bundle: %s", async (name, index, prints) => {
      using dir = tempDir("decorator-metadata-bundle", { ...files, "index.ts": head + index + tail });
      const build = await run([bunExe(), "build", "index.ts", "--target=bun", "--outdir=out"], String(dir));
      expect(build.stderr).toBe("");
      expectPrints(await run([bunExe(), join("out", "index.js")], String(dir)), bundlePrints[name] ?? prints);
    });

    // `bun check` reports TS1272, as tsc does, for a type that a decorated signature imports and
    // that the output of tsc names. The metadata is a use of an import in those places only.
    test.concurrent("the places where bun check reports TS1272: an import of a type stays", async () => {
      const shapes: Record<string, string> = {
        "parameter": `class K { @d m(a: IFoo) {} }`,
        "optional-parameter": `class K { @d m(a?: IFoo) {} }`,
        "return-type": `class K { @d m(): IFoo { return null! } }`,
        "field": `class K { @d p: IFoo; }`,
        "declare-field": `class K { @d declare p: IFoo; }`,
        "static-field": `class K { @d static p: IFoo; }`,
        "constructor": `@d class K { constructor(a: IFoo) {} }`,
        "parameter-property": `@d class K { constructor(readonly a: IFoo) {} }`,
        "decorated-parameter": `class K { m(@d a: IFoo) {} }`,
        "decorated-constructor-parameter": `class K { constructor(@d a: IFoo) {} }`,
        "getter": `class K { @d get p(): IFoo { return null! } }`,
        "setter": `class K { @d set p(v: IFoo) {} }`,
        "nullable": `class K { @d m(a: IFoo | null, b: undefined | IFoo) {} }`,
        "parenthesized": `class K { @d m(a: (IFoo)) {} }`,
        "union-of-itself": `class K { @d m(a: IFoo | IFoo) {} }`,
        "nested-class": `function f() { class K { @d m(a: IFoo) {} } return K; }`,
        "namespace-class": `namespace ns { export class K { @d m(a: IFoo) {} } }`,
        "rest-parameter": `class K { @d m(...a: IFoo[]) {} }`,
        "array": `class K { @d m(a: IFoo[]) {} }`,
        "readonly-array": `class K { @d m(a: readonly IFoo[]) {} }`,
        "tuple": `class K { @d m(a: [IFoo]) {} }`,
        "union": `class K { @d m(a: IFoo | string) {} }`,
        "intersection": `class K { @d m(a: IFoo & { y: 1 }) {} }`,
        "type-argument": `class K { @d m(a: Promise<IFoo>, b: Array<IFoo>) {} }`,
        "indexed-access": `class K { @d m(a: IFoo["x"]) {} }`,
        "keyof": `class K { @d m(a: keyof IFoo) {} }`,
        "conditional-type": `class K { @d m(a: IFoo extends object ? string : number) {} }`,
        "function-type": `class K { @d m(a: (x: IFoo) => IFoo) {} }`,
        "object-type": `class K { @d m(a: { x: IFoo }) {} }`,
        "constraint": `class K { @d m<T extends IFoo>(a: T) {} }`,
        "type-predicate": `class K { @d m(a: any): a is IFoo { return true } }`,
        "asserts": `class K { @d m(a: any): asserts a is IFoo {} }`,
        "member-without-decorator": `class K { m(a: IFoo) {} @d n() {} }`,
        "overload-signature": `class K { m(a: IFoo): void; @d m(a: any) {} }`,
        "declare-class": `declare class K { @d m(a: IFoo): void; }`,
        "class-expression": `const K = class { @d m(a: IFoo) {} };`,
      };
      // tsc prints the element type of a rest parameter. Bun prints Object, which names no import.
      const onlyTsc = ["rest-parameter"];
      const source = (shape: string) => `import { IFoo } from "./types";\ndeclare const d: any;\n${shape}\n`;

      using dir = tempDir("decorator-metadata-ts1272", {
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            isolatedModules: true,
            strict: false,
            lib: ["es5"],
            types: [],
          },
        }),
        "types.ts": `export interface IFoo { x: number }\n`,
        ...Object.fromEntries(Object.entries(shapes).map(([name, shape]) => [`${name}.ts`, source(shape)])),
      });
      const { stdout } = await run([bunExe(), "check"], String(dir));
      const reported = new Set(
        Array.from(stdout.matchAll(/^([\w-]+)\.ts\(\d+,\d+\): error TS1272/gm), match => match[1]),
      );

      const transpiler = new Bun.Transpiler({ loader: "ts", trimUnusedImports: true, tsconfig });
      const keepsTheImport = (shape: string) =>
        transpiler.scan(source(shape)).imports.some(({ path }) => path === "./types");
      const names = Object.keys(shapes);
      expect(names.filter(name => keepsTheImport(shapes[name]))).toEqual(
        names.filter(name => reported.has(name) && !onlyTsc.includes(name)),
      );
    });
  });
});
