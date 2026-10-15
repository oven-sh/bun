// A fixture of aot-audit-members.test.ts. One case a line: `t(() => { .. });`. Each runs three times: plain, in an --aot executable, under --aot-audit.
declare const Bun: any, process: any, Buffer: any;
const far = Bun.argv.length > 99 ? 1 : 0;
const anyv = (v: unknown): any => [v, 0][far];
const json = (text: string): any => JSON.parse(text);
let at = 0;
interface In1 { ida1: string; namea1: string; agea1: number }
interface In2 { ida2: string; namea2: string; agea2: number }
interface In3 { ida3: string; inner3: { deepa3: { x3: number } } }
interface In4 { ida4: string; inner4: { deepa4: { x4: number } } }
interface In5 { ida5: string; agea5: number }
interface In6 { ida6: string; sharedb6: number } interface Other6 { sharedb6: number; z6: { q6: number } }
interface In7 { ida7: string; sharedb7: number }
interface In8 { ida8: string; sharedb8: number }
interface In9 { ida9: string; sharedb9: number }
interface In10 { ida10: string; sharedb10: number }
interface In11 { ida11: string; ctxc11: { cwd11: string; deep: { x11: number } }; extrac11: number }
interface In12 { ida12: string; ctxc12: { cwd12: string; deep: { x12: number } } } function make12(): In12 { return { ida12: "k", ctxc12: { cwd12: "/", deep: { x12: 1 } } }; }
interface In13 { ida13: string; ctxc13: { cwd13: string; deep: { x13: number } } } function make13(): In13 { return { ida13: "k", ctxc13: { cwd13: "/", deep: { x13: 1 } } }; }
interface In14 { ida14: string; ctxc14: { cwd14: string; deep: { x14: number } } } class Maker14 { make(): In14 { return { ida14: "k", ctxc14: { cwd14: "/", deep: { x14: 1 } } }; } }
interface CA15 { cwd15: string } interface A15 { id15: string; ctx15: CA15 } interface MB15 { x15: number } interface B15 { id15: string; ctx15: CA15; more15: MB15 }
interface CA16 { cwd16: string } interface A16 { id16: string; ctx16: CA16 } interface B16 { id16: string; ctx16: CA16; more16: number; also16: string }
function t(f: () => unknown) { at++; let said: string; try { const v = f(); said = typeof v + " " + String(v); } catch (e) { said = "threw " + (e as Error).constructor.name + (process.env.WHY ? " " + String((e as Error).message).replace(/ \(bun --aot[^)]*\)/, "").replace(/\n */g, " ~ ") : ""); } console.log(at, said); }
t(() => { const u: In1 = json('{"ida1":"y","namea1":"n"}'); return u.ida1; }); // no literal of the type anywhere: lacks a member
t(() => { const u: In2 = json('{"ida2":"y","namea2":1,"agea2":"s"}'); return u.ida2; }); // no literal of the type anywhere: two members of the wrong kind
t(() => { const u: In3 = json('{"ida3":"y"}'); return u.ida3; }); // no literal of the type anywhere: lacks an object member
t(() => { const u: In4 = json('{"ida4":"y","inner4":{}}'); return u.ida4; }); // no literal of the type anywhere: the object member lacks
t(() => { const list: In5[] = json('[{"ida5":"y"}]'); let s = ""; for (const u of list) s += u.ida5; return s; }); // no literal of the type anywhere: an element lacks
t(() => { const o: Other6 = { sharedb6: 1, z6: { q6: 1 } }; const u: In6 = json('{"ida6":"y"}'); return u.ida6 + o.sharedb6; }); // the missing name is stored by a literal of another type
t(() => { const o: any = {}; o.sharedb7 = 1; const u: In7 = json('{"ida7":"y"}'); return u.ida7 + o.sharedb7; }); // the missing name is stored through any
t(() => { const o = anyv({ sharedb8: 1 }); const u: In8 = json('{"ida8":"y"}'); return u.ida8 + o.sharedb8; }); // the missing name is in a literal that goes to any
t(() => { const u: In9 = json('{"ida9":"y","sharedb9":1}'); u.sharedb9 = 2; const v: In9 = json('{"ida9":"y"}'); return v.ida9 + u.sharedb9; }); // the missing name is stored to an object of the type
t(() => { const k = "sharedb" + (10 + far); const o: any = {}; o[k] = 1; const u: In10 = json('{"ida10":"y"}'); return u.ida10; }); // the missing name is stored by a computed key alone
t(() => { const part = { cwd11: "/", deep: { x11: 1 } }; const u: In11 = json('{"ida11":"y","ctxc11":{"cwd11":"/","deep":{"x11":1}}}'); return u.ida11 + part.cwd11; }); // lacks a member nobody stores; another member is like a literal of the program
t(() => { const u: In12 = json('{"ida12":"y"}'); return u.ida12; }); // a function that makes one is never called
t(() => { const u: In13 = json('{"ida13":"y"}'); return u.ida13 + make13().ida13; }); // a function that makes one is called
t(() => { const u: In14 = json('{"ida14":"y"}'); return u.ida14; }); // a method that makes one, of a class nobody constructs
t(() => { const a: A15 = { id15: "k", ctx15: { cwd15: "/" } }; const b: B15 = json('{"id15":"y","ctx15":{"cwd15":"/"}}'); return a.id15 + b.id15; }); // nobody stores the member it lacks; the others are stored by a literal of a smaller type
t(() => { const a: A15 = { id15: "k", ctx15: { cwd15: "/" } }; const b: B15 = json('{"id15":"y","more15":{"x15":1}}'); return a.id15 + b.id15; }); // lacks a member that the literal of the smaller type stores
t(() => { const a: A16 = { id16: "k", ctx16: { cwd16: "/" } }; const b: B16 = json('{"id16":"y","ctx16":{"cwd16":"/"},"more16":"s","also16":1}'); return a.id16 + b.id16; }); // nobody stores the two members that are of the wrong kind
export {};
