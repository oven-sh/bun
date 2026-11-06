# A class can derive from a class of JS's and from one of the abstract classes of io. Those have a __dict__ for their instances; an object of
# JS's has its attributes as properties and no __dict__.
import _io
import inspect
import io
import js
import types


def show(label, function):
    try:
        print(label, function())
    except Exception as error:
        print(label, type(error).__name__, error)


class Reader(js.Date, io.RawIOBase):
    def readable(self):
        return True

    def readinto(self, buffer):
        if getattr(self, 'done', False):
            return 0
        self.done = True
        buffer[:1] = b'x'
        return 1


r = Reader(0)
show('mro', lambda: [c.__name__ for c in Reader.__mro__])
show('read', lambda: r.read(3))
show('of js', lambda: r.getTime())
show('attribute', lambda: r.done)
show('__dict__', lambda: (type(r.__dict__).__name__, dict(r.__dict__)))
show('vars', lambda: dict(vars(r)))
show('the descriptor asked directly', lambda: _io._IOBase.__dict__['__dict__'].__get__(r))
show('getattr_static', lambda: inspect.getattr_static(r, 'readable').__name__)
show('getattr_static of an attribute', lambda: inspect.getattr_static(r, 'done'))
own = js.eval('(function (o) { return Object.keys(o).join() })')
r.b = 2
show('set, seen from JS', lambda: (own(r), js.eval('(function (o) { return o.b })')(r), r.__dict__['b']))
js.eval('(function (o) { o.c = 3 })')(r)
show('set in JS', lambda: (r.c, sorted(r.__dict__)))
del r.b
show('deleted, seen from JS', lambda: (own(r), sorted(vars(r))))
show('__dict__ written', lambda: setattr(r, '__dict__', {}))
with r:
    show('closed inside', lambda: r.closed)
show('closed', lambda: r.closed)


class Lines(js.Map, io.TextIOBase):
    def __init__(self):
        self.left = ['a\n', 'b\n']

    def readline(self):
        return self.left.pop(0) if self.left else ''


show('lines', lambda: Lines().readlines())

for base_of_js in (js.Date, js.Map, js.Object, js.Promise, js.Uint8Array):
    for base in (io.IOBase, io.RawIOBase, io.BufferedIOBase, io.TextIOBase):
        show('%s, %s:' % (base_of_js.__name__, base.__name__), lambda: len(types.new_class('C', (base_of_js, base)).__mro__))
        show('%s, %s, __slots__:' % (base_of_js.__name__, base.__name__), lambda: len(types.new_class('C', (base_of_js, base), None, lambda namespace: namespace.update(__slots__=())).__mro__))

from node.events import EventEmitter
from node.stream import Writable


class Bus(EventEmitter, io.IOBase):
    pass


bus = Bus()
show('Bus', lambda: (isinstance(bus, EventEmitter), isinstance(bus, io.IOBase), bus.closed))
with bus:
    pass
show('Bus closed', lambda: bus.closed)
bus.name = 'b'
show('Bus __dict__', lambda: (type(bus.__dict__).__name__, 'name' in bus.__dict__, 'name' in vars(bus)))


class Sink(Writable, io.RawIOBase):
    def writable(self):
        return True


sink = Sink()
show('Sink', lambda: (isinstance(sink, Writable), isinstance(sink, io.RawIOBase), sink.closed, sink.writable()))
sink.name = 's'
show('Sink __dict__', lambda: (type(sink.__dict__).__name__, 'name' in sink.__dict__, 'name' in vars(sink)))
