# A key that is no str in the dict of a class is asked whether it is '__new__' when __new__ is assigned in a base of that class, or __bases__.
# What it raises comes out of the assignment, which has taken place. (type.__setattr__ is called as a function: behind a statement CPython leaves
# the exception for the next call that looks.)
try: import warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import warnings')
try: warnings.simplefilter('ignore')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore')")

try:
    def g(cls, *args):
        return object.__new__(cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def g(cls, *args):')

try:
    def show(what, act):
        try:
            act()
            print(what, '| went through')
        except BaseException as e:
            print(what, '|', type(e).__name__, e, '| cause', repr(e.__cause__), '| context', repr(e.__context__), e.__suppress_context__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def show(what, act):')

try:
    class Key:
        armed = False
        asked = 0
        def __hash__(self):
            return hash('__new__')
        def __eq__(self, other):
            Key.asked += 1
            if Key.armed:
                raise KeyError('from the key')
            return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Key:')

try:
    class A: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A: pass')
try:
    class B: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class B: pass')
try:
    class Root(A): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Root(A): pass')
try:
    class Before(Root): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Before(Root): pass')
try: Sub = type('Sub', (Root,), {Key(): 1})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Sub = type('Sub', (Root,), {Key(): 1})")
try:
    class After(Root): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class After(Root): pass')
try:
    class Under(Sub): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Under(Sub): pass')

try: Key.armed = True
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Key.armed = True')
try: show('set', lambda: type.__setattr__(Root, '__new__', g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('set', lambda: type.__setattr__(Root, '__new__', g))")
try: print(Root.__new__ is g)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Root.__new__ is g')
try: show('delete', lambda: type.__delattr__(Root, '__new__'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('delete', lambda: type.__delattr__(Root, '__new__'))")
try: print('__new__' in Root.__dict__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: '__new__' in Root.__dict__")
try: show('__bases__', lambda: type.__setattr__(Root, '__bases__', (B,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('__bases__', lambda: type.__setattr__(Root, '__bases__', (B,)))")
try: print('Root.__bases__ =>', Root.__bases__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Root.__bases__')
try: print('Sub.__mro__ =>', Sub.__mro__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Sub.__mro__')
try: Key.armed = False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Key.armed = False')
try: show('set', lambda: type.__setattr__(Root, '__new__', g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: show('set', lambda: type.__setattr__(Root, '__new__', g))")
try: print([type(c()).__name__ for c in (Root, Before, Sub, After, Under)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [type(c()).__name__ for c in (Root, Before, Sub, After, Under)]')

# A key that assigns again each time it is asked. What ends it is the end of the stack, and that has to end all the assignments it is called from.
try:
    class Again:
        asked = 0
        limit = 0
        def __hash__(self):
            return hash('__new__')
        def __eq__(self, other):
            Again.asked += 1
            if Again.asked <= Again.limit:
                type.__setattr__(Top, '__new__', g)
            return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Again:')
try:
    class Top: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Top: pass')
try: Low = type('Low', (Top,), {Again(): 1})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Low = type('Low', (Top,), {Again(): 1})")
try:
    for limit in (0, 1, 2, 5, 18, 10 ** 9):
        try: Again.asked, Again.limit = 0, limit
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Again.asked, Again.limit = 0, limit')
        try:
            type.__setattr__(Top, '__new__', g)
            print('limit [' + 'limit=' + (repr(limit) if type(limit) in (str, int, float, bytes, bool, type(None)) or (type(limit) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in limit)) else limit.__name__ if type(limit) is type else type(limit).__name__) + '] =>', limit)
            print('went through')
        except SystemError as e:
            depth = 0
            while isinstance(e, SystemError):
                depth += 1
                e = e.__cause__
            print('limit [' + 'limit=' + (repr(limit) if type(limit) in (str, int, float, bytes, bool, type(None)) or (type(limit) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in limit)) else limit.__name__ if type(limit) is type else type(limit).__name__) + '] =>', limit)
            print('SystemError', 'depth > 100 [' + 'limit=' + (repr(limit) if type(limit) in (str, int, float, bytes, bool, type(None)) or (type(limit) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in limit)) else limit.__name__ if type(limit) is type else type(limit).__name__) + '] =>', depth > 100)
            print('type(e).__name__ [' + 'limit=' + (repr(limit) if type(limit) in (str, int, float, bytes, bool, type(None)) or (type(limit) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in limit)) else limit.__name__ if type(limit) is type else type(limit).__name__) + '] =>', type(e).__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for limit in (0, 1, 2, 5, 18, 10 ** 9):')
