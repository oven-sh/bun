// Names that are read, stored, defined and called at very many places of a program, on objects of many shapes: every place must find what plain JavaScript finds.
const log = [];
class Counter { constructor(start) { this.busy = start; this.other = -start; } step(by) { this.busy += by; return this; } get doubled() { return this.busy * 2; } }
class Derived extends Counter { step(by) { super.step(by); this.other -= by; return this; } }
const wide = {}; for (let i = 0; i < 80; i++) wide["w" + i] = i; wide.busy = "out of line"; wide.step = function (by) { return { busy: by, step: wide.step, other: 0 }; };
const makers = [() => ({ busy: 1, other: 2, step(by) { this.busy += by; return this; } }), () => ({ other: 2, busy: 1, step(by) { this.busy -= by; return this; } }), () => new Counter(5), () => new Derived(7), () => Object.create({ busy: "inherited", other: "too", step() { return this; } }), () => wide, () => ({ get busy() { return "from a getter"; }, set busy(v) { log.push("set " + v); }, other: 0, step() { return this; } }), () => Object.assign(() => 0, { busy: "on a function", other: 1, step() { return this; } }), () => Object.assign([], { busy: "on an array", other: 1, step() { return this; } })];
function read0(o) { return o.busy; }
function read1(o) { return o.busy; }
function read2(o) { return o.busy; }
function read3(o) { return o.busy; }
function read4(o) { return o.busy; }
function read5(o) { return o.busy; }
function read6(o) { return o.busy; }
function read7(o) { return o.busy; }
function read8(o) { return o.busy; }
function read9(o) { return o.busy; }
function read10(o) { return o.busy; }
function read11(o) { return o.busy; }
function read12(o) { return o.busy; }
function read13(o) { return o.busy; }
function read14(o) { return o.busy; }
function read15(o) { return o.busy; }
function read16(o) { return o.busy; }
function read17(o) { return o.busy; }
function read18(o) { return o.busy; }
function read19(o) { return o.busy; }
function read20(o) { return o.busy; }
function read21(o) { return o.busy; }
function read22(o) { return o.busy; }
function read23(o) { return o.busy; }
function read24(o) { return o.busy; }
function read25(o) { return o.busy; }
function read26(o) { return o.busy; }
function read27(o) { return o.busy; }
function read28(o) { return o.busy; }
function read29(o) { return o.busy; }
function read30(o) { return o.busy; }
function read31(o) { return o.busy; }
function read32(o) { return o.busy; }
function read33(o) { return o.busy; }
function read34(o) { return o.busy; }
function read35(o) { return o.busy; }
function read36(o) { return o.busy; }
function read37(o) { return o.busy; }
function read38(o) { return o.busy; }
function read39(o) { return o.busy; }
function read40(o) { return o.busy; }
function read41(o) { return o.busy; }
function read42(o) { return o.busy; }
function read43(o) { return o.busy; }
function read44(o) { return o.busy; }
function read45(o) { return o.busy; }
function read46(o) { return o.busy; }
function read47(o) { return o.busy; }
function read48(o) { return o.busy; }
function read49(o) { return o.busy; }
function read50(o) { return o.busy; }
function read51(o) { return o.busy; }
function read52(o) { return o.busy; }
function read53(o) { return o.busy; }
function read54(o) { return o.busy; }
function read55(o) { return o.busy; }
function read56(o) { return o.busy; }
function read57(o) { return o.busy; }
function read58(o) { return o.busy; }
function read59(o) { return o.busy; }
function read60(o) { return o.busy; }
function read61(o) { return o.busy; }
function read62(o) { return o.busy; }
function read63(o) { return o.busy; }
function read64(o) { return o.busy; }
function read65(o) { return o.busy; }
function read66(o) { return o.busy; }
function read67(o) { return o.busy; }
function read68(o) { return o.busy; }
function read69(o) { return o.busy; }
function store0(o) { o.busy = 0; o.other = o.busy; return o.other; }
function store1(o) { o.busy = 1; o.other = o.busy; return o.other; }
function store2(o) { o.busy = 2; o.other = o.busy; return o.other; }
function store3(o) { o.busy = 3; o.other = o.busy; return o.other; }
function store4(o) { o.busy = 4; o.other = o.busy; return o.other; }
function store5(o) { o.busy = 5; o.other = o.busy; return o.other; }
function store6(o) { o.busy = 6; o.other = o.busy; return o.other; }
function store7(o) { o.busy = 7; o.other = o.busy; return o.other; }
function store8(o) { o.busy = 8; o.other = o.busy; return o.other; }
function store9(o) { o.busy = 9; o.other = o.busy; return o.other; }
function store10(o) { o.busy = 10; o.other = o.busy; return o.other; }
function store11(o) { o.busy = 11; o.other = o.busy; return o.other; }
function store12(o) { o.busy = 12; o.other = o.busy; return o.other; }
function store13(o) { o.busy = 13; o.other = o.busy; return o.other; }
function store14(o) { o.busy = 14; o.other = o.busy; return o.other; }
function store15(o) { o.busy = 15; o.other = o.busy; return o.other; }
function store16(o) { o.busy = 16; o.other = o.busy; return o.other; }
function store17(o) { o.busy = 17; o.other = o.busy; return o.other; }
function store18(o) { o.busy = 18; o.other = o.busy; return o.other; }
function store19(o) { o.busy = 19; o.other = o.busy; return o.other; }
function store20(o) { o.busy = 20; o.other = o.busy; return o.other; }
function store21(o) { o.busy = 21; o.other = o.busy; return o.other; }
function store22(o) { o.busy = 22; o.other = o.busy; return o.other; }
function store23(o) { o.busy = 23; o.other = o.busy; return o.other; }
function store24(o) { o.busy = 24; o.other = o.busy; return o.other; }
function store25(o) { o.busy = 25; o.other = o.busy; return o.other; }
function store26(o) { o.busy = 26; o.other = o.busy; return o.other; }
function store27(o) { o.busy = 27; o.other = o.busy; return o.other; }
function store28(o) { o.busy = 28; o.other = o.busy; return o.other; }
function store29(o) { o.busy = 29; o.other = o.busy; return o.other; }
function store30(o) { o.busy = 30; o.other = o.busy; return o.other; }
function store31(o) { o.busy = 31; o.other = o.busy; return o.other; }
function store32(o) { o.busy = 32; o.other = o.busy; return o.other; }
function store33(o) { o.busy = 33; o.other = o.busy; return o.other; }
function store34(o) { o.busy = 34; o.other = o.busy; return o.other; }
function store35(o) { o.busy = 35; o.other = o.busy; return o.other; }
function store36(o) { o.busy = 36; o.other = o.busy; return o.other; }
function store37(o) { o.busy = 37; o.other = o.busy; return o.other; }
function store38(o) { o.busy = 38; o.other = o.busy; return o.other; }
function store39(o) { o.busy = 39; o.other = o.busy; return o.other; }
function store40(o) { o.busy = 40; o.other = o.busy; return o.other; }
function store41(o) { o.busy = 41; o.other = o.busy; return o.other; }
function store42(o) { o.busy = 42; o.other = o.busy; return o.other; }
function store43(o) { o.busy = 43; o.other = o.busy; return o.other; }
function store44(o) { o.busy = 44; o.other = o.busy; return o.other; }
function store45(o) { o.busy = 45; o.other = o.busy; return o.other; }
function store46(o) { o.busy = 46; o.other = o.busy; return o.other; }
function store47(o) { o.busy = 47; o.other = o.busy; return o.other; }
function store48(o) { o.busy = 48; o.other = o.busy; return o.other; }
function store49(o) { o.busy = 49; o.other = o.busy; return o.other; }
function define0() { return { busy: 0, other: "0", step() { return this.busy; } }; }
function define1() { return { busy: 1, other: "1", step() { return this.busy; } }; }
function define2() { return { busy: 2, other: "2", step() { return this.busy; } }; }
function define3() { return { busy: 3, other: "3", step() { return this.busy; } }; }
function define4() { return { busy: 4, other: "4", step() { return this.busy; } }; }
function define5() { return { busy: 5, other: "5", step() { return this.busy; } }; }
function define6() { return { busy: 6, other: "6", step() { return this.busy; } }; }
function define7() { return { busy: 7, other: "7", step() { return this.busy; } }; }
function define8() { return { busy: 8, other: "8", step() { return this.busy; } }; }
function define9() { return { busy: 9, other: "9", step() { return this.busy; } }; }
function define10() { return { busy: 10, other: "10", step() { return this.busy; } }; }
function define11() { return { busy: 11, other: "11", step() { return this.busy; } }; }
function define12() { return { busy: 12, other: "12", step() { return this.busy; } }; }
function define13() { return { busy: 13, other: "13", step() { return this.busy; } }; }
function define14() { return { busy: 14, other: "14", step() { return this.busy; } }; }
function define15() { return { busy: 15, other: "15", step() { return this.busy; } }; }
function define16() { return { busy: 16, other: "16", step() { return this.busy; } }; }
function define17() { return { busy: 17, other: "17", step() { return this.busy; } }; }
function define18() { return { busy: 18, other: "18", step() { return this.busy; } }; }
function define19() { return { busy: 19, other: "19", step() { return this.busy; } }; }
function define20() { return { busy: 20, other: "20", step() { return this.busy; } }; }
function define21() { return { busy: 21, other: "21", step() { return this.busy; } }; }
function define22() { return { busy: 22, other: "22", step() { return this.busy; } }; }
function define23() { return { busy: 23, other: "23", step() { return this.busy; } }; }
function define24() { return { busy: 24, other: "24", step() { return this.busy; } }; }
function define25() { return { busy: 25, other: "25", step() { return this.busy; } }; }
function define26() { return { busy: 26, other: "26", step() { return this.busy; } }; }
function define27() { return { busy: 27, other: "27", step() { return this.busy; } }; }
function define28() { return { busy: 28, other: "28", step() { return this.busy; } }; }
function define29() { return { busy: 29, other: "29", step() { return this.busy; } }; }
function define30() { return { busy: 30, other: "30", step() { return this.busy; } }; }
function define31() { return { busy: 31, other: "31", step() { return this.busy; } }; }
function define32() { return { busy: 32, other: "32", step() { return this.busy; } }; }
function define33() { return { busy: 33, other: "33", step() { return this.busy; } }; }
function define34() { return { busy: 34, other: "34", step() { return this.busy; } }; }
function define35() { return { busy: 35, other: "35", step() { return this.busy; } }; }
function define36() { return { busy: 36, other: "36", step() { return this.busy; } }; }
function define37() { return { busy: 37, other: "37", step() { return this.busy; } }; }
function define38() { return { busy: 38, other: "38", step() { return this.busy; } }; }
function define39() { return { busy: 39, other: "39", step() { return this.busy; } }; }
function define40() { return { busy: 40, other: "40", step() { return this.busy; } }; }
function define41() { return { busy: 41, other: "41", step() { return this.busy; } }; }
function define42() { return { busy: 42, other: "42", step() { return this.busy; } }; }
function define43() { return { busy: 43, other: "43", step() { return this.busy; } }; }
function define44() { return { busy: 44, other: "44", step() { return this.busy; } }; }
function define45() { return { busy: 45, other: "45", step() { return this.busy; } }; }
function define46() { return { busy: 46, other: "46", step() { return this.busy; } }; }
function define47() { return { busy: 47, other: "47", step() { return this.busy; } }; }
function define48() { return { busy: 48, other: "48", step() { return this.busy; } }; }
function define49() { return { busy: 49, other: "49", step() { return this.busy; } }; }
function call0(o) { return o.step(0).busy; }
function call1(o) { return o.step(1).busy; }
function call2(o) { return o.step(2).busy; }
function call3(o) { return o.step(3).busy; }
function call4(o) { return o.step(4).busy; }
function call5(o) { return o.step(5).busy; }
function call6(o) { return o.step(6).busy; }
function call7(o) { return o.step(7).busy; }
function call8(o) { return o.step(8).busy; }
function call9(o) { return o.step(9).busy; }
function call10(o) { return o.step(10).busy; }
function call11(o) { return o.step(11).busy; }
function call12(o) { return o.step(12).busy; }
function call13(o) { return o.step(13).busy; }
function call14(o) { return o.step(14).busy; }
function call15(o) { return o.step(15).busy; }
function call16(o) { return o.step(16).busy; }
function call17(o) { return o.step(17).busy; }
function call18(o) { return o.step(18).busy; }
function call19(o) { return o.step(19).busy; }
function call20(o) { return o.step(20).busy; }
function call21(o) { return o.step(21).busy; }
function call22(o) { return o.step(22).busy; }
function call23(o) { return o.step(23).busy; }
function call24(o) { return o.step(24).busy; }
function call25(o) { return o.step(25).busy; }
function call26(o) { return o.step(26).busy; }
function call27(o) { return o.step(27).busy; }
function call28(o) { return o.step(28).busy; }
function call29(o) { return o.step(29).busy; }
function call30(o) { return o.step(30).busy; }
function call31(o) { return o.step(31).busy; }
function call32(o) { return o.step(32).busy; }
function call33(o) { return o.step(33).busy; }
function call34(o) { return o.step(34).busy; }
function call35(o) { return o.step(35).busy; }
function call36(o) { return o.step(36).busy; }
function call37(o) { return o.step(37).busy; }
function call38(o) { return o.step(38).busy; }
function call39(o) { return o.step(39).busy; }
function call40(o) { return o.step(40).busy; }
function call41(o) { return o.step(41).busy; }
function call42(o) { return o.step(42).busy; }
function call43(o) { return o.step(43).busy; }
function call44(o) { return o.step(44).busy; }
function call45(o) { return o.step(45).busy; }
function call46(o) { return o.step(46).busy; }
function call47(o) { return o.step(47).busy; }
function call48(o) { return o.step(48).busy; }
function call49(o) { return o.step(49).busy; }
function call50(o) { return o.step(50).busy; }
function call51(o) { return o.step(51).busy; }
function call52(o) { return o.step(52).busy; }
function call53(o) { return o.step(53).busy; }
function call54(o) { return o.step(54).busy; }
function call55(o) { return o.step(55).busy; }
function call56(o) { return o.step(56).busy; }
function call57(o) { return o.step(57).busy; }
function call58(o) { return o.step(58).busy; }
function call59(o) { return o.step(59).busy; }
function call60(o) { return o.step(60).busy; }
function call61(o) { return o.step(61).busy; }
function call62(o) { return o.step(62).busy; }
function call63(o) { return o.step(63).busy; }
function call64(o) { return o.step(64).busy; }
function call65(o) { return o.step(65).busy; }
function call66(o) { return o.step(66).busy; }
function call67(o) { return o.step(67).busy; }
function call68(o) { return o.step(68).busy; }
function call69(o) { return o.step(69).busy; }
function call70(o) { return o.step(70).busy; }
function call71(o) { return o.step(71).busy; }
function call72(o) { return o.step(72).busy; }
function call73(o) { return o.step(73).busy; }
function call74(o) { return o.step(74).busy; }
function call75(o) { return o.step(75).busy; }
function call76(o) { return o.step(76).busy; }
function call77(o) { return o.step(77).busy; }
function call78(o) { return o.step(78).busy; }
function call79(o) { return o.step(79).busy; }
const reads = [read0, read1, read2, read3, read4, read5, read6, read7, read8, read9, read10, read11, read12, read13, read14, read15, read16, read17, read18, read19, read20, read21, read22, read23, read24, read25, read26, read27, read28, read29, read30, read31, read32, read33, read34, read35, read36, read37, read38, read39, read40, read41, read42, read43, read44, read45, read46, read47, read48, read49, read50, read51, read52, read53, read54, read55, read56, read57, read58, read59, read60, read61, read62, read63, read64, read65, read66, read67, read68, read69];
const stores = [store0, store1, store2, store3, store4, store5, store6, store7, store8, store9, store10, store11, store12, store13, store14, store15, store16, store17, store18, store19, store20, store21, store22, store23, store24, store25, store26, store27, store28, store29, store30, store31, store32, store33, store34, store35, store36, store37, store38, store39, store40, store41, store42, store43, store44, store45, store46, store47, store48, store49];
const defines = [define0, define1, define2, define3, define4, define5, define6, define7, define8, define9, define10, define11, define12, define13, define14, define15, define16, define17, define18, define19, define20, define21, define22, define23, define24, define25, define26, define27, define28, define29, define30, define31, define32, define33, define34, define35, define36, define37, define38, define39, define40, define41, define42, define43, define44, define45, define46, define47, define48, define49];
const calls = [call0, call1, call2, call3, call4, call5, call6, call7, call8, call9, call10, call11, call12, call13, call14, call15, call16, call17, call18, call19, call20, call21, call22, call23, call24, call25, call26, call27, call28, call29, call30, call31, call32, call33, call34, call35, call36, call37, call38, call39, call40, call41, call42, call43, call44, call45, call46, call47, call48, call49, call50, call51, call52, call53, call54, call55, call56, call57, call58, call59, call60, call61, call62, call63, call64, call65, call66, call67, call68, call69, call70, call71, call72, call73, call74, call75, call76, call77, call78, call79];
const show = (v) => typeof v === "function" ? "function" : String(v);
const attempt = (f, o) => { try { return show(f(o)); } catch (error) { return error.constructor.name; } };
for (const make of makers) console.log(reads.map((f, i) => i % 23 ? "" : attempt(f, make())).join("|"), new Set(reads.map((f) => attempt(f, make()))).size, stores.map((f, i) => i % 17 ? "" : attempt(f, make())).join("|"), calls.map((f, i) => i % 27 ? "" : attempt(f, make())).join("|"));
console.log(defines.map((f) => f().busy + f().other + f().step()).join(" ").length, log.length, log.slice(0, 3).join());
for (const odd of [undefined, null, 1, "text", true, 10n, Symbol("s")]) console.log(attempt(read0, odd), attempt(read69, odd), attempt(store0, odd), attempt(store49, odd), attempt(call0, odd), attempt(call79, odd));
let sum = 0; for (let round = 0; round < 300; round++) { const o = makers[round % 4](); sum += reads[round % 70](o) + stores[round % 50](o) + calls[round % 80](o); if (round % 100 === 99 && typeof Bun !== "undefined") Bun.gc(true); } console.log(sum);
