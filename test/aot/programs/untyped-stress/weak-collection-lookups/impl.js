function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function thrownBy(f, ...args) {
    try {
        f(...args);
    } catch (error) {
        return error.constructor.name;
    }
    return "nothing";
}
(function () {
    const notHeldWeakly = [undefined, null, true, false, 0, -0, 1, 1.5, NaN, Infinity, "", "text", "a" + String(1), 10n, Symbol.for("registered")];

    function looksUpInEmpty(key) {
        const map = new WeakMap(), set = new WeakSet();
        return String(map.get(key)) + "," + map.has(key) + "," + set.has(key);
    }
    function looksUp(present, absent) {
        const map = new WeakMap(), set = new WeakSet();
        map.set(present, "value");
        set.add(present);
        return map.get(present) + "," + map.has(present) + "," + set.has(present) + "," + map.get(absent) + "," + map.has(absent) + "," + set.has(absent);
    }
    function holds(value) {
        const map = new WeakMap(), key = {};
        map.set(key, value);
        return map.has(key) ? map.get(key) : "absent";
    }
    function fills(count) {
        const map = new WeakMap(), set = new WeakSet(), keys = [];
        for (let i = 0; i < count; ++i) {
            const key = i & 1 ? { i } : [i];
            keys.push(key);
            map.set(key, i);
            set.add(key);
            if (map.get(key) !== i || !map.has(key) || !set.has(key))
                return "lost the key added last, " + i;
        }
        for (let i = 0; i < count; ++i) {
            if (map.get(keys[i]) !== i || !map.has(keys[i]) || !set.has(keys[i]))
                return "lost key " + i;
        }
        for (let i = 0; i < count; i += 3) {
            map.delete(keys[i]);
            set.delete(keys[i]);
        }
        for (let i = 0; i < count; ++i) {
            const isLeft = !!(i % 3);
            if (map.get(keys[i]) !== (isLeft ? i : undefined) || map.has(keys[i]) !== isLeft || set.has(keys[i]) !== isLeft)
                return "wrong about key " + i + " after some were deleted";
        }
        for (let i = 0; i < count; i += 3) {
            map.set(keys[i], -i);
            set.add(keys[i]);
        }
        for (let i = 0; i < count; ++i) {
            if (map.get(keys[i]) !== (i % 3 ? i : -i) || !map.has(keys[i]) || !set.has(keys[i]))
                return "wrong about key " + i + " after they were added again";
        }
        return "right";
    }
    function seesChanges(key) {
        const map = new WeakMap(), set = new WeakSet();
        let seen = String(map.get(key)) + map.has(key) + set.has(key);
        map.set(key, 1);
        set.add(key);
        seen += "," + map.get(key) + map.has(key) + set.has(key);
        map.set(key, 2);
        seen += "," + map.get(key) + map.has(key) + set.has(key);
        map.delete(key);
        set.delete(key);
        seen += "," + map.get(key) + map.has(key) + set.has(key);
        return seen;
    }
    function seesChangesInLoop(key, rounds) {
        const map = new WeakMap();
        let total = 0;
        for (let i = 0; i < rounds; ++i) {
            total += map.has(key) ? map.get(key) : 1000;
            if (i & 1)
                map.delete(key);
            else
                map.set(key, i);
        }
        return total;
    }
    function survivesCollections(rounds) {
        const map = new WeakMap(), set = new WeakSet(), kept = [];
        for (let round = 0; round < rounds; ++round) {
            for (let i = 0; i < 200; ++i) {
                const key = { round, i };
                map.set(key, key.i);
                set.add(key);
                if (!(i % 10))
                    kept.push(key);
            }
            gc();
            for (const key of kept) {
                if (map.get(key) !== key.i || !map.has(key) || !set.has(key))
                    return "lost a key that is alive";
            }
        }
        return "right";
    }
    function withOtherCounts(key) {
        const map = new WeakMap([[key, "value"]]), set = new WeakSet([key]);
        return String(map.get()) + "," + map.has() + "," + set.has() + "," + map.get(key, 1) + "," + map.has(key, 1) + "," + set.has(key, 1);
    }
    function ignoresResults(key) {
        const map = new WeakMap([[key, "value"]]), set = new WeakSet([key]);
        map.get(key);
        map.has(key);
        set.has(key);
        return "done";
    }

    for (let round = 0; round < 3; ++round) {
        const symbol = Symbol("not registered");
        for (const key of [{}, [], function () { }, new Map(), new WeakMap(), symbol, Symbol.iterator, /x/, new Proxy({}, {}), Object.freeze({})]) {
            check(looksUpInEmpty(key), "undefined,false,false", "looking up in empty collections");
            check(looksUp(key, {}), "value,true,true,undefined,false,false", "looking up a key that is there and one that is not");
            check(seesChanges(key), "undefinedfalsefalse,1truetrue,2truetrue,undefinedfalsefalse", "looking up between changes");
            check(withOtherCounts(key), "undefined,false,false,value,true,true", "too few and too many arguments");
            check(ignoresResults(key), "done", "results that are not used");
        }
        for (const key of notHeldWeakly) {
            check(looksUpInEmpty(key), "undefined,false,false", "looking up what cannot be a key in empty collections");
            check(looksUp({}, key), "value,true,true,undefined,false,false", "looking up what cannot be a key");
        }
        for (const value of [undefined, null, 0, -0, NaN, "", false, "text", symbol])
            check(holds(value), value, "a value held by a WeakMap");
        for (const count of [1, 2, 3, 4, 5, 8, 9, 100, 3000])
            check(fills(count), "right", "collections of " + count);
        check(seesChangesInLoop({}, 100), 1000 * 50 + 49 * 50, "looking up in a loop that changes the map");
        check(survivesCollections(3), "right", "looking up after collections");
    }

    function ofUnknownReceiver(collection, key) { return String(collection.get(key)) + "," + collection.has(key); }
    function hasOfUnknownReceiver(collection, key) { return collection.has(key); }
    noInline(ofUnknownReceiver);
    noInline(hasOfUnknownReceiver);
    const key = {};
    for (let round = 0; round < 50; ++round) {
        check(ofUnknownReceiver(new WeakMap([[key, round]]), key), round + ",true", "a WeakMap as a parameter");
        check(ofUnknownReceiver(new WeakMap(), key), "undefined,false", "an empty WeakMap as a parameter");
        check(ofUnknownReceiver(new Map([[key, round]]), key), round + ",true", "a Map as a parameter");
        check(ofUnknownReceiver({ get() { return "got"; }, has() { return "has"; } }, key), "got,has", "an object as a parameter");
        check(hasOfUnknownReceiver(new WeakSet([key]), key), true, "a WeakSet as a parameter");
        check(hasOfUnknownReceiver(new WeakSet(), key), false, "an empty WeakSet as a parameter");
        check(hasOfUnknownReceiver(new Set([key]), key), true, "a Set as a parameter");
    }

    class Overriding extends WeakMap {
        get(key) { return "overridden " + super.get(key); }
        has(key) { return "overridden " + super.has(key); }
    }
    class Inheriting extends WeakMap { }
    class InheritingSet extends WeakSet { }
    function ofSubclasses(key) {
        const overriding = new Overriding([[key, 1]]), inheriting = new Inheriting([[key, 2]]), set = new InheritingSet([key]);
        return overriding.get(key) + "," + overriding.has(key) + "," + inheriting.get(key) + "," + inheriting.has(key) + "," + inheriting.get({}) + "," + set.has(key) + "," + set.has({});
    }
    function withOwnMethods(key, replace) {
        const map = new WeakMap([[key, "value"]]), set = new WeakSet([key]);
        if (replace) {
            map.get = function (key) { return "own get"; };
            map.has = function (key) { return "own has"; };
            set.has = function (key) { return "own has of set"; };
        }
        return map.get(key) + "," + map.has(key) + "," + set.has(key);
    }
    function withOtherPrototype(key) {
        const map = new WeakMap([[key, "value"]]);
        Object.setPrototypeOf(map, { get() { return "other get"; }, has() { return "other has"; } });
        return map.get(key) + "," + map.has(key);
    }
    function onWrongReceiver(method, receiver, key) { return method.call(receiver, key); }
    for (let round = 0; round < 50; ++round) {
        check(ofSubclasses(key), "overridden 1,overridden true,2,true,undefined,true,false", "subclasses");
        check(withOwnMethods(key, false), "value,true,true", "no own methods");
        check(withOwnMethods(key, true), "own get,own has,own has of set", "own methods");
        check(withOtherPrototype(key), "other get,other has", "another prototype");
        check(onWrongReceiver(WeakMap.prototype.get, new WeakMap([[key, 1]]), key), 1, "get called on a WeakMap");
        for (const receiver of [new WeakSet([key]), new Map([[key, 1]]), {}, undefined, 1, "text"]) {
            check(thrownBy(onWrongReceiver, WeakMap.prototype.get, receiver, key), "TypeError", "WeakMap.prototype.get on another receiver");
            check(thrownBy(onWrongReceiver, WeakMap.prototype.has, receiver, key), "TypeError", "WeakMap.prototype.has on another receiver");
        }
        for (const receiver of [new WeakMap([[key, 1]]), new Set([key]), {}, null])
            check(thrownBy(onWrongReceiver, WeakSet.prototype.has, receiver, key), "TypeError", "WeakSet.prototype.has on another receiver");
    }

    function onlyIfWeakMap(collection, key, rounds) {
        let total = 0;
        for (let i = 0; i < rounds; ++i) {
            if (collection instanceof WeakMap)
                total += WeakMap.prototype.get.call(collection, key);
            else
                total += 1;
        }
        return total;
    }
    for (let round = 0; round < 10; ++round) {
        check(onlyIfWeakMap(new WeakMap([[key, 3]]), key, 100), 300, "a lookup that depends on a test, in a loop");
        check(onlyIfWeakMap({}, key, 100), 100, "a lookup that must not be made before its test");
        check(onlyIfWeakMap(1, key, 100), 100, "a lookup that must not be made before its test");
        check(onlyIfWeakMap(new Map(), key, 100), 100, "a lookup that must not be made before its test");
    }
})();
console.log("passed");
