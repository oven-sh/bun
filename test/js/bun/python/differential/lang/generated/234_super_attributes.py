# super().name and super().name(...), which the compiler treats on its own: what is found, what it is bound to, what goes wrong and how,
# and that none of it depends on `super` being the built-in.
try: import builtins
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import builtins')
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')


try:
    def show(f, *args):
        try:
            print(' ', f.__qualname__, '=', repr(f(*args)))
        except BaseException as e:
            print(' ', f.__qualname__, '!', type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(f, *args):')


try:
    class Base:
        attr = 'base attr'

        def method(self, *args, **kwargs):
            return ('Base.method', type(self).__name__, args, kwargs)

        @classmethod
        def cmethod(cls, *args):
            return ('Base.cmethod', cls.__name__, args)

        @staticmethod
        def smethod(*args):
            return ('Base.smethod', args)

        @property
        def prop(self):
            return ('Base.prop', type(self).__name__)

        def __getattr__(self, name):
            return ('Base.__getattr__', name)

        def __repr__(self):
            return '<%s>' % type(self).__name__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Base:')


try:
    class Other:
        def method(self, *args, **kwargs):
            return ('Other.method', type(self).__name__, args, kwargs)

        def only_other(self):
            return 'only other'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Other:')


try: print('--- what is found')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- what is found'")


try:
    class C(Base, Other):
        attr = 'C attr'

        def method(self, *args, **kwargs):
            return ('C.method',) + super().method(*args, **kwargs)

        def two(self, *args):
            return super(C, self).method(*args)

        def past_base(self):
            return super(Base, self).method()

        def get_attr(self):
            return super().attr

        def get_method(self):
            m = super().method
            return type(m).__name__, m.__self__ is self, m.__func__ is Base.method, m(1)

        def get_prop(self):
            return super().prop

        def call_prop(self):
            return super().prop()

        def static(self):
            return super().smethod(1), super().smethod is Base.smethod

        def klass(self):
            return super().cmethod(1), super().cmethod.__self__.__name__

        @classmethod
        def cmethod(cls, *args):
            return ('C.cmethod',) + super().cmethod(*args)

        @classmethod
        def unbound_from_class(cls):
            return super().method is Base.method, super().method(C(), 2)

        def other(self):
            return super().only_other()

        def missing(self):
            return super().nothing

        def missing_call(self):
            return super().nothing()

        def dunder_class(self):
            return super().__class__, super(C, self).__class__

        def keywords(self):
            return super().method(1, *[2, 3], k=4, **{'m': 5})

        def chained(self):
            return super().method().__len__(), super().attr.upper(), super().method()[0]

        def stored(self):
            s = super()
            return s.method(), type(s).__name__

        def in_lambda(self):
            return (lambda self: super().attr)(self), (lambda: super(C, self).attr)()

        def in_comprehension(self):
            return [super().attr for _ in range(2)], [super(C, self).attr for _ in range(1)]

        def in_generator_expression(self):
            return list(super(C, self).attr for _ in range(1))

        def in_nested(self):
            def inner(me):
                return super().attr
            return inner(self)

        def generator(self):
            yield super().attr
            yield super().method(1)

        def set_and_delete(self):
            try:
                super().x = 1
            except AttributeError as e:
                print('   ', e)
            try:
                del super().attr
            except AttributeError as e:
                print('   ', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C(Base, Other):')


try: c = C()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = C()')
try:
    for name in ('method', 'two', 'past_base', 'get_attr', 'get_method', 'get_prop', 'call_prop', 'static', 'klass', 'other', 'missing', 'missing_call', 'dunder_class', 'keywords', 'chained',
                 'stored', 'in_lambda', 'in_comprehension', 'in_generator_expression', 'in_nested', 'set_and_delete'):
        try: show(getattr(C, name), c)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(getattr(C, name), c)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for name in ('method', 'two', 'past_base', 'get_attr', 'get_method', ...")
try: show(C.cmethod, 5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(C.cmethod, 5)')
try: show(C.unbound_from_class)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(C.unbound_from_class)')
try: print(' ', 'list(c.generator()) =>', list(c.generator()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(c.generator())')


try:
    class D(C):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class D(C):')


try: show(C.method, D(), 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(C.method, D(), 1)')
try: show(D.cmethod)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(D.cmethod)')

try: print('--- what goes wrong')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- what goes wrong'")


try:
    class E(Base):
        def wrong_self(self):
            return super().method()

        def rebound_self(self):
            self = 5
            return super().method()

        def deleted_self(self):
            del self
            return super().method()

        def none_self(self):
            self = None
            return super().method

        def not_a_type(self):
            return super(5, self).method()

        def wrong_pair(self):
            return super(Other, self).method()

        def one_argument(self):
            return super(E).method

        def three_arguments(self):
            return super(E, self, 1).method

        def keyword_argument(self):
            return super(type=E).method

        def starred(self):
            return super(*(E, self)).method()

        def no_arguments():
            return super().method()

        def varargs(*args):
            return super().method()

        def keyword_only(*, self):
            return super().method()

        def cell_self(self):
            def inner():
                return self
            return super().method(), inner() is self
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E(Base):')


try: e = E()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: e = E()')
try: show(E.wrong_self, 5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(E.wrong_self, 5)')
try: show(E.wrong_self, Base())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(E.wrong_self, Base())')
try:
    for name in ('rebound_self', 'deleted_self', 'none_self', 'not_a_type', 'wrong_pair', 'one_argument', 'three_arguments', 'keyword_argument', 'starred', 'varargs', 'cell_self'):
        try: show(getattr(E, name), e)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(getattr(E, name), e)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for name in ('rebound_self', 'deleted_self', 'none_self', 'not_a_type...")
try: show(E.no_arguments)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(E.no_arguments)')
try: show(E.keyword_only, *[])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(E.keyword_only, *[])')


try:
    def outside(self):
        return super().method()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outside(self):')


try: show(outside, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(outside, e)')


try:
    def empty_cell():
        class F(Base):
            print('   in the body:', end=' ')

            def f(self):
                return super().method()
            show(f, 1)
        return F
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def empty_cell():')


try: empty_cell()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: empty_cell()')

try: print('--- evaluation order')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- evaluation order'")


try:
    def note(x):
        print('   note', x if not isinstance(x, type) else x.__name__)
        return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def note(x):')


try:
    class G(Base):
        def f(self):
            return super(note(G), note(self)).method(note(1), note(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class G(Base):')


try: show(G.f, G())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(G.f, G())')

try: print('--- super is another thing')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- super is another thing'")


try:
    class H(Base):
        def zero(self):
            return super().method()

        def two(self):
            return super(H, self).method()

        def attr_of(self):
            return super().attr
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class H(Base):')


try:
    class FakeSuper:
        def __init__(self, *args):
            print('   FakeSuper', [a.__name__ if isinstance(a, type) else a for a in args])

        def method(self):
            return 'fake method'

        attr = 'fake attr'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class FakeSuper:')


try: h = H()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h = H()')
try: builtins_super = builtins.super
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: builtins_super = builtins.super')
try: builtins.super = FakeSuper
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: builtins.super = FakeSuper')
try:
    try:
        for f in (H.zero, H.two, H.attr_of):
            show(f, h)
    finally:
        builtins.super = builtins_super
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: show(H.zero, h)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(H.zero, h)')
try: globals()['super'] = FakeSuper
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: globals()['super'] = FakeSuper")
try:
    for f in (H.zero, H.two, H.attr_of):
        try: show(f, h)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(f, h)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (H.zero, H.two, H.attr_of):')
try: del globals()['super']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: del globals()['super']")
try: show(H.zero, h)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(H.zero, h)')
try: del builtins.super
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del builtins.super')
try: show(H.zero, h)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(H.zero, h)')
try: builtins.super = builtins_super
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: builtins.super = builtins_super')


try:
    class SubSuper(builtins_super):
        def __getattribute__(self, name):
            return ('SubSuper', name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class SubSuper(builtins_super):')


try: builtins.super = SubSuper
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: builtins.super = SubSuper')
try: show(H.two, h)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(H.two, h)')
try: show(H.attr_of, h)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(H.attr_of, h)')
try: builtins.super = builtins_super
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: builtins.super = builtins_super')


try:
    def local_super(self, super):
        return super().method()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def local_super(self, super):')


try: show(local_super, h, lambda: Base())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: show(local_super, h, lambda: Base())')

try: print('--- classes that change')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- classes that change'")


try:
    class I(Base):
        def f(self):
            return super().method()[0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class I(Base):')


try: i = I()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i = I()')
try: print(' ', '[i.f() for _ in range(3)] =>', [i.f() for _ in range(3)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [i.f() for _ in range(3)]')
try: Base.method, saved = (lambda self: ('patched',)), Base.method
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Base.method, saved = (lambda self: ('patched',)), Base.method")
try: print(' ', 'i.f() =>', i.f())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i.f()')
try: Base.method = saved
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base.method = saved')
try: I.__bases__ = (Other,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: I.__bases__ = (Other,)')
try: print(' ', 'i.f() =>', i.f())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i.f()')
try: I.__bases__ = (Base,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: I.__bases__ = (Base,)')
try: print(' ', 'i.f() =>', i.f())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i.f()')


try:
    class Meta(type):
        def method(cls):
            return 'Meta.method of ' + cls.__name__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Meta(type):')


try:
    class MetaSub(Meta):
        def method(cls):
            return 'MetaSub, ' + super().method()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class MetaSub(Meta):')


try:
    class J(metaclass=MetaSub):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class J(metaclass=MetaSub):')


try: print(' ', 'J.method() =>', J.method())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: J.method()')


try:
    class Proxy:
        def __init__(self, target):
            object.__setattr__(self, 'target', target)

        @property
        def __class__(self):
            return type(object.__getattribute__(self, 'target'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Proxy:')


try: print(' ', 'C.get_attr(Proxy(c)) =>', C.get_attr(Proxy(c)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C.get_attr(Proxy(c))')
try: print('C.two(Proxy(c))[:1] =>', C.two(Proxy(c))[:1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C.two(Proxy(c))[:1]')


try:
    class Descriptor:
        def __get__(self, instance, owner):
            return ('got', instance, owner.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Descriptor:')


try:
    class K:
        d = Descriptor()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class K:')


try:
    class L(K):
        def f(self):
            return super().d

        @classmethod
        def g(cls):
            return super().d

        def __repr__(self):
            return '<L>'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class L(K):')


try: print(' ', 'L().f() =>', L().f())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: L().f()')
try: print('L.g() =>', L.g())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: L.g()')

try: print('--- what the code says')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- what the code says'")


try:
    def names_of(f):
        return f.__code__.co_names, f.__code__.co_freevars
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def names_of(f):')


try: print(' ', 'names_of(C.method) =>', names_of(C.method))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names_of(C.method)')
try: print('names_of(C.two) =>', names_of(C.two))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names_of(C.two)')
try: print('names_of(C.get_attr) =>', names_of(C.get_attr))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names_of(C.get_attr)')

try: print('--- tracebacks')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- tracebacks'")
try: import traceback
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import traceback')


try:
    class M(Base):
        def f(self):
            return super().nothing_here(
                1)

        def g(self):
            return (super()
                    .method
                    .nothing)

        def __getattr__(self, name):
            raise AttributeError(name)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class M(Base):')


try:
    for f in (M.f, M.g):
        try:
            f(M())
        except AttributeError as error:
            e = error
            tb = e.__traceback__.tb_next
            code = tb.tb_frame.f_code
            position = list(code.co_positions())[tb.tb_lasti // 2]
            print(' ', 'f.__qualname__ [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f.__qualname__)
            print('tb.tb_lineno - code.co_firstlineno [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', tb.tb_lineno - code.co_firstlineno)
            print('position[0] - code.co_firstlineno [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', position[0] - code.co_firstlineno)
            print('position[1] - code.co_firstlineno [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', position[1] - code.co_firstlineno)
            print('position[2:] [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', position[2:])
            print('e [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (M.f, M.g):')

try: print('--- tools')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '--- tools'")
try: M_ = sys.monitoring
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M_ = sys.monitoring')
try: seen = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen = []')


try:
    def name_of(x):
        return 'MISSING' if x is M_.MISSING else getattr(x, '__qualname__', None) or repr(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def name_of(x):')


try:
    def listen():
        M_.use_tool_id(1, 'test')
        for event in ('CALL', 'C_RETURN', 'C_RAISE'):
            M_.register_callback(1, getattr(M_.events, event), lambda code, offset, callable, arg0, event=event: seen.append((event, name_of(callable), name_of(arg0))) if code.co_filename == __file__ and code.co_name != 'stop' else None)
        M_.set_events(1, M_.events.CALL)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def listen():')


try:
    def stop():
        M_.set_events(1, 0)
        M_.free_tool_id(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def stop():')


try:
    for f, args in ((C.method, (c,)), (C.two, (c,)), (C.get_attr, (c,)), (C.missing, (c,)), (E.wrong_self, (5,)), (E.not_a_type, (E(),))):
        try: seen.clear()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen.clear()')
        try: listen()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: listen()')
        try:
            f(*args)
        except Exception as x:
            seen.append(type(x).__name__)
        finally:
            stop()
        try: print(' ', 'f.__qualname__ [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + ", " + 'args=' + (repr(args) if type(args) in (str, int, float, bytes, bool, type(None)) or (type(args) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in args)) else args.__name__ if type(args) is type else type(args).__name__) + '] =>', f.__qualname__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__qualname__')
        try: print('seen[1:] [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + ", " + 'args=' + (repr(args) if type(args) in (str, int, float, bytes, bool, type(None)) or (type(args) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in args)) else args.__name__ if type(args) is type else type(args).__name__) + '] =>', seen[1:])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen[1:]')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f, args in ((C.method, (c,)), (C.two, (c,)), (C.get_attr, (c,)), ...')


try:
    def profiler(frame, event, arg):
        if event.startswith('c_'):
            seen.append((event, arg.__name__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def profiler(frame, event, arg):')


try:
    for f in (C.method, C.get_attr):
        try: seen.clear()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen.clear()')
        try: sys.setprofile(profiler)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.setprofile(profiler)')
        try:
            f(c)
        finally:
            sys.setprofile(None)
        try: print(' ', 'f.__qualname__ [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', f.__qualname__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f.__qualname__')
        try: print('seen[:-1] [' + 'f=' + (repr(f) if type(f) in (str, int, float, bytes, bool, type(None)) or (type(f) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in f)) else f.__name__ if type(f) is type else type(f).__name__) + '] =>', seen[:-1])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen[:-1]')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (C.method, C.get_attr):')
