// Four hundred sites read the same five names. The lookups of the first five sites are cached where all sites find them, so a site that has never run, a site that runs seldom and a site that runs often all stay out of the run time.
// Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const entries = () => count("operationAOTGetById") + count("operationAOTGetByIdAndCache");
function Animal(name) { this.name = name; }
Animal.prototype.speak = function () { return this.name + " speaks"; };
Animal.prototype.legs = 4;
Object.defineProperty(Animal.prototype, "loud", { get() { return this.name.toUpperCase(); }, configurable: true });
function Dog(name) { Animal.call(this, name); this.tricks = 0; }
Dog.prototype = Object.create(Animal.prototype);
Dog.prototype.speak = function () { return Animal.prototype.speak.call(this) + " woof"; };
const dog = new Dog("rex");
const cat = new Animal("tom");
const plain = { name: "plain", legs: 0, speak() { return "plainly"; } };
// Eighty functions with the same five reads: four hundred sites.
function read0(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read1(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read2(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read3(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read4(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read5(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read6(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read7(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read8(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read9(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read10(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read11(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read12(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read13(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read14(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read15(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read16(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read17(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read18(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read19(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read20(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read21(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read22(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read23(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read24(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read25(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read26(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read27(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read28(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read29(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read30(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read31(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read32(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read33(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read34(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read35(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read36(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read37(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read38(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read39(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read40(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read41(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read42(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read43(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read44(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read45(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read46(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read47(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read48(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read49(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read50(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read51(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read52(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read53(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read54(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read55(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read56(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read57(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read58(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read59(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read60(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read61(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read62(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read63(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read64(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read65(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read66(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read67(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read68(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read69(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read70(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read71(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read72(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read73(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read74(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read75(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read76(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read77(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read78(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
function read79(o) { return o.name + "|" + o.speak() + "|" + o.missing + "|" + o.loud + "|" + o.legs; }
const all = [read0, read1, read2, read3, read4, read5, read6, read7, read8, read9, read10, read11, read12, read13, read14, read15, read16, read17, read18, read19, read20, read21, read22, read23, read24, read25, read26, read27, read28, read29, read30, read31, read32, read33, read34, read35, read36, read37, read38, read39, read40, read41, read42, read43, read44, read45, read46, read47, read48, read49, read50, read51, read52, read53, read54, read55, read56, read57, read58, read59, read60, read61, read62, read63, read64, read65, read66, read67, read68, read69, read70, read71, read72, read73, read74, read75, read76, read77, read78, read79];
const seen = new Set();
// The first function looks up each name on each kind of object.
for (let i = 0; i < 8; i++) for (const o of [dog, cat, plain]) seen.add(read0(o));
const before = entries();
// Each of the others runs seven times on one kind of object.
for (let turn = 0; turn < 7; turn++) for (const read of all) seen.add(read(dog));
// A second kind of object now and then.
for (const read of all) seen.add(read(cat));
const times = entries() - before;
console.log([...seen].join(" ; "));
console.log(times < 100 ? "the run time was entered under 100 times" : "the run time was entered " + times + " times");
// A site that runs often, on one kind of object and then on three in turn.
const atRest = entries();
let length = 0;
for (let i = 0; i < 20000; i++) length += read7(dog).length;
for (let i = 0; i < 20000; i++) length += read7(dog).length + read7(cat).length + read7(plain).length;
const later = entries() - atRest;
console.log(length, later < 60 ? "the busy site is served without the run time" : "the run time was entered " + later + " times");
// What was cached ends when it should.
Dog.prototype.legs = 3;
Animal.prototype.missing = "found";
Object.defineProperty(dog, "name", { get() { return "REX"; }, configurable: true });
const after = new Set();
for (const read of all) for (const o of [dog, cat, plain]) after.add(read(o));
console.log([...after].join(" ; "));
delete Dog.prototype.speak;
delete Animal.prototype.missing;
plain.loud = "LOUD";
after.clear();
for (const read of all) for (const o of [dog, cat, plain, { name: 1, speak: () => 2 }]) after.add(read(o));
console.log([...after].join(" ; "));
