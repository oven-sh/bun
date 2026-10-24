// An object built by untyped code, with closures that capture only that object, is used through declared types.
interface Api { a: number; plus: (x: number) => number; self: () => unknown }
interface Loose { a: number; [key: string]: unknown }
const lines: string[] = [];
const show = (title: string, f: () => unknown) => { let text: string; try { text = String(f()); } catch (e: any) { text = "throws " + e.constructor.name; } lines.push(title + ": " + text); };
const make = (a: number): any => { const o: any = { a }; o.plus = (x: number) => o.a + x; o.self = () => o; return o; };
const use = (api: Api, x: number): number => api.plus(x) + api.a;
const keys = (o: Loose): string => Object.keys(o).join();
function run() {
    show("as a parameter", () => use(make(1), 2));
    show("as a variable", () => { const api: Api = make(3); return api.plus(4) + " " + (api.plus === api.plus); });
    show("asserted", () => { const o = make(5); const api = o as Api; return [api.plus(1), api.self() === o || api.self() === api, typeof api.plus].join(); });
    show("in an array", () => { const all: Api[] = [make(1), make(2), make(3)]; let sum = 0; for (const api of all) sum += api.plus(1); return sum; });
    show("loose", () => keys(make(6)));
    show("many", () => { let sum = 0; for (let i = 0; i < 500; i++) sum += use(make(i), 1); return sum; });
    show("the same function behind the type", () => { const o = make(7); const f = o.plus; const api: Api = o; return api.plus(1) === f(1); });
    show("read first", () => { const o = make(8); o.plus(1); const api: Api = o; return api.plus(2); });
}
run();
console.log(lines.join("\n"));
