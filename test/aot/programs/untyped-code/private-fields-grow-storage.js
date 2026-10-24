// Private fields added to objects that have no room left in line: the first storage out of line, and storage doubled (4, 8, 16, 32 places); objects born elsewhere and stamped by a constructor that
// returns them; arrays and objects with elements, functions, objects with a null prototype, frozen and sealed objects, proxies; adding twice (TypeError); values kept across collections.
const lines = [];
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
function Returns(x) { return x; }
class Stamp extends Returns {
    #a = 1; #b = 2; #c = 3; #d = 4; #e = 5; #f = 6; #g = 7; #h = 8; #i = 9; #j = 10; #k = 11; #l = 12; #m = 13; #n = 14; #o = 15; #p = 16; #q = 17; #r = 18; #s = 19; #t = 20;
    #u = [21]; #v = { v: 22 }; #w = "23"; #x = 24.5; #y = null; #z = undefined;
    static sum(x) { return x.#a + x.#b + x.#c + x.#d + x.#e + x.#f + x.#g + x.#h + x.#i + x.#j + x.#k + x.#l + x.#m + x.#n + x.#o + x.#p + x.#q + x.#r + x.#s + x.#t + x.#u[0] + x.#v.v + x.#w + x.#x + x.#y + x.#z; }
    static has(x) { return [#a in x, #j in x, #z in x].join(); }
    static bump(x) { x.#a++; x.#t += 100; x.#z = "z"; return x.#a + "," + x.#t + "," + x.#z; }
}
function plain(n) { const o = {}; for (let i = 0; i < n; i++) o["p" + i] = i; return o; }
for (const n of [0, 1, 3, 5, 6, 7, 9, 10, 13, 14, 21, 22, 40, 70]) {
    const o = plain(n);
    new Stamp(o);
    o.after = "after";
    lines.push(n + " " + Stamp.sum(o) + " " + Stamp.has(o) + " " + Object.keys(o).length + " " + o["p" + (n - 1)] + " " + o.after + " " + Stamp.bump(o) + " " + attempt(() => new Stamp(o)));
}
const others = { array: [1, 2, 3], holey: [1, , 3], doubles: [1.5, 2.5], empty: [], withElements: { 0: "a", 1: "b", length: 2 }, func: function () {}, arrow: () => {}, nullProto: Object.create(null), map: new Map([[1, 2]]),
    date: new Date(0), typed: new Uint8Array(3), frozen: Object.freeze({ f: 1 }), sealed: Object.seal({ s: 1 }), notExtensible: Object.preventExtensions({ n: 1 }), proxy: new Proxy({}, {}), args: (function () { return arguments; })(1, 2), regexp: /x/g, error: new Error("e"), boxed: new String("abc") };
for (const [name, o] of Object.entries(others)) lines.push(name + " " + attempt(() => { new Stamp(o); return Stamp.sum(o) + " " + Stamp.has(o) + " " + JSON.stringify(Object.keys(o)) + " " + (Array.isArray(o) ? o.join() + " " + o.push(9) + " " + o.join() : "") + " " + Stamp.bump(o); }));
class Grows {
    pub0 = 0; #p0 = "a"; pub1 = 1; #p1 = "b"; pub2 = 2; #p2 = "c"; pub3 = 3; #p3 = "d"; pub4 = 4; #p4 = "e"; pub5 = 5; #p5 = "f"; pub6 = 6; #p6 = "g"; pub7 = 7; #p7 = "h"; pub8 = 8; #p8 = "i"; pub9 = 9; #p9 = "j";
    all() { return this.#p0 + this.#p1 + this.#p2 + this.#p3 + this.#p4 + this.#p5 + this.#p6 + this.#p7 + this.#p8 + this.#p9 + Object.values(this).join(""); }
}
class GrowsMore extends Grows { #q0 = 0; #q1 = 1; #q2 = 2; #q3 = 3; #q4 = 4; #q5 = 5; #q6 = 6; #q7 = 7; more() { return this.all() + this.#q0 + this.#q1 + this.#q2 + this.#q3 + this.#q4 + this.#q5 + this.#q6 + this.#q7; } }
lines.push(new Grows().all(), new GrowsMore().more());
const kept = [];
let check = 0;
for (let i = 0; i < 3000; i++) {
    const o = plain(i % 12);
    new Stamp(o);
    if (i % 100 === 0) kept.push(o);
    check = (check + Stamp.sum(o).length + new GrowsMore().more().length) % 100003;
}
lines.push(check + " " + kept.map(o => Stamp.sum(o).length + Object.keys(o).length).join());
console.log(lines.join("\n"));
