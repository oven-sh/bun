const Back = class { constructor(o) { return o; } };
class One extends Back { #p = "one"; static has(o) { return #p in o; } static read(o) { return o.#p; } }
class Twelve extends Back { #a = 1; #b = 2; #c = 3; #d = 4; #e = 5; #f = 6; #g = 7; #h = 8; #i = 9; #j = 10; #k = 11; #l = { held: "an object" }; static has(o) { return #a in o && #l in o; } static read(o) { return o.#a + o.#b + o.#c + o.#d + o.#e + o.#f + o.#g + o.#h + o.#i + o.#j + o.#k + o.#l.held; } }
class Brand extends Back { #m() { return "method"; } get #g() { return "getter"; } static has(o) { return #m in o; } static read(o) { return o.#m() + o.#g; } }
let junk = []; function garbage(k) { for (let i = 0; i < 40; i++) junk.push({ a: i, b: [i, k], c: "s" + i }); if (junk.length > 2000) junk = []; }
const lines = []; let sum = "";
function note(s) { sum += s + ";"; }
class C0 {  }
new One(C0); garbage(0);
{ const C = C0; note(String(C.name)); garbage(0); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C1 { m() { return 1; } }
new Twelve(C1); garbage(1);
{ const C = C1; note(String(C.name)); garbage(1); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C2 { static sm() { return 2; } }
new Brand(C2); garbage(2);
{ const C = C2; note(String(C.name)); garbage(2); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C3 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
Error.captureStackTrace(C3); garbage(3);
{ const C = C3; note(String(C.name)); garbage(3); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C4 { static stack() { return "declared"; } }
new One(C4); new Twelve(C4); new Brand(C4); Error.captureStackTrace(C4); garbage(4);
{ const C = C4; note(String(C.name)); garbage(4); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C5 {  }
Object.setPrototypeOf(Object.getPrototypeOf(new C5()), { parent: 5 }); garbage(5);
{ const C = C5; note(String(C.name)); garbage(5); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C6 { m() { return 6; } }
new Twelve(C6); Object.setPrototypeOf(Object.getPrototypeOf(new C6()), { parent: 6 }); garbage(6);
{ const C = C6; note(String(C.name)); garbage(6); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C7 { static sm() { return 7; } }
 garbage(7);
{ const C = C7; note(String(C.name)); garbage(7); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C8 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new One(C8); garbage(8);
{ const C = C8; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(8); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C9 { static stack() { return "declared"; } }
new Twelve(C9); garbage(9);
{ const C = C9; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(9); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C10 {  }
new Brand(C10); garbage(10);
{ const C = C10; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(10); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C11 { m() { return 11; } }
Error.captureStackTrace(C11); garbage(11);
{ const C = C11; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(11); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C12 { static sm() { return 12; } }
new One(C12); new Twelve(C12); new Brand(C12); Error.captureStackTrace(C12); garbage(12);
{ const C = C12; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(12); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C13 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C13()), { parent: 13 }); garbage(13);
{ const C = C13; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(13); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C14 { static stack() { return "declared"; } }
new Twelve(C14); Object.setPrototypeOf(Object.getPrototypeOf(new C14()), { parent: 14 }); garbage(14);
{ const C = C14; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(14); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C15 {  }
 garbage(15);
{ const C = C15; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(15); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C16 { m() { return 16; } }
new One(C16); garbage(16);
{ const C = C16; note(String(typeof C.prototype)); garbage(16); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C17 { static sm() { return 17; } }
new Twelve(C17); garbage(17);
{ const C = C17; note(String(typeof C.prototype)); garbage(17); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C18 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new Brand(C18); garbage(18);
{ const C = C18; note(String(typeof C.prototype)); garbage(18); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C19 { static stack() { return "declared"; } }
Error.captureStackTrace(C19); garbage(19);
{ const C = C19; note(String(typeof C.prototype)); garbage(19); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
console.log("19 " + sum.length + " " + sum.slice(-150)); sum = "";
class C20 {  }
new One(C20); new Twelve(C20); new Brand(C20); Error.captureStackTrace(C20); garbage(20);
{ const C = C20; note(String(typeof C.prototype)); garbage(20); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C21 { m() { return 21; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C21()), { parent: 21 }); garbage(21);
{ const C = C21; note(String(typeof C.prototype)); garbage(21); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C22 { static sm() { return 22; } }
new Twelve(C22); Object.setPrototypeOf(Object.getPrototypeOf(new C22()), { parent: 22 }); garbage(22);
{ const C = C22; note(String(typeof C.prototype)); garbage(22); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C23 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
 garbage(23);
{ const C = C23; note(String(typeof C.prototype)); garbage(23); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C24 { static stack() { return "declared"; } }
new One(C24); garbage(24);
{ const C = C24; note(String("name" in C)); garbage(24); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C25 {  }
new Twelve(C25); garbage(25);
{ const C = C25; note(String("name" in C)); garbage(25); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C26 { m() { return 26; } }
new Brand(C26); garbage(26);
{ const C = C26; note(String("name" in C)); garbage(26); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C27 { static sm() { return 27; } }
Error.captureStackTrace(C27); garbage(27);
{ const C = C27; note(String("name" in C)); garbage(27); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C28 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new One(C28); new Twelve(C28); new Brand(C28); Error.captureStackTrace(C28); garbage(28);
{ const C = C28; note(String("name" in C)); garbage(28); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C29 { static stack() { return "declared"; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C29()), { parent: 29 }); garbage(29);
{ const C = C29; note(String("name" in C)); garbage(29); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C30 {  }
new Twelve(C30); Object.setPrototypeOf(Object.getPrototypeOf(new C30()), { parent: 30 }); garbage(30);
{ const C = C30; note(String("name" in C)); garbage(30); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C31 { m() { return 31; } }
 garbage(31);
{ const C = C31; note(String("name" in C)); garbage(31); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C32 { static sm() { return 32; } }
new One(C32); garbage(32);
{ const C = C32; note(String(Object.keys(C).length)); garbage(32); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C33 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new Twelve(C33); garbage(33);
{ const C = C33; note(String(Object.keys(C).length)); garbage(33); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C34 { static stack() { return "declared"; } }
new Brand(C34); garbage(34);
{ const C = C34; note(String(Object.keys(C).length)); garbage(34); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C35 {  }
Error.captureStackTrace(C35); garbage(35);
{ const C = C35; note(String(Object.keys(C).length)); garbage(35); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C36 { m() { return 36; } }
new One(C36); new Twelve(C36); new Brand(C36); Error.captureStackTrace(C36); garbage(36);
{ const C = C36; note(String(Object.keys(C).length)); garbage(36); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C37 { static sm() { return 37; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C37()), { parent: 37 }); garbage(37);
{ const C = C37; note(String(Object.keys(C).length)); garbage(37); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C38 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new Twelve(C38); Object.setPrototypeOf(Object.getPrototypeOf(new C38()), { parent: 38 }); garbage(38);
{ const C = C38; note(String(Object.keys(C).length)); garbage(38); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C39 { static stack() { return "declared"; } }
 garbage(39);
{ const C = C39; note(String(Object.keys(C).length)); garbage(39); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
console.log("39 " + sum.length + " " + sum.slice(-150)); sum = "";
class C40 {  }
new One(C40); garbage(40);
{ const C = C40; note(String(C.length)); garbage(40); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C41 { m() { return 41; } }
new Twelve(C41); garbage(41);
{ const C = C41; note(String(C.length)); garbage(41); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C42 { static sm() { return 42; } }
new Brand(C42); garbage(42);
{ const C = C42; note(String(C.length)); garbage(42); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C43 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
Error.captureStackTrace(C43); garbage(43);
{ const C = C43; note(String(C.length)); garbage(43); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C44 { static stack() { return "declared"; } }
new One(C44); new Twelve(C44); new Brand(C44); Error.captureStackTrace(C44); garbage(44);
{ const C = C44; note(String(C.length)); garbage(44); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C45 {  }
Object.setPrototypeOf(Object.getPrototypeOf(new C45()), { parent: 45 }); garbage(45);
{ const C = C45; note(String(C.length)); garbage(45); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C46 { m() { return 46; } }
new Twelve(C46); Object.setPrototypeOf(Object.getPrototypeOf(new C46()), { parent: 46 }); garbage(46);
{ const C = C46; note(String(C.length)); garbage(46); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C47 { static sm() { return 47; } }
 garbage(47);
{ const C = C47; note(String(C.length)); garbage(47); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C48 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new One(C48); garbage(48);
{ const C = C48; note(String(C.name)); garbage(48); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C49 { static stack() { return "declared"; } }
new Twelve(C49); garbage(49);
{ const C = C49; note(String(C.name)); garbage(49); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C50 {  }
new Brand(C50); garbage(50);
{ const C = C50; note(String(C.name)); garbage(50); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C51 { m() { return 51; } }
Error.captureStackTrace(C51); garbage(51);
{ const C = C51; note(String(C.name)); garbage(51); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C52 { static sm() { return 52; } }
new One(C52); new Twelve(C52); new Brand(C52); Error.captureStackTrace(C52); garbage(52);
{ const C = C52; note(String(C.name)); garbage(52); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C53 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C53()), { parent: 53 }); garbage(53);
{ const C = C53; note(String(C.name)); garbage(53); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C54 { static stack() { return "declared"; } }
new Twelve(C54); Object.setPrototypeOf(Object.getPrototypeOf(new C54()), { parent: 54 }); garbage(54);
{ const C = C54; note(String(C.name)); garbage(54); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C55 {  }
 garbage(55);
{ const C = C55; note(String(C.name)); garbage(55); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C56 { m() { return 56; } }
new One(C56); garbage(56);
{ const C = C56; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(56); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C57 { static sm() { return 57; } }
new Twelve(C57); garbage(57);
{ const C = C57; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(57); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C58 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new Brand(C58); garbage(58);
{ const C = C58; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(58); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C59 { static stack() { return "declared"; } }
Error.captureStackTrace(C59); garbage(59);
{ const C = C59; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(59); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
console.log("59 " + sum.length + " " + sum.slice(-150)); sum = "";
class C60 {  }
new One(C60); new Twelve(C60); new Brand(C60); Error.captureStackTrace(C60); garbage(60);
{ const C = C60; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(60); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C61 { m() { return 61; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C61()), { parent: 61 }); garbage(61);
{ const C = C61; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(61); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C62 { static sm() { return 62; } }
new Twelve(C62); Object.setPrototypeOf(Object.getPrototypeOf(new C62()), { parent: 62 }); garbage(62);
{ const C = C62; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(62); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C63 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
 garbage(63);
{ const C = C63; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(63); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C64 { static stack() { return "declared"; } }
new One(C64); garbage(64);
{ const C = C64; note(String(typeof C.prototype)); garbage(64); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C65 {  }
new Twelve(C65); garbage(65);
{ const C = C65; note(String(typeof C.prototype)); garbage(65); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C66 { m() { return 66; } }
new Brand(C66); garbage(66);
{ const C = C66; note(String(typeof C.prototype)); garbage(66); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C67 { static sm() { return 67; } }
Error.captureStackTrace(C67); garbage(67);
{ const C = C67; note(String(typeof C.prototype)); garbage(67); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C68 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new One(C68); new Twelve(C68); new Brand(C68); Error.captureStackTrace(C68); garbage(68);
{ const C = C68; note(String(typeof C.prototype)); garbage(68); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C69 { static stack() { return "declared"; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C69()), { parent: 69 }); garbage(69);
{ const C = C69; note(String(typeof C.prototype)); garbage(69); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C70 {  }
new Twelve(C70); Object.setPrototypeOf(Object.getPrototypeOf(new C70()), { parent: 70 }); garbage(70);
{ const C = C70; note(String(typeof C.prototype)); garbage(70); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C71 { m() { return 71; } }
 garbage(71);
{ const C = C71; note(String(typeof C.prototype)); garbage(71); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C72 { static sm() { return 72; } }
new One(C72); garbage(72);
{ const C = C72; note(String("name" in C)); garbage(72); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C73 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new Twelve(C73); garbage(73);
{ const C = C73; note(String("name" in C)); garbage(73); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C74 { static stack() { return "declared"; } }
new Brand(C74); garbage(74);
{ const C = C74; note(String("name" in C)); garbage(74); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C75 {  }
Error.captureStackTrace(C75); garbage(75);
{ const C = C75; note(String("name" in C)); garbage(75); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C76 { m() { return 76; } }
new One(C76); new Twelve(C76); new Brand(C76); Error.captureStackTrace(C76); garbage(76);
{ const C = C76; note(String("name" in C)); garbage(76); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C77 { static sm() { return 77; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C77()), { parent: 77 }); garbage(77);
{ const C = C77; note(String("name" in C)); garbage(77); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C78 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new Twelve(C78); Object.setPrototypeOf(Object.getPrototypeOf(new C78()), { parent: 78 }); garbage(78);
{ const C = C78; note(String("name" in C)); garbage(78); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C79 { static stack() { return "declared"; } }
 garbage(79);
{ const C = C79; note(String("name" in C)); garbage(79); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
console.log("79 " + sum.length + " " + sum.slice(-150)); sum = "";
class C80 {  }
new One(C80); garbage(80);
{ const C = C80; note(String(Object.keys(C).length)); garbage(80); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C81 { m() { return 81; } }
new Twelve(C81); garbage(81);
{ const C = C81; note(String(Object.keys(C).length)); garbage(81); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C82 { static sm() { return 82; } }
new Brand(C82); garbage(82);
{ const C = C82; note(String(Object.keys(C).length)); garbage(82); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C83 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
Error.captureStackTrace(C83); garbage(83);
{ const C = C83; note(String(Object.keys(C).length)); garbage(83); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C84 { static stack() { return "declared"; } }
new One(C84); new Twelve(C84); new Brand(C84); Error.captureStackTrace(C84); garbage(84);
{ const C = C84; note(String(Object.keys(C).length)); garbage(84); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C85 {  }
Object.setPrototypeOf(Object.getPrototypeOf(new C85()), { parent: 85 }); garbage(85);
{ const C = C85; note(String(Object.keys(C).length)); garbage(85); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C86 { m() { return 86; } }
new Twelve(C86); Object.setPrototypeOf(Object.getPrototypeOf(new C86()), { parent: 86 }); garbage(86);
{ const C = C86; note(String(Object.keys(C).length)); garbage(86); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C87 { static sm() { return 87; } }
 garbage(87);
{ const C = C87; note(String(Object.keys(C).length)); garbage(87); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C88 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new One(C88); garbage(88);
{ const C = C88; note(String(C.length)); garbage(88); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C89 { static stack() { return "declared"; } }
new Twelve(C89); garbage(89);
{ const C = C89; note(String(C.length)); garbage(89); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C90 {  }
new Brand(C90); garbage(90);
{ const C = C90; note(String(C.length)); garbage(90); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C91 { m() { return 91; } }
Error.captureStackTrace(C91); garbage(91);
{ const C = C91; note(String(C.length)); garbage(91); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C92 { static sm() { return 92; } }
new One(C92); new Twelve(C92); new Brand(C92); Error.captureStackTrace(C92); garbage(92);
{ const C = C92; note(String(C.length)); garbage(92); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C93 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C93()), { parent: 93 }); garbage(93);
{ const C = C93; note(String(C.length)); garbage(93); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C94 { static stack() { return "declared"; } }
new Twelve(C94); Object.setPrototypeOf(Object.getPrototypeOf(new C94()), { parent: 94 }); garbage(94);
{ const C = C94; note(String(C.length)); garbage(94); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C95 {  }
 garbage(95);
{ const C = C95; note(String(C.length)); garbage(95); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C96 { m() { return 96; } }
new One(C96); garbage(96);
{ const C = C96; note(String(C.name)); garbage(96); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C97 { static sm() { return 97; } }
new Twelve(C97); garbage(97);
{ const C = C97; note(String(C.name)); garbage(97); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C98 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new Brand(C98); garbage(98);
{ const C = C98; note(String(C.name)); garbage(98); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C99 { static stack() { return "declared"; } }
Error.captureStackTrace(C99); garbage(99);
{ const C = C99; note(String(C.name)); garbage(99); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
console.log("99 " + sum.length + " " + sum.slice(-150)); sum = "";
class C100 {  }
new One(C100); new Twelve(C100); new Brand(C100); Error.captureStackTrace(C100); garbage(100);
{ const C = C100; note(String(C.name)); garbage(100); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C101 { m() { return 101; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C101()), { parent: 101 }); garbage(101);
{ const C = C101; note(String(C.name)); garbage(101); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C102 { static sm() { return 102; } }
new Twelve(C102); Object.setPrototypeOf(Object.getPrototypeOf(new C102()), { parent: 102 }); garbage(102);
{ const C = C102; note(String(C.name)); garbage(102); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C103 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
 garbage(103);
{ const C = C103; note(String(C.name)); garbage(103); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C104 { static stack() { return "declared"; } }
new One(C104); garbage(104);
{ const C = C104; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(104); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C105 {  }
new Twelve(C105); garbage(105);
{ const C = C105; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(105); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C106 { m() { return 106; } }
new Brand(C106); garbage(106);
{ const C = C106; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(106); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C107 { static sm() { return 107; } }
Error.captureStackTrace(C107); garbage(107);
{ const C = C107; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(107); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C108 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new One(C108); new Twelve(C108); new Brand(C108); Error.captureStackTrace(C108); garbage(108);
{ const C = C108; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(108); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C109 { static stack() { return "declared"; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C109()), { parent: 109 }); garbage(109);
{ const C = C109; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(109); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C110 {  }
new Twelve(C110); Object.setPrototypeOf(Object.getPrototypeOf(new C110()), { parent: 110 }); garbage(110);
{ const C = C110; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(110); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C111 { m() { return 111; } }
 garbage(111);
{ const C = C111; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(111); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C112 { static sm() { return 112; } }
new One(C112); garbage(112);
{ const C = C112; note(String(typeof C.prototype)); garbage(112); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C113 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new Twelve(C113); garbage(113);
{ const C = C113; note(String(typeof C.prototype)); garbage(113); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C114 { static stack() { return "declared"; } }
new Brand(C114); garbage(114);
{ const C = C114; note(String(typeof C.prototype)); garbage(114); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C115 {  }
Error.captureStackTrace(C115); garbage(115);
{ const C = C115; note(String(typeof C.prototype)); garbage(115); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C116 { m() { return 116; } }
new One(C116); new Twelve(C116); new Brand(C116); Error.captureStackTrace(C116); garbage(116);
{ const C = C116; note(String(typeof C.prototype)); garbage(116); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C117 { static sm() { return 117; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C117()), { parent: 117 }); garbage(117);
{ const C = C117; note(String(typeof C.prototype)); garbage(117); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C118 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new Twelve(C118); Object.setPrototypeOf(Object.getPrototypeOf(new C118()), { parent: 118 }); garbage(118);
{ const C = C118; note(String(typeof C.prototype)); garbage(118); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C119 { static stack() { return "declared"; } }
 garbage(119);
{ const C = C119; note(String(typeof C.prototype)); garbage(119); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
console.log("119 " + sum.length + " " + sum.slice(-150)); sum = "";
class C120 {  }
new One(C120); garbage(120);
{ const C = C120; note(String("name" in C)); garbage(120); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C121 { m() { return 121; } }
new Twelve(C121); garbage(121);
{ const C = C121; note(String("name" in C)); garbage(121); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C122 { static sm() { return 122; } }
new Brand(C122); garbage(122);
{ const C = C122; note(String("name" in C)); garbage(122); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C123 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
Error.captureStackTrace(C123); garbage(123);
{ const C = C123; note(String("name" in C)); garbage(123); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C124 { static stack() { return "declared"; } }
new One(C124); new Twelve(C124); new Brand(C124); Error.captureStackTrace(C124); garbage(124);
{ const C = C124; note(String("name" in C)); garbage(124); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C125 {  }
Object.setPrototypeOf(Object.getPrototypeOf(new C125()), { parent: 125 }); garbage(125);
{ const C = C125; note(String("name" in C)); garbage(125); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C126 { m() { return 126; } }
new Twelve(C126); Object.setPrototypeOf(Object.getPrototypeOf(new C126()), { parent: 126 }); garbage(126);
{ const C = C126; note(String("name" in C)); garbage(126); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C127 { static sm() { return 127; } }
 garbage(127);
{ const C = C127; note(String("name" in C)); garbage(127); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C128 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new One(C128); garbage(128);
{ const C = C128; note(String(Object.keys(C).length)); garbage(128); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C129 { static stack() { return "declared"; } }
new Twelve(C129); garbage(129);
{ const C = C129; note(String(Object.keys(C).length)); garbage(129); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C130 {  }
new Brand(C130); garbage(130);
{ const C = C130; note(String(Object.keys(C).length)); garbage(130); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C131 { m() { return 131; } }
Error.captureStackTrace(C131); garbage(131);
{ const C = C131; note(String(Object.keys(C).length)); garbage(131); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C132 { static sm() { return 132; } }
new One(C132); new Twelve(C132); new Brand(C132); Error.captureStackTrace(C132); garbage(132);
{ const C = C132; note(String(Object.keys(C).length)); garbage(132); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C133 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C133()), { parent: 133 }); garbage(133);
{ const C = C133; note(String(Object.keys(C).length)); garbage(133); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C134 { static stack() { return "declared"; } }
new Twelve(C134); Object.setPrototypeOf(Object.getPrototypeOf(new C134()), { parent: 134 }); garbage(134);
{ const C = C134; note(String(Object.keys(C).length)); garbage(134); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C135 {  }
 garbage(135);
{ const C = C135; note(String(Object.keys(C).length)); garbage(135); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C136 { m() { return 136; } }
new One(C136); garbage(136);
{ const C = C136; note(String(C.length)); garbage(136); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C137 { static sm() { return 137; } }
new Twelve(C137); garbage(137);
{ const C = C137; note(String(C.length)); garbage(137); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C138 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new Brand(C138); garbage(138);
{ const C = C138; note(String(C.length)); garbage(138); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C139 { static stack() { return "declared"; } }
Error.captureStackTrace(C139); garbage(139);
{ const C = C139; note(String(C.length)); garbage(139); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
console.log("139 " + sum.length + " " + sum.slice(-150)); sum = "";
class C140 {  }
new One(C140); new Twelve(C140); new Brand(C140); Error.captureStackTrace(C140); garbage(140);
{ const C = C140; note(String(C.length)); garbage(140); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C141 { m() { return 141; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C141()), { parent: 141 }); garbage(141);
{ const C = C141; note(String(C.length)); garbage(141); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C142 { static sm() { return 142; } }
new Twelve(C142); Object.setPrototypeOf(Object.getPrototypeOf(new C142()), { parent: 142 }); garbage(142);
{ const C = C142; note(String(C.length)); garbage(142); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C143 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
 garbage(143);
{ const C = C143; note(String(C.length)); garbage(143); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C144 { static stack() { return "declared"; } }
new One(C144); garbage(144);
{ const C = C144; note(String(C.name)); garbage(144); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C145 {  }
new Twelve(C145); garbage(145);
{ const C = C145; note(String(C.name)); garbage(145); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C146 { m() { return 146; } }
new Brand(C146); garbage(146);
{ const C = C146; note(String(C.name)); garbage(146); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C147 { static sm() { return 147; } }
Error.captureStackTrace(C147); garbage(147);
{ const C = C147; note(String(C.name)); garbage(147); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C148 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new One(C148); new Twelve(C148); new Brand(C148); Error.captureStackTrace(C148); garbage(148);
{ const C = C148; note(String(C.name)); garbage(148); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C149 { static stack() { return "declared"; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C149()), { parent: 149 }); garbage(149);
{ const C = C149; note(String(C.name)); garbage(149); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C150 {  }
new Twelve(C150); Object.setPrototypeOf(Object.getPrototypeOf(new C150()), { parent: 150 }); garbage(150);
{ const C = C150; note(String(C.name)); garbage(150); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C151 { m() { return 151; } }
 garbage(151);
{ const C = C151; note(String(C.name)); garbage(151); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C152 { static sm() { return 152; } }
new One(C152); garbage(152);
{ const C = C152; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(152); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C153 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new Twelve(C153); garbage(153);
{ const C = C153; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(153); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C154 { static stack() { return "declared"; } }
new Brand(C154); garbage(154);
{ const C = C154; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(154); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C155 {  }
Error.captureStackTrace(C155); garbage(155);
{ const C = C155; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(155); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C156 { m() { return 156; } }
new One(C156); new Twelve(C156); new Brand(C156); Error.captureStackTrace(C156); garbage(156);
{ const C = C156; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(156); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C157 { static sm() { return 157; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C157()), { parent: 157 }); garbage(157);
{ const C = C157; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(157); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C158 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new Twelve(C158); Object.setPrototypeOf(Object.getPrototypeOf(new C158()), { parent: 158 }); garbage(158);
{ const C = C158; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(158); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C159 { static stack() { return "declared"; } }
 garbage(159);
{ const C = C159; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(159); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
console.log("159 " + sum.length + " " + sum.slice(-150)); sum = "";
class C160 {  }
new One(C160); garbage(160);
{ const C = C160; note(String(typeof C.prototype)); garbage(160); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C161 { m() { return 161; } }
new Twelve(C161); garbage(161);
{ const C = C161; note(String(typeof C.prototype)); garbage(161); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C162 { static sm() { return 162; } }
new Brand(C162); garbage(162);
{ const C = C162; note(String(typeof C.prototype)); garbage(162); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C163 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
Error.captureStackTrace(C163); garbage(163);
{ const C = C163; note(String(typeof C.prototype)); garbage(163); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C164 { static stack() { return "declared"; } }
new One(C164); new Twelve(C164); new Brand(C164); Error.captureStackTrace(C164); garbage(164);
{ const C = C164; note(String(typeof C.prototype)); garbage(164); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C165 {  }
Object.setPrototypeOf(Object.getPrototypeOf(new C165()), { parent: 165 }); garbage(165);
{ const C = C165; note(String(typeof C.prototype)); garbage(165); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C166 { m() { return 166; } }
new Twelve(C166); Object.setPrototypeOf(Object.getPrototypeOf(new C166()), { parent: 166 }); garbage(166);
{ const C = C166; note(String(typeof C.prototype)); garbage(166); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C167 { static sm() { return 167; } }
 garbage(167);
{ const C = C167; note(String(typeof C.prototype)); garbage(167); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C168 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new One(C168); garbage(168);
{ const C = C168; note(String("name" in C)); garbage(168); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C169 { static stack() { return "declared"; } }
new Twelve(C169); garbage(169);
{ const C = C169; note(String("name" in C)); garbage(169); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C170 {  }
new Brand(C170); garbage(170);
{ const C = C170; note(String("name" in C)); garbage(170); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C171 { m() { return 171; } }
Error.captureStackTrace(C171); garbage(171);
{ const C = C171; note(String("name" in C)); garbage(171); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C172 { static sm() { return 172; } }
new One(C172); new Twelve(C172); new Brand(C172); Error.captureStackTrace(C172); garbage(172);
{ const C = C172; note(String("name" in C)); garbage(172); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C173 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C173()), { parent: 173 }); garbage(173);
{ const C = C173; note(String("name" in C)); garbage(173); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C174 { static stack() { return "declared"; } }
new Twelve(C174); Object.setPrototypeOf(Object.getPrototypeOf(new C174()), { parent: 174 }); garbage(174);
{ const C = C174; note(String("name" in C)); garbage(174); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C175 {  }
 garbage(175);
{ const C = C175; note(String("name" in C)); garbage(175); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C176 { m() { return 176; } }
new One(C176); garbage(176);
{ const C = C176; note(String(Object.keys(C).length)); garbage(176); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C177 { static sm() { return 177; } }
new Twelve(C177); garbage(177);
{ const C = C177; note(String(Object.keys(C).length)); garbage(177); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C178 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new Brand(C178); garbage(178);
{ const C = C178; note(String(Object.keys(C).length)); garbage(178); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C179 { static stack() { return "declared"; } }
Error.captureStackTrace(C179); garbage(179);
{ const C = C179; note(String(Object.keys(C).length)); garbage(179); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
console.log("179 " + sum.length + " " + sum.slice(-150)); sum = "";
class C180 {  }
new One(C180); new Twelve(C180); new Brand(C180); Error.captureStackTrace(C180); garbage(180);
{ const C = C180; note(String(Object.keys(C).length)); garbage(180); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C181 { m() { return 181; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C181()), { parent: 181 }); garbage(181);
{ const C = C181; note(String(Object.keys(C).length)); garbage(181); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C182 { static sm() { return 182; } }
new Twelve(C182); Object.setPrototypeOf(Object.getPrototypeOf(new C182()), { parent: 182 }); garbage(182);
{ const C = C182; note(String(Object.keys(C).length)); garbage(182); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C183 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
 garbage(183);
{ const C = C183; note(String(Object.keys(C).length)); garbage(183); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C184 { static stack() { return "declared"; } }
new One(C184); garbage(184);
{ const C = C184; note(String(C.length)); garbage(184); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C185 {  }
new Twelve(C185); garbage(185);
{ const C = C185; note(String(C.length)); garbage(185); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C186 { m() { return 186; } }
new Brand(C186); garbage(186);
{ const C = C186; note(String(C.length)); garbage(186); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C187 { static sm() { return 187; } }
Error.captureStackTrace(C187); garbage(187);
{ const C = C187; note(String(C.length)); garbage(187); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C188 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new One(C188); new Twelve(C188); new Brand(C188); Error.captureStackTrace(C188); garbage(188);
{ const C = C188; note(String(C.length)); garbage(188); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C189 { static stack() { return "declared"; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C189()), { parent: 189 }); garbage(189);
{ const C = C189; note(String(C.length)); garbage(189); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C190 {  }
new Twelve(C190); Object.setPrototypeOf(Object.getPrototypeOf(new C190()), { parent: 190 }); garbage(190);
{ const C = C190; note(String(C.length)); garbage(190); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C191 { m() { return 191; } }
 garbage(191);
{ const C = C191; note(String(C.length)); garbage(191); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C192 { static sm() { return 192; } }
new One(C192); garbage(192);
{ const C = C192; note(String(C.name)); garbage(192); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C193 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new Twelve(C193); garbage(193);
{ const C = C193; note(String(C.name)); garbage(193); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C194 { static stack() { return "declared"; } }
new Brand(C194); garbage(194);
{ const C = C194; note(String(C.name)); garbage(194); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C195 {  }
Error.captureStackTrace(C195); garbage(195);
{ const C = C195; note(String(C.name)); garbage(195); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C196 { m() { return 196; } }
new One(C196); new Twelve(C196); new Brand(C196); Error.captureStackTrace(C196); garbage(196);
{ const C = C196; note(String(C.name)); garbage(196); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C197 { static sm() { return 197; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C197()), { parent: 197 }); garbage(197);
{ const C = C197; note(String(C.name)); garbage(197); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C198 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new Twelve(C198); Object.setPrototypeOf(Object.getPrototypeOf(new C198()), { parent: 198 }); garbage(198);
{ const C = C198; note(String(C.name)); garbage(198); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C199 { static stack() { return "declared"; } }
 garbage(199);
{ const C = C199; note(String(C.name)); garbage(199); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
console.log("199 " + sum.length + " " + sum.slice(-150)); sum = "";
class C200 {  }
new One(C200); garbage(200);
{ const C = C200; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(200); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C201 { m() { return 201; } }
new Twelve(C201); garbage(201);
{ const C = C201; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(201); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C202 { static sm() { return 202; } }
new Brand(C202); garbage(202);
{ const C = C202; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(202); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C203 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
Error.captureStackTrace(C203); garbage(203);
{ const C = C203; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(203); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C204 { static stack() { return "declared"; } }
new One(C204); new Twelve(C204); new Brand(C204); Error.captureStackTrace(C204); garbage(204);
{ const C = C204; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(204); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C205 {  }
Object.setPrototypeOf(Object.getPrototypeOf(new C205()), { parent: 205 }); garbage(205);
{ const C = C205; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(205); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C206 { m() { return 206; } }
new Twelve(C206); Object.setPrototypeOf(Object.getPrototypeOf(new C206()), { parent: 206 }); garbage(206);
{ const C = C206; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(206); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C207 { static sm() { return 207; } }
 garbage(207);
{ const C = C207; note(String(Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join())); garbage(207); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C208 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new One(C208); garbage(208);
{ const C = C208; note(String(typeof C.prototype)); garbage(208); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C209 { static stack() { return "declared"; } }
new Twelve(C209); garbage(209);
{ const C = C209; note(String(typeof C.prototype)); garbage(209); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C210 {  }
new Brand(C210); garbage(210);
{ const C = C210; note(String(typeof C.prototype)); garbage(210); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C211 { m() { return 211; } }
Error.captureStackTrace(C211); garbage(211);
{ const C = C211; note(String(typeof C.prototype)); garbage(211); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C212 { static sm() { return 212; } }
new One(C212); new Twelve(C212); new Brand(C212); Error.captureStackTrace(C212); garbage(212);
{ const C = C212; note(String(typeof C.prototype)); garbage(212); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C213 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C213()), { parent: 213 }); garbage(213);
{ const C = C213; note(String(typeof C.prototype)); garbage(213); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C214 { static stack() { return "declared"; } }
new Twelve(C214); Object.setPrototypeOf(Object.getPrototypeOf(new C214()), { parent: 214 }); garbage(214);
{ const C = C214; note(String(typeof C.prototype)); garbage(214); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C215 {  }
 garbage(215);
{ const C = C215; note(String(typeof C.prototype)); garbage(215); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C216 { m() { return 216; } }
new One(C216); garbage(216);
{ const C = C216; note(String("name" in C)); garbage(216); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C217 { static sm() { return 217; } }
new Twelve(C217); garbage(217);
{ const C = C217; note(String("name" in C)); garbage(217); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C218 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new Brand(C218); garbage(218);
{ const C = C218; note(String("name" in C)); garbage(218); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C219 { static stack() { return "declared"; } }
Error.captureStackTrace(C219); garbage(219);
{ const C = C219; note(String("name" in C)); garbage(219); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
console.log("219 " + sum.length + " " + sum.slice(-150)); sum = "";
class C220 {  }
new One(C220); new Twelve(C220); new Brand(C220); Error.captureStackTrace(C220); garbage(220);
{ const C = C220; note(String("name" in C)); garbage(220); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C221 { m() { return 221; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C221()), { parent: 221 }); garbage(221);
{ const C = C221; note(String("name" in C)); garbage(221); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C222 { static sm() { return 222; } }
new Twelve(C222); Object.setPrototypeOf(Object.getPrototypeOf(new C222()), { parent: 222 }); garbage(222);
{ const C = C222; note(String("name" in C)); garbage(222); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C223 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
 garbage(223);
{ const C = C223; note(String("name" in C)); garbage(223); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C224 { static stack() { return "declared"; } }
new One(C224); garbage(224);
{ const C = C224; note(String(Object.keys(C).length)); garbage(224); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C225 {  }
new Twelve(C225); garbage(225);
{ const C = C225; note(String(Object.keys(C).length)); garbage(225); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C226 { m() { return 226; } }
new Brand(C226); garbage(226);
{ const C = C226; note(String(Object.keys(C).length)); garbage(226); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C227 { static sm() { return 227; } }
Error.captureStackTrace(C227); garbage(227);
{ const C = C227; note(String(Object.keys(C).length)); garbage(227); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C228 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new One(C228); new Twelve(C228); new Brand(C228); Error.captureStackTrace(C228); garbage(228);
{ const C = C228; note(String(Object.keys(C).length)); garbage(228); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C229 { static stack() { return "declared"; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C229()), { parent: 229 }); garbage(229);
{ const C = C229; note(String(Object.keys(C).length)); garbage(229); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C230 {  }
new Twelve(C230); Object.setPrototypeOf(Object.getPrototypeOf(new C230()), { parent: 230 }); garbage(230);
{ const C = C230; note(String(Object.keys(C).length)); garbage(230); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C231 { m() { return 231; } }
 garbage(231);
{ const C = C231; note(String(Object.keys(C).length)); garbage(231); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C232 { static sm() { return 232; } }
new One(C232); garbage(232);
{ const C = C232; note(String(C.length)); garbage(232); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C233 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new Twelve(C233); garbage(233);
{ const C = C233; note(String(C.length)); garbage(233); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C234 { static stack() { return "declared"; } }
new Brand(C234); garbage(234);
{ const C = C234; note(String(C.length)); garbage(234); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C235 {  }
Error.captureStackTrace(C235); garbage(235);
{ const C = C235; note(String(C.length)); garbage(235); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C236 { m() { return 236; } }
new One(C236); new Twelve(C236); new Brand(C236); Error.captureStackTrace(C236); garbage(236);
{ const C = C236; note(String(C.length)); garbage(236); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C237 { static sm() { return 237; } }
Object.setPrototypeOf(Object.getPrototypeOf(new C237()), { parent: 237 }); garbage(237);
{ const C = C237; note(String(C.length)); garbage(237); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C238 { m() { return 1; } static sm() { return 2; } get g() { return 3; } }
new Twelve(C238); Object.setPrototypeOf(Object.getPrototypeOf(new C238()), { parent: 238 }); garbage(238);
{ const C = C238; note(String(C.length)); garbage(238); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
class C239 { static stack() { return "declared"; } }
 garbage(239);
{ const C = C239; note(String(C.length)); garbage(239); note([C.name, Object.getOwnPropertyNames(C).filter(x => !x.startsWith("original")).join("/"), typeof C.stack, One.has(C) && One.read(C), Twelve.has(C) && Twelve.read(C), Brand.has(C) && Brand.read(C), new C() instanceof C, new C().parent, Object.getPrototypeOf(C) === Function.prototype].join()); }
console.log("239 " + sum.length + " " + sum.slice(-150)); sum = "";
if (typeof gc === "function") gc();
console.log("behind a collection " + [C0, C1, C4, C6].map(C => [C.name, One.has(C), Twelve.has(C) && Twelve.read(C)].join()).join(" "));
