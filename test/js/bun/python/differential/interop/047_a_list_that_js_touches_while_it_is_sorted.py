# A list of Python's is an array of JS's, and is empty and without room for as long as it is sorted. What JS does to it meanwhile, or to all arrays at once.
import js


def attempt(f):
    try:
        f()
        return 'sorted'
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


print('--- the length and the room of a list, while it is sorted')
numbers = js.eval('(a => /public length: (\\d+); vector length: (\\d+)/.exec(process.getBuiltinModule("bun:jsc").describeArray(a)).slice(1).map(Number))')
for count in (1, 3, 64, 65, 200, 2000):
    for name, act in (('nothing', lambda x: None), ('clear', lambda x: x.clear()), ('reverse', lambda x: x.reverse()), ('sort', lambda x: x.sort()), ('sort with a key', lambda x: x.sort(key=abs)),
            ('extend by nothing', lambda x: x.extend([])), ('copy', lambda x: x.copy()), ('append + pop', lambda x: (x.append(1), x.pop())), ('100 items and clear', lambda x: (x.extend(range(100)), x.clear()))):
        x = list(range(count, 0, -1))
        seen = []
        def key(v):
            if not seen:
                seen.append(list(numbers(x)))
                act(x)
                length, room = numbers(x)
                seen.append([length, room > 0])
            return v
        try:
            x.sort(key=key)
            result = 'sorted'
        except ValueError as e:
            result = str(e)
        print(count, name, '|', *seen, '|', result, '|', list(numbers(x))[0], x == list(range(1, count + 1)))

print('--- what JS does to it')
acts = {
    'nothing': '(a => {})',
    'push + pop': '(a => { a.push(1); a.pop(); })',
    'a[0] = 1; a.length = 0': '(a => { a[0] = 1; a.length = 0; })',
    'a.length = 5; a.length = 0': '(a => { a.length = 5; a.length = 0; })',
    'unshift + shift': '(a => { a.unshift(1); a.shift(); })',
    'splice in and out': '(a => { a.splice(0, 0, 1, 2); a.splice(0, 2); })',
    'a[1000000] = 1; a.length = 0': '(a => { a[1000000] = 1; a.length = 0; })',
    'push': '(a => { a.push(9); })',
    'sort': '(a => { a.sort(); })',
    'a.length = 0': '(a => { a.length = 0; })',
    # No item is touched.
    'a.x = 1': '(a => { a.x = 1; })',
    # JS gives up the room of a long array that is emptied, as the sort has: it cannot be told.
    '100 items; a.length = 0': '(a => { for (let i = 0; i < 100; i++) a.push(i); a.length = 0; })',
}
x_of = js.eval('(a => a.x)')
for count in (3, 200):
    for name, source in acts.items():
        act = js.eval(source)
        x = list(range(count, 0, -1))
        seen = []
        def key(v):
            if not seen:
                seen.append(len(x))
                act(x)
            return v
        result = attempt(lambda: x.sort(key=key))
        x.append(0)
        print(count, name, '|', result, '|', seen, x == list(range(1, count + 1)) + [0], x_of(x))

print('--- the key gives the array a prototype with an index that cannot be written')
give = js.eval('(a => { const p = Object.create(Array.prototype); Object.defineProperty(p, 1, { value: 5, writable: false }); Object.setPrototypeOf(a, p); })')
show = js.eval('(a => JSON.stringify(a) + " " + a.length + " " + JSON.stringify(Object.getOwnPropertyNames(a)))')
a = js.eval('[3, 1, 2]')
def key(v):
    if v == 3:
        give(a)
    return v
print(attempt(lambda: list.sort(a, key=key)), '|', show(a), len(a), list(a))
list.append(a, 8)
print(show(a), len(a))

print('--- the key has JS give Array.prototype an accessor for an index: every array of the realm gets other storage')
x = [3, 1, 2, 5, 4]
def key(v):
    if v == 3:
        js.eval('Object.defineProperty(Array.prototype, 7, { get() { return 1; }, configurable: true })')
    return v
print(attempt(lambda: x.sort(key=key)), '|', x, len(x))
x.append(8)
x.append(9)
print(x, len(x))
x.extend([1, 2])
print(x, len(x))
x.sort()
print(x)
x.sort(key=lambda v: -v)
print(x)
