(function () {
    function check(actual, expected, what) {
        if (!Object.is(actual, expected))
            throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
    }
    const answer = () => 42;

    function byStore() { const map = new Map(); map.has = answer; return map.has(1); }
    function byDefinition() { const map = new Map(); Object.defineProperty(map, "has", { value: answer }); return map.has(1); }
    function byAccessor() { const map = new Map(); let reads = 0; Object.defineProperty(map, "has", { get() { reads++; return answer; } }); map.has(1); return reads; }
    function byAssign() { const map = new Map(); Object.assign(map, { has: answer }); return map.has(1); }
    function byReflect() { const map = new Map(); Reflect.set(map, "has", answer); return map.has(1); }
    function byComputedName(name) { const map = new Map(); map[name] = answer; return map.has(1); }
    function byNewPrototype() { const map = new Map(); Object.setPrototypeOf(map, { has: answer }); return map.has(1); }
    function byProto() { const map = new Map(); map.__proto__ = { has: answer }; return map.has(1); }
    function withoutPrototype() { const map = new Map(); Object.setPrototypeOf(map, null); try { return map.has(1); } catch (error) { return error.constructor.name; } }
    class ReturnsArgument { constructor(object) { return object; } }
    class Stamps extends ReturnsArgument { has = answer; }
    function byField() { const map = new Map(); new Stamps(map); return map.has(1); }
    function byProxy() { const map = new Map(); new Proxy(map, { }).has = answer; return map.has(1); }
    function byInterpretedCode() { const map = new Map(); (0, eval)("(function (object, f) { object.has = f; })")(map, answer); return map.has(1); }
    check([byStore(), byDefinition(), byAccessor(), byAssign(), byReflect(), byComputedName("has"), byNewPrototype(), byProto(), withoutPrototype(), byField(), byProxy(), byInterpretedCode()].join(),
        "42,42,1,42,42,42,42,42,TypeError,42,42,42", "Map.prototype.has shadowed in twelve ways");

    function setAdd() { const set = new Set(); set.add = answer; return set.add(1); }
    function setDelete() { const set = new Set([1]); set.delete = answer; return set.delete(1); }
    function setSize() { const set = new Set([1]); Object.defineProperty(set, "size", { value: "many" }); return set.size; }
    function mapSize() { const map = new Map(); Object.setPrototypeOf(map, { size: "none" }); return map.size; }
    function mapGet() { const map = new Map([[1, 2]]); map.get = answer; return map.get(1); }
    function mapSet() { const map = new Map(); map.set = answer; return map.set(1, 2); }
    function weakMapGet() { const map = new WeakMap(); map.get = answer; return map.get({ }); }
    function weakSetHas() { const set = new WeakSet(); set.has = answer; return set.has({ }); }
    function dateTime() { const date = new Date(0); date.getTime = answer; return date.getTime(); }
    function dateYear() { const date = new Date(0); date.getUTCFullYear = answer; return date.getUTCFullYear(); }
    function literalExec() { const pattern = /a/g; pattern.exec = answer; return pattern.exec("a"); }
    function constructedTest() { const pattern = new RegExp("a"); pattern.test = answer; return pattern.test("a"); }
    function testWithOwnExec() { const pattern = new RegExp("a"); pattern.exec = () => null; return pattern.test("a"); }
    check([setAdd(), setDelete(), setSize(), mapSize(), mapGet(), mapSet(), weakMapGet(), weakSetHas(), dateTime(), dateYear(), literalExec(), constructedTest(), testWithOwnExec()].join(),
        "42,42,many,none,42,42,42,42,42,42,42,42,false", "the other kinds");

    class Textual extends Map {
        has(key) { return super.has(key) ? "present" : ""; }
        get size() { return super.size ? "some" : ""; }
    }
    function returnsHas(map, key) { return map.has(key); }
    function returnsSize(map) { return map.size; }
    const plain = new Map([[1, 1]]), shadowed = new Map([[1, 1]]), inheriting = new Map([[1, 1]]);
    shadowed.has = key => "own " + key;
    Object.setPrototypeOf(inheriting, { has(key) { return "inherited " + key; }, size: -1 });
    check([returnsHas(plain, 1), returnsHas(plain, 2), returnsHas(shadowed, 1), returnsHas(inheriting, 1)].join(), "true,false,own 1,inherited 1", "maps from outside");
    check([returnsSize(plain), returnsSize(shadowed), returnsSize(inheriting)].join(), "1,1,-1", "sizes of maps from outside");
})();
console.log("passed");
