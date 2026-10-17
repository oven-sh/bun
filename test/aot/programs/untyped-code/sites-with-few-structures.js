// Sites that read by name from objects of a few structures each: whatever places the structures fall on, the answers are the same.
class Base { twice() { return this.value * 2; } }
class Other { twice() { return -this.value; } get extra() { return 7; } }
// Far enough back that `value` is kept outside the object in some, in the object in others.
const kinds = [];
for (let i = 0; i < 48; i++) {
  kinds.push(n => { const o = i % 3 ? new Base() : new Other(); for (let k = 0; k < i % 5 * 4; k++) o["pad" + i + "_" + k] = k; o["own" + i] = i; o.value = n; if (i % 4 === 1 && i % 3) o.extra = i; return o; });
}
function read0(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read1(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read2(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read3(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read4(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read5(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read6(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read7(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read8(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read9(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read10(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read11(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read12(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read13(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read14(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read15(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read16(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read17(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read18(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read19(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read20(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read21(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read22(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
function read23(o) { return o.value + (o.extra === undefined ? 0 : o.extra) + o.twice(); }
const sites = [read0, read1, read2, read3, read4, read5, read6, read7, read8, read9, read10, read11, read12, read13, read14, read15, read16, read17, read18, read19, read20, read21, read22, read23];
let sum = 0;
const objects = kinds.map((make, i) => make(i + 1));
// Site s meets 2 + s % 9 kinds, from the s-th on.
for (let turn = 0; turn < 400; turn++) sites.forEach((read, s) => { for (let k = 0; k < 2 + s % 9; k++) sum += read(objects[(s * 2 + k) % objects.length]); });
console.log(sum);
// What a slot holds ends with the structure, or with what it rests on.
for (const o of objects) { if (o.value % 7 === 0) delete o.value; if (o.value % 5 === 0) o.late = 1; }
Base.prototype.twice = function () { return 1; };
sum = 0;
for (let turn = 0; turn < 40; turn++) sites.forEach((read, s) => { for (let k = 0; k < 2 + s % 9; k++) { const v = read(objects[(s * 2 + k) % objects.length]); sum += Number.isNaN(v) ? 1000 : v; } });
console.log(sum);
Object.defineProperty(Base.prototype, "extra", { get() { return 100; }, configurable: true });
sum = 0;
for (let turn = 0; turn < 40; turn++) sites.forEach((read, s) => { for (let k = 0; k < 2 + s % 9; k++) { const v = read(objects[(s * 2 + k) % objects.length]); sum += Number.isNaN(v) ? 1000 : v; } });
console.log(sum);
