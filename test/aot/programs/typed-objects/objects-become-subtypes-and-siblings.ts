// Objects are made as a base type, kept in arrays of it, and cast to one of many subtypes later, when the program knows more about them, and then to a sibling of that subtype. A cast changes nothing: the object stays the same object, gets a property of the subtype or of the sibling when it is stored, keeps its keys in the order they were created in, and reads and writes like any other, however often that happens and while the collector runs.
interface Base { id: number; flags: number }
interface Sub0 extends Base { a0: number | undefined; b0: string | undefined; c0: Base | undefined; d0: boolean | undefined }
interface Sub1 extends Base { a1: number | undefined; b1: string | undefined; c1: Base | undefined; d1: boolean | undefined }
interface Sub2 extends Base { a2: number | undefined; b2: string | undefined; c2: Base | undefined; d2: boolean | undefined }
interface Sub3 extends Base { a3: number | undefined; b3: string | undefined; c3: Base | undefined; d3: boolean | undefined }
interface Sub4 extends Base { a4: number | undefined; b4: string | undefined; c4: Base | undefined; d4: boolean | undefined }
interface Sub5 extends Base { a5: number | undefined; b5: string | undefined; c5: Base | undefined; d5: boolean | undefined }
interface Sub6 extends Base { a6: number | undefined; b6: string | undefined; c6: Base | undefined; d6: boolean | undefined }
interface Sub7 extends Base { a7: number | undefined; b7: string | undefined; c7: Base | undefined; d7: boolean | undefined }
interface Sub8 extends Base { a8: number | undefined; b8: string | undefined; c8: Base | undefined; d8: boolean | undefined }
interface Sub9 extends Base { a9: number | undefined; b9: string | undefined; c9: Base | undefined; d9: boolean | undefined }
interface Sub10 extends Base { a10: number | undefined; b10: string | undefined; c10: Base | undefined; d10: boolean | undefined }
interface Sub11 extends Base { a11: number | undefined; b11: string | undefined; c11: Base | undefined; d11: boolean | undefined }
interface Deep extends Sub0 { deep: number[] | undefined }

