// Objects are made as a base type and cast to one of many subtypes afterwards. The cast changes nothing: the subtype's fields are absent until they are stored, and everything else is as it was, however many kinds there are, whatever order the keys were created in, and while the collector runs.
interface Base { id: number; kind: number; note?: string; next?: Base }
interface Sub0 extends Base { a0?: number; b0?: string; c0?: Base; d0?: boolean }
interface Sub1 extends Base { a1?: number; b1?: string; c1?: Base; d1?: boolean }
interface Sub2 extends Base { a2?: number; b2?: string; c2?: Base; d2?: boolean }
interface Sub3 extends Base { a3?: number; b3?: string; c3?: Base; d3?: boolean }
interface Sub4 extends Base { a4?: number; b4?: string; c4?: Base; d4?: boolean }
interface Sub5 extends Base { a5?: number; b5?: string; c5?: Base; d5?: boolean }
interface Sub6 extends Base { a6?: number; b6?: string; c6?: Base; d6?: boolean }
interface Sub7 extends Base { a7?: number; b7?: string; c7?: Base; d7?: boolean }
interface Sub8 extends Base { a8?: number; b8?: string; c8?: Base; d8?: boolean }
interface Sub9 extends Base { a9?: number; b9?: string; c9?: Base; d9?: boolean }
interface Sub10 extends Base { a10?: number; b10?: string; c10?: Base; d10?: boolean }
interface Sub11 extends Base { a11?: number; b11?: string; c11?: Base; d11?: boolean }
interface Sub12 extends Base { a12?: number; b12?: string; c12?: Base; d12?: boolean }
interface Sub13 extends Base { a13?: number; b13?: string; c13?: Base; d13?: boolean }
interface Sub14 extends Base { a14?: number; b14?: string; c14?: Base; d14?: boolean }
interface Sub15 extends Base { a15?: number; b15?: string; c15?: Base; d15?: boolean }
interface Sub16 extends Base { a16?: number; b16?: string; c16?: Base; d16?: boolean }
interface Sub17 extends Base { a17?: number; b17?: string; c17?: Base; d17?: boolean }
interface Sub18 extends Base { a18?: number; b18?: string; c18?: Base; d18?: boolean }
interface Sub19 extends Base { a19?: number; b19?: string; c19?: Base; d19?: boolean }
interface Sub20 extends Base { a20?: number; b20?: string; c20?: Base; d20?: boolean }
interface Sub21 extends Base { a21?: number; b21?: string; c21?: Base; d21?: boolean }
interface Sub22 extends Base { a22?: number; b22?: string; c22?: Base; d22?: boolean }
interface Sub23 extends Base { a23?: number; b23?: string; c23?: Base; d23?: boolean }
interface Sub24 extends Base { a24?: number; b24?: string; c24?: Base; d24?: boolean }
interface Sub25 extends Base { a25?: number; b25?: string; c25?: Base; d25?: boolean }
interface Deep extends Sub0 { deep?: number[] }

function plain(id: number, kind: number): Base { return { id, kind }; }
function noted(id: number, kind: number): Base { const made: Base = { id, kind }; made.note = "n" + id; return made; }
function linked(id: number, kind: number): Base { const made: Base = { id, kind }; made.next = made; made.note = "l"; return made; }
const makers = [plain, noted, linked];

