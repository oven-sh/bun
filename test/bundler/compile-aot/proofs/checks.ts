export function wantsNumber(a: number, b: number) { return a + b; }
export function wantsString(s: string) { return s + "!"; }
export function wantsBoolean(b: boolean) { return !b; }
export function wantsObject(o: object) { return typeof o; }
export function wantsArray(a: number[]) { return a.length; }
export function wantsFunction(f: () => number) { return f(); }
export function wantsOptional(n?: number) { return n === undefined ? "none" : n + 1; }
export function wantsNullable(s: string | null) { return s === null ? "null" : s.length; }
export function wantsUnion(v: number | string) { return typeof v; }
export function wantsBigInt(b: bigint) { return b + 1n; }
export function wantsSymbol(s: symbol) { return typeof s; }
export function returnsNumber(v: any): number { return v; }
export function attempt(f: (v: any) => unknown, values: unknown[]) {
    let a = 1, b = 2.5, c = "c", d = { d: 4 }, e = [5], out: string[] = [];
    for (const v of values) {
        try { out.push(String(f(v))); } catch (error: any) { out.push(error.constructor.name); }
        if (a + b !== 3.5 || c !== "c" || d.d !== 4 || e[0] !== 5) out.push("CORRUPTED");
    }
    return out.join();
}
