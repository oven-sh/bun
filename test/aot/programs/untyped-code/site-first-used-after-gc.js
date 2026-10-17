// A site that is first used after a collection is filled without the run time's operation, where all sites' table knows the answer.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
// Far enough back that the two are kept outside the object.
const make = n => { const o = {}; for (let i = 0; i < 30; i++) o["early" + i] = i; o.alpha = n; o.beta = -n; return o; };
const object = make(3);
// Eighty functions, two sites each.
function read0(o, late) { return late ? o.beta : o.alpha; }
function read1(o, late) { return late ? o.beta : o.alpha; }
function read2(o, late) { return late ? o.beta : o.alpha; }
function read3(o, late) { return late ? o.beta : o.alpha; }
function read4(o, late) { return late ? o.beta : o.alpha; }
function read5(o, late) { return late ? o.beta : o.alpha; }
function read6(o, late) { return late ? o.beta : o.alpha; }
function read7(o, late) { return late ? o.beta : o.alpha; }
function read8(o, late) { return late ? o.beta : o.alpha; }
function read9(o, late) { return late ? o.beta : o.alpha; }
function read10(o, late) { return late ? o.beta : o.alpha; }
function read11(o, late) { return late ? o.beta : o.alpha; }
function read12(o, late) { return late ? o.beta : o.alpha; }
function read13(o, late) { return late ? o.beta : o.alpha; }
function read14(o, late) { return late ? o.beta : o.alpha; }
function read15(o, late) { return late ? o.beta : o.alpha; }
function read16(o, late) { return late ? o.beta : o.alpha; }
function read17(o, late) { return late ? o.beta : o.alpha; }
function read18(o, late) { return late ? o.beta : o.alpha; }
function read19(o, late) { return late ? o.beta : o.alpha; }
function read20(o, late) { return late ? o.beta : o.alpha; }
function read21(o, late) { return late ? o.beta : o.alpha; }
function read22(o, late) { return late ? o.beta : o.alpha; }
function read23(o, late) { return late ? o.beta : o.alpha; }
function read24(o, late) { return late ? o.beta : o.alpha; }
function read25(o, late) { return late ? o.beta : o.alpha; }
function read26(o, late) { return late ? o.beta : o.alpha; }
function read27(o, late) { return late ? o.beta : o.alpha; }
function read28(o, late) { return late ? o.beta : o.alpha; }
function read29(o, late) { return late ? o.beta : o.alpha; }
function read30(o, late) { return late ? o.beta : o.alpha; }
function read31(o, late) { return late ? o.beta : o.alpha; }
function read32(o, late) { return late ? o.beta : o.alpha; }
function read33(o, late) { return late ? o.beta : o.alpha; }
function read34(o, late) { return late ? o.beta : o.alpha; }
function read35(o, late) { return late ? o.beta : o.alpha; }
function read36(o, late) { return late ? o.beta : o.alpha; }
function read37(o, late) { return late ? o.beta : o.alpha; }
function read38(o, late) { return late ? o.beta : o.alpha; }
function read39(o, late) { return late ? o.beta : o.alpha; }
function read40(o, late) { return late ? o.beta : o.alpha; }
function read41(o, late) { return late ? o.beta : o.alpha; }
function read42(o, late) { return late ? o.beta : o.alpha; }
function read43(o, late) { return late ? o.beta : o.alpha; }
function read44(o, late) { return late ? o.beta : o.alpha; }
function read45(o, late) { return late ? o.beta : o.alpha; }
function read46(o, late) { return late ? o.beta : o.alpha; }
function read47(o, late) { return late ? o.beta : o.alpha; }
function read48(o, late) { return late ? o.beta : o.alpha; }
function read49(o, late) { return late ? o.beta : o.alpha; }
function read50(o, late) { return late ? o.beta : o.alpha; }
function read51(o, late) { return late ? o.beta : o.alpha; }
function read52(o, late) { return late ? o.beta : o.alpha; }
function read53(o, late) { return late ? o.beta : o.alpha; }
function read54(o, late) { return late ? o.beta : o.alpha; }
function read55(o, late) { return late ? o.beta : o.alpha; }
function read56(o, late) { return late ? o.beta : o.alpha; }
function read57(o, late) { return late ? o.beta : o.alpha; }
function read58(o, late) { return late ? o.beta : o.alpha; }
function read59(o, late) { return late ? o.beta : o.alpha; }
function read60(o, late) { return late ? o.beta : o.alpha; }
function read61(o, late) { return late ? o.beta : o.alpha; }
function read62(o, late) { return late ? o.beta : o.alpha; }
function read63(o, late) { return late ? o.beta : o.alpha; }
function read64(o, late) { return late ? o.beta : o.alpha; }
function read65(o, late) { return late ? o.beta : o.alpha; }
function read66(o, late) { return late ? o.beta : o.alpha; }
function read67(o, late) { return late ? o.beta : o.alpha; }
function read68(o, late) { return late ? o.beta : o.alpha; }
function read69(o, late) { return late ? o.beta : o.alpha; }
function read70(o, late) { return late ? o.beta : o.alpha; }
function read71(o, late) { return late ? o.beta : o.alpha; }
function read72(o, late) { return late ? o.beta : o.alpha; }
function read73(o, late) { return late ? o.beta : o.alpha; }
function read74(o, late) { return late ? o.beta : o.alpha; }
function read75(o, late) { return late ? o.beta : o.alpha; }
function read76(o, late) { return late ? o.beta : o.alpha; }
function read77(o, late) { return late ? o.beta : o.alpha; }
function read78(o, late) { return late ? o.beta : o.alpha; }
function read79(o, late) { return late ? o.beta : o.alpha; }
const all = [read0, read1, read2, read3, read4, read5, read6, read7, read8, read9, read10, read11, read12, read13, read14, read15, read16, read17, read18, read19, read20, read21, read22, read23, read24, read25, read26, read27, read28, read29, read30, read31, read32, read33, read34, read35, read36, read37, read38, read39, read40, read41, read42, read43, read44, read45, read46, read47, read48, read49, read50, read51, read52, read53, read54, read55, read56, read57, read58, read59, read60, read61, read62, read63, read64, read65, read66, read67, read68, read69, read70, read71, read72, read73, read74, read75, read76, read77, read78, read79];
let sum = 0;
for (let turn = 0; turn < 20; turn++) for (const read of all) sum += read(object, false);
sum += read0(object, true);
collect();
const before = count("operationAOTGetById");
for (let turn = 0; turn < 40; turn++) for (const read of all) sum += read(object, true);
const times = count("operationAOTGetById") - before;
console.log(sum, times < 40 ? "and the operation was entered under 40 times" : "and the operation was entered " + times + " times");
// What was filled so dies with its structure, as any slot.
let other = make(5);
for (let turn = 0; turn < 20; turn++) for (const read of all) sum += read(other, true) + read(other, false);
other = null;
collect();
const third = make(7); third.gamma = 1;
for (let turn = 0; turn < 20; turn++) for (const read of all) sum += read(third, true) + read(object, true);
delete object.beta;
console.log(sum, read5(object, true), read5(third, true), read5(object, false));
