# A memoryview that is only the operand of one operation is released when that is over; one that anything else refers to is not.
import gc
import sys

log = []


class Exporter:
    def __init__(self, name):
        self.name = name
        self.data = bytearray(b'0123456789')

    def __buffer__(self, flags):
        log.append('export')
        return memoryview(self.data)

    def __release_buffer__(self, view):
        log.append('release')
        view.release()


e = Exporter('e')


def show(label, *values):
    print(label, *values, log)
    log.clear()


print('--- released at once')
x = memoryview(e).tobytes()
show('tobytes', x)
x = memoryview(e)[:3].tobytes()
show('slice, tobytes', x)
x = (memoryview(e)[2:8])[1:3].tobytes()
show('slice, slice, tobytes', x)
x = bytes(memoryview(e))
show('bytes()', x)
x = bytes(memoryview(e)[:4])
show('bytes() of a slice', x)
x = bytearray(memoryview(e)[4:])
show('bytearray()', x)
x = memoryview(e).tolist()
show('tolist', x)
x = memoryview(e)[1:3].hex()
show('hex', x)
x = memoryview(e).cast('B')[:2].tobytes()
show('cast', x)
x = memoryview(e).cast('H').tolist()
show('cast to H', x)
x = memoryview(e).toreadonly().tobytes()
show('toreadonly', x)
x = memoryview(memoryview(e)[1:])[1:].tobytes()
show('a view of a view', x)
x = memoryview(e)[3]
show('an item', x)
x = memoryview(e)[-1]
show('an item from the end', x)
x = memoryview(e).tobytes(order='F')
show('keyword argument', x)
x = bytes(memoryview(e)[:2]) + bytes(memoryview(e)[8:])
show('two in a row', x)
x = [bytes(memoryview(e)[i:i + 2]) for i in range(0, 6, 2)]
show('in a comprehension', x)


def function():
    return memoryview(e)[5:].tobytes()


show('in a function', function())


def stores():
    target = bytearray(4)
    target[:] = memoryview(e)[:4]
    show('stored in a slice of a bytearray', target)
    target[1:3] = memoryview(e)[8:]
    show('stored in a part', target)
    start = 2
    target[start:] = memoryview(e)[5:7]
    show('stored from a variable on', target)
    items = [None]
    items[0] = memoryview(e)[:1]
    show('stored in a list: kept')
    items[0].release()
    show('release()')
    for target in (items, bytearray(1), items):
        try:
            target[0] = memoryview(e)[:1]
        except TypeError:
            log.append('TypeError')
        show('the same store', type(target).__name__)
        if target is items:
            items[0].release()
            show('release()')


stores()

print('--- also when it fails')
try:
    memoryview(e)[100]
except IndexError as error:
    show('IndexError', error)
try:
    memoryview(e).tobytes(order='X')
except ValueError as error:
    show('ValueError', error)
try:
    memoryview(e)['a']
except TypeError as error:
    show('TypeError', error)
try:
    memoryview(e).cast('Q')
except TypeError as error:
    show('cast', error)
try:
    bytes(memoryview(e), 'ascii')
except TypeError as error:
    show('bytes()', error)

print('--- what programs do')
b = bytearray(b'abcdefghij')
x = memoryview(b)[:3].tobytes()
del b[:3]
print(x, b)
x = bytes(memoryview(b)[:2])
del b[:2]
print(x, b)
for i in range(3):
    x = memoryview(b)[:1].tobytes()
    del b[:1]
    b += b'z' * 3
print(x, b)

print('--- not released: something else refers to it')
m = memoryview(e)
x = m.tobytes()
show('a variable', x)
m.release()
show('release()')

m = memoryview(e)
x = m[:2].tobytes()
show('a slice of a variable', x)
m.release()
show('release()')

items = [memoryview(e)]
x = items[0].tobytes()
show('in a list', x)
items.pop().release()
show('release()')

kept = []


def keep(view):
    kept.append(view)
    return b'kept'


x = keep(memoryview(e))
show('kept by a function', x)
print(kept[0].tobytes())
kept.pop().release()
show('release()')

with memoryview(e) as m:
    show('with')
show('after with')
del m


def closure():
    view = memoryview(e)
    return lambda: view.tobytes()


f = closure()
show('a closure', f())
f.__closure__[0].cell_contents.release()
show('release()')


def generator():
    view = memoryview(e)
    yield view[:1].tobytes()
    yield view[1:2].tobytes()


g = generator()
show('a generator', next(g))
show('again', next(g))
g.gi_frame.f_locals['view'].release()
show('release()')
g.close()


def site(make, use):
    return use(make(e))


show('a call site: makes and uses up', site(memoryview, bytes))
show('the same site: the view is kept', site(memoryview, keep))
saved = kept[0]
show('the same site: somebody else\'s view', site(lambda exporter: saved, bytes))
print(saved.tobytes())
show('still good')
kept.clear()
saved.release()
show('release()')
show('the same site: makes and uses up again', site(memoryview, bytes))


def method_site(make):
    return make(e).tobytes()


show('a method site', method_site(memoryview))
saved = memoryview(e)
show('made')
show('the same site: somebody else\'s view', method_site(lambda exporter: saved))
print(saved.tobytes())
saved.release()
show('release()')


def second(a, b):
    return b


def views_of(exporter):
    result = []
    for o in gc.get_objects():
        if isinstance(o, memoryview):
            try:
                if o.obj is exporter:
                    result.append(o)
            except ValueError:
                pass
    return result


b = bytearray(b'abc')
found = second(memoryview(b), views_of(b))
print('gc.get_objects()', len(found), found[0].tobytes())
try:
    del b[:1]
except BufferError as error:
    print('BufferError:', error)
found.pop().release()
del b[:1]
print(b)

print('--- still refused')
b = bytearray(b'abcdef')
m = memoryview(b)
for attempt in (lambda: b.pop(), lambda: b.append(1), lambda: b.extend(b'x'), lambda: b.clear(), lambda: b.__delitem__(0), lambda: b.__iadd__(b'y')):
    try:
        attempt()
    except BufferError as error:
        print('BufferError:', error)
x = m[:2].tobytes()
try:
    del b[:2]
except BufferError as error:
    print('BufferError:', error)
m.release()
del b[:2]
print(x, b)

seen = []


def profiler(frame, event, arg):
    if event == 'c_call' and getattr(arg, '__name__', '') == 'tobytes':
        seen.append(arg.__self__)


b = bytearray(b'abcdef')
sys.setprofile(profiler)
x = memoryview(b)[:2].tobytes()
sys.setprofile(None)
try:
    del b[:2]
except BufferError as error:
    print('a profiler kept it. BufferError:', error)
print(seen[0].tobytes())
seen.pop().release()
del b[:2]
print(b)