function fill(all: Base[], count: number): void {
    for (let i = 0; i < count; i++) {
        if (i % 3 === 0) all.push({ id: i, flags: 1 });
        else if (i % 3 === 1) all.push({ flags: 2, id: i });
        else all.push({ id: i, flags: 3 });
    }
}
function become0(base: Base): Sub0 { const sub = base as Sub0; sub.a0 = base.id + 0; return sub; }
function read0(sub: Sub0): string { return sub.a0 + " " + sub.b0 + " " + (sub.c0 ? sub.c0.id : "none") + " " + sub.d0; }
function sum0(sub: Sub0): number { return (sub.a0 ?? -1) + (sub.b0 === undefined ? 0 : sub.b0.length) + (sub.c0 === undefined ? 0 : 1) + (sub.d0 ? 1 : 0); }
function become1(base: Base): Sub1 { const sub = base as Sub1; sub.a1 = base.id + 1; return sub; }
function read1(sub: Sub1): string { return sub.a1 + " " + sub.b1 + " " + (sub.c1 ? sub.c1.id : "none") + " " + sub.d1; }
function sum1(sub: Sub1): number { return (sub.a1 ?? -1) + (sub.b1 === undefined ? 0 : sub.b1.length) + (sub.c1 === undefined ? 0 : 1) + (sub.d1 ? 1 : 0); }
function become2(base: Base): Sub2 { const sub = base as Sub2; sub.a2 = base.id + 2; return sub; }
function read2(sub: Sub2): string { return sub.a2 + " " + sub.b2 + " " + (sub.c2 ? sub.c2.id : "none") + " " + sub.d2; }
function sum2(sub: Sub2): number { return (sub.a2 ?? -1) + (sub.b2 === undefined ? 0 : sub.b2.length) + (sub.c2 === undefined ? 0 : 1) + (sub.d2 ? 1 : 0); }
function become3(base: Base): Sub3 { const sub = base as Sub3; sub.a3 = base.id + 3; return sub; }
function read3(sub: Sub3): string { return sub.a3 + " " + sub.b3 + " " + (sub.c3 ? sub.c3.id : "none") + " " + sub.d3; }
function sum3(sub: Sub3): number { return (sub.a3 ?? -1) + (sub.b3 === undefined ? 0 : sub.b3.length) + (sub.c3 === undefined ? 0 : 1) + (sub.d3 ? 1 : 0); }
function become4(base: Base): Sub4 { const sub = base as Sub4; sub.a4 = base.id + 4; return sub; }
function read4(sub: Sub4): string { return sub.a4 + " " + sub.b4 + " " + (sub.c4 ? sub.c4.id : "none") + " " + sub.d4; }
function sum4(sub: Sub4): number { return (sub.a4 ?? -1) + (sub.b4 === undefined ? 0 : sub.b4.length) + (sub.c4 === undefined ? 0 : 1) + (sub.d4 ? 1 : 0); }
function become5(base: Base): Sub5 { const sub = base as Sub5; sub.a5 = base.id + 5; return sub; }
function read5(sub: Sub5): string { return sub.a5 + " " + sub.b5 + " " + (sub.c5 ? sub.c5.id : "none") + " " + sub.d5; }
function sum5(sub: Sub5): number { return (sub.a5 ?? -1) + (sub.b5 === undefined ? 0 : sub.b5.length) + (sub.c5 === undefined ? 0 : 1) + (sub.d5 ? 1 : 0); }
function become6(base: Base): Sub6 { const sub = base as Sub6; sub.a6 = base.id + 6; return sub; }
function read6(sub: Sub6): string { return sub.a6 + " " + sub.b6 + " " + (sub.c6 ? sub.c6.id : "none") + " " + sub.d6; }
function sum6(sub: Sub6): number { return (sub.a6 ?? -1) + (sub.b6 === undefined ? 0 : sub.b6.length) + (sub.c6 === undefined ? 0 : 1) + (sub.d6 ? 1 : 0); }
function become7(base: Base): Sub7 { const sub = base as Sub7; sub.a7 = base.id + 7; return sub; }
function read7(sub: Sub7): string { return sub.a7 + " " + sub.b7 + " " + (sub.c7 ? sub.c7.id : "none") + " " + sub.d7; }
function sum7(sub: Sub7): number { return (sub.a7 ?? -1) + (sub.b7 === undefined ? 0 : sub.b7.length) + (sub.c7 === undefined ? 0 : 1) + (sub.d7 ? 1 : 0); }
function become8(base: Base): Sub8 { const sub = base as Sub8; sub.a8 = base.id + 8; return sub; }
function read8(sub: Sub8): string { return sub.a8 + " " + sub.b8 + " " + (sub.c8 ? sub.c8.id : "none") + " " + sub.d8; }
function sum8(sub: Sub8): number { return (sub.a8 ?? -1) + (sub.b8 === undefined ? 0 : sub.b8.length) + (sub.c8 === undefined ? 0 : 1) + (sub.d8 ? 1 : 0); }
function become9(base: Base): Sub9 { const sub = base as Sub9; sub.a9 = base.id + 9; return sub; }
function read9(sub: Sub9): string { return sub.a9 + " " + sub.b9 + " " + (sub.c9 ? sub.c9.id : "none") + " " + sub.d9; }
function sum9(sub: Sub9): number { return (sub.a9 ?? -1) + (sub.b9 === undefined ? 0 : sub.b9.length) + (sub.c9 === undefined ? 0 : 1) + (sub.d9 ? 1 : 0); }
function become10(base: Base): Sub10 { const sub = base as Sub10; sub.a10 = base.id + 10; return sub; }
function read10(sub: Sub10): string { return sub.a10 + " " + sub.b10 + " " + (sub.c10 ? sub.c10.id : "none") + " " + sub.d10; }
function sum10(sub: Sub10): number { return (sub.a10 ?? -1) + (sub.b10 === undefined ? 0 : sub.b10.length) + (sub.c10 === undefined ? 0 : 1) + (sub.d10 ? 1 : 0); }
function become11(base: Base): Sub11 { const sub = base as Sub11; sub.a11 = base.id + 11; return sub; }
function read11(sub: Sub11): string { return sub.a11 + " " + sub.b11 + " " + (sub.c11 ? sub.c11.id : "none") + " " + sub.d11; }
function sum11(sub: Sub11): number { return (sub.a11 ?? -1) + (sub.b11 === undefined ? 0 : sub.b11.length) + (sub.c11 === undefined ? 0 : 1) + (sub.d11 ? 1 : 0); }
function become(base: Base, kind: number): Base {
    switch (kind) {
        case 0: return become0(base);
        case 1: return become1(base);
        case 2: return become2(base);
        case 3: return become3(base);
        case 4: return become4(base);
        case 5: return become5(base);
        case 6: return become6(base);
        case 7: return become7(base);
        case 8: return become8(base);
        case 9: return become9(base);
        case 10: return become10(base);
        case 11: return become11(base);
    }
    return base;
}
function sum(base: Base, kind: number): number {
    switch (kind) {
        case 0: return sum0(base as Sub0);
        case 1: return sum1(base as Sub1);
        case 2: return sum2(base as Sub2);
        case 3: return sum3(base as Sub3);
        case 4: return sum4(base as Sub4);
        case 5: return sum5(base as Sub5);
        case 6: return sum6(base as Sub6);
        case 7: return sum7(base as Sub7);
        case 8: return sum8(base as Sub8);
        case 9: return sum9(base as Sub9);
        case 10: return sum10(base as Sub10);
        case 11: return sum11(base as Sub11);
    }
    return 0;
}
function show(value: Base): string {
    return JSON.stringify(value, (key, held) => (key.startsWith("c") && held ? "object " + held.id : held)) + " " + Object.keys(value).join();
}
function attempt(label: string, run: () => unknown) {
    try {
        console.log(label, run());
    } catch (error) {
        console.log(label, error instanceof TypeError ? "TypeError" : String(error));
    }
}
function one(id: number): Base {
    const all: Base[] = [];
    all.push({ id, flags: 9 });
    return all[0];
}