function to0(base: Base): Sub0 { const sub = base as Sub0; if ("a0" in sub || sub.b0 !== undefined || sub.c0 !== undefined || sub.d0 !== undefined) throw new Error("not absent in Sub0"); sub.a0 = base.id + 0; return sub; }
function to1(base: Base): Sub1 { const sub = base as Sub1; if ("a1" in sub || sub.b1 !== undefined || sub.c1 !== undefined || sub.d1 !== undefined) throw new Error("not absent in Sub1"); sub.a1 = base.id + 1; return sub; }
function to2(base: Base): Sub2 { const sub = base as Sub2; if ("a2" in sub || sub.b2 !== undefined || sub.c2 !== undefined || sub.d2 !== undefined) throw new Error("not absent in Sub2"); sub.a2 = base.id + 2; return sub; }
function to3(base: Base): Sub3 { const sub = base as Sub3; if ("a3" in sub || sub.b3 !== undefined || sub.c3 !== undefined || sub.d3 !== undefined) throw new Error("not absent in Sub3"); sub.a3 = base.id + 3; return sub; }
function to4(base: Base): Sub4 { const sub = base as Sub4; if ("a4" in sub || sub.b4 !== undefined || sub.c4 !== undefined || sub.d4 !== undefined) throw new Error("not absent in Sub4"); sub.a4 = base.id + 4; return sub; }
function to5(base: Base): Sub5 { const sub = base as Sub5; if ("a5" in sub || sub.b5 !== undefined || sub.c5 !== undefined || sub.d5 !== undefined) throw new Error("not absent in Sub5"); sub.a5 = base.id + 5; return sub; }
function to6(base: Base): Sub6 { const sub = base as Sub6; if ("a6" in sub || sub.b6 !== undefined || sub.c6 !== undefined || sub.d6 !== undefined) throw new Error("not absent in Sub6"); sub.a6 = base.id + 6; return sub; }
function to7(base: Base): Sub7 { const sub = base as Sub7; if ("a7" in sub || sub.b7 !== undefined || sub.c7 !== undefined || sub.d7 !== undefined) throw new Error("not absent in Sub7"); sub.a7 = base.id + 7; return sub; }
function to8(base: Base): Sub8 { const sub = base as Sub8; if ("a8" in sub || sub.b8 !== undefined || sub.c8 !== undefined || sub.d8 !== undefined) throw new Error("not absent in Sub8"); sub.a8 = base.id + 8; return sub; }
function to9(base: Base): Sub9 { const sub = base as Sub9; if ("a9" in sub || sub.b9 !== undefined || sub.c9 !== undefined || sub.d9 !== undefined) throw new Error("not absent in Sub9"); sub.a9 = base.id + 9; return sub; }
function to10(base: Base): Sub10 { const sub = base as Sub10; if ("a10" in sub || sub.b10 !== undefined || sub.c10 !== undefined || sub.d10 !== undefined) throw new Error("not absent in Sub10"); sub.a10 = base.id + 10; return sub; }
function to11(base: Base): Sub11 { const sub = base as Sub11; if ("a11" in sub || sub.b11 !== undefined || sub.c11 !== undefined || sub.d11 !== undefined) throw new Error("not absent in Sub11"); sub.a11 = base.id + 11; return sub; }
function to12(base: Base): Sub12 { const sub = base as Sub12; if ("a12" in sub || sub.b12 !== undefined || sub.c12 !== undefined || sub.d12 !== undefined) throw new Error("not absent in Sub12"); sub.a12 = base.id + 12; return sub; }
function to13(base: Base): Sub13 { const sub = base as Sub13; if ("a13" in sub || sub.b13 !== undefined || sub.c13 !== undefined || sub.d13 !== undefined) throw new Error("not absent in Sub13"); sub.a13 = base.id + 13; return sub; }
function to14(base: Base): Sub14 { const sub = base as Sub14; if ("a14" in sub || sub.b14 !== undefined || sub.c14 !== undefined || sub.d14 !== undefined) throw new Error("not absent in Sub14"); sub.a14 = base.id + 14; return sub; }
function to15(base: Base): Sub15 { const sub = base as Sub15; if ("a15" in sub || sub.b15 !== undefined || sub.c15 !== undefined || sub.d15 !== undefined) throw new Error("not absent in Sub15"); sub.a15 = base.id + 15; return sub; }
function to16(base: Base): Sub16 { const sub = base as Sub16; if ("a16" in sub || sub.b16 !== undefined || sub.c16 !== undefined || sub.d16 !== undefined) throw new Error("not absent in Sub16"); sub.a16 = base.id + 16; return sub; }
function to17(base: Base): Sub17 { const sub = base as Sub17; if ("a17" in sub || sub.b17 !== undefined || sub.c17 !== undefined || sub.d17 !== undefined) throw new Error("not absent in Sub17"); sub.a17 = base.id + 17; return sub; }
function to18(base: Base): Sub18 { const sub = base as Sub18; if ("a18" in sub || sub.b18 !== undefined || sub.c18 !== undefined || sub.d18 !== undefined) throw new Error("not absent in Sub18"); sub.a18 = base.id + 18; return sub; }
function to19(base: Base): Sub19 { const sub = base as Sub19; if ("a19" in sub || sub.b19 !== undefined || sub.c19 !== undefined || sub.d19 !== undefined) throw new Error("not absent in Sub19"); sub.a19 = base.id + 19; return sub; }
function to20(base: Base): Sub20 { const sub = base as Sub20; if ("a20" in sub || sub.b20 !== undefined || sub.c20 !== undefined || sub.d20 !== undefined) throw new Error("not absent in Sub20"); sub.a20 = base.id + 20; return sub; }
function to21(base: Base): Sub21 { const sub = base as Sub21; if ("a21" in sub || sub.b21 !== undefined || sub.c21 !== undefined || sub.d21 !== undefined) throw new Error("not absent in Sub21"); sub.a21 = base.id + 21; return sub; }
function to22(base: Base): Sub22 { const sub = base as Sub22; if ("a22" in sub || sub.b22 !== undefined || sub.c22 !== undefined || sub.d22 !== undefined) throw new Error("not absent in Sub22"); sub.a22 = base.id + 22; return sub; }
function to23(base: Base): Sub23 { const sub = base as Sub23; if ("a23" in sub || sub.b23 !== undefined || sub.c23 !== undefined || sub.d23 !== undefined) throw new Error("not absent in Sub23"); sub.a23 = base.id + 23; return sub; }
function to24(base: Base): Sub24 { const sub = base as Sub24; if ("a24" in sub || sub.b24 !== undefined || sub.c24 !== undefined || sub.d24 !== undefined) throw new Error("not absent in Sub24"); sub.a24 = base.id + 24; return sub; }
function to25(base: Base): Sub25 { const sub = base as Sub25; if ("a25" in sub || sub.b25 !== undefined || sub.c25 !== undefined || sub.d25 !== undefined) throw new Error("not absent in Sub25"); sub.a25 = base.id + 25; return sub; }
const casts: ((base: Base) => Base)[] = [to0, to1, to2, to3, to4, to5, to6, to7, to8, to9, to10, to11, to12, to13, to14, to15, to16, to17, to18, to19, to20, to21, to22, to23, to24, to25];

