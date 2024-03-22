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
      prop1: () => {};
      // @ts-ignore
      @d1
      prop2: "foo" = "foo";
      // @ts-ignore
      @d1
      prop3: symbol;
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
});
