// Classes in JavaScript with more private methods than an object holds in line by default (six): plain ones, generators, async ones, accessors; with fields beside them, in a subclass, in a class
// evaluated many times; what `new` gives each object, brand checks, and that once warm `new` asks the engine nothing about the methods. Only the jsc shell can count; elsewhere the count is zero.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const lines = [];
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
class Renderer {
    #out = [];
    #onDestroy = undefined;
    #isBody = false;
    #boundary = null;
    type;
    #parent;
    promise = undefined;
    global;
    local;
    constructor(global, parent) {
        this.#parent = parent;
        this.global = global;
        this.local = parent ? { ...parent.local } : { depth: 0 };
        this.type = parent ? parent.type : "body";
    }
    push(x) { this.#out.push(x); return this; }
    child() { const c = new Renderer(this.global, this); this.#out.push(c); return c; }
    *#eachChild() { for (const x of this.#out) if (x instanceof Renderer) yield x; }
    *#eachText() { for (const x of this.#out) if (typeof x === "string") yield x; }
    *#everything() { yield* this.#eachText(); for (const c of this.#eachChild()) yield* c.#everything(); }
    #depth() { return this.#parent ? this.#parent.#depth() + 1 : 0; }
    #collect(content = { body: "" }) { for (const x of this.#out) { if (typeof x === "string") content.body += x; else x.#collect(content); } return content; }
    async #collectLater(content = { body: "" }) { for (const x of this.#out) { if (typeof x === "string") content.body += await x; else await x.#collectLater(content); } return content; }
    async #flags() { return [this.#isBody, this.#boundary, this.#onDestroy].join(); }
    async #all() { return (await this.#collectLater()).body + "|" + (await this.#flags()); }
    get #size() { return this.#out.length; }
    set #size(n) { this.#out.length = n; }
    text() { return this.#collect().body + " " + [...this.#everything()].join("") + " " + this.#depth() + " " + this.#size; }
    later() { return this.#all(); }
    cut(n) { this.#size = n; return this.#size; }
    static has(x) { return [#out in x, #eachChild in x, #all in x, #size in x, #depth in x].join(); }
    static depthOf(x) { return x.#depth(); }
    static assign(x) { x.#depth = 1; }
}
class Special extends Renderer {
    #a() { return "a"; } #b() { return "b"; } #c() { return "c"; } #d() { return "d"; } #e() { return "e"; } #f() { return "f"; } #g() { return "g"; }
    #own = 7;
    letters() { return this.#a() + this.#b() + this.#c() + this.#d() + this.#e() + this.#f() + this.#g() + this.#own; }
}
function tree(C) {
    const root = new C({ name: "global" });
    root.push("a").child().push("b").child().push("c");
    root.push("d");
    return root;
}
lines.push(tree(Renderer).text(), tree(Special).text(), tree(Special).letters());
lines.push(Object.keys(new Renderer({})).join(), JSON.stringify(new Special({ g: 1 })));
lines.push(Renderer.has(new Renderer({})), Renderer.has(new Special({})), Renderer.has({}), attempt(() => Renderer.has(1)));
lines.push(attempt(() => Renderer.depthOf({})), attempt(() => Renderer.depthOf(new Special({}).child())), attempt(() => Renderer.assign(new Renderer({}))));
function Returns(x) { return x; }
class Stamps extends Returns {
    #m1() { return 1; } #m2() { return 2; } #m3() { return 3; } #m4() { return 4; } #m5() { return 5; } #m6() { return 6; } #m7() { return 7; } #m8() { return 8; } #m9() { return 9; }
    static sum(x) { return x.#m1() + x.#m2() + x.#m3() + x.#m4() + x.#m5() + x.#m6() + x.#m7() + x.#m8() + x.#m9(); }
}
const stamped = { already: 1, there: 2 };
new Stamps(stamped);
lines.push(Stamps.sum(stamped) + " " + Object.keys(stamped).join(), attempt(() => new Stamps(stamped)), attempt(() => new Stamps(Object.freeze({}))) === "TypeError" ? "frozen: TypeError" : "frozen: stamped");
const array = []; new Stamps(array); array.push(1, 2, 3);
lines.push(Stamps.sum(array) + " " + array.join());
const made = [];
for (let i = 0; i < 3; i++) {
    made.push(class {
        #p1() { return i; } #p2() { return i + 1; } #p3() { return i + 2; } #p4() { return i + 3; } #p5() { return i + 4; } #p6() { return i + 5; } #p7() { return i + 6; }
        sum() { return this.#p1() + this.#p2() + this.#p3() + this.#p4() + this.#p5() + this.#p6() + this.#p7(); }
        static is(x) { return #p7 in x; }
    });
}
lines.push(made.map(C => new C().sum()).join(), made.map(C => made.map(D => C.is(new D())).join("")).join(" ").replaceAll("true", "T").replaceAll("false", "f"));
for (let i = 0; i < 200; i++) { tree(Renderer); tree(Special); }
const before = count("operationAOTPrivateMethodsAdd");
let length = 0;
for (let i = 0; i < 2000; i++) length += tree(Renderer).text().length + tree(Special).letters().length;
lines.push(length + " asked " + (count("operationAOTPrivateMethodsAdd") - before));
tree(Renderer).later().then(x => { lines.push(x); console.log(lines.join("\n")); });
