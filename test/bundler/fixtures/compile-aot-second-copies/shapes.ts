export function Item(this: any, tag: any, key: any, child: any) { this.tag = tag; this.key = key; this.child = child; }
const strangeNames = ["other", "tag", "key", "child"];
export const member = () => new (Item as any)("t", "k", "c");
export const stranger = process.argv.includes("--no-strangers") ? member : () => { const o: any = { }; for (const name of strangeNames) o[name] = name[0]; return o; };
export function readsAll(o: any) { const a = o.tag; const b = o.key; const c = o.child; return a + b + c; }
export function readsAround(o: any, f: any) { const a = o.tag; f(); const b = o.key; f(); return a + b + o.child; }
let calls = 0;
export function touches() { ++calls; }
export function around(list: any[]) { let s = ""; for (const o of list) s += readsAround(o, touches); return s.length; }
export function passes(value: number) { return value; }
export function spins(o: any, n: number, passes: (value: number) => number) {
    let sum = 0;
    for (let i = 0; i < n; ++i) {
        sum += passes(o.tag.length) + o.key.length;
        sum += Math.sqrt(o.child.length + i) | 0;
    }
    return sum;
}
export function sums(list: any[]) { let s = ""; for (const o of list) s += readsAll(o); return s.length; }
import { readFileSync } from "node:fs";
export function counters() {
    const path = process.env.BUN_JSC_aotTypeCoverageCountsPath;
    if (!path) return "";
    Bun.gc(true);
    let text = ""; try { text = readFileSync(path + ".operations", "utf8"); } catch { return " [no counters]"; }
    const of = (name: string) => { const line = text.split("\n").find(l => l.endsWith("\t" + name)); return line ? Number(line.split("\t")[0]) : 0; };
    return " [born with number " + of("Family::born:with-number") + ", given " + of("Family::given:construction") + "; exits: without number " + of("exit-into-generic-copy:exits-without-number") + ", departed " + of("exit-into-generic-copy:exits-departed") + "; departures " + of("Family::departed:deletion") + "]";
}
