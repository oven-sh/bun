# A list of Python is an array of JS, so every array that JS can make is a list: with holes, frozen, sparse, with accessors for
# indices, with a length of four thousand million, of another shape than the one that Python's own lists have. Everything that can be
# done to a list is done to each of them. What comes out is for other tests: here the point is that the process survives, and that
# the array is still one that JS and the collector can walk.
#
# Usage: evil_js_arrays.py --list | GROUP [-v] [--all]       -v: says which operation comes next. --all: also what takes time or room
# for each item, for arrays that say they have very many (minutes, on a release build). A group is a kind of array, or a kind with "!" in front: the same after
# Array.prototype has been given an accessor for an index, which changes the storage of all arrays of the realm, for good. With "!!"
# it is an index that the lists reach.
import sys

KINDS = {
    "empty": "[]",
    "ints": "[1, 2, 3, 4, 5, 6, 7, 8]",
    "doubles": "[1.5, 2.5, 3.5, -0, 1e300]",
    "doubles_nan": "[1.5, NaN, 2.5]",
    "values": "['a', {}, null, undefined, 1, 2.5, [1]]",
    "ints_written": "(() => { let a = [1, 2, 3]; a.push(4); return a })()",
    "doubles_written": "(() => { let a = [1.5, 2.5]; a.push(3.5); return a })()",
    "values_written": "(() => { let a = ['a', 'b']; a.push('c'); return a })()",
    "undecided": "new Array(5)",
    "undecided_long": "new Array(3000)",
    "undecided_very_long": "new Array(100000)",
    "holes": "[1, , 3, , 5]",
    "holes_doubles": "[1.5, , 3.5]",
    "holes_at_end": "(() => { let a = [1, 2, 3]; a.length = 10; return a })()",
    "frozen": "Object.freeze([1, 2, 3])",
    "frozen_values": "Object.freeze(['a', {}, [1]])",
    "frozen_empty": "Object.freeze([])",
    "sealed": "Object.seal([1, 2, 3])",
    "not_extensible": "Object.preventExtensions([1, 2, 3])",
    "length_read_only": "(() => { let a = [1, 2, 3]; Object.defineProperty(a, 'length', { writable: false }); return a })()",
    "item_read_only": "(() => { let a = [1, 2, 3]; Object.defineProperty(a, 1, { value: 9, writable: false }); return a })()",
    "item_not_configurable": "(() => { let a = [1, 2, 3]; Object.defineProperty(a, 1, { value: 9, configurable: false }); return a })()",
    "getter": "(() => { let a = [1, 2, 3]; Object.defineProperty(a, 1, { get() { return 9 } }); return a })()",
    "getter_that_clears": "(() => { let a = [1, 2, 3, 4]; Object.defineProperty(a, 1, { get() { a.length = 0; return 9 }, configurable: true }); return a })()",
    "setter_that_grows": "(() => { let a = [1, 2, 3]; Object.defineProperty(a, 1, { get() { return 1 }, set(v) { a.push(v) }, configurable: true }); return a })()",
    "getter_that_throws": "(() => { let a = [1, 2, 3]; Object.defineProperty(a, 0, { get() { throw new Error('no') } }); return a })()",
    "sparse": "(() => { let a = [1, 2, 3]; a[20000] = 4; return a })()",
    "sparse_far": "(() => { let a = []; a[4294967294] = 1; return a })()",
    "length_huge": "(() => { let a = [1, 2, 3]; a.length = 4294967295; return a })()",
    "longer_than_items_in_a_row_can_be": "(() => { let a = [1, 2, 3]; a.length = 300000000; return a })()",
    "length_cut": "(() => { let a = [1, 2, 3, 4, 5, 6]; a.length = 2; return a })()",
    "array_storage": "(() => { let a = [1, 2, 3]; a[100000] = 1; a.length = 3; return a })()",
    "shifted": "(() => { let a = []; for (let i = 0; i < 100; i++) a.push(i); for (let i = 0; i < 50; i++) a.shift(); return a })()",
    "unshifted": "(() => { let a = [1, 2, 3]; for (let i = 0; i < 50; i++) a.unshift(i); return a })()",
    "array_storage_shifted": "(() => { let a = [1, 2, 3, 4, 5]; a[100000] = 1; a.length = 5; a.shift(); a.unshift(7, 8); return a })()",
    "named_properties": "(() => { let a = [1, 2, 3]; for (let i = 0; i < 40; i++) a['p' + i] = i; return a })()",
    "named_properties_only": "(() => { let a = []; for (let i = 0; i < 40; i++) a['p' + i] = i; return a })()",
    "subclass": "(() => { class A extends Array {}; return A.from([1, 2, 3]) })()",
    "subclass_empty": "(() => { class A extends Array {}; return new A() })()",
    "subclass_with_getter_for_length": "(() => { class A extends Array { get size() { return 1 } }; let a = new A(3); a.fill(1); return a })()",
    "no_prototype": "Object.setPrototypeOf([1, 2, 3], null)",
    "prototype_with_items": "Object.setPrototypeOf([1, , 3], { 1: 'from the prototype' })",
    "prototype_with_accessor": "Object.setPrototypeOf([1, , 3], Object.defineProperty({}, 1, { get() { return 'got' }, set(v) {} }))",
    "prototype_is_proxy": "Object.setPrototypeOf([1, , 3], new Proxy({}, {}))",
    "array_prototype": "(() => { Array.prototype.length = 0; return Array.prototype })()",
    "of_itself": "(() => { let a = [1]; a.push(a); return a })()",
    "long": "Array.from({ length: 3000 }, (x, i) => i)",
    "long_doubles": "Array.from({ length: 3000 }, (x, i) => i + 0.5)",
    "long_values": "Array.from({ length: 3000 }, (x, i) => 's' + i)",
    "regexp_match": "/(a)(b)?/.exec('a')",
    "template_strings": "(s => s)`a${1}b`",
    "from_json": "JSON.parse('[1, [2, 3], {\"a\": [4]}]')",
    "arguments_spread": "((...rest) => rest)(1, 2, 3)",
    "concat_spreadable_off": "(() => { let a = [1, 2]; a[Symbol.isConcatSpreadable] = false; return a })()",
    "other_realm": "process.getBuiltinModule('node:vm').runInNewContext('[1, 2, 3]')",
    "other_realm_doubles": "process.getBuiltinModule('node:vm').runInNewContext('[1.5, 2.5]')",
    "other_realm_with_accessor": "process.getBuiltinModule('node:vm').runInNewContext('Object.defineProperty(Array.prototype, 100000, { get() { return 1 }, set(v) {} }); [1, 2, 3]')",
    "other_realm_frozen": "process.getBuiltinModule('node:vm').runInNewContext('Object.freeze([1, 2, 3])')",
    "species": "(() => { let a = [1, 2]; a.constructor = { [Symbol.species]: function () { return {} } }; return a })()",
}

