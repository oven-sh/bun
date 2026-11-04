# __name__ and __qualname__ of a function set to an instance of a class derived from str: messages and repr() go by them.
try:
    class StrSub(str):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class StrSub(str):')


try:
    def show(tag, f):
        try:
            print(tag, '=', f())
        except Exception as e:
            print(tag, '!', type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(tag, f):')


try:
    def free(v):
        def inner():
            return v
        return inner
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def free(v):')


try:
    def f(a):
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def f(a):')


try: f.__qualname__ = StrSub('qual')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: f.__qualname__ = StrSub('qual')")
try: f.__name__ = StrSub('name')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: f.__name__ = StrSub('name')")
try: show('read', lambda: (f.__name__, f.__qualname__, type(f.__name__).__name__, type(f.__qualname__).__name__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('read', lambda: (f.__name__, f.__qualname__, type(f.__name__).__...")
try: show('call', lambda: f())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('call', lambda: f())")
try: show('keyword', lambda: f(1, z=2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('keyword', lambda: f(1, z=2))")
try: show('too many', lambda: f(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('too many', lambda: f(1, 2))")
try: show('twice', lambda: f(1, a=2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('twice', lambda: f(1, a=2))")
try: show('repr', lambda: repr(f).split(' at ')[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('repr', lambda: repr(f).split(' at ')[0])")
try: show('code', lambda: setattr(f, '__code__', free(1).__code__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('code', lambda: setattr(f, '__code__', free(1).__code__))")
try: show('bound', lambda: repr(f.__get__(5)).split(' of ')[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('bound', lambda: repr(f.__get__(5)).split(' of ')[0])")


try:
    class Odd(str):
        def __str__(self):
            return 'str of it'

        def __repr__(self):
            return 'repr of it'

        def __format__(self, spec):
            return 'format of it'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Odd(str):')


try: f.__qualname__ = Odd('odd')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: f.__qualname__ = Odd('odd')")
try: show('call', lambda: f())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('call', lambda: f())")
try: show('repr', lambda: repr(f).split(' at ')[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('repr', lambda: repr(f).split(' at ')[0])")


try:
    def g():
        yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g():')


try: g.__qualname__ = StrSub('gen')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: g.__qualname__ = StrSub('gen')")
try: show('generator', lambda: (repr(g()).split(' at ')[0], type(g().__qualname__).__name__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('generator', lambda: (repr(g()).split(' at ')[0], type(g().__qua...")
