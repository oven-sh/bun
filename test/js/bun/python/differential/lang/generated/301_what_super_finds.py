# What super().name(...) calls, by the kind of thing that the class behind has by the name: the result, with and without a tool that is told of calls, and what the tool is told.
#
# Without a tool, a function or a method of a built-in type is called with the instance in front of the arguments, and anything else is bound first and called as it is. While a tool is
# told of calls the `super` object is made, for the tool to be told of that call. What is called then, and how, is the same.
try: import sys, functools, cProfile
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys, functools, cProfile')
try:
    class Callable:
        def __call__(self, *a): return ('Callable', len(a)) + a[-1:]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Callable:')
try:
    class Getter:
        def __get__(self, instance, owner): return lambda *a: ('Getter', type(instance).__name__, owner.__name__) + a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Getter:')
try:
    class GetterOfValue:
        def __get__(self, instance, owner): return len
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class GetterOfValue:')
try:
    class NonData:
        def __init__(self, f): self.f = f
        def __get__(self, instance, owner): return functools.partial(self.f, instance)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NonData:')
try:
    def plain(self, x): return ('plain', type(self).__name__, x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def plain(self, x): return ('plain', type(self).__name__, x)")
try:
    def generator(self, x): yield ('generator', type(self).__name__, x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def generator(self, x): yield ('generator', type(self).__name__, x)")
try:
    class Other:
        def method(self, x): return ('Other.method', type(self).__name__, x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Other:')
try: other = Other()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: other = Other()')
try:
    class Base(list):
        function = plain
        lambda_ = lambda self, x: ('lambda', type(self).__name__, x)
        static = staticmethod(lambda x: ('static', x))
        static_builtin = staticmethod(len)
        class_ = classmethod(lambda cls, x: ('class', cls.__name__, x))
        class_builtin = classmethod(repr)
        prop = property(lambda self: lambda x: ('property', type(self).__name__, x))
        callable_ = Callable()
        partial = functools.partial(plain, 'first')
        partialmethod = functools.partialmethod(plain)
        builtin = len
        builtin_method_of_an_object = [1, 2].count
        bound = other.method
        getter = Getter()
        getter_of_builtin = GetterOfValue()
        nondata = NonData(plain)
        type_ = tuple
        class_of_python = Other
        generator_ = generator
        method_descriptor = list.count
        slot_wrapper = list.__contains__
        method_of_another_type = str.upper
        cached = functools.cached_property(lambda self: lambda x: ('cached', x))
        wrapped = functools.wraps(plain)(lambda self, x: ('wrapped', x))
        def raises(self, x): raise ValueError(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Base(list):')
try: NAMES = [n for n in vars(Base) if not n.startswith('__')]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: NAMES = [n for n in vars(Base) if not n.startswith('__')]")
try: ns = {'Base': Base}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ns = {'Base': Base}")
try: exec('class Derived(Base):\n' + ''.join('    def %s(self, x): return super().%s(x)\n    def two_%s(self, x): return super(Derived, self).%s(x)\n' % (n, n, n, n) for n in NAMES)
     + '    def count(self, x): return super().count(x)\n    def __contains__(self, x): return super().__contains__(x)\n    def __len__(self): return super().__len__()\n'
     + '    def __init__(self, *a): super().__init__(*a)\n    def __new__(cls, *a): return super().__new__(cls)\n    def __repr__(self): return "D" + super().__repr__()\n'
     + '    def __eq__(self, x): return super().__eq__(x)\n    __hash__ = None\n    def append(self, x): return super().append(x)\n    def __getitem__(self, x): return super().__getitem__(x)\n'
     + '    @classmethod\n    def of_class(cls, x): return super().class_(x)\n    @classmethod\n    def function_of_class(cls, x): return super().function(cls, x)\n'
     + '    @classmethod\n    def static_of_class(cls, x): return super().static(x)\n    @classmethod\n    def fromkeys_(cls, x): return super().__subclasshook__(x)\n'
     + '    def missing(self, x): return super().no_such_name(x)\n', ns)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: exec('class Derived(Base):\\n' + ''.join(' def %s(self, x): return sup...")
try: Derived = ns['Derived']
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Derived = ns['Derived']")
try: CALLS = [(n, lambda d, n=n: getattr(d, n)('ab')) for n in NAMES] + [('two_' + n, lambda d, n=n: getattr(d, 'two_' + n)('ab')) for n in NAMES] + [
    ('count', lambda d: d.count(1)), ('__contains__', lambda d: 1 in d), ('__len__', lambda d: len(d)), ('__init__ and __new__', lambda d: Derived([3])), ('__repr__', lambda d: repr(d)),
    ('__eq__', lambda d: d == [1, 1]), ('append', lambda d: (d.append(1), d.pop())), ('__getitem__', lambda d: d[0]), ('of_class', lambda d: d.of_class(5)),
    ('function_of_class', lambda d: Derived.function_of_class(5)), ('static_of_class', lambda d: Derived.static_of_class(5)), ('fromkeys_', lambda d: Derived.fromkeys_(int)), ('missing', lambda d: d.missing(1))]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: CALLS = [(n, lambda d, n=n: getattr(d, n)('ab')) for n in NAMES] + [(...")
try:
    def outcome(call, d):
        try:
            r = call(d)
            if hasattr(r, 'send'): r = list(r)
            return repr(r)
        except Exception as e:
            return '%s: %s' % (type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outcome(call, d):')
try:
    def name_of(f):
        return getattr(f, '__qualname__', None) or type(f).__name__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def name_of(f):')
try:
    def profiled(call, d):
        ev = []
        def pr(frame, event, arg):
            # What the methods of Derived call, and no more.
            if event.startswith('c_'):
                if frame.f_code.co_qualname.startswith('Derived.'): ev.append('%s %s' % (event, name_of(arg)))
            elif frame.f_back.f_code.co_qualname.startswith('Derived.'): ev.append('%s %s' % (event, frame.f_code.co_qualname))
        sys.setprofile(pr)
        try: r = outcome(call, d)
        finally: sys.setprofile(None)
        return r, ev
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def profiled(call, d):')
try: M = sys.monitoring
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: M = sys.monitoring')
try: EV = M.events
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: EV = M.events')
try:
    def monitored(call, d, answer=None):
        ev = []
        def arg0(a): return 'MISSING' if a is M.MISSING else type(a).__name__
        M.use_tool_id(3, 'test')
        def told(kind):
            def callback(code, offset, f, a):
                ev.append('%s %s(%s)' % (kind, name_of(f), arg0(a)))
                return answer if kind == 'CALL' else None
            return callback
        M.register_callback(3, EV.CALL, told('CALL')); M.register_callback(3, EV.C_RETURN, told('C_RETURN')); M.register_callback(3, EV.C_RAISE, told('C_RAISE'))
        for c in (f.__code__ for f in vars(Derived).values() if hasattr(f, '__code__')): M.set_local_events(3, c, EV.CALL)
        for c in (f.__func__.__code__ for f in vars(Derived).values() if isinstance(f, classmethod)): M.set_local_events(3, c, EV.CALL)
        try: r = [outcome(call, d), outcome(call, d)]
        finally:
            for c in (f.__code__ for f in vars(Derived).values() if hasattr(f, '__code__')): M.set_local_events(3, c, 0)
            for c in (f.__func__.__code__ for f in vars(Derived).values() if isinstance(f, classmethod)): M.set_local_events(3, c, 0)
            for e in (EV.CALL, EV.C_RETURN, EV.C_RAISE): M.register_callback(3, e, None)
            M.free_tool_id(3)
            M.restart_events()
        return r, ev
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def monitored(call, d, answer=None):')
try:
    def under_cprofile(call, d):
        p = cProfile.Profile(); p.enable()
        try: return outcome(call, d)
        finally: p.disable()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def under_cprofile(call, d):')
try:
    def rows():
        for name, call in CALLS:
            d = Derived([1, 1])
            plainly = outcome(call, d)
            yield '%s: %s' % (name, plainly)
            r, ev = profiled(call, d)
            yield '    setprofile: %s | %s' % ('the same' if r == plainly else r, ', '.join(ev))
            r, ev = monitored(call, d)
            yield '    monitoring: %s | %s' % ('the same' if r == [plainly] * 2 else r, ', '.join(ev))
            r, ev = monitored(call, d, M.DISABLE)
            yield '    monitoring, DISABLE: %s | %s' % ('the same' if r == [plainly] * 2 else r, ', '.join(ev))
            r = under_cprofile(call, d)
            yield '    cProfile: %s' % ('the same' if r == plainly else r)
            r = outcome(call, d)
            yield '    afterwards: %s' % ('the same' if r == plainly else r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def rows():')
try: print('\n'.join(rows()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '\\n'.join(rows())")
