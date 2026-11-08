# The result of cast() points into the memory of the source, which lies in a view. While cast() is at work code of the program runs, the source is given the class of a simple type back and the
# memory goes: the view is released, an mmap closed, the memory of WebAssembly grows.
# - While the arguments are converted: the address of the source is worked out behind that. If the view has been released there is none, and the call is refused.
# - While the result is made, behind the taking of the address: the result keeps the source all the same, by which it is known afterwards that what it points to is gone.
# (It was a bare address, and read and wrote whatever lay there.)
import ctypes, gc, js, mmap


def attempt(f):
    try:
        return repr(f())
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


between = []
class Meta(type(ctypes._Pointer)):
    @property
    def __class__(cls):
        while between:
            between.pop()()
        return Meta
class WhileTheArgumentsAreConverted(ctypes._Pointer, metaclass=Meta):
    _type_ = ctypes.c_ulong
class WhileTheResultIsMade(ctypes._Pointer):
    _type_ = ctypes.c_ulong
    def __init__(self):
        while between:
            between.pop()()


def try_with(Target, exporter, let_go):
    source = ctypes.c_void_p.from_buffer(exporter)
    source.__class__ = ctypes.c_ulong * 1
    source[0] = 0x5151
    def act():
        source.__class__ = ctypes.c_void_p
        let_go(source)
    between.append(act)
    try:
        result = ctypes.cast(source, Target)
    except ctypes.ArgumentError as e:
        print(' ', len(between), type(source).__name__, 'ArgumentError:', e)
        return
    kept = result._objects
    print(' ', len(between), type(source).__name__, type(kept).__name__, isinstance(kept, dict) and any(value is source for value in kept.values()))
    del source, kept, act
    for i in range(4):
        gc.collect()
    print(' ', attempt(lambda: hex(result[0])), '|', attempt(lambda: result.__setitem__(0, 1)), '|', attempt(lambda: hex(result.contents.value)))


for Target in (WhileTheArgumentsAreConverted, WhileTheResultIsMade):
    print('======', Target.__name__)
    print('--- a bytearray, the view released')
    try_with(Target, bytearray(4096), lambda source: source._objects.release())
    print('--- an mmap, the view released and the mmap closed')
    mapped = mmap.mmap(-1, 4096)
    try_with(Target, mapped, lambda source: (source._objects.release(), mapped.close()))
    print('--- memory of WebAssembly that grows')
    grows = js.eval('new WebAssembly.Memory({ initial: 1, maximum: 400 })')
    try_with(Target, js.eval('(m => new Uint8Array(m.buffer))')(grows), lambda source: grows.grow(300))
    print('--- a typed array, the view released: that is pinned, and stays')
    try_with(Target, js.eval('new Uint8Array(4096)'), lambda source: source._objects.release())
    print('--- nothing goes')
    try_with(Target, bytearray(4096), lambda source: None)
