// A typed read is tested wherever it stands: under `typeof`, against `undefined` or a literal, in a condition, as a binding, an argument or an operand. A field that holds another kind throws a TypeError; one that is undefined, null or missing passes and goes on as it is.
interface Clock { origin: number; name: string; on: boolean; next: Clock; list: number[]; tick: () => number; big: bigint }
declare function fromHost(which: number): Clock;
const raws: any[] = [0, 1].map(() => JSON.parse('{"origin":1,"name":"n","on":true,"next":null,"list":[1],"tick":null,"big":null}'));
for (const raw of raws) { raw.next = raw; raw.tick = () => 7; raw.big = 5n; }
(globalThis as any).fromHost = (which: number) => raws[which];
const kept: Clock = fromHost(0), broken: Clock = fromHost(1);
{ const raw = raws[1]; raw.origin = undefined; raw.name = 5; raw.on = "yes"; raw.next = 0; delete raw.list; raw.tick = null; raw.big = ""; }
// The object under test. It goes from one place of type `Clock` to another, which asks only for an object.
let c: Clock = kept;
function attempt(label: string, f: () => unknown): void {
    const out: string[] = [];
    for (let which = 0; which < 2; which++) {
        c = which === 0 ? kept : broken;
        try { out.push(show(f())); } catch (e) { out.push((e as Error).constructor.name); }
    }
    console.log(label, out.join(" | "));
}
function show(v: unknown): string {
    return typeof v === "bigint" ? v + "n" : typeof v === "function" ? "fn" : typeof v === "object" && v !== null ? "obj" : typeof v === "string" ? JSON.stringify(v) : String(v);
}

// typeof
attempt("t typeof", () => [typeof c.origin, typeof c.name, typeof c.on, typeof c.next, typeof c.list, typeof c.tick, typeof c.big].join());
attempt("t typeof ===", () => typeof c.origin === "number" && typeof c.tick === "function");
attempt("t typeof through", () => [typeof (c.origin), typeof c.origin!, typeof (c.origin satisfies number), typeof (c.name)!].join());
attempt("a typeof as", () => [typeof (c.origin as number), typeof ((c.name as string)!), (c.on as boolean) === true].join());
// equality against undefined, null, a literal
attempt("t === undefined", () => [c.origin === undefined, c.list === undefined, undefined !== c.name, c.tick === undefined].join());
attempt("t === null", () => [c.tick === null, null === c.next, c.origin !== null].join());
attempt("t == null", () => [c.origin == null, c.tick == null, c.list != null, null == c.name, c.on == undefined].join());
attempt("t === literal", () => [c.origin === 1, c.name === "n", c.on === true, 5 === c.name as unknown, c.big === 5n, c.origin === -1, c.name !== "x", c.on === false].join());
attempt("t == literal", () => [c.origin == 1, c.name == "5", "" == c.big as unknown, c.on != true].join());
// conditions
attempt("t if", () => { if (c.origin) return "T"; return "F"; });
attempt("t if string", () => { if (c.name) return "T"; return "F"; });
attempt("t if boolean", () => { if (c.on) return "T"; return "F"; });
attempt("t if object", () => { if (c.next) return "T"; return "F"; });
attempt("t if through", () => { if ((c.list as number[])!) return "T"; return "F"; });
attempt("t ?:", () => (c.next ? "T" : "F") + (c.big ? "T" : "F"));
attempt("t while", () => { let n = 0; while (c.list && n < 2) n++; return n; });
attempt("t do", () => { let n = 0; do n++; while (c.origin && n < 2); return n; });
attempt("t for", () => { let n = 0; for (; c.next && n < 2; n++); return n; });
// !
attempt("t !", () => [!c.origin, !c.name, !c.on, !c.next, !c.list, !c.tick, !c.big].join());
attempt("t !!", () => [!!c.origin, !!c.list, Boolean(c.tick)].join());
// in, instanceof
attempt("t in", () => ["length" in (c.list ?? []), (c.name as unknown as string) in { n: 1, 5: 1 }].join());
attempt("t instanceof", () => [c.list instanceof Array, c.next instanceof Object, c.tick instanceof Function, (c.origin as unknown) instanceof Number].join());
// the left side of && and ||, in a condition and for its value
attempt("t && condition", () => { if (c.origin && c.on) return "T"; return "F"; });
attempt("t || condition", () => { if (c.list || c.next) return "T"; return "F"; });
attempt("t && falls through", () => c.list && "there");
attempt("t || falls through", () => c.origin || "none");
// the left side of ??, the receiver of ?.
attempt("t ??", () => [c.origin ?? "none", c.list ?? "none", c.tick ?? "none"].map(show).join());
attempt("t ?.", () => [c.list?.length, c.tick?.(), c.list?.[0]].join());
attempt("t ?. ??", () => c.list?.length ?? "none");
// an expression that forwards its operand
attempt("t ?: within typeof", () => typeof (c.on ? c.origin : c.name));
attempt("t || within typeof", () => [typeof (c.name || c.origin), typeof (c.big && c.on), typeof (c.name ?? c.on)].join());
attempt("t || within ===", () => (c.name || "x") === "n");
attempt("t , within if", () => { let n = 0; if ((n++, c.list)) return "T" + n; return "F" + n; });

// bindings, arguments, operands, results, receivers
attempt("h binding", () => { const t = c.origin; return typeof t === "number"; });
attempt("h argument", () => show(c.name));
attempt("h arithmetic", () => c.origin + 1);
attempt("h operand of an operand", () => { if (c.origin + 1) return "T"; return "F"; });
attempt("h === not a literal", () => c.origin === kept.origin);
attempt("h relational", () => c.origin < 2);
attempt("h return", () => c.on);
attempt("h receiver", () => c.list.length);
attempt("h call", () => c.tick());
attempt("h template", () => `${c.name}`);
// the left side of &&, || and ?? for its value
attempt("t && lets through", () => c.name && "x");
attempt("h && kept", () => c.big && "x");
attempt("h || kept", () => c.name || "none");
attempt("t || falls through, object", () => c.next || "none");
attempt("h ?? kept", () => c.name ?? "none");
attempt("h ?. receiver that is no object", () => c.next?.origin);
export {};