if sys.argv[1:] == ["--list"]:
    for kind in KINDS:
        print(kind)
    for kind in KINDS:
        print("!" + kind)
    for kind in KINDS:
        print("!!" + kind)
    sys.exit(0)

if sys.implementation.name == "cpython":
    print("done")
    sys.exit(0)

import bisect, collections, copy, functools, gc, heapq, io, itertools, json, operator, pickle, random, struct
import js

LONG = 10000  # Whatever takes time or room for every item is not done to a list that says it is longer.


class Key:
    """Changes the list while it is being sorted, searched or compared."""
    def __init__(self, target, value):
        self.target, self.value = target, value

    def poke(self):
        try:
            self.target.append(1) if len(self.target) < 20 else self.target.clear()
        except Exception:
            pass

    def __lt__(self, other):
        self.poke()
        return id(self) < id(other)

    def __eq__(self, other):
        self.poke()
        return False

    __hash__ = None


VALUES = [0, -1, 2**31, 2**53, 2**70, 1.5, float("nan"), -0.0, None, True, "s", b"b", (), [], {}, object(), len]


def operations(make):
    """Each is given a new array."""
    simple = [
        len, bool, type, id, iter, reversed, dir, sys.getsizeof, gc.is_tracked,
        lambda l: l[0], lambda l: l[-1], lambda l: l[1], lambda l: l[len(l) - 1], lambda l: l[len(l)], lambda l: l[2**31], lambda l: l[-2**31], lambda l: l[2**70],
        lambda l: l[:2], lambda l: l[-2:], lambda l: l[1:3], lambda l: l[:6:2], lambda l: l[5::-1][:5], lambda l: l[2**31:], lambda l: l[:0],
        lambda l: l.append(1), lambda l: l.append(1.5), lambda l: l.append("s"), lambda l: l.append(l), lambda l: l.append(None),
        lambda l: l.extend([1, 2]), lambda l: l.extend((1.5, "s")), lambda l: l.extend(iter("ab")), lambda l: l.extend(x for x in (1, 2)),
        lambda l: l.insert(2**40, 1), lambda l: l.pop(), lambda l: l.pop(-1), lambda l: l.pop(2**40),
        lambda l: l.__setitem__(0, 1), lambda l: l.__setitem__(1, "s"), lambda l: l.__setitem__(-1, 1.5), lambda l: l.__setitem__(len(l), 1),
        lambda l: l.__delitem__(-1), lambda l: l.__delitem__(len(l)), lambda l: l.__setitem__(slice(0, 4, 2), [1, 2]), lambda l: l.__setitem__(slice(2**40, None), [1]),
        lambda l: l.__iadd__([1]), lambda l: l.__iadd__("ab"),
        lambda l: l * 0, lambda l: 0 * l, lambda l: l * -5, lambda l: [] + l[:3], lambda l: l[:3] + [], lambda l: l.__class__, lambda l: l.__reduce_ex__(2)[0],
        lambda l: next(iter(l)), lambda l: next(reversed(l)), lambda l: operator.length_hint(iter(l)), lambda l: iter(l).__reduce__()[0],
        lambda l: iter(l).__setstate__(2**40), lambda l: reversed(l).__setstate__(2**40), lambda l: reversed(l).__setstate__(-5),
        lambda l: list(itertools.islice(l, 5)), lambda l: list(itertools.islice(reversed(l), 5)), lambda l: list(zip(l, "abc")), lambda l: 1 in l[:5],
        lambda l: hash(l), lambda l: l.__sizeof__(), lambda l: l == l[:3], lambda l: l[:3] < l[:2], lambda l: operator.indexOf(l[:5], 3),
        lambda l: setattr(l, "x", 1), lambda l: l.length, lambda l: l.push(1), lambda l: l.slice(0, 2), lambda l: l.at(-1),
    ]
    # These look at every item, move them all, or make as many.
    whole = [
        gc.get_referents, lambda l: l.indexOf(1),
        lambda l: l.insert(0, 1), lambda l: l.insert(1, "s"), lambda l: l.insert(-1, 1.5), lambda l: l.insert(-2**40, 1), lambda l: l.pop(0), lambda l: l.pop(1),
        lambda l: l.clear(), lambda l: l.__init__(), lambda l: l.__init__([1, 2]), lambda l: l.__init__("abc"), lambda l: l.__delitem__(0), lambda l: l.__delitem__(1),
        lambda l: l.__setitem__(slice(0, 1), [7, 8, 9]), lambda l: l.__setitem__(slice(1, 2), []), lambda l: l.__setitem__(slice(None), "xyz"), lambda l: l.__setitem__(slice(1, 1), l[:4]),
        lambda l: l.__delitem__(slice(0, 1)), lambda l: l.__delitem__(slice(0, 4, 2)), lambda l: l.__delitem__(slice(3, None, -1)),
        lambda l: l.__imul__(0), lambda l: l.__imul__(-1), lambda l: l.__imul__(1),
        repr, str, list, tuple, set, sorted, sum, min, max, any, all, copy.copy, copy.deepcopy, json.dumps, pickle.dumps, bytes, bytearray, collections.deque,
        collections.Counter, dict.fromkeys, enumerate, "".join, heapq.heapify, random.shuffle, functools.partial(map, str),
        lambda l: l + l, lambda l: l * 2, lambda l: l * 3, lambda l: l.__imul__(2), lambda l: l.__iadd__(l), lambda l: l.extend(l), lambda l: l.copy(), lambda l: l[:], lambda l: l[::-1], lambda l: l[::2],
        lambda l: l.reverse(), lambda l: l.sort(), lambda l: l.sort(reverse=True), lambda l: l.sort(key=id), lambda l: l.sort(key=str),
        lambda l: l.sort(key=lambda x: Key(l, x)), lambda l: l.sort(key=lambda x: l.clear()), lambda l: l.sort(key=lambda x: l.append(x)),
        lambda l: l.count(1), lambda l: l.index(3), lambda l: l.index(3, 1, 2), lambda l: l.remove(3), lambda l: l.remove("absent"), lambda l: l.count(Key(l, 0)), lambda l: l.index(Key(l, 0)),
        lambda l: l.remove(Key(l, 0)), lambda l: Key(l, 0) in l, lambda l: l == list(l), lambda l: l < list(l), lambda l: l == [Key(l, 0)] * len(l),
        lambda l: [x for x in l], lambda l: [*l], lambda l: (*l,), lambda l: {*map(id, l)}, lambda l: print(*l, file=io.StringIO()), lambda l: (lambda *a: len(a))(*l),
        lambda l: (lambda a, *b: b)(*l), lambda l: struct.pack("%dd" % len(l), *l), lambda l: l.__setitem__(slice(None), l), lambda l: l.__setitem__(slice(None, None, -1), l),
        lambda l: l.__delitem__(slice(None)), lambda l: l.__delitem__(slice(None, None, 2)), lambda l: l.__delitem__(slice(None, None, -1)),
        lambda l: [l.append(x) for x in l if len(l) < 50], lambda l: [l.pop() for x in l], lambda l: [l.clear() for x in l], lambda l: [l.insert(0, x) for x in l if len(l) < 50],
        lambda l: [l.pop(0) for x in reversed(l)], lambda l: heapq.heappush(l, 1), lambda l: heapq.heappop(l), lambda l: heapq.heapreplace(l, 2), lambda l: heapq.nlargest(2, l),
        lambda l: heapq.heappush(l, Key(l, 0)), lambda l: bisect.insort(l, 2), lambda l: bisect.bisect(l, 2), lambda l: bisect.insort(l, Key(l, 0)), lambda l: list(heapq.merge(l, l)),
        lambda l: list(itertools.chain(l, l)), lambda l: list(itertools.accumulate(l)), lambda l: list(map(operator.add, l, l)), lambda l: functools.reduce(operator.add, l),
        lambda l: l.sort(key=functools.cmp_to_key(lambda a, b: 0)), lambda l: l.map(lambda x, *a: x), lambda l: l.reverse() or l.sort(), lambda l: js.JSON.stringify(l),
    ]
    simple += [(lambda v: lambda l: l.__setitem__(0, v))(v) for v in VALUES] + [(lambda v: lambda l: l.append(v))(v) for v in VALUES]
    whole += [(lambda v: lambda l: l.insert(0, v))(v) for v in VALUES] + [(lambda v: lambda l: l.__setitem__(slice(0, 1), [v, v]))(v) for v in VALUES]

    def unpack2(l):
        a, b = l

    def unpack3(l):
        a, b, c = l

    def unpack_star(l):
        a, *b = l

    def unpack_star_middle(l):
        a, *b, c = l

    def loop_and_store(l):
        for i, x in enumerate(l):
            l[i] = x if i & 1 else str(x)

    def subscripts(l):
        # The fast paths of the interpreter, with each kind of value.
        for i in range(min(len(l), 8)):
            for v in VALUES:
                l[i] = v
                l[i]
                l[-1 - i] = v
        if l:
            return l[0]

    def truth(l):
        if l:
            return 1
        while not l:
            return 2

    def match(l):
        match l:
            case [a, b]:
                return 2
            case [a, *rest]:
                return 1
            case []:
                return 0

    whole += [unpack2, unpack3, unpack_star, unpack_star_middle, loop_and_store, match]
    simple += [subscripts, truth]
    return simple, whole