const all: Base[] = [];
fill(all, 6000);
let total = 0;
for (let i = 0; i < all.length; i++) {
    const made = become(all[i], i % 12);
    if (made !== all[i]) throw new Error("another object");
    total += sum(made, i % 12);
}
console.log("each to its subtype", total);
for (let i = 0; i < all.length; i += 701) console.log(show(all[i]));

total = 0;
for (let round = 0; round < 4; round++) {
    for (let i = 0; i < all.length; i++) {
        const sibling = (i + 1) % 12;
        total += sum(all[i], sibling);
        if (round === 1) become(all[i], sibling);
        if (round === 2 && i % 5 === 0) (all[i] as Sub3).b3 = "text " + i;
    }
}
console.log("each to a sibling as well", total);
for (let i = 0; i < all.length; i += 701) console.log(show(all[i]));
console.log(read0(all[0] as Sub0), "|", read1(all[0] as Sub1), "|", read3(all[0] as Sub3), "|", read5(all[0] as Sub5));

attempt("cast again", () => show(become3(become3(one(1)))));
attempt("cast deeper", () => {
    const deep = become0(one(2)) as Deep;
    deep.deep = [1];
    return show(deep) + " " + read0(deep);
});
attempt("another property first", () => {
    const base = one(3);
    (base as any).stray = "s";
    return show(become4(base)) + " " + read4(base as Sub4);
});
attempt("frozen first", () => show(become5(Object.freeze(one(4)))));
attempt("sealed first", () => show(become6(Object.seal(one(5)))));
attempt("not extensible first", () => show(become7(Object.preventExtensions(one(6)))));
attempt("frozen afterwards", () => {
    const sub = Object.freeze(become8(one(7)));
    return read8(sub) + " " + read9(sub as Base as Sub9) + " " + Object.isFrozen(sub);
});
attempt("undefined", () => become9(undefined as unknown as Base));
attempt("a sibling's property: absent, present, deleted, present", () => {
    const sub = become1(one(12)) as Base as Sub2;
    const seen: unknown[] = [];
    for (let i = 0; i < 4; i++) seen.push(sub.a2);
    sub.a2 = 7;
    for (let i = 0; i < 4; i++) seen.push(sub.a2);
    delete (sub as any).a2;
    for (let i = 0; i < 4; i++) seen.push(sub.a2);
    sub.a2 = 8;
    for (let i = 0; i < 4; i++) seen.push(sub.a2);
    return seen.join() + " " + show(sub);
});
attempt("a sibling's property beside more and more others", () => {
    const sub = become1(one(13)) as Base as Sub2;
    sub.b2 = "first";
    sub.a2 = 1;
    let sumOfAll = 0;
    for (let i = 0; i < 300; i++) {
        (sub as any)["p" + i] = i;
        if (sub.b2 !== "first") throw new Error("lost at " + i);
        sumOfAll += sub.a2! + (sub as any)["p" + (i >> 1)];
    }
    for (let i = 0; i < 300; i += 2) {
        delete (sub as any)["p" + i];
        if (sub.b2 !== "first" || sub.a2 !== 1) throw new Error("lost while deleting " + i);
    }
    sub.b2 = "last";
    return sumOfAll + " " + sub.b2 + " " + Object.keys(sub).length;
});
attempt("a sibling's property stored through any", () => {
    const sub = become1(one(15)) as Base as Sub2;
    const seen: unknown[] = [sub.b2];
    (sub as any).b2 = "through any";
    seen.push(sub.b2);
    (sub as any).b2 = undefined;
    seen.push(sub.b2, "b2" in sub);
    return seen.join();
});

let withSibling = 0;
let without = 0;
const kept: Base[] = [];
for (let round = 0; round < 40; round++) {
    const some: Base[] = [];
    fill(some, 3000);
    for (let i = 0; i < some.length; i++) {
        const sub = become1(some[i]);
        sub.c1 = kept.length ? kept[kept.length - 1] : undefined;
        const sibling = sub as Base as Sub2;
        if (i & 1) sibling.a2 = i;
        if (sibling.a2 === undefined) without++;
        else withSibling++;
        if ((i & 1 ? i : undefined) !== sibling.a2) throw new Error("wrong at " + i);
    }
    kept.push(some[round]);
}
console.log("objects come and go", withSibling, without, kept.map(value => sum1(value as Sub1) + sum2(value as Sub2)).join());
