// A fixture of aot-audit-members.test.ts. One case a line: `t(() => { .. });`. Each runs three times: plain, in an --aot executable, under --aot-audit.
declare const Bun: any, process: any, Buffer: any;
const far = Bun.argv.length > 99 ? 1 : 0;
const anyv = (v: unknown): any => [v, 0][far];
const json = (text: string): any => JSON.parse(text);
let at = 0;
interface C1 { cwd1: string; deep: { x1: number } } interface R1 { id: string; ctx: C1 } const K1: R1 = { id: "k", ctx: { cwd1: "/", deep: { x1: 1 } } }; const G1 = '{"id":"y","ctx":{"cwd1":"/","deep":{"x1":1}}}';
interface C2 { cwd2: string; deep: { x2: number } } interface R2 { id: string; ctx: C2 } const K2: R2 = { id: "k", ctx: { cwd2: "/", deep: { x2: 1 } } }; const G2 = '{"id":"y","ctx":{"cwd2":"/","deep":{"x2":1}}}';
interface C3 { cwd3: string; deep: { x3: number } } interface R3 { id: string; ctx: C3 } const K3: R3 = { id: "k", ctx: { cwd3: "/", deep: { x3: 1 } } }; const G3 = '{"id":"y","ctx":{"cwd3":"/","deep":{"x3":1}}}';
interface C4 { cwd4: string; deep: { x4: number } } interface R4 { id: string; ctx: C4 } const K4: R4 = { id: "k", ctx: { cwd4: "/", deep: { x4: 1 } } }; const G4 = '{"id":"y","ctx":{"cwd4":"/","deep":{"x4":1}}}';
interface C5 { cwd5: string; deep: { x5: number } } interface R5 { id: string; ctx: C5 } const K5: R5 = { id: "k", ctx: { cwd5: "/", deep: { x5: 1 } } }; const G5 = '{"id":"y","ctx":{"cwd5":"/","deep":{"x5":1}}}';
interface C6 { cwd6: string; deep: { x6: number } } interface R6 { id: string; ctx: C6 } const K6: R6 = { id: "k", ctx: { cwd6: "/", deep: { x6: 1 } } }; const G6 = '{"id":"y","ctx":{"cwd6":"/","deep":{"x6":1}}}';
interface C7 { cwd7: string; deep: { x7: number } } interface R7 { id: string; ctx: C7 } const K7: R7 = { id: "k", ctx: { cwd7: "/", deep: { x7: 1 } } }; const G7 = '{"id":"y","ctx":{"cwd7":"/","deep":{"x7":1}}}';
interface C8 { cwd8: string; deep: { x8: number } } interface R8 { id: string; ctx: C8 } const K8: R8 = { id: "k", ctx: { cwd8: "/", deep: { x8: 1 } } }; const G8 = '{"id":"y","ctx":{"cwd8":"/","deep":{"x8":1}}}';
interface C9 { cwd9: string; deep: { x9: number } } interface R9 { id: string; ctx: C9 } const K9: R9 = { id: "k", ctx: { cwd9: "/", deep: { x9: 1 } } }; const G9 = '{"id":"y","ctx":{"cwd9":"/","deep":{"x9":1}}}';
interface C10 { cwd10: string; deep: { x10: number } } interface R10 { id: string; ctx: C10 } const K10: R10 = { id: "k", ctx: { cwd10: "/", deep: { x10: 1 } } }; const G10 = '{"id":"y","ctx":{"cwd10":"/","deep":{"x10":1}}}';
interface C11 { cwd11: string; deep: { x11: number } } interface R11 { id: string; ctx: C11 } const K11: R11 = { id: "k", ctx: { cwd11: "/", deep: { x11: 1 } } }; const G11 = '{"id":"y","ctx":{"cwd11":"/","deep":{"x11":1}}}';
interface C12 { cwd12: string; deep: { x12: number } } interface R12 { id: string; ctx: C12 } const K12: R12 = { id: "k", ctx: { cwd12: "/", deep: { x12: 1 } } }; const G12 = '{"id":"y","ctx":{"cwd12":"/","deep":{"x12":1}}}';
interface C13 { cwd13: string; deep: { x13: number } } interface R13 { id: string; ctx: C13 } const K13: R13 = { id: "k", ctx: { cwd13: "/", deep: { x13: 1 } } }; const G13 = '{"id":"y","ctx":{"cwd13":"/","deep":{"x13":1}}}';
interface C14 { cwd14: string; deep: { x14: number } } interface R14 { id: string; ctx: C14 } const K14: R14 = { id: "k", ctx: { cwd14: "/", deep: { x14: 1 } } }; const G14 = '{"id":"y","ctx":{"cwd14":"/","deep":{"x14":1}}}';
interface C15 { cwd15: string; deep: { x15: number } } interface R15 { id: string; ctx: C15 } const K15: R15 = { id: "k", ctx: { cwd15: "/", deep: { x15: 1 } } }; const G15 = '{"id":"y","ctx":{"cwd15":"/","deep":{"x15":1}}}';
interface C16 { cwd16: string; deep: { x16: number } } interface R16 { id: string; ctx: C16 } const K16: R16 = { id: "k", ctx: { cwd16: "/", deep: { x16: 1 } } }; const G16 = '{"id":"y","ctx":{"cwd16":"/","deep":{"x16":1}}}';
interface C17 { cwd17: string; deep: { x17: number } } interface R17 { id: string; ctx: C17 } const K17: R17 = { id: "k", ctx: { cwd17: "/", deep: { x17: 1 } } }; const G17 = '{"id":"y","ctx":{"cwd17":"/","deep":{"x17":1}}}';
interface C18 { cwd18: string; deep: { x18: number } } interface R18 { id: string; ctx: C18 } const K18: R18 = { id: "k", ctx: { cwd18: "/", deep: { x18: 1 } } }; const G18 = '{"id":"y","ctx":{"cwd18":"/","deep":{"x18":1}}}';
interface C19 { cwd19: string; deep: { x19: number } } interface R19 { id: string; ctx: C19 } const K19: R19 = { id: "k", ctx: { cwd19: "/", deep: { x19: 1 } } }; const G19 = '{"id":"y","ctx":{"cwd19":"/","deep":{"x19":1}}}';
interface C20 { cwd20: string; deep: { x20: number } } interface R20 { id: string; ctx: C20 } const K20: R20 = { id: "k", ctx: { cwd20: "/", deep: { x20: 1 } } }; const G20 = '{"id":"y","ctx":{"cwd20":"/","deep":{"x20":1}}}';
interface C21 { cwd21: string; deep: { x21: number } } interface R21 { id: string; ctx: C21 } const K21: R21 = { id: "k", ctx: { cwd21: "/", deep: { x21: 1 } } }; const G21 = '{"id":"y","ctx":{"cwd21":"/","deep":{"x21":1}}}';
interface C22 { cwd22: string; deep: { x22: number } } interface R22 { id: string; ctx: C22 } const K22: R22 = { id: "k", ctx: { cwd22: "/", deep: { x22: 1 } } }; const G22 = '{"id":"y","ctx":{"cwd22":"/","deep":{"x22":1}}}';
interface C23 { cwd23: string; deep: { x23: number } } interface R23 { id: string; ctx: C23 } const K23: R23 = { id: "k", ctx: { cwd23: "/", deep: { x23: 1 } } }; const G23 = '{"id":"y","ctx":{"cwd23":"/","deep":{"x23":1}}}';
interface C24 { cwd24: string; deep: { x24: number } } interface R24 { id: string; ctx: C24 } const K24: R24 = { id: "k", ctx: { cwd24: "/", deep: { x24: 1 } } }; const G24 = '{"id":"y","ctx":{"cwd24":"/","deep":{"x24":1}}}';
interface C25 { cwd25: string; deep: { x25: number } } interface R25 { id: string; ctx: C25 } const K25: R25 = { id: "k", ctx: { cwd25: "/", deep: { x25: 1 } } }; const G25 = '{"id":"y","ctx":{"cwd25":"/","deep":{"x25":1}}}';
interface C26 { cwd26: string; deep: { x26: number } } interface R26 { id: string; ctx: C26 } const K26: R26 = { id: "k", ctx: { cwd26: "/", deep: { x26: 1 } } }; const G26 = '{"id":"y","ctx":{"cwd26":"/","deep":{"x26":1}}}';
interface C27 { cwd27: string; deep: { x27: number } } interface R27 { id: string; ctx: C27 } const K27: R27 = { id: "k", ctx: { cwd27: "/", deep: { x27: 1 } } }; const G27 = '{"id":"y","ctx":{"cwd27":"/","deep":{"x27":1}}}';
interface C28 { cwd28: string; deep: { x28: number } } interface R28 { id: string; ctx: C28 } const K28: R28 = { id: "k", ctx: { cwd28: "/", deep: { x28: 1 } } }; const G28 = '{"id":"y","ctx":{"cwd28":"/","deep":{"x28":1}}}';
interface C29 { cwd29: string; deep: { x29: number } } interface R29 { id: string; ctx: C29 } const K29: R29 = { id: "k", ctx: { cwd29: "/", deep: { x29: 1 } } }; const G29 = '{"id":"y","ctx":{"cwd29":"/","deep":{"x29":1}}}';
interface C30 { cwd30: string; deep: { x30: number } } interface R30 { id: string; ctx: C30 } const K30: R30 = { id: "k", ctx: { cwd30: "/", deep: { x30: 1 } } }; const G30 = '{"id":"y","ctx":{"cwd30":"/","deep":{"x30":1}}}';
interface C31 { cwd31: string; deep: { x31: number } } interface R31 { id: string; ctx: C31 } const K31: R31 = { id: "k", ctx: { cwd31: "/", deep: { x31: 1 } } }; const G31 = '{"id":"y","ctx":{"cwd31":"/","deep":{"x31":1}}}';
interface C32 { cwd32: string; deep: { x32: number } } interface R32 { id: string; ctx: C32 } const K32: R32 = { id: "k", ctx: { cwd32: "/", deep: { x32: 1 } } }; const G32 = '{"id":"y","ctx":{"cwd32":"/","deep":{"x32":1}}}';
interface C33 { cwd33: string; deep: { x33: number } } interface R33 { id: string; ctx: C33 } const K33: R33 = { id: "k", ctx: { cwd33: "/", deep: { x33: 1 } } }; const G33 = '{"id":"y","ctx":{"cwd33":"/","deep":{"x33":1}}}';
interface C34 { cwd34: string; deep: { x34: number } } interface R34 { id: string; ctx: C34 } const K34: R34 = { id: "k", ctx: { cwd34: "/", deep: { x34: 1 } } }; const G34 = '{"id":"y","ctx":{"cwd34":"/","deep":{"x34":1}}}';
interface C35 { cwd35: string; deep: { x35: number } } interface R35 { id: string; ctx: C35 } const K35: R35 = { id: "k", ctx: { cwd35: "/", deep: { x35: 1 } } }; const G35 = '{"id":"y","ctx":{"cwd35":"/","deep":{"x35":1}}}';
interface C36 { cwd36: string; deep: { x36: number } } interface R36 { id: string; ctx: C36 } const K36: R36 = { id: "k", ctx: { cwd36: "/", deep: { x36: 1 } } }; const G36 = '{"id":"y","ctx":{"cwd36":"/","deep":{"x36":1}}}';
interface C37 { cwd37: string; deep: { x37: number } } interface R37 { id: string; ctx: C37 } const K37: R37 = { id: "k", ctx: { cwd37: "/", deep: { x37: 1 } } }; const G37 = '{"id":"y","ctx":{"cwd37":"/","deep":{"x37":1}}}';
interface C38 { cwd38: string; deep: { x38: number } } interface R38 { id: string; ctx: C38 } const K38: R38 = { id: "k", ctx: { cwd38: "/", deep: { x38: 1 } } }; const G38 = '{"id":"y","ctx":{"cwd38":"/","deep":{"x38":1}}}';
interface C39 { cwd39: string; deep: { x39: number } } interface R39 { id: string; ctx: C39 } const K39: R39 = { id: "k", ctx: { cwd39: "/", deep: { x39: 1 } } }; const G39 = '{"id":"y","ctx":{"cwd39":"/","deep":{"x39":1}}}';
interface C40 { cwd40: string; deep: { x40: number } } interface R40 { id: string; ctx: C40 } const K40: R40 = { id: "k", ctx: { cwd40: "/", deep: { x40: 1 } } }; const G40 = '{"id":"y","ctx":{"cwd40":"/","deep":{"x40":1}}}';
interface C41 { cwd41: string; deep: { x41: number } } interface R41 { id: string; ctx: C41 } const K41: R41 = { id: "k", ctx: { cwd41: "/", deep: { x41: 1 } } }; const G41 = '{"id":"y","ctx":{"cwd41":"/","deep":{"x41":1}}}';
interface C42 { cwd42: string; deep: { x42: number } } interface R42 { id: string; ctx: C42 } const K42: R42 = { id: "k", ctx: { cwd42: "/", deep: { x42: 1 } } }; const G42 = '{"id":"y","ctx":{"cwd42":"/","deep":{"x42":1}}}';
interface C43 { cwd43: string; deep: { x43: number } } interface R43 { id: string; ctx: C43 } const K43: R43 = { id: "k", ctx: { cwd43: "/", deep: { x43: 1 } } }; const G43 = '{"id":"y","ctx":{"cwd43":"/","deep":{"x43":1}}}';
interface C44 { cwd44: string; deep: { x44: number } } interface R44 { id: string; ctx: C44 } const K44: R44 = { id: "k", ctx: { cwd44: "/", deep: { x44: 1 } } }; const G44 = '{"id":"y","ctx":{"cwd44":"/","deep":{"x44":1}}}';
interface C45 { cwd45: string; deep: { x45: number } } interface R45 { id: string; ctx: C45 } const K45: R45 = { id: "k", ctx: { cwd45: "/", deep: { x45: 1 } } }; const G45 = '{"id":"y","ctx":{"cwd45":"/","deep":{"x45":1}}}';
interface C46 { cwd46: string; deep: { x46: number } } interface R46 { id: string; ctx: C46 } const K46: R46 = { id: "k", ctx: { cwd46: "/", deep: { x46: 1 } } }; const G46 = '{"id":"y","ctx":{"cwd46":"/","deep":{"x46":1}}}';
interface C47 { cwd47: string; deep: { x47: number } } interface R47 { id: string; ctx: C47 } const K47: R47 = { id: "k", ctx: { cwd47: "/", deep: { x47: 1 } } }; const G47 = '{"id":"y","ctx":{"cwd47":"/","deep":{"x47":1}}}';
interface C48 { cwd48: string; deep: { x48: number } } interface R48 { id: string; ctx: C48 } const K48: R48 = { id: "k", ctx: { cwd48: "/", deep: { x48: 1 } } }; const G48 = '{"id":"y","ctx":{"cwd48":"/","deep":{"x48":1}}}';
interface C49 { cwd49: string; deep: { x49: number } } interface R49 { id: string; ctx: C49 } const K49: R49 = { id: "k", ctx: { cwd49: "/", deep: { x49: 1 } } }; const G49 = '{"id":"y","ctx":{"cwd49":"/","deep":{"x49":1}}}';
interface C50 { cwd50: string; deep: { x50: number } } interface R50 { id: string; ctx: C50 } const K50: R50 = { id: "k", ctx: { cwd50: "/", deep: { x50: 1 } } }; const G50 = '{"id":"y","ctx":{"cwd50":"/","deep":{"x50":1}}}';
interface C51 { cwd51: string; deep: { x51: number } } interface R51 { id: string; ctx: C51 } const K51: R51 = { id: "k", ctx: { cwd51: "/", deep: { x51: 1 } } }; const G51 = '{"id":"y","ctx":{"cwd51":"/","deep":{"x51":1}}}';
interface C52 { cwd52: string; deep: { x52: number } } interface R52 { id: string; ctx: C52 } const K52: R52 = { id: "k", ctx: { cwd52: "/", deep: { x52: 1 } } }; const G52 = '{"id":"y","ctx":{"cwd52":"/","deep":{"x52":1}}}';
interface C53 { cwd53: string; deep: { x53: number } } interface R53 { id: string; ctx: C53 } const K53: R53 = { id: "k", ctx: { cwd53: "/", deep: { x53: 1 } } }; const G53 = '{"id":"y","ctx":{"cwd53":"/","deep":{"x53":1}}}';
interface C54 { cwd54: string; deep: { x54: number } } interface R54 { id: string; ctx: C54 } const K54: R54 = { id: "k", ctx: { cwd54: "/", deep: { x54: 1 } } }; const G54 = '{"id":"y","ctx":{"cwd54":"/","deep":{"x54":1}}}';
interface C55 { cwd55: string; deep: { x55: number } } interface R55 { id: string; ctx: C55 } const K55: R55 = { id: "k", ctx: { cwd55: "/", deep: { x55: 1 } } }; const G55 = '{"id":"y","ctx":{"cwd55":"/","deep":{"x55":1}}}';
interface C56 { cwd56: string; deep: { x56: number } } interface R56 { id: string; ctx: C56 } const K56: R56 = { id: "k", ctx: { cwd56: "/", deep: { x56: 1 } } }; const G56 = '{"id":"y","ctx":{"cwd56":"/","deep":{"x56":1}}}';
interface C57 { cwd57: string; deep: { x57: number } } interface R57 { id: string; ctx: C57 } const K57: R57 = { id: "k", ctx: { cwd57: "/", deep: { x57: 1 } } }; const G57 = '{"id":"y","ctx":{"cwd57":"/","deep":{"x57":1}}}';
interface C58 { cwd58: string; deep: { x58: number } } interface R58 { id: string; ctx: C58 } const K58: R58 = { id: "k", ctx: { cwd58: "/", deep: { x58: 1 } } }; const G58 = '{"id":"y","ctx":{"cwd58":"/","deep":{"x58":1}}}';
interface C59 { cwd59: string; deep: { x59: number } } interface R59 { id: string; ctx: C59 } const K59: R59 = { id: "k", ctx: { cwd59: "/", deep: { x59: 1 } } }; const G59 = '{"id":"y","ctx":{"cwd59":"/","deep":{"x59":1}}}';
interface C60 { cwd60: string; deep: { x60: number } } interface R60 { id: string; ctx: C60 } const K60: R60 = { id: "k", ctx: { cwd60: "/", deep: { x60: 1 } } }; const G60 = '{"id":"y","ctx":{"cwd60":"/","deep":{"x60":1}}}';
interface C61 { cwd61: string; deep: { x61: number } } interface R61 { id: string; ctx: C61 } const K61: R61 = { id: "k", ctx: { cwd61: "/", deep: { x61: 1 } } }; const G61 = '{"id":"y","ctx":{"cwd61":"/","deep":{"x61":1}}}';
interface C62 { cwd62: string; deep: { x62: number } } interface R62 { id: string; ctx: C62 } const K62: R62 = { id: "k", ctx: { cwd62: "/", deep: { x62: 1 } } }; const G62 = '{"id":"y","ctx":{"cwd62":"/","deep":{"x62":1}}}';
interface C63 { cwd63: string; deep: { x63: number } } interface R63 { id: string; ctx: C63 } const K63: R63 = { id: "k", ctx: { cwd63: "/", deep: { x63: 1 } } }; const G63 = '{"id":"y","ctx":{"cwd63":"/","deep":{"x63":1}}}';
interface C64 { cwd64: string; deep: { x64: number } } interface R64 { id: string; ctx: C64 } const K64: R64 = { id: "k", ctx: { cwd64: "/", deep: { x64: 1 } } }; const G64 = '{"id":"y","ctx":{"cwd64":"/","deep":{"x64":1}}}';
interface C65 { cwd65: string; deep: { x65: number } } interface R65 { id: string; ctx: C65 } const K65: R65 = { id: "k", ctx: { cwd65: "/", deep: { x65: 1 } } }; const G65 = '{"id":"y","ctx":{"cwd65":"/","deep":{"x65":1}}}';
const CC = '{"cwd":"/","deep":{"x":1}}', G = '{"id":"y","ctx":' + CC + "}", L = '{"id":"y"}';
function t(f: () => unknown) { at++; let said: string; try { const v = f(); said = typeof v + " " + String(v); } catch (e) { said = "threw " + (e as Error).constructor.name + (process.env.WHY ? " " + String((e as Error).message).replace(/ \(bun --aot[^)]*\)/, "").replace(/\n */g, " ~ ") : ""); } console.log(at, said); }
async function ta(f: () => Promise<unknown>) { at++; let said: string; try { const v = await f(); said = typeof v + " " + String(v); } catch (e) { said = "threw " + (e as Error).constructor.name + (process.env.WHY ? " " + String((e as Error).message).replace(/ \(bun --aot[^)]*\)/, "").replace(/\n */g, " ~ ") : ""); } console.log(at, said); }
t(() => { const v: R1 = anyv(json(G1)); return typeof v; }); // variable: fits
t(() => { const v: R1 = anyv(json(L)); return typeof v; }); // variable: LACKS
t(() => { const v: R2 = JSON.parse(G2); return typeof v; }); // variable, fresh by the text: fits
t(() => { const v: R2 = JSON.parse(L); return typeof v; }); // variable, fresh by the text: LACKS
t(() => { let v: R3 = K3; v = anyv(json(G3)); return typeof v; }); // let, assigned later: fits
t(() => { let v: R3 = K3; v = anyv(json(L)); return typeof v; }); // let, assigned later: LACKS
t(() => { function f(): R4 { return anyv(json(G4)); } return typeof f(); }); // return: fits
t(() => { function f(): R4 { return anyv(json(L)); } return typeof f(); }); // return: LACKS
t(() => { const f = (): R5 => anyv(json(G5)); return typeof f(); }); // arrow return: fits
t(() => { const f = (): R5 => anyv(json(L)); return typeof f(); }); // arrow return: LACKS
t(() => { function f(r: R6) { return typeof r; } return f(anyv(json(G6))); }); // argument: fits
t(() => { function f(r: R6) { return typeof r; } return f(anyv(json(L))); }); // argument: LACKS
t(() => { class M { m(r: R7) { return typeof r; } } return new M().m(anyv(json(G7))); }); // argument of a method: fits
t(() => { class M { m(r: R7) { return typeof r; } } return new M().m(anyv(json(L))); }); // argument of a method: LACKS
t(() => { function f(r: R8) { return typeof r; } return (f as any)(json(G8)); }); // argument through any: fits
t(() => { function f(r: R8) { return typeof r; } return (f as any)(json(L)); }); // argument through any: LACKS
t(() => { class M { m(r: R10) { return typeof r; } } return (new M() as any).m(json(G10)); }); // argument of a method through any: fits
t(() => { class M { m(r: R10) { return typeof r; } } return (new M() as any).m(json(L)); }); // argument of a method through any: LACKS // silent: a parameter: every object passes in the mask of the prologue, for the price
t(() => { let s = ""; [json(G11)].forEach((r: R11) => { s += typeof r; }); return s; }); // callback from a native: fits
t(() => { let s = ""; [json(L)].forEach((r: R11) => { s += typeof r; }); return s; }); // callback from a native: LACKS // silent: a parameter: every object passes in the mask of the prologue, for the price
t(() => { let s = ""; [json(G12)].forEach(({ id }: R12) => { s += typeof id; }); return s; }); // callback with a pattern from a native: fits
t(() => { let s = ""; [json(L)].forEach(({ id }: R12) => { s += typeof id; }); return s; }); // callback with a pattern from a native: LACKS // silent: a pattern: there is no row where no binding is read
t(() => { const box: { r: R13 } = { r: K13 }; box.r = anyv(json(G13)); return typeof box.r; }); // field store: fits
t(() => { const box: { r: R13 } = { r: K13 }; box.r = anyv(json(L)); return typeof box.r; }); // field store: LACKS
t(() => { class H { r: R14 = K14; } const h = new H(); h.r = anyv(json(G14)); return typeof h.r; }); // class field store: fits
t(() => { class H { r: R14 = K14; } const h = new H(); h.r = anyv(json(L)); return typeof h.r; }); // class field store: LACKS
t(() => { class H { r: R15 = K15; } const h: any = new H(); h.r = json(G15); return typeof h.r; }); // field store through any: fits
t(() => { class H { r: R15 = K15; } const h: any = new H(); h.r = json(L); return typeof h.r; }); // field store through any: LACKS
t(() => { const list: R16[] = json("[" + G16 + "]"); return typeof list[0]; }); // element read: fits
t(() => { const list: R16[] = json("[" + L + "]"); return typeof list[0]; }); // element read: LACKS
t(() => { const list: R17[] = json("[" + G17 + "]"); return list[0].id; }); // element read, then a member: fits
t(() => { const list: R17[] = json("[" + L + "]"); return list[0].id; }); // element read, then a member: LACKS
t(() => { let s = ""; const list: R18[] = json("[" + G18 + "]"); for (const r of list) s += typeof r; return s; }); // for of: fits
t(() => { let s = ""; const list: R18[] = json("[" + L + "]"); for (const r of list) s += typeof r; return s; }); // for of: LACKS // silent: a claim is tested where its binding is first read, and `typeof` of a name is no read
t(() => { let s = ""; const list: R19[] = json("[" + G19 + "]"); for (const { id } of list) s += typeof id; return s; }); // for of with a pattern: fits
t(() => { let s = ""; const list: R19[] = json("[" + L + "]"); for (const { id } of list) s += typeof id; return s; }); // for of with a pattern: LACKS // silent: a pattern: there is no row where no binding is read
t(() => { const [r]: R20[] = json("[" + G20 + "]"); return typeof r; }); // array pattern: fits
t(() => { const [r]: R20[] = json("[" + L + "]"); return typeof r; }); // array pattern: LACKS // silent: a claim is tested where its binding is first read, and `typeof` of a name is no read
t(() => { function all(): R21[] { return json("[" + G21 + "]"); } const [r] = all(); return typeof r; }); // array pattern of a call: fits
t(() => { function all(): R21[] { return json("[" + L + "]"); } const [r] = all(); return typeof r; }); // array pattern of a call: LACKS // silent: a claim is tested where its binding is first read, and `typeof` of a name is no read
t(() => { const list: R22[] = json("[" + G22 + "]"); const [...rest] = list; return typeof rest[0]; }); // spread of the array: fits
t(() => { const list: R22[] = json("[" + L + "]"); const [...rest] = list; return typeof rest[0]; }); // spread of the array: LACKS
t(() => { const list: R23[] = json("[" + G23 + "]"); return list.map(r => typeof r).join(); }); // map callback: fits
t(() => { const list: R23[] = json("[" + L + "]"); return list.map(r => typeof r).join(); }); // map callback: LACKS // silent: a parameter: every object passes in the mask of the prologue, for the price
t(() => { const list: R24[] = json("[" + G24 + "]"); return typeof list.find(r => true); }); // find: fits
t(() => { const list: R24[] = json("[" + L + "]"); return typeof list.find(r => true); }); // find: LACKS // silent: a parameter: every object passes in the mask of the prologue, for the price
t(() => { const list: R25[] = json("[" + G25 + "]"); return typeof list.at(0); }); // at: fits
t(() => { const list: R25[] = json("[" + L + "]"); return typeof list.at(0); }); // at: LACKS
t(() => { const list: R26[] = json("[" + G26 + "]"); return typeof list.pop(); }); // pop: fits
t(() => { const list: R26[] = json("[" + L + "]"); return typeof list.pop(); }); // pop: LACKS
t(() => { const list: R27[] = [K27]; list.push(anyv(json(G27))); return typeof list[1]; }); // push: fits
t(() => { const list: R27[] = [K27]; list.push(anyv(json(L))); return typeof list[1]; }); // push: LACKS
t(() => { const list: R28[] = [K28]; list[0] = anyv(json(G28)); return typeof list[0]; }); // index store: fits
t(() => { const list: R28[] = [K28]; list[0] = anyv(json(L)); return typeof list[0]; }); // index store: LACKS
t(() => { const m: Map<string, R29> = anyv(new Map([["a", json(G29)]])); return typeof m.get("a"); }); // Map.get: fits
t(() => { const m: Map<string, R29> = anyv(new Map([["a", json(L)]])); return typeof m.get("a"); }); // Map.get: LACKS
t(() => { const m = new Map<string, R30>(); m.set("a", anyv(json(G30))); return typeof m.get("a"); }); // Map.set: fits
t(() => { const m = new Map<string, R30>(); m.set("a", anyv(json(L))); return typeof m.get("a"); }); // Map.set: LACKS
t(() => { let s = ""; const m: Map<string, R31> = anyv(new Map([["a", json(G31)]])); for (const r of m.values()) s += typeof r; return s; }); // Map values: fits
t(() => { let s = ""; const m: Map<string, R31> = anyv(new Map([["a", json(L)]])); for (const r of m.values()) s += typeof r; return s; }); // Map values: LACKS // silent: a claim is tested where its binding is first read, and `typeof` of a name is no read
t(() => { let s = ""; const m: Set<R32> = anyv(new Set([json(G32)])); for (const r of m) s += typeof r; return s; }); // Set for of: fits
t(() => { let s = ""; const m: Set<R32> = anyv(new Set([json(L)])); for (const r of m) s += typeof r; return s; }); // Set for of: LACKS // silent: a claim is tested where its binding is first read, and `typeof` of a name is no read
t(() => { const o: { r: R33; z: R33 } = anyv({ r: json(G33), z: K33 }); return typeof o.r; }); // property read of a record: fits // silent: what typed code has made goes by its layout in a build, which the audit does not know
t(() => { const o: { r: R33; z: R33 } = anyv({ r: json(L), z: K33 }); return typeof o.r; }); // property read of a record: LACKS // silent: what typed code has made goes by its layout in a build, which the audit does not know
t(() => { const o: { r: R34 } = json('{"r":' + G34 + "}"); return typeof o.r; }); // property read of data: fits
t(() => { const o: { r: R34 } = json('{"r":' + L + "}"); return typeof o.r; }); // property read of data: LACKS
t(() => { const { r }: { r: R35 } = json('{"r":' + G35 + "}"); return typeof r; }); // object pattern: fits
t(() => { const { r }: { r: R35 } = json('{"r":' + L + "}"); return typeof r; }); // object pattern: LACKS
t(() => { function pick<T>(x: unknown): T { return x as T; } const v = pick<R36>(json(G36)); return typeof v; }); // call result of a generic: fits
t(() => { function pick<T>(x: unknown): T { return x as T; } const v = pick<R36>(json(L)); return typeof v; }); // call result of a generic: LACKS
t(() => { function pick<T>(x: unknown): T { return x as T; } return pick<R37>(json(G37)).id; }); // call result of a generic, then a member: fits
t(() => { function pick<T>(x: unknown): T { return x as T; } return pick<R37>(json(L)).id; }); // call result of a generic, then a member: LACKS
t(() => { const f: any = () => json(G38); const v: R38 = f(); return typeof v; }); // call result through any: fits
t(() => { const f: any = () => json(L); const v: R38 = f(); return typeof v; }); // call result through any: LACKS
t(() => { const d = json(G39) as R39; const v: R39 = d; return typeof v; }); // as, then a typed variable: fits
t(() => { const d = json(L) as R39; const v: R39 = d; return typeof v; }); // as, then a typed variable: LACKS
t(() => { const d = anyv(json(G40)) as R40; return d.id; }); // as, then a member: fits
t(() => { const d = anyv(json(L)) as R40; return d.id; }); // as, then a member: LACKS
t(() => { const d = anyv(json(G41)) as R41; return typeof d.ctx; }); // as, then the object member: fits
t(() => { const d = anyv(json(L)) as R41; return typeof d.ctx; }); // as, then the object member: LACKS
t(() => { function f(r: R42) { return typeof r; } return f(anyv(json(G42)) as R42); }); // as, then an argument: fits
t(() => { function f(r: R42) { return typeof r; } return f(anyv(json(L)) as R42); }); // as, then an argument: LACKS
t(() => { const v: R43 | null = anyv(json(G43)); return typeof v; }); // union with null: fits
t(() => { const v: R43 | null = anyv(json(L)); return typeof v; }); // union with null: LACKS
t(() => { const v: R44 | string = anyv(json(G44)); return typeof v; }); // union with a string: fits
t(() => { const v: R44 | string = anyv(json(L)); return typeof v; }); // union with a string: LACKS
t(() => { const v: R45 | number[] = anyv(json(G45)); return typeof v; }); // union with an array: fits
t(() => { const v: R45 | number[] = anyv(json(L)); return typeof v; }); // union with an array: LACKS
t(() => { function f(r?: R46) { return typeof r; } return f(anyv(json(G46))); }); // optional parameter: fits
t(() => { function f(r?: R46) { return typeof r; } return f(anyv(json(L))); }); // optional parameter: LACKS
t(() => { function f(r: R47 = K47) { return typeof r; } return f(anyv(json(G47))); }); // default parameter: fits
t(() => { function f(r: R47 = K47) { return typeof r; } return f(anyv(json(L))); }); // default parameter: LACKS
t(() => { function f(...rs: R48[]) { return typeof rs[0]; } return f(anyv(json(G48))); }); // rest parameter: fits
t(() => { function f(...rs: R48[]) { return typeof rs[0]; } return f(anyv(json(L))); }); // rest parameter: LACKS
t(() => { const v: R49 = far ? K49 : anyv(json(G49)); return typeof v; }); // ternary: fits
t(() => { const v: R49 = far ? K49 : anyv(json(L)); return typeof v; }); // ternary: LACKS
t(() => { const v: R50 = anyv(null) ?? anyv(json(G50)); return typeof v; }); // nullish: fits
t(() => { const v: R50 = anyv(null) ?? anyv(json(L)); return typeof v; }); // nullish: LACKS
t(() => { const v = anyv(json(G51)) satisfies R51; return typeof v; }); // satisfies: fits
t(() => { const v = anyv(json(L)) satisfies R51; return typeof v; }); // satisfies: LACKS
t(() => { const v: R52 = anyv(json(G52))!; return typeof v; }); // non-null: fits
t(() => { const v: R52 = anyv(json(L))!; return typeof v; }); // non-null: LACKS
t(() => { const d: unknown = json(G53); if (typeof d === "object" && d !== null) { const v = d as R53; return typeof v; } return 0; }); // typeof guard: fits
t(() => { const d: unknown = json(L); if (typeof d === "object" && d !== null) { const v = d as R53; return typeof v; } return 0; }); // typeof guard: LACKS
t(() => { function isR(x: unknown): x is R54 { return true; } const d: unknown = json(G54); if (isR(d)) return d.id; return 0; }); // a predicate: fits
t(() => { function isR(x: unknown): x is R54 { return true; } const d: unknown = json(L); if (isR(d)) return d.id; return 0; }); // a predicate: LACKS
t(() => { function isR(x: unknown): x is R55 { return true; } const d: unknown = json(G55); if (isR(d)) return typeof d.ctx; return 0; }); // a predicate, then the object member: fits
t(() => { function isR(x: unknown): x is R55 { return true; } const d: unknown = json(L); if (isR(d)) return typeof d.ctx; return 0; }); // a predicate, then the object member: LACKS
t(() => { const d: R56 | string = anyv(json(G56)); if (typeof d !== "string") return d.id; return 0; }); // in guard: fits
t(() => { const d: R56 | string = anyv(json(L)); if (typeof d !== "string") return d.id; return 0; }); // in guard: LACKS
t(() => { try { throw json(G57); } catch (e) { const v: R57 = e as any; return typeof v; } }); // catch: fits
t(() => { try { throw json(L); } catch (e) { const v: R57 = e as any; return typeof v; } }); // catch: LACKS // silent: a claim is tested where its binding is first read, and `typeof` of a name is no read
await ta(async () => { const v: R58 = await Promise.resolve(anyv(json(G58))); return typeof v; }); // await of a promise of any: fits
await ta(async () => { const v: R58 = await Promise.resolve(anyv(json(L))); return typeof v; }); // await of a promise of any: LACKS
await ta(async () => { const f = async (): Promise<R59> => anyv(json(G59)); return typeof (await f()); }); // await of a typed async function: fits
await ta(async () => { const f = async (): Promise<R59> => anyv(json(L)); return typeof (await f()); }); // await of a typed async function: LACKS
await ta(async () => { const f = async (): Promise<R60> => await Promise.resolve(json(G60) as Promise<any>); return (await f()).id; }); // await of a typed async function, then a member: fits
await ta(async () => { const f = async (): Promise<R60> => await Promise.resolve(json(L) as Promise<any>); return (await f()).id; }); // await of a typed async function, then a member: LACKS
await ta(async () => { const p: Promise<R61> = Promise.resolve(anyv(json(G61))); return typeof (await p); }); // await of a typed promise: fits
await ta(async () => { const p: Promise<R61> = Promise.resolve(anyv(json(L))); return typeof (await p); }); // await of a typed promise: LACKS
await ta(async () => { const p: Promise<R62> = Promise.resolve(anyv(json(G62))); return await p.then(r => typeof r); }); // then: fits
await ta(async () => { const p: Promise<R62> = Promise.resolve(anyv(json(L))); return await p.then(r => typeof r); }); // then: LACKS // silent: a parameter: every object passes in the mask of the prologue, for the price
await ta(async () => { let s = ""; async function* g(): AsyncGenerator<R63> { yield anyv(json(G63)); } for await (const r of g()) s += typeof r; return s; }); // for await: fits
await ta(async () => { let s = ""; async function* g(): AsyncGenerator<R63> { yield anyv(json(L)); } for await (const r of g()) s += typeof r; return s; }); // for await: LACKS // silent: a claim is tested where its binding is first read, and `typeof` of a name is no read
await ta(async () => { let s = ""; function* g(): Generator<R64> { yield anyv(json(G64)); } for (const r of g()) s += typeof r; return s; }); // a generator: fits
await ta(async () => { let s = ""; function* g(): Generator<R64> { yield anyv(json(L)); } for (const r of g()) s += typeof r; return s; }); // a generator: LACKS // silent: a claim is tested where its binding is first read, and `typeof` of a name is no read
await ta(async () => { const f = async ({ id }: R65) => typeof id; return await (f as any)(json(G65)); }); // async callback with a pattern through any: fits
await ta(async () => { const f = async ({ id }: R65) => typeof id; return await (f as any)(json(L)); }); // async callback with a pattern through any: LACKS // silent: a pattern: there is no row where no binding is read
export {};
