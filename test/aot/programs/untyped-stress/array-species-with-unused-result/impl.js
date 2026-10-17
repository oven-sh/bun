function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

(function () {
    const log = [];
    function logged(f) {
        log.length = 0;
        try {
            f();
        } catch (error) {
            log.push("threw " + error.message);
        }
        return log.join(", ");
    }

    function mapsForEffect(a) { a.map(function (value) { log.push("map " + value); return value; }); }
    function filtersForEffect(a) { a.filter(function (value) { log.push("filter " + value); return value > 1; }); }
    function mapsForResult(a) { return a.map(function (value) { log.push("map " + value); return value; }); }
    function filtersForResult(a) { return a.filter(function (value) { log.push("filter " + value); return value > 1; }); }
    function both(a) {
        return logged(function () {
            mapsForEffect(a);
            filtersForEffect(a);
        });
    }
    const callbacksOnly = "map 1, map 2, filter 1, filter 2";

    check(both([1, 2]), callbacksOnly, "an original array");
    check(both([1, , 2]), callbacksOnly, "an original array with a hole");

    class Logged extends Array {
        constructor(...args) {
            super(...args);
            log.push("constructed(" + args.join() + ")");
        }
    }
    const ofSubclass = new Logged(1, 2);
    check(both(ofSubclass), "constructed(2), map 1, map 2, constructed(0), filter 1, filter 2", "an instance of a subclass");
    check(logged(function () { check(mapsForResult(ofSubclass) instanceof Logged, true, "the class of what map makes"); }), "constructed(2), map 1, map 2", "map of an instance of a subclass");
    check(logged(function () { check(filtersForResult(ofSubclass) instanceof Logged, true, "the class of what filter makes"); }), "constructed(0), filter 1, filter 2", "filter of an instance of a subclass");

    class WithSpecies extends Array {
        static get [Symbol.species]() {
            log.push("species");
            return Array;
        }
    }
    check(both(WithSpecies.of(1, 2)), "species, map 1, map 2, species, filter 1, filter 2", "a subclass with a species getter");

    function withConstructor(constructor) {
        const a = [1, 2];
        a.constructor = constructor;
        return a;
    }
    check(both(withConstructor({ [Symbol.species]: function (length) { log.push("made(" + length + ")"); } })), "made(2), map 1, map 2, made(0), filter 1, filter 2", "a constructor of its own");
    check(both(withConstructor({ [Symbol.species]: function () { throw new Error("species"); } })), "threw species", "a species constructor that throws");
    check(both(withConstructor({ get [Symbol.species]() { log.push("species"); return undefined; } })), "species, map 1, map 2, species, filter 1, filter 2", "a species getter that gives undefined");
    check(both(withConstructor({ [Symbol.species]: null })), callbacksOnly, "null for species");
    check(both(withConstructor(undefined)), callbacksOnly, "undefined for a constructor");
    check(both(withConstructor(1)).startsWith("threw "), true, "a number for a constructor");
    check(both(withConstructor({ [Symbol.species]: 1 })).startsWith("threw "), true, "a number for species");

    const accessor = [1, 2];
    Object.defineProperty(accessor, "constructor", { get() { log.push("constructor"); return Array; } });
    check(both(accessor), "constructor, map 1, map 2, constructor, filter 1, filter 2", "a getter for the constructor");

    const stores = withConstructor({
        [Symbol.species]: function () {
            return new Proxy({ }, {
                defineProperty(target, key, descriptor) {
                    log.push("define " + String(key) + " " + descriptor.value);
                    return Reflect.defineProperty(target, key, descriptor);
                },
            });
        },
    });
    check(both(stores), "map 1, define 0 1, map 2, define 1 2, filter 1, filter 2, define 0 2", "stores into what the species constructor made");

    const reparented = [1, 2];
    Object.setPrototypeOf(reparented, { __proto__: Array.prototype, get constructor() { log.push("constructor"); return Array; } });
    check(both(reparented), "constructor, map 1, map 2, constructor, filter 1, filter 2", "a constructor inherited from another prototype");

    const foreign = createGlobalObject().Array(1, 2);
    check(both(foreign), callbacksOnly, "an array of another realm");
    check(logged(function () { check(Object.getPrototypeOf(mapsForResult(foreign)), Object.getPrototypeOf(foreign), "the realm of what map makes"); }), "map 1, map 2", "map of an array of another realm");

    function constructorChangedByCallback() {
        const a = [1, 2];
        a.map(function (value) {
            log.push("map " + value);
            a.constructor = { [Symbol.species]: function () { log.push("made"); } };
            return value;
        });
    }
    check(logged(constructorChangedByCallback), "map 1, map 2", "a constructor that the callback changes");
})();
console.log("passed");