check = js.eval("""(a => {
    // Walks it as JS does. For a long one, the ends.
    let n = a.length, seen = 0;
    for (let i = 0; i < Math.min(n, 300); i++) { try { if (a[i] !== undefined) seen++ } catch (e) {} }
    for (let i = Math.max(0, n - 300); i < n; i++) { try { if (a[i] !== undefined) seen++ } catch (e) {} }
    try { Object.getOwnPropertyNames(a).length } catch (e) {}
    try { if (n < 1000) JSON.stringify(a, (k, v) => typeof v === 'object' || typeof v === 'function' ? null : typeof v === 'bigint' ? 0 : v) } catch (e) {}
    return seen;
})""")


def main(group):
    kind = group.lstrip("!")
    if group.startswith("!"):
        js.eval("Object.defineProperty(Array.prototype, %d, { get() { return 1 }, set(v) {}, configurable: true })" % (5 if group.startswith("!!") else 100000))
    source = KINDS[kind]
    make = lambda: js.eval(source)
    simple, whole = operations(make)
    outcomes = collections.Counter()
    for number, operation in enumerate(simple + whole):
        try:
            l = make()
        except Exception:
            # The accessor is in the way of the host's own code.
            break
        if operation in whole and len(l) > LONG and "--all" not in sys.argv:
            continue
        if verbose:
            sys.stderr.write("%s %d\n" % (group, number))
        result = None
        try:
            result = operation(l)
            if type(result) in (map, enumerate, zip, reversed):
                result = list(itertools.islice(result, 20))
            outcomes["returned"] += 1
        except RecursionError:
            outcomes["RecursionError"] += 1
        except MemoryError:
            outcomes["MemoryError"] += 1
        except Exception:
            outcomes["raised"] += 1
        check(l)
        if type(result) is list:
            check(result)
        del l, result
        if number % 16 == 0:
            gc.collect()
    gc.collect()
    print("done")


verbose = "-v" in sys.argv
main(sys.argv[1])
