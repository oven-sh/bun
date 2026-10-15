// A fixture of aot-audit-members.test.ts. One case a line: `t(() => { .. });`. Each runs three times: plain, in an --aot executable, under --aot-audit.
declare const Bun: any, process: any, Buffer: any;
const far = Bun.argv.length > 99 ? 1 : 0;
const anyv = (v: unknown): any => [v, 0][far];
const json = (text: string): any => JSON.parse(text);
let at = 0;
interface C1 { cwd1: string; deep: { x1: number } } interface B1 { id: string; ctx: C1; more: number } const K1: B1 = { id: "k", ctx: { cwd1: "/", deep: { x1: 1 } }, more: 1 };
interface C2 { cwd2: string; deep: { x2: number } } interface B2 { id: string; ctx: C2; more: string } const K2: B2 = { id: "k", ctx: { cwd2: "/", deep: { x2: 1 } }, more: "s" };
interface C3 { cwd3: string; deep: { x3: number } } interface B3 { id: string; ctx: C3; more: boolean } const K3: B3 = { id: "k", ctx: { cwd3: "/", deep: { x3: 1 } }, more: true };
interface C4 { cwd4: string; deep: { x4: number } } interface B4 { id: string; ctx: C4; more: { x4: number } } const K4: B4 = { id: "k", ctx: { cwd4: "/", deep: { x4: 1 } }, more: { x4: 1 } };
interface C5 { cwd5: string; deep: { x5: number } } interface B5 { id: string; ctx: C5; more: { s5: string } } const K5: B5 = { id: "k", ctx: { cwd5: "/", deep: { x5: 1 } }, more: { s5: "s" } };
interface C6 { cwd6: string; deep: { x6: number } } interface B6 { id: string; ctx: C6; more: { n6: { y6: number } } } const K6: B6 = { id: "k", ctx: { cwd6: "/", deep: { x6: 1 } }, more: { n6: { y6: 1 } } };
interface C7 { cwd7: string; deep: { x7: number } } interface B7 { id: string; ctx: C7; more: number[] } const K7: B7 = { id: "k", ctx: { cwd7: "/", deep: { x7: 1 } }, more: [1] };
interface C8 { cwd8: string; deep: { x8: number } } interface B8 { id: string; ctx: C8; more: { e8: number }[] } const K8: B8 = { id: "k", ctx: { cwd8: "/", deep: { x8: 1 } }, more: [{ e8: 1 }] };
interface C9 { cwd9: string; deep: { x9: number } } interface B9 { id: string; ctx: C9; more: any } const K9: B9 = { id: "k", ctx: { cwd9: "/", deep: { x9: 1 } }, more: 1 };
interface C10 { cwd10: string; deep: { x10: number } } interface B10 { id: string; ctx: C10; more: unknown } const K10: B10 = { id: "k", ctx: { cwd10: "/", deep: { x10: 1 } }, more: 1 };
interface C11 { cwd11: string; deep: { x11: number } } interface B11 { id: string; ctx: C11; more: number | undefined } const K11: B11 = { id: "k", ctx: { cwd11: "/", deep: { x11: 1 } }, more: 1 };
interface C12 { cwd12: string; deep: { x12: number } } interface B12 { id: string; ctx: C12; more: string | null } const K12: B12 = { id: "k", ctx: { cwd12: "/", deep: { x12: 1 } }, more: null };
interface C13 { cwd13: string; deep: { x13: number } } interface B13 { id: string; ctx: C13; more: Date } const K13: B13 = { id: "k", ctx: { cwd13: "/", deep: { x13: 1 } }, more: new Date(0) };
interface C14 { cwd14: string; deep: { x14: number } } interface B14 { id: string; ctx: C14; more: () => number } const K14: B14 = { id: "k", ctx: { cwd14: "/", deep: { x14: 1 } }, more: () => 1 };
interface C15 { cwd15: string; deep: { x15: number } } interface B15 { id: string; ctx: C15; more: Map<string, number> } const K15: B15 = { id: "k", ctx: { cwd15: "/", deep: { x15: 1 } }, more: new Map() };
interface C16 { cwd16: string; deep: { x16: number } } interface B16 { id: string; ctx: C16; more: Record<string, string> } const K16: B16 = { id: "k", ctx: { cwd16: "/", deep: { x16: 1 } }, more: {} };
interface C17 { cwd17: string; deep: { x17: number } } interface B17 { id: string; ctx: C17; more: object } const K17: B17 = { id: "k", ctx: { cwd17: "/", deep: { x17: 1 } }, more: {} };
interface C18 { cwd18: string; deep: { x18: number } } interface B18 { id: string; ctx: C18; more: number } const K18: B18 = { id: "k", ctx: { cwd18: "/", deep: { x18: 1 } }, more: 1 };
interface A18 { id: string; ctx: C18 } const KA18: A18 = { id: "k", ctx: { cwd18: "/", deep: { x18: 1 } } };
interface C19 { cwd19: string; deep: { x19: number } } interface B19 { id: string; ctx: C19; more: string } const K19: B19 = { id: "k", ctx: { cwd19: "/", deep: { x19: 1 } }, more: "s" };
interface A19 { id: string; ctx: C19 } const KA19: A19 = { id: "k", ctx: { cwd19: "/", deep: { x19: 1 } } };
interface C20 { cwd20: string; deep: { x20: number } } interface B20 { id: string; ctx: C20; more: boolean } const K20: B20 = { id: "k", ctx: { cwd20: "/", deep: { x20: 1 } }, more: true };
interface A20 { id: string; ctx: C20 } const KA20: A20 = { id: "k", ctx: { cwd20: "/", deep: { x20: 1 } } };
interface C21 { cwd21: string; deep: { x21: number } } interface B21 { id: string; ctx: C21; more: { x21: number } } const K21: B21 = { id: "k", ctx: { cwd21: "/", deep: { x21: 1 } }, more: { x21: 1 } };
interface A21 { id: string; ctx: C21 } const KA21: A21 = { id: "k", ctx: { cwd21: "/", deep: { x21: 1 } } };
interface C22 { cwd22: string; deep: { x22: number } } interface B22 { id: string; ctx: C22; more: { s22: string } } const K22: B22 = { id: "k", ctx: { cwd22: "/", deep: { x22: 1 } }, more: { s22: "s" } };
interface A22 { id: string; ctx: C22 } const KA22: A22 = { id: "k", ctx: { cwd22: "/", deep: { x22: 1 } } };
interface C23 { cwd23: string; deep: { x23: number } } interface B23 { id: string; ctx: C23; more: { n23: { y23: number } } } const K23: B23 = { id: "k", ctx: { cwd23: "/", deep: { x23: 1 } }, more: { n23: { y23: 1 } } };
interface A23 { id: string; ctx: C23 } const KA23: A23 = { id: "k", ctx: { cwd23: "/", deep: { x23: 1 } } };
interface C24 { cwd24: string; deep: { x24: number } } interface B24 { id: string; ctx: C24; more: number[] } const K24: B24 = { id: "k", ctx: { cwd24: "/", deep: { x24: 1 } }, more: [1] };
interface A24 { id: string; ctx: C24 } const KA24: A24 = { id: "k", ctx: { cwd24: "/", deep: { x24: 1 } } };
interface C25 { cwd25: string; deep: { x25: number } } interface B25 { id: string; ctx: C25; more: { e25: number }[] } const K25: B25 = { id: "k", ctx: { cwd25: "/", deep: { x25: 1 } }, more: [{ e25: 1 }] };
interface A25 { id: string; ctx: C25 } const KA25: A25 = { id: "k", ctx: { cwd25: "/", deep: { x25: 1 } } };
interface C26 { cwd26: string; deep: { x26: number } } interface B26 { id: string; ctx: C26; more: any } const K26: B26 = { id: "k", ctx: { cwd26: "/", deep: { x26: 1 } }, more: 1 };
interface A26 { id: string; ctx: C26 } const KA26: A26 = { id: "k", ctx: { cwd26: "/", deep: { x26: 1 } } };
interface C27 { cwd27: string; deep: { x27: number } } interface B27 { id: string; ctx: C27; more: unknown } const K27: B27 = { id: "k", ctx: { cwd27: "/", deep: { x27: 1 } }, more: 1 };
interface A27 { id: string; ctx: C27 } const KA27: A27 = { id: "k", ctx: { cwd27: "/", deep: { x27: 1 } } };
interface C28 { cwd28: string; deep: { x28: number } } interface B28 { id: string; ctx: C28; more: number | undefined } const K28: B28 = { id: "k", ctx: { cwd28: "/", deep: { x28: 1 } }, more: 1 };
interface A28 { id: string; ctx: C28 } const KA28: A28 = { id: "k", ctx: { cwd28: "/", deep: { x28: 1 } } };
interface C29 { cwd29: string; deep: { x29: number } } interface B29 { id: string; ctx: C29; more: string | null } const K29: B29 = { id: "k", ctx: { cwd29: "/", deep: { x29: 1 } }, more: null };
interface A29 { id: string; ctx: C29 } const KA29: A29 = { id: "k", ctx: { cwd29: "/", deep: { x29: 1 } } };
interface C30 { cwd30: string; deep: { x30: number } } interface B30 { id: string; ctx: C30; more: Date } const K30: B30 = { id: "k", ctx: { cwd30: "/", deep: { x30: 1 } }, more: new Date(0) };
interface A30 { id: string; ctx: C30 } const KA30: A30 = { id: "k", ctx: { cwd30: "/", deep: { x30: 1 } } };
interface C31 { cwd31: string; deep: { x31: number } } interface B31 { id: string; ctx: C31; more: () => number } const K31: B31 = { id: "k", ctx: { cwd31: "/", deep: { x31: 1 } }, more: () => 1 };
interface A31 { id: string; ctx: C31 } const KA31: A31 = { id: "k", ctx: { cwd31: "/", deep: { x31: 1 } } };
interface C32 { cwd32: string; deep: { x32: number } } interface B32 { id: string; ctx: C32; more: Map<string, number> } const K32: B32 = { id: "k", ctx: { cwd32: "/", deep: { x32: 1 } }, more: new Map() };
interface A32 { id: string; ctx: C32 } const KA32: A32 = { id: "k", ctx: { cwd32: "/", deep: { x32: 1 } } };
interface C33 { cwd33: string; deep: { x33: number } } interface B33 { id: string; ctx: C33; more: Record<string, string> } const K33: B33 = { id: "k", ctx: { cwd33: "/", deep: { x33: 1 } }, more: {} };
interface A33 { id: string; ctx: C33 } const KA33: A33 = { id: "k", ctx: { cwd33: "/", deep: { x33: 1 } } };
interface C34 { cwd34: string; deep: { x34: number } } interface B34 { id: string; ctx: C34; more: object } const K34: B34 = { id: "k", ctx: { cwd34: "/", deep: { x34: 1 } }, more: {} };
interface A34 { id: string; ctx: C34 } const KA34: A34 = { id: "k", ctx: { cwd34: "/", deep: { x34: 1 } } };
function t(f: () => unknown) { at++; let said: string; try { const v = f(); said = typeof v + " " + String(v); } catch (e) { said = "threw " + (e as Error).constructor.name + (process.env.WHY ? " " + String((e as Error).message).replace(/ \(bun --aot[^)]*\)/, "").replace(/\n */g, " ~ ") : ""); } console.log(at, said); }
t(() => { const b: B1 = json('{"id":"y","ctx":{"cwd1":"/","deep":{"x1":1}}}'); return b.id; }); // lacks a member that is number
t(() => { const b: B2 = json('{"id":"y","ctx":{"cwd2":"/","deep":{"x2":1}}}'); return b.id; }); // lacks a member that is string
t(() => { const b: B3 = json('{"id":"y","ctx":{"cwd3":"/","deep":{"x3":1}}}'); return b.id; }); // lacks a member that is boolean
t(() => { const b: B4 = json('{"id":"y","ctx":{"cwd4":"/","deep":{"x4":1}}}'); return b.id; }); // lacks a member that is a flat record
t(() => { const b: B5 = json('{"id":"y","ctx":{"cwd5":"/","deep":{"x5":1}}}'); return b.id; }); // lacks a member that is a flat record of a string
t(() => { const b: B6 = json('{"id":"y","ctx":{"cwd6":"/","deep":{"x6":1}}}'); return b.id; }); // lacks a member that is a nested record
t(() => { const b: B7 = json('{"id":"y","ctx":{"cwd7":"/","deep":{"x7":1}}}'); return b.id; }); // lacks a member that is an array of numbers
t(() => { const b: B8 = json('{"id":"y","ctx":{"cwd8":"/","deep":{"x8":1}}}'); return b.id; }); // lacks a member that is an array of records
t(() => { const b: B9 = json('{"id":"y","ctx":{"cwd9":"/","deep":{"x9":1}}}'); return b.id; }); // lacks a member that is any
t(() => { const b: B10 = json('{"id":"y","ctx":{"cwd10":"/","deep":{"x10":1}}}'); return b.id; }); // lacks a member that is unknown
t(() => { const b: B11 = json('{"id":"y","ctx":{"cwd11":"/","deep":{"x11":1}}}'); return b.id; }); // lacks a member that is number | undefined
t(() => { const b: B12 = json('{"id":"y","ctx":{"cwd12":"/","deep":{"x12":1}}}'); return b.id; }); // lacks a member that is string | null
t(() => { const b: B13 = json('{"id":"y","ctx":{"cwd13":"/","deep":{"x13":1}}}'); return b.id; }); // lacks a member that is a Date
t(() => { const b: B14 = json('{"id":"y","ctx":{"cwd14":"/","deep":{"x14":1}}}'); return b.id; }); // lacks a member that is a function
t(() => { const b: B15 = json('{"id":"y","ctx":{"cwd15":"/","deep":{"x15":1}}}'); return b.id; }); // lacks a member that is a Map
t(() => { const b: B16 = json('{"id":"y","ctx":{"cwd16":"/","deep":{"x16":1}}}'); return b.id; }); // lacks a member that is a record of strings
t(() => { const b: B17 = json('{"id":"y","ctx":{"cwd17":"/","deep":{"x17":1}}}'); return b.id; }); // lacks a member that is object
t(() => { const b: B18 = json('{"id":"y","ctx":{"cwd18":"/","deep":{"x18":1}}}'); return b.id; }); // lacks a member that is number, and a type without it stands beside
t(() => { const b: B19 = json('{"id":"y","ctx":{"cwd19":"/","deep":{"x19":1}}}'); return b.id; }); // lacks a member that is string, and a type without it stands beside
t(() => { const b: B20 = json('{"id":"y","ctx":{"cwd20":"/","deep":{"x20":1}}}'); return b.id; }); // lacks a member that is boolean, and a type without it stands beside
t(() => { const b: B21 = json('{"id":"y","ctx":{"cwd21":"/","deep":{"x21":1}}}'); return b.id; }); // lacks a member that is a flat record, and a type without it stands beside
t(() => { const b: B22 = json('{"id":"y","ctx":{"cwd22":"/","deep":{"x22":1}}}'); return b.id; }); // lacks a member that is a flat record of a string, and a type without it stands beside
t(() => { const b: B23 = json('{"id":"y","ctx":{"cwd23":"/","deep":{"x23":1}}}'); return b.id; }); // lacks a member that is a nested record, and a type without it stands beside
t(() => { const b: B24 = json('{"id":"y","ctx":{"cwd24":"/","deep":{"x24":1}}}'); return b.id; }); // lacks a member that is an array of numbers, and a type without it stands beside
t(() => { const b: B25 = json('{"id":"y","ctx":{"cwd25":"/","deep":{"x25":1}}}'); return b.id; }); // lacks a member that is an array of records, and a type without it stands beside
t(() => { const b: B26 = json('{"id":"y","ctx":{"cwd26":"/","deep":{"x26":1}}}'); return b.id; }); // lacks a member that is any, and a type without it stands beside
t(() => { const b: B27 = json('{"id":"y","ctx":{"cwd27":"/","deep":{"x27":1}}}'); return b.id; }); // lacks a member that is unknown, and a type without it stands beside
t(() => { const b: B28 = json('{"id":"y","ctx":{"cwd28":"/","deep":{"x28":1}}}'); return b.id; }); // lacks a member that is number | undefined, and a type without it stands beside
t(() => { const b: B29 = json('{"id":"y","ctx":{"cwd29":"/","deep":{"x29":1}}}'); return b.id; }); // lacks a member that is string | null, and a type without it stands beside
t(() => { const b: B30 = json('{"id":"y","ctx":{"cwd30":"/","deep":{"x30":1}}}'); return b.id; }); // lacks a member that is a Date, and a type without it stands beside
t(() => { const b: B31 = json('{"id":"y","ctx":{"cwd31":"/","deep":{"x31":1}}}'); return b.id; }); // lacks a member that is a function, and a type without it stands beside
t(() => { const b: B32 = json('{"id":"y","ctx":{"cwd32":"/","deep":{"x32":1}}}'); return b.id; }); // lacks a member that is a Map, and a type without it stands beside
t(() => { const b: B33 = json('{"id":"y","ctx":{"cwd33":"/","deep":{"x33":1}}}'); return b.id; }); // lacks a member that is a record of strings, and a type without it stands beside
t(() => { const b: B34 = json('{"id":"y","ctx":{"cwd34":"/","deep":{"x34":1}}}'); return b.id; }); // lacks a member that is object, and a type without it stands beside
export {};
