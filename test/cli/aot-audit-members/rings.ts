// A fixture of aot-audit-members.test.ts. One case a line: `t(() => { .. });`. Each runs three times: plain, in an --aot executable, under --aot-audit.
declare const Bun: any, process: any, Buffer: any;
const far = Bun.argv.length > 99 ? 1 : 0;
const anyv = (v: unknown): any => [v, 0][far];
const json = (text: string): any => JSON.parse(text);
let at = 0;
interface CA { cwd: string; deep: { x: number } }
interface OptA { c: CA; n?: number; b?: boolean; s?: string; o?: CA; g?: bigint }
interface Tree { c: CA; l?: Tree; r?: Tree }
const CC = '{"cwd":"/","deep":{"x":1}}';
const keep: unknown[] = [{ c: { cwd: "/", deep: { x: 1 } } } as OptA, { c: { cwd: "/", deep: { x: 1 } } } as Tree];
function t(f: () => unknown) { at++; let said: string; try { const v = f(); said = typeof v + " " + String(v); } catch (e) { said = "threw " + (e as Error).constructor.name + (process.env.WHY ? " " + String((e as Error).message).replace(/ \(bun --aot[^)]*\)/, "").replace(/\n */g, " ~ ") : ""); } console.log(at, said); }
t(() => { const v: OptA = anyv({ c: json(CC), n: undefined }); return typeof v; }); // a literal of typed code: an optional number is undefined
t(() => { const v: OptA = anyv({ c: json(CC), n: undefined, b: undefined, s: undefined, o: undefined, g: undefined }); return typeof v; }); // all of them
t(() => { const v: OptA = anyv(Object.assign(json('{"c":' + CC + "}"), { n: undefined })); return typeof v; }); // outside data: an optional number is undefined
t(() => { const v: OptA = anyv(Object.assign(json('{"c":' + CC + "}"), { b: undefined, s: undefined, o: undefined, g: undefined })); return typeof v; }); // outside data: the others
t(() => { const v: OptA = json('{"c":' + CC + ',"n":null}'); return typeof v; }); // outside data: an optional number is null
t(() => { const v: OptA = json('{"c":' + CC + ',"b":null}'); return typeof v; }); // outside data: an optional boolean is null
t(() => { const v: OptA = json('{"c":' + CC + ',"s":null,"o":null}'); return typeof v; }); // outside data: an optional string and object are null
t(() => { const v: OptA = json('{"c":' + CC + ',"n":"1"}'); return typeof v; }); // outside data: an optional number is a string
t(() => { let d = json('{"c":' + CC + "}"); for (let i = 0; i < 40; i++) { const up = json('{"c":' + CC + "}"); up.l = d; up.r = d; d = up; } const v: Tree = anyv(d); return typeof v; }); // forty levels, each reached twice
t(() => { let d = json("{}"); for (let i = 0; i < 40; i++) { const up = json('{"c":' + CC + "}"); up.l = d; up.r = d; d = up; } const v: Tree = anyv(d); return typeof v; });
t(() => keep.length);
export {};
