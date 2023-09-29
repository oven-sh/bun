import assert from "assert";
import { itBundled, testForFile } from "./expectBundled";
var { describe, test, expect } = testForFile(import.meta.path);

itBundled("decorator_metadata/TypeSerialization", {
  files: {
    "/entry.ts": /* ts */ `
        import "reflect-metadata";
        function d1() {}
        class Known {}
        class Swag {}
        class A_1 {}

        // @ts-ignore
        @d1
        class Yolo {
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
                p18: \`123\`,
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
            ){}
        }

        const received = Reflect.getMetadata("design:paramtypes", Yolo);
        console.log(received.length === 174);
        console.log(received[0] === Object);
        console.log(received[1] === Object);
        console.log(received[2] === void 0);
        console.log(received[3] === void 0);
        console.log(received[4] === void 0);
        console.log(received[5] === void 0);
        console.log(received[6] === Number);
        console.log(received[7] === String);
        console.log(received[8] === Boolean);
        console.log(received[9] === (typeof Symbol === "function" ? Symbol : Object));
        console.log(received[10] === (typeof BigInt === "function" ? BigInt : Object));
        console.log(received[11] === Object);
        console.log(received[12] === Function);
        console.log(received[13] === Array);
        console.log(received[14] === Object);
        console.log(received[15] === Number);
        console.log(received[16] === (typeof BigInt === "function" ? BigInt : Object));
        console.log(received[17] === String);
        console.log(received[18] === String);
        console.log(received[19] === Boolean);
        console.log(received[20] === Boolean);
        console.log(received[21] === Map);
        console.log(received[22] === Set);
        console.log(received[23] === Known);
        console.log(received[24] === Object);
        console.log(received[25] === void 0);
        console.log(received[26] === void 0);
        console.log(received[27] === String);
        console.log(received[28] === String);
        console.log(received[29] === String);
        console.log(received[30] === String);
        console.log(received[31] === Object);
        console.log(received[32] === Object);
        console.log(received[33] === String);
        console.log(received[34] === String);
        console.log(received[35] === Object);
        console.log(received[36] === Object);
        console.log(received[37] === String);
        console.log(received[38] === String);
        console.log(received[39] === String);
        console.log(received[40] === String);
        console.log(received[41] === String);
        console.log(received[42] === String);
        console.log(received[43] === Object);
        console.log(received[44] === Object);
        console.log(received[45] === Object);
        console.log(received[46] === Object);
        console.log(received[47] === Object);
        console.log(received[48] === Object);
        console.log(received[49] === String);
        console.log(received[50] === String);
        console.log(received[51] === Object);
        console.log(received[52] === Object);
        console.log(received[53] === Object);
        console.log(received[54] === Object);
        console.log(received[55] === Swag);
        console.log(received[56] === Swag);
        console.log(received[57] === Swag);
        console.log(received[58] === Swag);
        console.log(received[59] === Swag);
        console.log(received[60] === Swag);
        console.log(received[61] === Object);
        console.log(received[62] === Object);
        console.log(received[63] === Object);
        console.log(received[64] === Object);
        console.log(received[65] === Object);
        console.log(received[66] === Object);
        console.log(received[67] === void 0);
        console.log(received[68] === void 0);
        console.log(received[69] === Swag);
        console.log(received[70] === Swag);
        console.log(received[71] === Swag);
        console.log(received[72] === Swag);
        console.log(received[73] === Object);
        console.log(received[74] === Object);
        console.log(received[75] === Swag);
        console.log(received[76] === Swag);
        console.log(received[77] === Object);
        console.log(received[78] === Object);
        console.log(received[79] === Swag);
        console.log(received[80] === Swag);
        console.log(received[81] === Object);
        console.log(received[82] === Object);
        console.log(received[83] === Object);
        console.log(received[84] === Object);
        console.log(received[85] === Object);
        console.log(received[86] === Object);
        console.log(received[87] === void 0);
        console.log(received[88] === void 0);
        console.log(received[89] === void 0);
        console.log(received[90] === void 0);
        console.log(received[91] === void 0);
        console.log(received[92] === void 0);
        console.log(received[93] === void 0);
        console.log(received[94] === void 0);
        console.log(received[95] === Object);
        console.log(received[96] === void 0);
        console.log(received[97] === Object);
        console.log(received[98] === Object);
        console.log(received[99] === void 0);
        console.log(received[100] === void 0);
        console.log(received[101] === void 0);
        console.log(received[102] === void 0);
        console.log(received[103] === void 0);
        console.log(received[104] === void 0);
        console.log(received[105] === void 0);
        console.log(received[106] === void 0);
        console.log(received[107] === Object);
        console.log(received[108] === Object);
        console.log(received[109] === Object);
        console.log(received[110] === Object);
        console.log(received[111] === Object);
        console.log(received[112] === Object);
        console.log(received[113] === Object);
        console.log(received[114] === Object);
        console.log(received[115] === Object);
        console.log(received[116] === Object);
        console.log(received[117] === Object);
        console.log(received[118] === Object);
        console.log(received[119] === Object);
        console.log(received[120] === void 0);
        console.log(received[121] === Object);
        console.log(received[122] === Object);
        console.log(received[123] === Object);
        console.log(received[124] === Object);
        console.log(received[125] === Object);
        console.log(received[126] === Object);
        console.log(received[127] === Object);
        console.log(received[128] === Object);
        console.log(received[129] === Object);
        console.log(received[130] === Object);
        console.log(received[131] === Object);
        console.log(received[132] === Object);
        console.log(received[133] === Object);
        console.log(received[134] === void 0);
        console.log(received[135] === void 0);
        console.log(received[136] === void 0);
        console.log(received[137] === void 0);
        console.log(received[138] === void 0);
        console.log(received[139] === void 0);
        console.log(received[140] === void 0);
        console.log(received[141] === void 0);
        console.log(received[142] === void 0);
        console.log(received[143] === void 0);
        console.log(received[144] === Object);
        console.log(received[145] === Object);
        console.log(received[146] === void 0);
        console.log(received[147] === void 0);
        console.log(received[148] === void 0);
        console.log(received[149] === void 0);
        console.log(received[150] === void 0);
        console.log(received[151] === void 0);
        console.log(received[152] === void 0);
        console.log(received[153] === void 0);
        console.log(received[154] === void 0);
        console.log(received[155] === Object);
        console.log(received[156] === Object);
        console.log(received[157] === Object);
        console.log(received[158] === void 0);
        console.log(received[159] === Object);
        console.log(received[160] === Object);
        console.log(received[161] === Object);
        console.log(received[162] === Object);
        console.log(received[163] === Object);
        console.log(received[164] === Object);
        console.log(received[165] === Object);
        console.log(received[166] === Object);
        console.log(received[167] === Object);
        console.log(received[168] === Object);
        console.log(received[169] === Object);
        console.log(received[170] === Object);
        console.log(received[171] === Boolean);
        console.log(received[172] === Object);
        console.log(received[173] === Object);

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

        console.log(Reflect.getMetadata("design:type", A) === undefined);
        console.log(Reflect.getMetadata("design:paramtypes", A)[0] === String);
        console.log(Reflect.getMetadata("design:returntype", A) === undefined);

        console.log(Reflect.getMetadata("design:type", A.prototype) === undefined);
        console.log(Reflect.getMetadata("design:paramtypes", A.prototype) === undefined);
        console.log(Reflect.getMetadata("design:returntype", A.prototype) === undefined);

        console.log(Reflect.getMetadata("design:type", A.prototype.method1) === undefined);
        console.log(Reflect.getMetadata("design:paramtypes", A.prototype.method1) === undefined);
        console.log(Reflect.getMetadata("design:returntype", A.prototype.method1) === undefined);

        console.log(Reflect.getMetadata("design:type", A.prototype, "method1") === Function);
        console.log(Reflect.getMetadata("design:paramtypes", A.prototype, "method1")[0] === Number);
        console.log(Reflect.getMetadata("design:returntype", A.prototype, "method1") === Boolean);

        console.log(Reflect.getMetadata("design:type", A.prototype, "prop1") === Function);
        console.log(Reflect.getMetadata("design:paramtypes", A.prototype, "prop1") === undefined);
        console.log(Reflect.getMetadata("design:returntype", A.prototype, "prop1") === undefined);

        console.log(Reflect.getMetadata("design:type", A.prototype, "prop2") === String);
        console.log(Reflect.getMetadata("design:paramtypes", A.prototype, "prop2") === undefined);
        console.log(Reflect.getMetadata("design:returntype", A.prototype, "prop2") === undefined);

        console.log(Reflect.getMetadata("design:type", A.prototype, "prop3") === Symbol);
        console.log(Reflect.getMetadata("design:paramtypes", A.prototype, "prop3") === undefined);
        console.log(Reflect.getMetadata("design:returntype", A.prototype, "prop3") === undefined);

        class HelloWorld {
            // @ts-ignore
            constructor(@d1 arg1: string) {}
        }

        console.log(Reflect.getMetadata("design:type", HelloWorld) === undefined);
        console.log(Reflect.getMetadata("design:paramtypes", HelloWorld)[0] === String);
        console.log(Reflect.getMetadata("design:returntype", HelloWorld) === undefined);

        type B = "hello" | "world";
        const b = 2;
        const c = ["hello", "world"] as const;
        type Loser = \`hello \${B}\`; // "hello hello" | "hello world"
        function d1() {}

        class AClass {
            constructor(
                // @ts-ignore
                @d1 p0: \`hello \${B}\`,
                // @ts-ignore
                p1: keyof Something,
                p2: typeof b,
                p3: readonly ["hello", "world"],
                p4: typeof c,
                p5: readonly [number, string],
                // prettier-ignore
                p6: (string | string),
                // prettier-ignore
                p7: (string & string),
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

        const paramtypes = Reflect.getMetadata("design:paramtypes", AClass);
        console.log(paramtypes[0] === String);
        console.log(paramtypes[1] === Object);
        console.log(paramtypes[2] === Object);
        console.log(paramtypes[3] === Array);
        console.log(paramtypes[4] === Object);
        console.log(paramtypes[5] === Array);
        console.log(paramtypes[6] === String);
        console.log(paramtypes[7] === String);
        console.log(paramtypes[8] === String);
        console.log(paramtypes[9] === Object);
        console.log(paramtypes[10] === Object);
        console.log(paramtypes[11] === Object);

        console.log(Reflect.getMetadata("design:returntype", AClass.prototype, "method1") === Promise);
    `,
    "/tsconfig.json": /* json */ `
        {
            "compilerOptions": {
                "experimentalDecorators": true,
                "emitDecoratorMetadata": true,
            }
        }
    `,
  },
  install: ["reflect-metadata"],
  bundling: true,
  run: {
    stdout: "true\n".repeat(212),
  },
});

itBundled("decorator_metadata/ImportIdentifiers", {
  files: {
    "/entry.ts": /* ts */ `
        import "reflect-metadata";
        import { Foo } from "./foo.js";

        function d1() {}

        @d1
        class Bar {
            constructor(foo: Foo) {}
        }

        console.log(Reflect.getMetadata("design:paramtypes", Bar)[0] === Foo);
    `,
    "/foo.js": /* js */ `
        const f = () => "Foo";
        module.exports[f()] = class Foo {};
    `,
    "/tsconfig.json": /* json */ `
        {
            "compilerOptions": {
                "experimentalDecorators": true,
                "emitDecoratorMetadata": true,
            }
        }
    `,
  },
  install: ["reflect-metadata"],
  run: {
    stdout: "true\n",
  },
});
