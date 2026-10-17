// Every way for `undefined` or `null` to get into a variable, property, parameter or result whose type is an object, string, array or function type that includes neither.
// Each behaves as in plain JavaScript. Each has its own types, with a property that no other has, so that one case does not change how the objects of another are stored.
function say(what: string, make: () => string): void { try { console.log(what + ":", make()); } catch (e) { console.log(what + ":", "throws", (e as Error).name); } }
const nothing: unknown = undefined;
const nullish: unknown = null;
interface Leaf1 { text: string; l1: number }
function leaf1(text: string): Leaf1 { return { text, l1: 1 }; }
interface Holder1 { h1: number; leaf: Leaf1; name: string; list: Leaf1[]; run: () => string }
function fresh1(): Holder1 { return { h1: 1, leaf: leaf1("t"), name: "n", list: [leaf1("l")], run: () => "r" }; }
function textOf1(h: Holder1): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf1(h: Holder1): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("as made", () => { return textOf1(fresh1()) + nameOf1(fresh1()); });
interface Leaf2 { text: string; l2: number }
function leaf2(text: string): Leaf2 { return { text, l2: 2 }; }
interface Holder2 { h2: number; leaf: Leaf2; name: string; list: Leaf2[]; run: () => string }
function fresh2(): Holder2 { return { h2: 2, leaf: leaf2("t"), name: "n", list: [leaf2("l")], run: () => "r" }; }
function textOf2(h: Holder2): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf2(h: Holder2): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
const leaves2: Leaf2[] = [leaf2("a")];
const names2: string[] = ["x"];
say("an element past the end", () => { const h = fresh2(); h.leaf = leaves2[5]; h.name = names2[7]; return textOf2(h) + nameOf2(h); });
interface Leaf3 { text: string; l3: number }
function leaf3(text: string): Leaf3 { return { text, l3: 3 }; }
interface Holder3 { h3: number; leaf: Leaf3; name: string; list: Leaf3[]; run: () => string }
function fresh3(): Holder3 { return { h3: 3, leaf: leaf3("t"), name: "n", list: [leaf3("l")], run: () => "r" }; }
function textOf3(h: Holder3): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf3(h: Holder3): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("`as` on undefined", () => { const h = fresh3(); h.leaf = nothing as Leaf3; h.name = nothing as string; return textOf3(h) + nameOf3(h); });
interface Leaf4 { text: string; l4: number }
function leaf4(text: string): Leaf4 { return { text, l4: 4 }; }
interface Holder4 { h4: number; leaf: Leaf4; name: string; list: Leaf4[]; run: () => string }
function fresh4(): Holder4 { return { h4: 4, leaf: leaf4("t"), name: "n", list: [leaf4("l")], run: () => "r" }; }
function textOf4(h: Holder4): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf4(h: Holder4): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("`as` on null", () => { const h = fresh4(); h.leaf = nullish as Leaf4; h.name = nullish as string; return textOf4(h) + nameOf4(h); });
interface Leaf5 { text: string; l5: number }
function leaf5(text: string): Leaf5 { return { text, l5: 5 }; }
interface Holder5 { h5: number; leaf: Leaf5; name: string; list: Leaf5[]; run: () => string }
function fresh5(): Holder5 { return { h5: 5, leaf: leaf5("t"), name: "n", list: [leaf5("l")], run: () => "r" }; }
function textOf5(h: Holder5): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf5(h: Holder5): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("a store through any", () => { const h = fresh5(); const loose: any = h; loose.leaf = undefined; loose.name = null; return textOf5(h) + nameOf5(h); });
interface Leaf6 { text: string; l6: number }
function leaf6(text: string): Leaf6 { return { text, l6: 6 }; }
interface Holder6 { h6: number; leaf: Leaf6; name: string; list: Leaf6[]; run: () => string }
function fresh6(): Holder6 { return { h6: 6, leaf: leaf6("t"), name: "n", list: [leaf6("l")], run: () => "r" }; }
function textOf6(h: Holder6): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf6(h: Holder6): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("a store by a computed key", () => { const h = fresh6(); const loose: any = h; loose[["le", "af"].join("")] = undefined; return textOf6(h); });
interface Leaf7 { text: string; l7: number }
function leaf7(text: string): Leaf7 { return { text, l7: 7 }; }
interface Holder7 { h7: number; leaf: Leaf7; name: string; list: Leaf7[]; run: () => string }
function fresh7(): Holder7 { return { h7: 7, leaf: leaf7("t"), name: "n", list: [leaf7("l")], run: () => "r" }; }
function textOf7(h: Holder7): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf7(h: Holder7): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
interface Outer7 { inner: Holder7 }
say("a store to what an object holds, through any", () => { const o: Outer7 = { inner: fresh7() }; const loose: any = o; loose.inner.leaf = null; return textOf7(o.inner); });
interface Leaf8 { text: string; l8: number }
function leaf8(text: string): Leaf8 { return { text, l8: 8 }; }
interface Holder8 { h8: number; leaf: Leaf8; name: string; list: Leaf8[]; run: () => string }
function fresh8(): Holder8 { return { h8: 8, leaf: leaf8("t"), name: "n", list: [leaf8("l")], run: () => "r" }; }
function textOf8(h: Holder8): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf8(h: Holder8): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("Object.assign", () => { const h = fresh8(); Object.assign(h, { leaf: undefined }); return textOf8(h); });
interface Leaf9 { text: string; l9: number }
function leaf9(text: string): Leaf9 { return { text, l9: 9 }; }
interface Holder9 { h9: number; leaf: Leaf9; name: string; list: Leaf9[]; run: () => string }
function fresh9(): Holder9 { return { h9: 9, leaf: leaf9("t"), name: "n", list: [leaf9("l")], run: () => "r" }; }
function textOf9(h: Holder9): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf9(h: Holder9): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("Reflect.set", () => { const h = fresh9(); Reflect.set(h, "name", null); return nameOf9(h); });
interface Leaf10 { text: string; l10: number }
function leaf10(text: string): Leaf10 { return { text, l10: 10 }; }
interface Holder10 { h10: number; leaf: Leaf10; name: string; list: Leaf10[]; run: () => string }
function fresh10(): Holder10 { return { h10: 10, leaf: leaf10("t"), name: "n", list: [leaf10("l")], run: () => "r" }; }
function textOf10(h: Holder10): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf10(h: Holder10): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("a spread of any", () => { const more: any = { leaf: undefined }; const h: Holder10 = { ...fresh10(), ...more }; return textOf10(h); });
interface Leaf11 { text: string; l11: number }
function leaf11(text: string): Leaf11 { return { text, l11: 11 }; }
interface Holder11 { h11: number; leaf: Leaf11; name: string; list: Leaf11[]; run: () => string }
function fresh11(): Holder11 { return { h11: 11, leaf: leaf11("t"), name: "n", list: [leaf11("l")], run: () => "r" }; }
function textOf11(h: Holder11): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf11(h: Holder11): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("a spread of a part", () => { const part: Partial<Holder11> = { name: undefined }; const h = { ...fresh11(), ...part } as Holder11; return nameOf11(h); });
interface Leaf12 { text: string; l12: number }
function leaf12(text: string): Leaf12 { return { text, l12: 12 }; }
interface Holder12 { h12: number; leaf: Leaf12; name: string; list: Leaf12[]; run: () => string }
function fresh12(): Holder12 { return { h12: 12, leaf: leaf12("t"), name: "n", list: [leaf12("l")], run: () => "r" }; }
function textOf12(h: Holder12): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf12(h: Holder12): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("a copy of what holds undefined", () => { const h = fresh12(); h.leaf = nothing as Leaf12; const copy: Holder12 = { ...h }; return textOf12(copy); });
interface Leaf13 { text: string; l13: number }
function leaf13(text: string): Leaf13 { return { text, l13: 13 }; }
interface Holder13 { h13: number; leaf: Leaf13; name: string; list: Leaf13[]; run: () => string }
function fresh13(): Holder13 { return { h13: 13, leaf: leaf13("t"), name: "n", list: [leaf13("l")], run: () => "r" }; }
function textOf13(h: Holder13): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf13(h: Holder13): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("delete", () => { const h = fresh13(); delete (h as any).leaf; return textOf13(h) + ("leaf" in h); });
interface Leaf14 { text: string; l14: number }
function leaf14(text: string): Leaf14 { return { text, l14: 14 }; }
interface Holder14 { h14: number; leaf: Leaf14; name: string; list: Leaf14[]; run: () => string }
function fresh14(): Holder14 { return { h14: 14, leaf: leaf14("t"), name: "n", list: [leaf14("l")], run: () => "r" }; }
function textOf14(h: Holder14): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf14(h: Holder14): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("a literal under `as`", () => { const h = { name: "only" } as Holder14; return textOf14(h) + nameOf14(h); });
interface Leaf15 { text: string; l15: number }
function leaf15(text: string): Leaf15 { return { text, l15: 15 }; }
interface Holder15 { h15: number; leaf: Leaf15; name: string; list: Leaf15[]; run: () => string }
function fresh15(): Holder15 { return { h15: 15, leaf: leaf15("t"), name: "n", list: [leaf15("l")], run: () => "r" }; }
function textOf15(h: Holder15): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf15(h: Holder15): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("find that finds nothing", () => { const h = fresh15(); h.leaf = [fresh15().leaf].find(l => l.text === "zz") as Leaf15; return textOf15(h); });
interface Leaf16 { text: string; l16: number }
function leaf16(text: string): Leaf16 { return { text, l16: 16 }; }
interface Holder16 { h16: number; leaf: Leaf16; name: string; list: Leaf16[]; run: () => string }
function fresh16(): Holder16 { return { h16: 16, leaf: leaf16("t"), name: "n", list: [leaf16("l")], run: () => "r" }; }
function textOf16(h: Holder16): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf16(h: Holder16): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
class Early16 { leaf: Leaf16; seen: string; constructor() { this.seen = this.peek(); this.leaf = leaf16("late"); } peek(): string { return this.leaf === undefined ? "not yet" : this.leaf.text; } }
say("a field read before it is stored", () => { return new Early16().seen; });
interface Leaf17 { text: string; l17: number }
function leaf17(text: string): Leaf17 { return { text, l17: 17 }; }
interface Holder17 { h17: number; leaf: Leaf17; name: string; list: Leaf17[]; run: () => string }
function fresh17(): Holder17 { return { h17: 17, leaf: leaf17("t"), name: "n", list: [leaf17("l")], run: () => "r" }; }
function textOf17(h: Holder17): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf17(h: Holder17): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
class Unset17 { leaf!: Leaf17; name!: string }
say("a field that no constructor stores", () => { const u = new Unset17(); return (u.leaf === undefined) + " " + (u.name === undefined); });
interface Leaf18 { text: string; l18: number }
function leaf18(text: string): Leaf18 { return { text, l18: 18 }; }
interface Holder18 { h18: number; leaf: Leaf18; name: string; list: Leaf18[]; run: () => string }
function fresh18(): Holder18 { return { h18: 18, leaf: leaf18("t"), name: "n", list: [leaf18("l")], run: () => "r" }; }
function textOf18(h: Holder18): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf18(h: Holder18): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("a variable without a value", () => { let l: Leaf18; const read = () => l; const before = read() === undefined; l = leaf18("now"); return before + read().text; });
interface Leaf19 { text: string; l19: number }
function leaf19(text: string): Leaf19 { return { text, l19: 19 }; }
interface Holder19 { h19: number; leaf: Leaf19; name: string; list: Leaf19[]; run: () => string }
function fresh19(): Holder19 { return { h19: 19, leaf: leaf19("t"), name: "n", list: [leaf19("l")], run: () => "r" }; }
function textOf19(h: Holder19): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf19(h: Holder19): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
function take19(l: Leaf19, s: string): string { return (l === undefined ? "no l" : l.text) + (s === undefined ? "no s" : s); }
say("arguments left out", () => { return (take19 as any)(); });
interface Leaf20 { text: string; l20: number }
function leaf20(text: string): Leaf20 { return { text, l20: 20 }; }
interface Holder20 { h20: number; leaf: Leaf20; name: string; list: Leaf20[]; run: () => string }
function fresh20(): Holder20 { return { h20: 20, leaf: leaf20("t"), name: "n", list: [leaf20("l")], run: () => "r" }; }
function textOf20(h: Holder20): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf20(h: Holder20): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
function take20(l: Leaf20, s: string): string { return (l === undefined ? "no l" : l.text) + (s === undefined ? "no s" : s); }
say("arguments left out by apply", () => { return take20.apply(undefined, [] as any); });
interface Leaf21 { text: string; l21: number }
function leaf21(text: string): Leaf21 { return { text, l21: 21 }; }
interface Holder21 { h21: number; leaf: Leaf21; name: string; list: Leaf21[]; run: () => string }
function fresh21(): Holder21 { return { h21: 21, leaf: leaf21("t"), name: "n", list: [leaf21("l")], run: () => "r" }; }
function textOf21(h: Holder21): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf21(h: Holder21): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
const leaves21: Leaf21[] = [];
function take21(l: Leaf21): string { return l === undefined ? "no l" : l.text; }
say("an argument from an element past the end", () => { return take21(leaves21[3]); });
interface Leaf22 { text: string; l22: number }
function leaf22(text: string): Leaf22 { return { text, l22: 22 }; }
interface Holder22 { h22: number; leaf: Leaf22; name: string; list: Leaf22[]; run: () => string }
function fresh22(): Holder22 { return { h22: 22, leaf: leaf22("t"), name: "n", list: [leaf22("l")], run: () => "r" }; }
function textOf22(h: Holder22): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf22(h: Holder22): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("handed by a built-in", () => { return [undefined as unknown as Leaf22].map(l => (l === undefined ? "u" : l.text)).join(); });
interface Leaf23 { text: string; l23: number }
function leaf23(text: string): Leaf23 { return { text, l23: 23 }; }
interface Holder23 { h23: number; leaf: Leaf23; name: string; list: Leaf23[]; run: () => string }
function fresh23(): Holder23 { return { h23: 23, leaf: leaf23("t"), name: "n", list: [leaf23("l")], run: () => "r" }; }
function textOf23(h: Holder23): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf23(h: Holder23): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
function yields23(flag: boolean): Leaf23 { if (flag) return leaf23("y"); return undefined as unknown as Leaf23; }
say("a result", () => { const l = yields23(false); return l === undefined ? "nothing came" : l.text; });
interface Leaf24 { text: string; l24: number }
function leaf24(text: string): Leaf24 { return { text, l24: 24 }; }
interface Holder24 { h24: number; leaf: Leaf24; name: string; list: Leaf24[]; run: () => string }
function fresh24(): Holder24 { return { h24: 24, leaf: leaf24("t"), name: "n", list: [leaf24("l")], run: () => "r" }; }
function textOf24(h: Holder24): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf24(h: Holder24): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
function yields24(flag: boolean): Leaf24 { if (flag) return leaf24("y"); return null as unknown as Leaf24; }
say("a result stored to a field", () => { const h = fresh24(); h.leaf = yields24(false); return textOf24(h); });
interface Leaf25 { text: string; l25: number }
function leaf25(text: string): Leaf25 { return { text, l25: 25 }; }
interface Holder25 { h25: number; leaf: Leaf25; name: string; list: Leaf25[]; run: () => string }
function fresh25(): Holder25 { return { h25: 25, leaf: leaf25("t"), name: "n", list: [leaf25("l")], run: () => "r" }; }
function textOf25(h: Holder25): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf25(h: Holder25): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
const leaves25: Leaf25[] = [];
say("caught on the way", () => { let l: Leaf25 = leaf25("first"); try { l = leaves25[9]; throw new Error("x"); } catch { return l === undefined ? "gone" : l.text; } });
interface Leaf26 { text: string; l26: number }
function leaf26(text: string): Leaf26 { return { text, l26: 26 }; }
interface Holder26 { h26: number; leaf: Leaf26; name: string; list: Leaf26[]; run: () => string }
function fresh26(): Holder26 { return { h26: 26, leaf: leaf26("t"), name: "n", list: [leaf26("l")], run: () => "r" }; }
function textOf26(h: Holder26): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf26(h: Holder26): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("a default that is not taken", () => { const { leaf = leaf26("d") } = { leaf: nullish as Leaf26 }; return leaf === null ? "null stays" : leaf.text; });
interface Leaf27 { text: string; l27: number }
function leaf27(text: string): Leaf27 { return { text, l27: 27 }; }
interface Holder27 { h27: number; leaf: Leaf27; name: string; list: Leaf27[]; run: () => string }
function fresh27(): Holder27 { return { h27: 27, leaf: leaf27("t"), name: "n", list: [leaf27("l")], run: () => "r" }; }
function textOf27(h: Holder27): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf27(h: Holder27): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
const table27: Record<string, Leaf27> = {};
say("a dictionary that has no such key", () => { const h = fresh27(); h.leaf = table27["no"]; return textOf27(h); });
interface Leaf28 { text: string; l28: number }
function leaf28(text: string): Leaf28 { return { text, l28: 28 }; }
interface Holder28 { h28: number; leaf: Leaf28; name: string; list: Leaf28[]; run: () => string }
function fresh28(): Holder28 { return { h28: 28, leaf: leaf28("t"), name: "n", list: [leaf28("l")], run: () => "r" }; }
function textOf28(h: Holder28): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf28(h: Holder28): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
function* gen28(): Generator<Leaf28, Leaf28, Leaf28> { const sent = yield leaf28("g"); return sent; }
say("sent to a generator", () => { const g = gen28(); g.next(); const done = g.next(undefined as unknown as Leaf28); return done.value === undefined ? "nothing sent" : done.value.text; });
interface Leaf29 { text: string; l29: number }
function leaf29(text: string): Leaf29 { return { text, l29: 29 }; }
interface Holder29 { h29: number; leaf: Leaf29; name: string; list: Leaf29[]; run: () => string }
function fresh29(): Holder29 { return { h29: 29, leaf: leaf29("t"), name: "n", list: [leaf29("l")], run: () => "r" }; }
function textOf29(h: Holder29): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf29(h: Holder29): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("a function that is not there", () => { const h = fresh29(); h.run = nothing as () => string; return typeof h.run; });
interface Leaf30 { text: string; l30: number }
function leaf30(text: string): Leaf30 { return { text, l30: 30 }; }
interface Holder30 { h30: number; leaf: Leaf30; name: string; list: Leaf30[]; run: () => string }
function fresh30(): Holder30 { return { h30: 30, leaf: leaf30("t"), name: "n", list: [leaf30("l")], run: () => "r" }; }
function textOf30(h: Holder30): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf30(h: Holder30): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("a list that is not there", () => { const h = fresh30(); h.list = nothing as Leaf30[]; return h.list === undefined ? "no list" : String(h.list.length); });
interface Leaf31 { text: string; l31: number }
function leaf31(text: string): Leaf31 { return { text, l31: 31 }; }
interface Holder31 { h31: number; leaf: Leaf31; name: string; list: Leaf31[]; run: () => string }
function fresh31(): Holder31 { return { h31: 31, leaf: leaf31("t"), name: "n", list: [leaf31("l")], run: () => "r" }; }
function textOf31(h: Holder31): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf31(h: Holder31): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
interface Less31 { leaf: Leaf31 }
say("through a view with fewer properties", () => { const h = fresh31(); const less: Less31 = h; less.leaf = nothing as Leaf31; return textOf31(h); });
interface Leaf32 { text: string; l32: number }
function leaf32(text: string): Leaf32 { return { text, l32: 32 }; }
interface Holder32 { h32: number; leaf: Leaf32; name: string; list: Leaf32[]; run: () => string }
function fresh32(): Holder32 { return { h32: 32, leaf: leaf32("t"), name: "n", list: [leaf32("l")], run: () => "r" }; }
function textOf32(h: Holder32): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf32(h: Holder32): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
const early32 = peek32();
function peek32(): string { return late32 === undefined ? "not yet" : late32.text; }
var late32: Leaf32 = leaf32("late");
say("a module variable read before it is stored", () => { return early32; });
interface Leaf33 { text: string; l33: number }
function leaf33(text: string): Leaf33 { return { text, l33: 33 }; }
interface Holder33 { h33: number; leaf: Leaf33; name: string; list: Leaf33[]; run: () => string }
function fresh33(): Holder33 { return { h33: 33, leaf: leaf33("t"), name: "n", list: [leaf33("l")], run: () => "r" }; }
function textOf33(h: Holder33): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf33(h: Holder33): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("through a closure", () => { let l: Leaf33 = leaf33("first"); const clear = () => { l = nothing as Leaf33; }; clear(); return l === undefined ? "cleared" : l.text; });
interface Leaf34 { text: string; l34: number }
function leaf34(text: string): Leaf34 { return { text, l34: 34 }; }
interface Holder34 { h34: number; leaf: Leaf34; name: string; list: Leaf34[]; run: () => string }
function fresh34(): Holder34 { return { h34: 34, leaf: leaf34("t"), name: "n", list: [leaf34("l")], run: () => "r" }; }
function textOf34(h: Holder34): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf34(h: Holder34): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("behind a test that does not hold for the other property", () => { const h = fresh34(); h.leaf = nothing as Leaf34; const other = fresh34(); if (other.leaf !== undefined) return textOf34(h); return "-"; });
interface Leaf35 { text: string; l35: number }
function leaf35(text: string): Leaf35 { return { text, l35: 35 }; }
interface Holder35 { h35: number; leaf: Leaf35; name: string; list: Leaf35[]; run: () => string }
function fresh35(): Holder35 { return { h35: 35, leaf: leaf35("t"), name: "n", list: [leaf35("l")], run: () => "r" }; }
function textOf35(h: Holder35): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf35(h: Holder35): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("an object made under any", () => { const loose: any = { h35: 35, leaf: null, name: undefined, list: [], run: () => "r" }; const h: Holder35 = loose; return textOf35(fresh35()) + textOf35(h) + nameOf35(h); });
interface Leaf36 { text: string; l36: number }
function leaf36(text: string): Leaf36 { return { text, l36: 36 }; }
interface Holder36 { h36: number; leaf: Leaf36; name: string; list: Leaf36[]; run: () => string }
function fresh36(): Holder36 { return { h36: 36, leaf: leaf36("t"), name: "n", list: [leaf36("l")], run: () => "r" }; }
function textOf36(h: Holder36): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf36(h: Holder36): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
interface Outer36 { inner: Holder36 }
say("an object made under any that holds another", () => { const loose: any = { inner: { h36: 36, leaf: null, name: "n", list: [], run: () => "r" } }; const o: Outer36 = loose; return textOf36(fresh36()) + textOf36(o.inner); });
interface Leaf37 { text: string; l37: number }
function leaf37(text: string): Leaf37 { return { text, l37: 37 }; }
interface Holder37 { h37: number; leaf: Leaf37; name: string; list: Leaf37[]; run: () => string }
function fresh37(): Holder37 { return { h37: 37, leaf: leaf37("t"), name: "n", list: [leaf37("l")], run: () => "r" }; }
function textOf37(h: Holder37): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf37(h: Holder37): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("an object made under any, handed over through any", () => { const loose: any = { h37: 37, leaf: undefined, name: "n", list: [], run: () => "r" }; return textOf37(fresh37()) + (textOf37 as any)(loose); });
interface Leaf38 { text: string; l38: number }
function leaf38(text: string): Leaf38 { return { text, l38: 38 }; }
interface Holder38 { h38: number; leaf: Leaf38; name: string; list: Leaf38[]; run: () => string }
function fresh38(): Holder38 { return { h38: 38, leaf: leaf38("t"), name: "n", list: [leaf38("l")], run: () => "r" }; }
function textOf38(h: Holder38): string { return h.leaf === undefined ? "no leaf" : h.leaf === null ? "null leaf" : h.leaf.text; }
function nameOf38(h: Holder38): string { return h.name === undefined ? "no name" : h.name === null ? "null name" : h.name; }
say("an object made under any, under `as`", () => { const loose: any = { h38: 38, leaf: null, name: null, list: [], run: () => "r" }; return textOf38(fresh38()) + nameOf38(loose as Holder38); });
interface LeafLater { later: string }
async function later(): Promise<LeafLater> { return nothing as LeafLater; }
later().then(l => console.log("awaited:", l === undefined ? "nothing" : l.later));
