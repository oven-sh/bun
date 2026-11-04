# super().name and super().name(...), which the compiler treats on its own: what is found, what it is bound to, what goes wrong and how,
# and that none of it depends on `super` being the built-in.
import builtins
import sys


def show(f, *args):
    try:
        print(' ', f.__qualname__, '=', repr(f(*args)))
    except BaseException as e:
        print(' ', f.__qualname__, '!', type(e).__name__, e)


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


class Other:
    def method(self, *args, **kwargs):
        return ('Other.method', type(self).__name__, args, kwargs)

    def only_other(self):
        return 'only other'


print('--- what is found')


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


c = C()
for name in ('method', 'two', 'past_base', 'get_attr', 'get_method', 'get_prop', 'call_prop', 'static', 'klass', 'other', 'missing', 'missing_call', 'dunder_class', 'keywords', 'chained',
             'stored', 'in_lambda', 'in_comprehension', 'in_generator_expression', 'in_nested', 'set_and_delete'):
    show(getattr(C, name), c)
show(C.cmethod, 5)
show(C.unbound_from_class)
print(' ', list(c.generator()))


class D(C):
    pass


show(C.method, D(), 1)
show(D.cmethod)

print('--- what goes wrong')


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


e = E()
show(E.wrong_self, 5)
show(E.wrong_self, Base())
for name in ('rebound_self', 'deleted_self', 'none_self', 'not_a_type', 'wrong_pair', 'one_argument', 'three_arguments', 'keyword_argument', 'starred', 'varargs', 'cell_self'):
    show(getattr(E, name), e)
show(E.no_arguments)
show(E.keyword_only, *[])


def outside(self):
    return super().method()


show(outside, e)


def empty_cell():
    class F(Base):
        print('   in the body:', end=' ')

        def f(self):
            return super().method()
        show(f, 1)
    return F


empty_cell()

print('--- evaluation order')


def note(x):
    print('   note', x if not isinstance(x, type) else x.__name__)
    return x


class G(Base):
    def f(self):
        return super(note(G), note(self)).method(note(1), note(2))


show(G.f, G())

print('--- super is another thing')


class H(Base):
    def zero(self):
        return super().method()

    def two(self):
        return super(H, self).method()

    def attr_of(self):
        return super().attr


class FakeSuper:
    def __init__(self, *args):
        print('   FakeSuper', [a.__name__ if isinstance(a, type) else a for a in args])

    def method(self):
        return 'fake method'

    attr = 'fake attr'


h = H()
builtins_super = builtins.super
builtins.super = FakeSuper
try:
    for f in (H.zero, H.two, H.attr_of):
        show(f, h)
finally:
    builtins.super = builtins_super
show(H.zero, h)
globals()['super'] = FakeSuper
for f in (H.zero, H.two, H.attr_of):
    show(f, h)
del globals()['super']
show(H.zero, h)
del builtins.super
show(H.zero, h)
builtins.super = builtins_super


class SubSuper(builtins_super):
    def __getattribute__(self, name):
        return ('SubSuper', name)


builtins.super = SubSuper
show(H.two, h)
show(H.attr_of, h)
builtins.super = builtins_super


def local_super(self, super):
    return super().method()


show(local_super, h, lambda: Base())

print('--- classes that change')


class I(Base):
    def f(self):
        return super().method()[0]


i = I()
print(' ', [i.f() for _ in range(3)])
Base.method, saved = (lambda self: ('patched',)), Base.method
print(' ', i.f())
Base.method = saved
I.__bases__ = (Other,)
print(' ', i.f())
I.__bases__ = (Base,)
print(' ', i.f())


class Meta(type):
    def method(cls):
        return 'Meta.method of ' + cls.__name__


class MetaSub(Meta):
    def method(cls):
        return 'MetaSub, ' + super().method()


class J(metaclass=MetaSub):
    pass


print(' ', J.method())


class Proxy:
    def __init__(self, target):
        object.__setattr__(self, 'target', target)

    @property
    def __class__(self):
        return type(object.__getattribute__(self, 'target'))


print(' ', C.get_attr(Proxy(c)), C.two(Proxy(c))[:1])


class Descriptor:
    def __get__(self, instance, owner):
        return ('got', instance, owner.__name__)


class K:
    d = Descriptor()


class L(K):
    def f(self):
        return super().d

    @classmethod
    def g(cls):
        return super().d

    def __repr__(self):
        return '<L>'


print(' ', L().f(), L.g())

print('--- what the code says')


def names_of(f):
    return f.__code__.co_names, f.__code__.co_freevars


print(' ', names_of(C.method), names_of(C.two), names_of(C.get_attr))

print('--- tracebacks')
import traceback


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


for f in (M.f, M.g):
    try:
        f(M())
    except AttributeError as error:
        e = error
        tb = e.__traceback__.tb_next
        code = tb.tb_frame.f_code
        position = list(code.co_positions())[tb.tb_lasti // 2]
        print(' ', f.__qualname__, tb.tb_lineno - code.co_firstlineno, position[0] - code.co_firstlineno, position[1] - code.co_firstlineno, position[2:], e)

print('--- tools')
M_ = sys.monitoring
seen = []


def name_of(x):
    return 'MISSING' if x is M_.MISSING else getattr(x, '__qualname__', None) or repr(x)


def listen():
    M_.use_tool_id(1, 'test')
    for event in ('CALL', 'C_RETURN', 'C_RAISE'):
        M_.register_callback(1, getattr(M_.events, event), lambda code, offset, callable, arg0, event=event: seen.append((event, name_of(callable), name_of(arg0))) if code.co_filename == __file__ and code.co_name != 'stop' else None)
    M_.set_events(1, M_.events.CALL)


def stop():
    M_.set_events(1, 0)
    M_.free_tool_id(1)


for f, args in ((C.method, (c,)), (C.two, (c,)), (C.get_attr, (c,)), (C.missing, (c,)), (E.wrong_self, (5,)), (E.not_a_type, (E(),))):
    seen.clear()
    listen()
    try:
        f(*args)
    except Exception as x:
        seen.append(type(x).__name__)
    finally:
        stop()
    print(' ', f.__qualname__, seen[1:])


def profiler(frame, event, arg):
    if event.startswith('c_'):
        seen.append((event, arg.__name__))


for f in (C.method, C.get_attr):
    seen.clear()
    sys.setprofile(profiler)
    try:
        f(c)
    finally:
        sys.setprofile(None)
    print(' ', f.__qualname__, seen[:-1])
