# An instance of ctypes over memory of JS. While there is one, or a pointer that was made from one, JS neither shrinks the memory nor takes it away: it is refused, or gets a copy.
# Where memory goes all the same, what was made over it says so.
import ctypes, gc, js, mmap, sys


def attempt(f):
    try:
        return repr(f())
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


def look(array, pointer, nested):
    print(' ', attempt(lambda: array[0]), '|', attempt(lambda: array[500]), '|', attempt(lambda: array.__setitem__(500, 1)), '|', attempt(lambda: len(bytes(array))), '|', attempt(lambda: memoryview(array).nbytes))
    print(' ', attempt(lambda: pointer[0]), '|', attempt(lambda: pointer[500]), '|', attempt(lambda: pointer.__setitem__(500, 1)), '|', attempt(lambda: pointer[0:3]), '|', attempt(lambda: type(pointer.contents).__name__))
    print(' ', attempt(lambda: nested[0][500]), '|', attempt(lambda: nested.contents[500]), '|', attempt(lambda: nested[0].__setitem__(500, 1)))


for name, make, act in (
        ('shrunk', 'new Uint8Array(new ArrayBuffer(4096, { maxByteLength: 8192 }))', '(a => a.buffer.resize(16))'),
        ('grown', 'new Uint8Array(new ArrayBuffer(4096, { maxByteLength: 8192 }))', '(a => a.buffer.resize(8192))'),
        ('handed on', 'new Uint8Array(4096)', '(a => a.buffer.transfer().byteLength)'),
        ('cloned away', 'new Uint8Array(4096)', '(a => structuredClone(a.buffer, { transfer: [a.buffer] }).byteLength)')):
    memory = js.eval(make)
    array = (ctypes.c_long * 512).from_buffer(memory)
    array[500] = 7
    pointer = ctypes.cast(array, ctypes.POINTER(ctypes.c_long))
    nested = ctypes.pointer(array)
    print(name)
    look(array, pointer, nested)
    print(' ', attempt(lambda: js.eval(act)(memory)), len(memory))
    look(array, pointer, nested)
    del array, nested
    gc.collect()
    print('  the pointer is left:', attempt(lambda: js.eval(act)(memory)), len(memory), attempt(lambda: pointer[500]))
    del pointer
    gc.collect()
    print('  nothing is left:', attempt(lambda: js.eval(act)(memory)), len(memory))

print('--- the view that holds the memory is released by hand: the memory stays for as long as anything made of the instance is there')
def part_of_what_is_let_go(keeps_the_array_of_js):
    memory = js.eval('new Uint8Array(4096)')
    array = (ctypes.c_long * 512).from_buffer(memory)
    array[500] = 7
    pointer = ctypes.pointer(array)
    array._objects['ffffffff'].release()
    print(' ', attempt(lambda: array[500]), '|', attempt(lambda: pointer[0][500]), '|', attempt(lambda: pointer.contents[500]), '|', attempt(lambda: memoryview(array).nbytes))
    part = pointer[0]
    pointer.contents = (ctypes.c_long * 512)()
    return part, js.eval('(a => () => a.buffer.transfer().byteLength + " " + a.length)')(memory) if keeps_the_array_of_js else None
def collect_and_fill():
    for i in range(4):
        gc.collect()
    js.eval('(() => { const junk = []; for (let i = 0; i < 3000; i++) junk.push(new Uint8Array(4096).fill(0x6a)); return junk.length })')()
    gc.collect()
# Nothing is left but what was made through the pointer.
part, nothing = part_of_what_is_let_go(False)
collect_and_fill()
print(' ', attempt(lambda: hex(part[500])), '|', attempt(lambda: part.__setitem__(500, 1)), '|', attempt(lambda: part[500]))
# JS has the array still, and tries to hand the memory on.
part, hand_on = part_of_what_is_let_go(True)
collect_and_fill()
print(' ', attempt(lambda: part[500]), '|', attempt(lambda: part.__setitem__(500, 1)), '|', attempt(lambda: part[500]), '|', hand_on())
del part
gc.collect()
print(' ', hand_on())

print('--- an mmap lets go of its memory as soon as nothing is exported, whatever is pinned: from then on it is gone')
class HandsOn:
    def __init__(self, exporter):
        self.exporter = exporter
    def __buffer__(self, flags):
        return memoryview(self.exporter)
def over_an_mmap(act, exporter=lambda mapped: mapped):
    mapped = mmap.mmap(-1, 8192, mmap.MAP_PRIVATE)
    array = (ctypes.c_ubyte * 8192).from_buffer(exporter(mapped))
    array[5000] = 7
    pointer = ctypes.pointer(array)
    print(' ', attempt(lambda: act(mapped)), '|', attempt(lambda: array[5000]))
    array._objects['ffffffff'].release()
    part = pointer[0]
    print(' ', attempt(lambda: array[5000]), '|', attempt(lambda: pointer[0][5000]), '|', attempt(lambda: part[5000]))
    print(' ', attempt(lambda: act(mapped)))
    print(' ', attempt(lambda: array[5000]), '|', attempt(lambda: array.__setitem__(5000, 1)), '|', attempt(lambda: pointer[0][5000]), '|', attempt(lambda: pointer.contents[5000]), '|', attempt(lambda: part[5000]))
over_an_mmap(lambda mapped: mapped.close())
over_an_mmap(lambda mapped: mapped.resize(4096))
over_an_mmap(lambda mapped: mapped.resize(16384))
over_an_mmap(lambda mapped: mapped.close(), HandsOn)

print('--- the memory of a WebAssembly.Memory that grows is another buffer from then on')
grows = js.eval('new WebAssembly.Memory({ initial: 1, maximum: 400 })')
memory = js.eval('(m => new Uint8Array(m.buffer))')(grows)
array = (ctypes.c_long * 512).from_buffer(memory)
array[500] = 7
pointer = ctypes.cast(array, ctypes.POINTER(ctypes.c_long))
nested = ctypes.pointer(array)
look(array, pointer, nested)
print(' ', grows.grow(300), len(memory))
look(array, pointer, nested)

print('--- an audit hook is told of from_buffer() before the memory is held')
armed = []
def hook(event, args):
    if armed and event.startswith('ctypes.'):
        print('  the hook,', event + ':', attempt(armed.pop()))
sys.addaudithook(hook)
for act in ('(a => a.buffer.resize(16))', '(a => a.buffer.resize(4095))', '(a => a.buffer.resize(4096 + 8))', '(a => a.buffer.transfer().byteLength)'):
    memory = js.eval('new Uint8Array(new ArrayBuffer(4096, { maxByteLength: 8192 }))')
    armed.append(lambda: js.eval(act)(memory))
    print(' ', attempt(lambda: type((ctypes.c_long * 512).from_buffer(memory)).__name__), len(memory))

print('--- the bytes of a small typed array lie with the array until its buffer is asked for, which from_buffer() does')
for size in (16, 64):
    memory = js.eval('(n => new Uint8Array(n))')(size)
    array = (ctypes.c_char * size).from_buffer(memory)
    pointer = ctypes.cast(array, ctypes.POINTER(ctypes.c_int))
    before = ctypes.addressof(array)
    pointer[0] = 0x41414141
    js.eval('(u => u.buffer)')(memory)
    print(size, ctypes.addressof(array) != before, array[0:4], '|', attempt(lambda: pointer[0]), '|', attempt(lambda: pointer.__setitem__(0, 1)), '|', attempt(lambda: ctypes.cast(array, ctypes.POINTER(ctypes.c_int))[0]))