function show(value: Base): string {
    return JSON.stringify(value, (key, held) => ((key === "next" || key.startsWith("c")) && held ? "object" : held)) + " " + Object.keys(value).join();
}

function attempt(label: string, run: () => unknown) {
    try {
        console.log(label, run());
    } catch (error) {
        console.log(label, error instanceof TypeError ? "TypeError" : String(error));
    }
}

const kept: Base[] = [];
let sum = 0;
for (let round = 0; round < 400; round++) {
    for (let kind = 0; kind < casts.length; kind++) {
        const base = makers[(round + kind) % makers.length](round, kind);
        const sub = casts[kind](base);
        if (sub !== base) throw new Error("another object");
        sum += Object.keys(sub).length + sub.id;
        if ((round * casts.length + kind) % 997 === 0) kept.push(sub);
    }
}
console.log(sum, kept.length);
for (const value of kept) console.log(show(value));

attempt("cast again", () => show(to3(to3(plain(1, 3)))));
attempt("cast deeper", () => {
    const deep = to0(noted(2, 0)) as Deep;
    deep.deep = [1];
    return show(deep);
});
attempt("another property first", () => {
    const base = plain(3, 4);
    (base as any).stray = "s";
    return show(to4(base));
});
attempt("frozen first", () => show(to5(Object.freeze(plain(4, 5)))));
attempt("sealed first", () => show(to6(Object.seal(plain(5, 6)))));
attempt("not extensible first", () => show(to7(Object.preventExtensions(plain(6, 7)))));
attempt("a key deleted first", () => {
    const base = noted(7, 8);
    delete base.note;
    return show(to8(base));
});
attempt("undefined", () => to9(undefined as unknown as Base));
attempt("a number", () => to9(9 as unknown as Base));
attempt("a literal through any", () => show(to10({ id: 10, kind: 10 } as any)));
attempt("parsed data", () => show(to11(JSON.parse('{"id":11,"kind":11}'))));
attempt("one subtype, then another", () => show(to13(to12(plain(12, 12)))));

const chain: Base[] = [];
for (let round = 0; round < 60000; round++) {
    const sub = to1(linked(round, 1)) as Sub1;
    sub.c1 = chain.length ? chain[chain.length - 1] : undefined;
    sub.b1 = "b" + (round & 7);
    if (round % 1000 === 0) chain.push(sub);
}
console.log(chain.length, chain.map(value => (value as Sub1).a1! + ((value as Sub1).c1 ? (value as Sub1).c1!.id : -1)).join());
