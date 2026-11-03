# Every pair of public built-in types as the bases of a class: which pairs make a class, and why the others do not.
try: import array, ast, builtins, collections, functools, io, itertools, re, struct, types, weakref
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import array, ast, builtins, collections, functools, io, itertools, r...')

try:
    def public_types():
        seen = []
        for module in (builtins, types, collections, functools, itertools, io, weakref, array, ast, struct, re):
            names = sorted(n for n in dir(module) if not n.startswith('_'))
            if module is ast:
                names = ['AST', 'Name', 'expr']
            for name in names:
                value = getattr(module, name)
                if isinstance(value, type) and '__firstlineno__' not in vars(value) and value not in seen:
                    seen.append(value)
        return seen
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def public_types():')

try:
    def label(t):
        return t.__name__ if t.__module__ == 'builtins' else t.__module__ + '.' + t.__name__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def label(t):')

try:
    def classify(message):
        for code, text in (('N', 'is not an acceptable base type'), ('L', 'multiple bases have instance lay-out conflict'),
                           ('M', 'Cannot create a consistent method resolution'), ('D', 'duplicate base class'),
                           ('C', 'metaclass conflict')):
            if text in message:
                return code
        return '?' + message
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def classify(message):')

try: TYPES = public_types()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: TYPES = public_types()')
try: print('len(TYPES) =>', len(TYPES))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(TYPES)')
try: print('types')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'types'")

# Alone.
try: BASES = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: BASES = []')
try:
    for a in TYPES:
        try:
            type('X', (a,), {})
        except TypeError as e:
            print('label(a) [' + 'a=' + (repr(a) if type(a) in (str, int, float, bytes, bool, type(None)) or (type(a) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in a)) else a.__name__ if type(a) is type else type(a).__name__) + '] =>', label(a))
            print('classify(str(e)) [' + 'a=' + (repr(a) if type(a) in (str, int, float, bytes, bool, type(None)) or (type(a) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in a)) else a.__name__ if type(a) is type else type(a).__name__) + '] =>', classify(str(e)))
        else:
            BASES.append(a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for a in TYPES:')

# Most exceptions are laid out as BaseException is; a few of those stand for them all.
try: PLAIN = (ArithmeticError, KeyError, ValueError, Warning)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: PLAIN = (ArithmeticError, KeyError, ValueError, Warning)')
try: BASES = [t for t in BASES if not issubclass(t, BaseException) or t in PLAIN or vars(t).keys() - vars(ValueError).keys()]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: BASES = [t for t in BASES if not issubclass(t, BaseException) or t in...')
try: print('len(BASES) =>', len(BASES))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(BASES)')
try: print('to pair:', "' '.join(map(label, BASES)) =>", ' '.join(map(label, BASES)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ' '.join(map(label, BASES))")
try:
    for a in BASES:
        try: row = {}
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: row = {}')
        for b in BASES:
            try:
                cls = type('X', (a, b), {})
            except TypeError as e:
                code = classify(str(e))
            else:
                code = 'ok:' + label(cls.__base__)
            try: row.setdefault(code, []).append(label(b))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: row.setdefault(code, []).append(label(b))')
        try: print('label(a) [' + 'a=' + (repr(a) if type(a) in (str, int, float, bytes, bool, type(None)) or (type(a) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in a)) else a.__name__ if type(a) is type else type(a).__name__) + '] =>', label(a))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: label(a)')
        for code in sorted(row):
            try: print('   ', 'code [' + 'a=' + (repr(a) if type(a) in (str, int, float, bytes, bool, type(None)) or (type(a) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in a)) else a.__name__ if type(a) is type else type(a).__name__) + ", " + 'code=' + (repr(code) if type(code) in (str, int, float, bytes, bool, type(None)) or (type(code) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in code)) else code.__name__ if type(code) is type else type(code).__name__) + '] =>', code)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: code')
            try: print('len(row[code]) [' + 'a=' + (repr(a) if type(a) in (str, int, float, bytes, bool, type(None)) or (type(a) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in a)) else a.__name__ if type(a) is type else type(a).__name__) + ", " + 'code=' + (repr(code) if type(code) in (str, int, float, bytes, bool, type(None)) or (type(code) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in code)) else code.__name__ if type(code) is type else type(code).__name__) + '] =>', len(row[code]))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(row[code])')
            try: print("' '.join(row[code]) [" + 'a=' + (repr(a) if type(a) in (str, int, float, bytes, bool, type(None)) or (type(a) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in a)) else a.__name__ if type(a) is type else type(a).__name__) + ", " + 'code=' + (repr(code) if type(code) in (str, int, float, bytes, bool, type(None)) or (type(code) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in code)) else code.__name__ if type(code) is type else type(code).__name__) + '] =>', ' '.join(row[code]))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: ' '.join(row[code])")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for a in BASES:')
