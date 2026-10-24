// Patterns are recompiled, moved and emptied by the callbacks and conversions that run while strings are matched, replaced and split.
function show(f) { try { const v = f(); return typeof v === "object" && v ? JSON.stringify(v) : String(v); } catch (e) { return "threw " + e.constructor.name; } }
const text = "aa1bb22cc333dd4444" + "é".repeat(3) + "\u{1F600}x9";
const lines = [];
for (const flags of ["", "g", "y", "gy", "gu", "gi", "gd", "gv", "gs", "gm"]) {
    const make = () => new RegExp("(\\d+)|(?<w>[a-c])", flags);
    const scenes = {
        compileInCallback: r => text.replace(r, m => { r.compile("z", flags.replace(/[dv]/g, "")); return "<" + m + ">"; }),
        compileToGroups: r => text.replace(r, (...a) => { r.compile("(a)(b)(c)(d)?", "g"); return a.length; }),
        lastIndexInCallback: r => text.replace(r, m => { r.lastIndex = 1e9; return "#"; }) + r.lastIndex,
        lastIndexObject: r => { let n = 0; r.lastIndex = { valueOf() { n++; r.compile("b+", flags.replace(/[dv]/g, "")); return 2; } }; return JSON.stringify(r.exec(text)) + n + "," + show(() => r.lastIndex); },
        negative: r => { r.lastIndex = -5; return JSON.stringify(r.exec(text)) + r.lastIndex; },
        fraction: r => { r.lastIndex = 2.7; return JSON.stringify(r.exec(text)) + r.lastIndex; },
        inSurrogate: r => { r.lastIndex = text.indexOf("\u{1F600}") + 1; return JSON.stringify(r.exec(text)) + r.lastIndex; },
        frozen: r => { Object.freeze(r); return show(() => r.exec(text)) + show(() => text.replace(r, "x")) + show(() => r.test(text)); },
        readOnlyLastIndex: r => { Object.defineProperty(r, "lastIndex", { value: 3, writable: false }); return show(() => r.exec(text)) + show(() => text.match(r)) + show(() => text.split(r).length); },
        ownExec: r => { r.exec = function (s) { this.exec = undefined; return null; }; return show(() => text.replace(r, "x")) + show(() => r.test(text)) + show(() => text.match(r)); },
        ownExecBad: r => { r.exec = () => 5; return show(() => r.test(text)) + show(() => text.replace(r, "x")); },
        ownExecArrayLike: r => { let n = 0; r.exec = () => n++ ? null : { index: 1e9, length: 3, 0: "q", 1: { toString() { return "g1"; } }, 2: undefined, groups: { w: "W" } }; return show(() => text.replace(r, "[$1|$2|$<w>|$&]")); },
        ownFlags: r => { Object.defineProperty(r, "flags", { value: "g" }); return show(() => text.replace(r, "x")) + show(() => [...text.matchAll(r)].length); },
        ownGlobal: r => { Object.defineProperty(r, "global", { get() { return true; } }); return show(() => text.replace(r, "x")); },
        matchAllThenCompile: r => { const it = text.matchAll(r); const a = it.next(); r.compile("nothing"); return JSON.stringify([a, it.next()]); },
        splitLimit: r => JSON.stringify(text.split(r, { valueOf() { r.compile("c"); return 4; } })),
        species: r => { r.constructor = { [Symbol.species]: function (p, f) { return new RegExp("b", f); } }; return JSON.stringify(text.split(r)) + show(() => [...text.matchAll(r)].length); },
        replaceValueObject: r => text.replace(r, { toString() { r.lastIndex = 5; return "$2$1$0$9$<w>$<none>$'"; } }).length,
        subject: r => r.exec({ toString() { r.compile("dd"); return text; } }),
        legacy: r => { r.exec(text); return [RegExp.$1, RegExp.lastMatch, RegExp.leftContext.length, RegExp["$+"], RegExp.input === text].join(); },
        emptyMatches: r => { r.compile("", flags.replace(/[dv]/g, "")); return text.replace(r, "-").length + "," + show(() => text.match(r)?.length) + "," + text.split(r).length; },
        collect: r => text.replace(r, m => { Bun.gc(true); return m + m; }),
        rope: r => { let s = ""; for (let i = 0; i < 50; i++) s += text; return s.replace(r, (m, a, b, at) => at % 7 ? "" : m).length; },
        subclass: r => { class R extends RegExp { exec(s) { const m = super.exec(s); if (m) m[0] = "!"; return m; } } const x = new R(r.source, flags); return show(() => text.replace(x, "[$&]")) + show(() => text.search(x)) + show(() => x.test(text)); },
        indices: r => JSON.stringify(r.exec(text)?.indices ?? null),
        symbolOff: r => { r[Symbol.match] = false; return show(() => text.includes(r)) + show(() => text.startsWith(r)); },
        source: r => [r.source, r.flags, String(r), r.sticky, r.unicode, r.hasIndices, r.dotAll].join(),
    };
    for (const [name, scene] of Object.entries(scenes)) if (flags.includes("g") || !["ownFlags", "ownGlobal"].includes(name)) for (const warm of [false, true]) { const r = make(); if (warm) { r.test(text); text.replace(r, "x"); r.lastIndex = 0; } lines.push(flags + " " + name + " " + warm + " " + show(() => scene(r)) + " @" + show(() => r.lastIndex)); }
}
console.log(lines.join("\n"));
