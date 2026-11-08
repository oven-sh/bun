# list.sort() leaves an array filled while it sorts if JS has given an item an attribute. Not one whose items merely lie in a map: an attribute was given and has been taken back, or a
# prototype has an accessor for an index, which puts the items of an instance of a class derived from list there. Such a one is emptied like any list, and what a key does to it shows as it does
# for a list.
import js

class Derived(list):
    pass

class WithSlots(list):
    __slots__ = ()

COUNT = 70
numbers = [(i * 37) % COUNT for i in range(COUNT)]
fill = js.eval('(n => { const a = []; for (let i = 0; i < n; i++) a.push((i * 37) % n); return a; })')

def taken_back(source):
    return lambda: js.eval('(a => { %s; return a; })' % source)(fill(COUNT))

kinds = {
    'a list': lambda: list(numbers),
    'derived from list': lambda: Derived(numbers),
    'derived from list, with slots': lambda: WithSlots(numbers),
    'an array': lambda: fill(COUNT),
    'read-only and writable again': taken_back('Object.defineProperty(a, 3, { writable: false }); Object.defineProperty(a, 3, { writable: true })'),
    'a getter and a value again': taken_back('Object.defineProperty(a, 3, { get() { return 0; }, configurable: true }); Object.defineProperty(a, 3, { value: (3 * 37) % a.length, writable: true, enumerable: true })'),
    'hidden and shown again': taken_back('Object.defineProperty(a, 3, { enumerable: false }); Object.defineProperty(a, 3, { enumerable: true })'),
    'the item with the attribute deleted and set again': taken_back('Object.defineProperty(a, 3, { writable: false }); delete a[3]; a[3] = (3 * 37) % a.length'),
    'still read-only': taken_back('Object.defineProperty(a, 3, { writable: false })'),
}

acts = {
    'nothing': lambda x: None,
    'clear()': lambda x: x.clear(),
    'x[:] = []': lambda x: x.__setitem__(slice(None), []),
    'pop()': lambda x: x.pop(),
    'del x[0]': lambda x: x.__delitem__(0),
    'x *= 2': lambda x: x.__imul__(2),
    'append(1)': lambda x: x.append(1),
    'extend([1, 2])': lambda x: x.extend([1, 2]),
    'insert(0, 1)': lambda x: x.insert(0, 1),
    'x[0] = 1': lambda x: x.__setitem__(0, 1),
    'reverse()': lambda x: x.reverse(),
    'sort()': lambda x: x.sort(),
    'append(1), pop()': lambda x: (x.append(1), x.pop()),
}

def trial(make, act, at):
    x = make()
    seen = []
    calls = [0]
    def key(value):
        calls[0] += 1
        if calls[0] == at:
            seen.append(len(x))
            try:
                act(x)
            except Exception as error:
                seen.append(type(error).__name__)
            seen.append(len(x))
        return value
    try:
        list.sort(x, key=key)
        result = 'sorted'
    except Exception as error:
        result = '%s: %s' % (type(error).__name__, error)
    return result, seen, len(x), list(x) == sorted(numbers)

def table(title):
    print('---', title)
    for what, act in acts.items():
        for at in (1, COUNT):
            model = trial(kinds['a list'], act, at)
            unlike = [name for name, make in kinds.items() if name != 'still read-only' and trial(make, act, at) != model]
            print(what, at, '|', *model, '| unlike a list:', unlike, '| still read-only:', *trial(kinds['still read-only'], act, at))

table('as things are')
js.eval('Object.defineProperty(Array.prototype, 1000000, { get() { return "from the prototype"; }, configurable: true })')
table('a prototype has an accessor for an index')
js.eval('delete Array.prototype[1000000]')
table('and has it no more')
