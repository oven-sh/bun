# A class changes: every class derived from it answers anew, whatever it had been asked before, however many ways lead
# to it and however deep it lies.

try:
    def asked(classes, name):
        return [getattr(c, name, 'none') for c in classes]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def asked(classes, name):')

# A lattice: each level has two classes, and each of them derives from both of the level above. The ways from Base to
# the last level double with every level.
try:
    def lattice(levels):
        class Base: pass
        rows = [(Base,)]
        a = b = Base
        for i in range(levels):
            bases = (a,) if a is b else (a, b)
            a, b = type('A%d' % i, bases, {}), type('B%d' % i, bases, {})
            rows.append((a, b))
        return Base, [c for row in rows for c in row]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def lattice(levels):')

try:
    for levels in (1, 2, 5, 30, 200):
        try: Base, classes = lattice(levels)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base, classes = lattice(levels)')
        try: instances = [c() for c in classes]
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: instances = [c() for c in classes]')
        try: print('levels [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', levels)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: levels')
        try: print('len(classes) [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', len(classes))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(classes)')
        try: print("set(asked(classes, 'x')) [" + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', set(asked(classes, 'x')))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: set(asked(classes, 'x'))")
        try: print("set(asked(instances, 'x')) [" + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', set(asked(instances, 'x')))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: set(asked(instances, 'x'))")
        try: Base.x = 1
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base.x = 1')
        try: print('levels [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', levels)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: levels')
        try: print("set(asked(classes, 'x')) [" + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', set(asked(classes, 'x')))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: set(asked(classes, 'x'))")
        try: print("set(asked(instances, 'x')) [" + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', set(asked(instances, 'x')))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: set(asked(instances, 'x'))")
        try: Base.x = 2
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base.x = 2')
        try: print('levels [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', levels)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: levels')
        try: print("set(asked(classes, 'x')) [" + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', set(asked(classes, 'x')))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: set(asked(classes, 'x'))")
        try: print("set(asked(instances, 'x')) [" + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', set(asked(instances, 'x')))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: set(asked(instances, 'x'))")
        try: middle = classes[len(classes) // 2]
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: middle = classes[len(classes) // 2]')
        try: middle.x = 3
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: middle.x = 3')
        try: print('levels [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', levels)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: levels')
        try: print('middle.__name__ [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', middle.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: middle.__name__')
        try: print("sorted(set(asked(classes, 'x'))) [" + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', sorted(set(asked(classes, 'x'))))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: sorted(set(asked(classes, 'x')))")
        try: print("asked(classes, 'x').count(3) [" + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', asked(classes, 'x').count(3))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked(classes, 'x').count(3)")
        try: print("asked(instances, 'x').count(3) [" + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', asked(instances, 'x').count(3))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked(instances, 'x').count(3)")
        try: del middle.x
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del middle.x')
        try: print('levels [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', levels)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: levels')
        try: print("set(asked(classes, 'x')) [" + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', set(asked(classes, 'x')))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: set(asked(classes, 'x'))")
        try: del Base.x
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del Base.x')
        try: print('levels [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', levels)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: levels')
        try: print("set(asked(classes, 'x')) [" + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', set(asked(classes, 'x')))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: set(asked(classes, 'x'))")
        try: print("set(asked(instances, 'x')) [" + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', set(asked(instances, 'x')))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: set(asked(instances, 'x'))")
        # What the interpreter looks up by itself. (CPython goes every way there is for these, so not for the tall ones.)
        if levels > 5:
            continue
        try:
            print('len(instances[-1]) [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', len(instances[-1]))
        except TypeError as e:
            print('e [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', e)
        try: Base.__len__ = lambda self: 7
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base.__len__ = lambda self: 7')
        try: print('levels [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', levels)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: levels')
        try: print('{len(o) for o in instances} [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', {len(o) for o in instances})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {len(o) for o in instances}')
        try: print('{bool(o) for o in instances} [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', {bool(o) for o in instances})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {bool(o) for o in instances}')
        try: Base.__len__ = lambda self: 0
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base.__len__ = lambda self: 0')
        try: print('levels [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', levels)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: levels')
        try: print('{len(o) for o in instances} [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', {len(o) for o in instances})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {len(o) for o in instances}')
        try: print('{bool(o) for o in instances} [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', {bool(o) for o in instances})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {bool(o) for o in instances}')
        try: Base.__bool__ = lambda self: True
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base.__bool__ = lambda self: True')
        try: print('levels [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', levels)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: levels')
        try: print('{bool(o) for o in instances} [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', {bool(o) for o in instances})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {bool(o) for o in instances}')
        try: del Base.__len__, Base.__bool__
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del Base.__len__, Base.__bool__')
        try: print('levels [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', levels)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: levels')
        try: print('{bool(o) for o in instances} [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', {bool(o) for o in instances})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {bool(o) for o in instances}')
        try: print("{hasattr(o, '__len__') for o in instances} [" + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', {hasattr(o, '__len__') for o in instances})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: {hasattr(o, '__len__') for o in instances}")
        try: Base.__getattr__ = lambda self, name: name.upper()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base.__getattr__ = lambda self, name: name.upper()')
        try: print('levels [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', levels)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: levels')
        try: print('{o.y for o in instances} [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', {o.y for o in instances})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {o.y for o in instances}')
        try: del Base.__getattr__
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del Base.__getattr__')
        try: print('levels [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', levels)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: levels')
        try: print("set(asked(instances, 'y')) [" + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', set(asked(instances, 'y')))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: set(asked(instances, 'y'))")
        try: Base.__init__ = lambda self, *a: setattr(self, 'made', len(a))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Base.__init__ = lambda self, *a: setattr(self, 'made', len(a))")
        try: print('levels [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', levels)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: levels')
        try: print('{c(1, 2).made for c in classes} [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', {c(1, 2).made for c in classes})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {c(1, 2).made for c in classes}')
        try: del Base.__init__
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del Base.__init__')
        try: Base.__call__ = lambda self: 'called'
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Base.__call__ = lambda self: 'called'")
        try: print('levels [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', levels)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: levels')
        try: print('{o() for o in instances} [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', {o() for o in instances})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {o() for o in instances}')
        try: print('{callable(o) for o in instances} [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', {callable(o) for o in instances})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {callable(o) for o in instances}')
        try: del Base.__call__
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del Base.__call__')
        try: print('levels [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', levels)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: levels')
        try: print('{callable(o) for o in instances} [' + 'levels=' + (repr(levels) if type(levels) in (str, int, float, bytes, bool, type(None)) or (type(levels) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in levels)) else levels.__name__ if type(levels) is type else type(levels).__name__) + '] =>', {callable(o) for o in instances})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {callable(o) for o in instances}')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for levels in (1, 2, 5, 30, 200):')

# A chain. With the MRO that Python makes, a chain of n classes takes n * n / 2 entries; this metaclass keeps each at two,
# so a class at the end finds nothing of Root's, but is told of every change all the same.
try:
    class Short(type):
        def mro(cls):
            return [cls, object]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Short(type):')

try:
    for depth in (10, 3000):
        class Root(metaclass=Short): pass
        try: c = Root
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = Root')
        for i in range(depth):
            try: c = Short('C', (c,), {})
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: c = Short('C', (c,), {})")
        try: print('depth [' + 'depth=' + (repr(depth) if type(depth) in (str, int, float, bytes, bool, type(None)) or (type(depth) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in depth)) else depth.__name__ if type(depth) is type else type(depth).__name__) + '] =>', depth)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: depth')
        try: print("getattr(c, 'x', 'none') [" + 'depth=' + (repr(depth) if type(depth) in (str, int, float, bytes, bool, type(None)) or (type(depth) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in depth)) else depth.__name__ if type(depth) is type else type(depth).__name__) + '] =>', getattr(c, 'x', 'none'))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: getattr(c, 'x', 'none')")
        try: print("getattr(Root, 'x', 'none') [" + 'depth=' + (repr(depth) if type(depth) in (str, int, float, bytes, bool, type(None)) or (type(depth) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in depth)) else depth.__name__ if type(depth) is type else type(depth).__name__) + '] =>', getattr(Root, 'x', 'none'))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: getattr(Root, 'x', 'none')")
        try: Root.x = 1
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Root.x = 1')
        try: print('depth [' + 'depth=' + (repr(depth) if type(depth) in (str, int, float, bytes, bool, type(None)) or (type(depth) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in depth)) else depth.__name__ if type(depth) is type else type(depth).__name__) + '] =>', depth)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: depth')
        try: print("getattr(c, 'x', 'none') [" + 'depth=' + (repr(depth) if type(depth) in (str, int, float, bytes, bool, type(None)) or (type(depth) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in depth)) else depth.__name__ if type(depth) is type else type(depth).__name__) + '] =>', getattr(c, 'x', 'none'))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: getattr(c, 'x', 'none')")
        try: print('Root.x [' + 'depth=' + (repr(depth) if type(depth) in (str, int, float, bytes, bool, type(None)) or (type(depth) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in depth)) else depth.__name__ if type(depth) is type else type(depth).__name__) + '] =>', Root.x)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Root.x')
        try: Root.__len__ = lambda self: 3
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Root.__len__ = lambda self: 3')
        try: print('depth [' + 'depth=' + (repr(depth) if type(depth) in (str, int, float, bytes, bool, type(None)) or (type(depth) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in depth)) else depth.__name__ if type(depth) is type else type(depth).__name__) + '] =>', depth)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: depth')
        try: print('len(Root()) [' + 'depth=' + (repr(depth) if type(depth) in (str, int, float, bytes, bool, type(None)) or (type(depth) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in depth)) else depth.__name__ if type(depth) is type else type(depth).__name__) + '] =>', len(Root()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(Root())')
        try: print("hasattr(c(), '__len__') [" + 'depth=' + (repr(depth) if type(depth) in (str, int, float, bytes, bool, type(None)) or (type(depth) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in depth)) else depth.__name__ if type(depth) is type else type(depth).__name__) + '] =>', hasattr(c(), '__len__'))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: hasattr(c(), '__len__')")
        try: del Root.x, Root.__len__
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del Root.x, Root.__len__')
        try: print('depth [' + 'depth=' + (repr(depth) if type(depth) in (str, int, float, bytes, bool, type(None)) or (type(depth) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in depth)) else depth.__name__ if type(depth) is type else type(depth).__name__) + '] =>', depth)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: depth')
        try: print("getattr(Root, 'x', 'none') [" + 'depth=' + (repr(depth) if type(depth) in (str, int, float, bytes, bool, type(None)) or (type(depth) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in depth)) else depth.__name__ if type(depth) is type else type(depth).__name__) + '] =>', getattr(Root, 'x', 'none'))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: getattr(Root, 'x', 'none')")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for depth in (10, 3000):')

# A chain with the MROs that Python makes.
try:
    class Root: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Root: pass')
try: chain = [Root]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: chain = [Root]')
try:
    for i in range(400):
        try: chain.append(type('C%d' % i, (chain[-1],), {}))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: chain.append(type('C%d' % i, (chain[-1],), {}))")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(400):')
try: print(set(asked(chain, 'x')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: set(asked(chain, 'x'))")
try: Root.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Root.x = 1')
try: print(set(asked(chain, 'x')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: set(asked(chain, 'x'))")
try: chain[200].x = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: chain[200].x = 2')
try: print("asked(chain, 'x').count(1) =>", asked(chain, 'x').count(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked(chain, 'x').count(1)")
try: print("asked(chain, 'x').count(2) =>", asked(chain, 'x').count(2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked(chain, 'x').count(2)")
try: del chain[200].x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del chain[200].x')
try: print(set(asked(chain, 'x')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: set(asked(chain, 'x'))")

# Two classes, each with the other in an MRO of its own making, and each derived from the other by __bases__.
try:
    class Loop(type):
        other = None
        def mro(cls):
            return [cls] + ([Loop.other] if Loop.other else []) + [object]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Loop(type):')
try:
    class P(metaclass=Loop): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class P(metaclass=Loop): pass')
try: Loop.other = P
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Loop.other = P')
try:
    class Q(metaclass=Loop): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Q(metaclass=Loop): pass')
try: Loop.other = Q
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Loop.other = Q')
try:
    class Holder(metaclass=Loop): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Holder(metaclass=Loop): pass')
try: P.__bases__ = (Holder,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.__bases__ = (Holder,)')
try: print('[c.__name__ for c in P.__mro__] =>', [c.__name__ for c in P.__mro__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in P.__mro__]')
try: print('[c.__name__ for c in Q.__mro__] =>', [c.__name__ for c in Q.__mro__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in Q.__mro__]')
try: print("getattr(P, 'x', 'none') =>", getattr(P, 'x', 'none'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: getattr(P, 'x', 'none')")
try: print("getattr(Q, 'x', 'none') =>", getattr(Q, 'x', 'none'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: getattr(Q, 'x', 'none')")
try: Q.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Q.x = 1')
try: print("getattr(P, 'x', 'none') =>", getattr(P, 'x', 'none'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: getattr(P, 'x', 'none')")
try: print("getattr(Q, 'x', 'none') =>", getattr(Q, 'x', 'none'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: getattr(Q, 'x', 'none')")
try: P.x = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: P.x = 2')
try: print("getattr(P, 'x', 'none') =>", getattr(P, 'x', 'none'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: getattr(P, 'x', 'none')")
try: print("getattr(Q, 'x', 'none') =>", getattr(Q, 'x', 'none'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: getattr(Q, 'x', 'none')")
try: del Q.x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del Q.x')
try: print("getattr(P, 'x', 'none') =>", getattr(P, 'x', 'none'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: getattr(P, 'x', 'none')")
try: print("getattr(Q, 'x', 'none') =>", getattr(Q, 'x', 'none'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: getattr(Q, 'x', 'none')")
try: del P.x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del P.x')
try: print("getattr(P, 'x', 'none') =>", getattr(P, 'x', 'none'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: getattr(P, 'x', 'none')")
try: print("getattr(Q, 'x', 'none') =>", getattr(Q, 'x', 'none'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: getattr(Q, 'x', 'none')")

# Classes that have died, and classes that come while the others are asked.
try: import gc
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import gc')
try: Base, classes = lattice(6)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base, classes = lattice(6)')
try: kept = classes[:5]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kept = classes[:5]')
try: del classes
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del classes')
try: gc.collect()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gc.collect()')
try: Base.x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base.x = 1')
try: print("set(asked(kept, 'x')) =>", set(asked(kept, 'x')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: set(asked(kept, 'x'))")
try: print('len(Base.__subclasses__()) =>', len(Base.__subclasses__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(Base.__subclasses__())')
try: late = type('Late', (kept[-1], kept[-2]), {})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: late = type('Late', (kept[-1], kept[-2]), {})")
try: print(late.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: late.x')
try: Base.x = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base.x = 2')
try: print('late.x =>', late.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: late.x')
try: print("set(asked(kept, 'x')) =>", set(asked(kept, 'x')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: set(asked(kept, 'x'))")

# __bases__ moves a part of a lattice under another class.
try: Base, classes = lattice(8)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Base, classes = lattice(8)')
try:
    class Other: x = 'other'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class Other: x = 'other'")
try: Base.x = 'base'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Base.x = 'base'")
try: print(set(asked(classes, 'x')))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: set(asked(classes, 'x'))")
try: classes[1].__bases__ = (Other,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: classes[1].__bases__ = (Other,)')
try: print("sorted(set(asked(classes, 'x'))) =>", sorted(set(asked(classes, 'x'))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: sorted(set(asked(classes, 'x')))")
try: print("asked(classes, 'x').count('other') =>", asked(classes, 'x').count('other'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked(classes, 'x').count('other')")
try: Base.x = 'base again'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Base.x = 'base again'")
try: print("sorted(set(asked(classes, 'x'))) =>", sorted(set(asked(classes, 'x'))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: sorted(set(asked(classes, 'x')))")
try: print("asked(classes, 'x').count('other') =>", asked(classes, 'x').count('other'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked(classes, 'x').count('other')")
try: Other.x = 'other again'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Other.x = 'other again'")
try: print("sorted(set(asked(classes, 'x'))) =>", sorted(set(asked(classes, 'x'))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: sorted(set(asked(classes, 'x')))")
try: print("asked(classes, 'x').count('other again') =>", asked(classes, 'x').count('other again'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: asked(classes, 'x').count('other again')")

# __bases__: whose mro() is called, and in which order. A class comes once for each way that leads to it.
try:
    class Log(type):
        calls = []
        fails = None
        def mro(cls):
            Log.calls.append(cls.__name__)
            if Log.fails == (cls.__name__, Log.calls.count(cls.__name__)):
                raise ValueError('no MRO for ' + cls.__name__)
            return super().mro()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Log(type):')
try:
    class X(metaclass=Log): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class X(metaclass=Log): pass')
try:
    class Y(metaclass=Log): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Y(metaclass=Log): pass')
try:
    class A(X): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A(X): pass')
try:
    class B(A): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class B(A): pass')
try:
    class C(A): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C(A): pass')
try:
    class D(B, C): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class D(B, C): pass')
try:
    class E(D): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E(D): pass')
try:
    class F(C): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class F(C): pass')
try:
    class G(E, F): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class G(E, F): pass')
try: every = (A, B, C, D, E, F, G)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: every = (A, B, C, D, E, F, G)')
try:
    def names():
        return [''.join(k.__name__[0] for k in c.__mro__) for c in every]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def names():')
try: print(names())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names()')
try: Log.calls.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Log.calls.clear()')
try: A.__bases__ = (Y,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.__bases__ = (Y,)')
try: print('Log.calls =>', Log.calls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Log.calls')
try: print('names() =>', names())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names()')
try:
    for fails in (('A', 1), ('D', 1), ('D', 2), ('G', 1), ('G', 3), ('F', 1), ('G', 4), ('G', 5)):
        try: Log.calls.clear()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Log.calls.clear()')
        try: Log.fails = fails
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Log.fails = fails')
        try:
            A.__bases__ = (X,)
            print('fails [' + 'fails=' + (repr(fails) if type(fails) in (str, int, float, bytes, bool, type(None)) or (type(fails) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in fails)) else fails.__name__ if type(fails) is type else type(fails).__name__) + '] =>', fails)
            print('assigned')
            Log.fails = None
            A.__bases__ = (Y,)
        except ValueError as e:
            print('fails [' + 'fails=' + (repr(fails) if type(fails) in (str, int, float, bytes, bool, type(None)) or (type(fails) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in fails)) else fails.__name__ if type(fails) is type else type(fails).__name__) + '] =>', fails)
            print('e [' + 'fails=' + (repr(fails) if type(fails) in (str, int, float, bytes, bool, type(None)) or (type(fails) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in fails)) else fails.__name__ if type(fails) is type else type(fails).__name__) + '] =>', e)
        try: print('Log.calls [' + 'fails=' + (repr(fails) if type(fails) in (str, int, float, bytes, bool, type(None)) or (type(fails) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in fails)) else fails.__name__ if type(fails) is type else type(fails).__name__) + '] =>', Log.calls)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Log.calls')
        try: print('A.__bases__ [' + 'fails=' + (repr(fails) if type(fails) in (str, int, float, bytes, bool, type(None)) or (type(fails) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in fails)) else fails.__name__ if type(fails) is type else type(fails).__name__) + '] =>', A.__bases__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: A.__bases__')
        try: print('names() [' + 'fails=' + (repr(fails) if type(fails) in (str, int, float, bytes, bool, type(None)) or (type(fails) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in fails)) else fails.__name__ if type(fails) is type else type(fails).__name__) + '] =>', names())
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names()')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: for fails in (('A', 1), ('D', 1), ('D', 2), ('G', 1), ('G', 3), ('F',...")
try: Log.fails = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Log.fails = None')
try: Log.calls.clear()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Log.calls.clear()')
try: C.__bases__ = (A, X)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C.__bases__ = (A, X)')
try: print('Log.calls =>', Log.calls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Log.calls')
try: print('names() =>', names())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: names()')

# __bases__: which class decides the layout, for all that have it from there.
try:
    def derive(*bases):
        try:
            type('Z', bases, {})
            return 'fits'
        except TypeError as e:
            return str(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def derive(*bases):')
try:
    class S1: __slots__ = ('a',)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class S1: __slots__ = ('a',)")
try:
    class S2: __slots__ = ('a',)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class S2: __slots__ = ('a',)")
try:
    class Mid(S1): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Mid(S1): pass')
try:
    class Low(Mid): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Low(Mid): pass')
try:
    class Lower(Low): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Lower(Low): pass')
try:
    class Own(Low): __slots__ = ('b',)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class Own(Low): __slots__ = ('b',)")
try:
    class UnderOwn(Own): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class UnderOwn(Own): pass')
try:
    class Beside(S1): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Beside(S1): pass')
try:
    class Both(Lower, Beside): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Both(Lower, Beside): pass')
try:
    for c in (Mid, Low, Lower, Own, UnderOwn, Both):
        try: print('c.__name__ [' + 'c=' + (repr(c) if type(c) in (str, int, float, bytes, bool, type(None)) or (type(c) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in c)) else c.__name__ if type(c) is type else type(c).__name__) + '] =>', c.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.__name__')
        try: print('derive(c, S1) [' + 'c=' + (repr(c) if type(c) in (str, int, float, bytes, bool, type(None)) or (type(c) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in c)) else c.__name__ if type(c) is type else type(c).__name__) + '] =>', derive(c, S1))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: derive(c, S1)')
        try: print('|', 'derive(c, S2) [' + 'c=' + (repr(c) if type(c) in (str, int, float, bytes, bool, type(None)) or (type(c) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in c)) else c.__name__ if type(c) is type else type(c).__name__) + '] =>', derive(c, S2))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: derive(c, S2)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for c in (Mid, Low, Lower, Own, UnderOwn, Both):')
try:
    try:
        Mid.__bases__ = (S2,)
    except TypeError as e:
        print(e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try:
    for c in (Mid, Low, Lower, Own, UnderOwn, Both):
        try: print('c.__name__ [' + 'c=' + (repr(c) if type(c) in (str, int, float, bytes, bool, type(None)) or (type(c) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in c)) else c.__name__ if type(c) is type else type(c).__name__) + '] =>', c.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.__name__')
        try: print('c.__base__.__name__ [' + 'c=' + (repr(c) if type(c) in (str, int, float, bytes, bool, type(None)) or (type(c) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in c)) else c.__name__ if type(c) is type else type(c).__name__) + '] =>', c.__base__.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.__base__.__name__')
        try: print('derive(c, S1) [' + 'c=' + (repr(c) if type(c) in (str, int, float, bytes, bool, type(None)) or (type(c) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in c)) else c.__name__ if type(c) is type else type(c).__name__) + '] =>', derive(c, S1))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: derive(c, S1)')
        try: print('|', 'derive(c, S2) [' + 'c=' + (repr(c) if type(c) in (str, int, float, bytes, bool, type(None)) or (type(c) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in c)) else c.__name__ if type(c) is type else type(c).__name__) + '] =>', derive(c, S2))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: derive(c, S2)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for c in (Mid, Low, Lower, Own, UnderOwn, Both):')

# Assignments from inside assignments, three deep. The third would lead round if the second were taken back; it is not, and all three stay.
try:
    class Hooked(type):
        plan = {}
        def mro(cls):
            act = Hooked.plan.pop(cls.__name__, None)
            if act:
                act()
            return type.mro(cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Hooked(type):')
try:
    def assign(target, bases):
        try:
            target.__bases__ = bases
            return 'assigned'
        except Exception as e:
            return '%s: %s' % (type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def assign(target, bases):')
try:
    def short(classes):
        return [c.__name__ for c in classes]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def short(classes):')
try:
    class O1(metaclass=Hooked): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class O1(metaclass=Hooked): pass')
try:
    class O2(metaclass=Hooked): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class O2(metaclass=Hooked): pass')
try:
    class O3(metaclass=Hooked): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class O3(metaclass=Hooked): pass')
try:
    class T(O1): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class T(O1): pass')
try:
    class U(T): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class U(T): pass')
try:
    def third():
        print('O2.__bases__ = (U,):', assign(O2, (U,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def third():')
try:
    def second():
        Hooked.plan['U'] = third
        print('U.__bases__ = (O3,):', assign(U, (O3,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def second():')
try: Hooked.plan['T'] = second
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Hooked.plan['T'] = second")
try: print('T.__bases__ = (O2,):', 'assign(T, (O2,)) =>', assign(T, (O2,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(T, (O2,))')
try:
    for c in (T, U, O1, O2, O3):
        try: print('c.__name__ [' + 'c=' + (repr(c) if type(c) in (str, int, float, bytes, bool, type(None)) or (type(c) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in c)) else c.__name__ if type(c) is type else type(c).__name__) + '] =>', c.__name__)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.__name__')
        try: print('short(c.__bases__) [' + 'c=' + (repr(c) if type(c) in (str, int, float, bytes, bool, type(None)) or (type(c) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in c)) else c.__name__ if type(c) is type else type(c).__name__) + '] =>', short(c.__bases__))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(c.__bases__)')
        try: print('short(c.__mro__) [' + 'c=' + (repr(c) if type(c) in (str, int, float, bytes, bool, type(None)) or (type(c) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in c)) else c.__name__ if type(c) is type else type(c).__name__) + '] =>', short(c.__mro__))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(c.__mro__)')
        try: print('short(c.__subclasses__()) [' + 'c=' + (repr(c) if type(c) in (str, int, float, bytes, bool, type(None)) or (type(c) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in c)) else c.__name__ if type(c) is type else type(c).__name__) + '] =>', short(c.__subclasses__()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(c.__subclasses__())')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for c in (T, U, O1, O2, O3):')

# A class registered as a sequence, then as a mapping: what derives from it, by whichever way, is one too.
try: import collections.abc
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import collections.abc')
try:
    def kind(o):
        match o:
            case []: return 'sequence'
            case {}: return 'mapping'
        return 'neither'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def kind(o):')
try:
    class R:
        def __len__(self): return 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class R:')
try:
    class R1(R): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class R1(R): pass')
try:
    class R2(R): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class R2(R): pass')
try:
    class R3(R1, R2): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class R3(R1, R2): pass')
try:
    class R4(R3): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class R4(R3): pass')
try: kinds = lambda: [kind(c()) for c in (R, R1, R2, R3, R4)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kinds = lambda: [kind(c()) for c in (R, R1, R2, R3, R4)]')
try: print(kinds())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kinds()')
try: collections.abc.Sequence.register(R1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: collections.abc.Sequence.register(R1)')
try: print(kinds())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kinds()')
try: collections.abc.Mapping.register(R)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: collections.abc.Mapping.register(R)')
try: print(kinds())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kinds()')
try: collections.abc.Sequence.register(R3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: collections.abc.Sequence.register(R3)')
try: print(kinds())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: kinds()')

# An assignment from inside another takes a class out of the MROs' way: T has P in its MRO still, and P has nobody in its list. What is read from T follows P all the same.
try:
    class P(metaclass=Hooked): x = 'first'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class P(metaclass=Hooked): x = 'first'")
try:
    class Q1(metaclass=Hooked): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Q1(metaclass=Hooked): pass')
try:
    class Q2(P): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Q2(P): pass')
try:
    class Q3(metaclass=Hooked): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Q3(metaclass=Hooked): pass')
try:
    class V(Q1): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class V(Q1): pass')
try:
    class W(V): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class W(V): pass')
try: Hooked.plan['W'] = lambda: print('Q2.__bases__ = (Q3,):', assign(Q2, (Q3,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Hooked.plan['W'] = lambda: print('Q2.__bases__ = (Q3,):', assign(Q2, ...")
try: print('V.__bases__ = (Q2,):', 'assign(V, (Q2,)) =>', assign(V, (Q2,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(V, (Q2,))')
try: print('short(V.__mro__) =>', short(V.__mro__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(V.__mro__)')
try: print('short(W.__mro__) =>', short(W.__mro__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(W.__mro__)')
try: print('short(Q2.__mro__) =>', short(Q2.__mro__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(Q2.__mro__)')
try: print('short(P.__subclasses__()) =>', short(P.__subclasses__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(P.__subclasses__())')
try: print('short(Q2.__subclasses__()) =>', short(Q2.__subclasses__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(Q2.__subclasses__())')
try: v, w = V(), W()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: v, w = V(), W()')
try:
    def read():
        return [getattr(o, 'x', None) for o in (V, W, v, w)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def read():')
try: print('read() =>', read())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: read()')
try: print('read() =>', read())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: read()')
try: P.x = 'second'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: P.x = 'second'")
try: print(read())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: read()')
try: del P.x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del P.x')
try: print(read())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: read()')
try: P.x = property(lambda self: 'third')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: P.x = property(lambda self: 'third')")
try: print(read()[2:])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: read()[2:]')

# The same where the outer assignment fails and is taken back.
try:
    class P(metaclass=Hooked): x = 'first'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class P(metaclass=Hooked): x = 'first'")
try:
    class Q1(P): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Q1(P): pass')
try:
    class Q2(metaclass=Hooked): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Q2(metaclass=Hooked): pass')
try:
    class Q3(metaclass=Hooked): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Q3(metaclass=Hooked): pass')
try:
    class V(Q1): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class V(Q1): pass')
try:
    class W(V): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class W(V): pass')
try:
    def act():
        print('Q1.__bases__ = (Q3,):', assign(Q1, (Q3,)))
        raise KeyError('the outer one fails')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def act():')
try: Hooked.plan['W'] = act
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Hooked.plan['W'] = act")
try: print('V.__bases__ = (Q2,):', 'assign(V, (Q2,)) =>', assign(V, (Q2,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(V, (Q2,))')
try: print('short(V.__bases__) =>', short(V.__bases__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(V.__bases__)')
try: print('short(V.__mro__) =>', short(V.__mro__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(V.__mro__)')
try: print('short(W.__mro__) =>', short(W.__mro__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(W.__mro__)')
try: print('short(Q1.__mro__) =>', short(Q1.__mro__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(Q1.__mro__)')
try: print('short(P.__subclasses__()) =>', short(P.__subclasses__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(P.__subclasses__())')
try: print('short(Q1.__subclasses__()) =>', short(Q1.__subclasses__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(Q1.__subclasses__())')
try: print('short(Q2.__subclasses__()) =>', short(Q2.__subclasses__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(Q2.__subclasses__())')
try: v, w = V(), W()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: v, w = V(), W()')
try: print('read() =>', read())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: read()')
try: print('read() =>', read())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: read()')
try: P.x = 'second'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: P.x = 'second'")
try: Q2.x = 'of Q2'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Q2.x = 'of Q2'")
try: Q3.x = 'of Q3'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Q3.x = 'of Q3'")
try: print(read())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: read()')
try: del Q3.x, Q2.x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del Q3.x, Q2.x')
try: print(read())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: read()')

# A key with the hash of '__del__' in the dict of the class is asked behind the writing of the bases: what it assigns then is held against them.
try: import warnings
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import warnings')
try: warnings.simplefilter('ignore')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: warnings.simplefilter('ignore')")
try:
    class Key:
        act = None
        def __hash__(self): return hash('__del__')
        def __eq__(self, other):
            act, Key.act = Key.act, None
            if act:
                act()
            return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Key:')
try:
    class K1: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class K1: pass')
try:
    class K2: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class K2: pass')
try: KA = type('KA', (K1,), {Key(): 1})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: KA = type('KA', (K1,), {Key(): 1})")
try:
    class KB(K2): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class KB(K2): pass')
try: Key.act = lambda: print('from inside, KB.__bases__ = (KA,):', assign(KB, (KA,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Key.act = lambda: print('from inside, KB.__bases__ = (KA,):', assign(...")
try: print('KA.__bases__ = (KB,):', 'assign(KA, (KB,)) =>', assign(KA, (KB,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(KA, (KB,))')
try: print('short(KA.__bases__) =>', short(KA.__bases__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(KA.__bases__)')
try: print('short(KB.__bases__) =>', short(KB.__bases__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(KB.__bases__)')
try: print('short(KA.__mro__) =>', short(KA.__mro__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(KA.__mro__)')
try: print('short(KB.__mro__) =>', short(KB.__mro__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(KB.__mro__)')

# A base that is named twice, which an mro() of the metaclass's own lets through.
try:
    class Twice(type):
        calls = 0
        def mro(cls):
            Twice.calls += 1
            return [cls] + list(cls.__bases__[0].__mro__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Twice(type):')
try:
    class First(metaclass=Twice): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class First(metaclass=Twice): pass')
try:
    class Second(metaclass=Twice): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Second(metaclass=Twice): pass')
try:
    class Root(First): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Root(First): pass')
try: last = Root
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: last = Root')
try:
    for i in range(12):
        try: last = Twice('C%d' % i, (last, last), {})
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: last = Twice('C%d' % i, (last, last), {})")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(12):')
try: print('short(Root.__subclasses__()) =>', short(Root.__subclasses__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(Root.__subclasses__())')
try: print('short(last.__bases__) =>', short(last.__bases__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(last.__bases__)')
try: Twice.calls = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Twice.calls = 0')
try: Root.__bases__ = (Second,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Root.__bases__ = (Second,)')
try: print('Twice.calls =>', Twice.calls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Twice.calls')
try: print('short(last.__mro__[-3:]) =>', short(last.__mro__[-3:]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(last.__mro__[-3:])')
try: Twice.calls = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Twice.calls = 0')
try: last.__bases__[0].__bases__ = (Root, Root, Second)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: last.__bases__[0].__bases__ = (Root, Root, Second)')
try: print('Twice.calls =>', Twice.calls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Twice.calls')
try: print('short(Root.__subclasses__()) =>', short(Root.__subclasses__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(Root.__subclasses__())')
try: print('short(Second.__subclasses__()) =>', short(Second.__subclasses__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(Second.__subclasses__())')

# A class that is being made, handed out by its own mro(): as a base of one of its bases.
try:
    class Early(type):
        act = None
        def mro(cls):
            act, Early.act = Early.act, None
            if act:
                act(cls)
            return type.mro(cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Early(type):')
try:
    class E1(metaclass=Early): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E1(metaclass=Early): pass')
try:
    class E2(metaclass=Early): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E2(metaclass=Early): pass')
try:
    for target in (E1, E2):
        try: Early.act = lambda cls: print(target.__name__, assign(target, (cls,)))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Early.act = lambda cls: print(target.__name__, assign(target, (cls,)))')
        class N(E1, E2): pass
        try: print('short(N.__mro__) [' + 'target=' + (repr(target) if type(target) in (str, int, float, bytes, bool, type(None)) or (type(target) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in target)) else target.__name__ if type(target) is type else type(target).__name__) + '] =>', short(N.__mro__))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(N.__mro__)')
        try: print('short(target.__bases__) [' + 'target=' + (repr(target) if type(target) in (str, int, float, bytes, bool, type(None)) or (type(target) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in target)) else target.__name__ if type(target) is type else type(target).__name__) + '] =>', short(target.__bases__))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(target.__bases__)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for target in (E1, E2):')

# As above, T is left with P in its MRO and P with nobody in its list; and a key in the dict of a class derived from T is asked about '__new__' at the end of the assignment. What it reads
# then, it reads anew after a change of P.
try:
    class NewKey:
        act = None
        def __hash__(self): return hash('__new__')
        def __eq__(self, other):
            act, NewKey.act = NewKey.act, None
            if act:
                act()
            return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class NewKey:')
try:
    class P(metaclass=Hooked): x = 'first'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class P(metaclass=Hooked): x = 'first'")
try:
    class R1(metaclass=Hooked): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class R1(metaclass=Hooked): pass')
try:
    class R2(P): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class R2(P): pass')
try:
    class R3(metaclass=Hooked): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class R3(metaclass=Hooked): pass')
try:
    class T(R1): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class T(R1): pass')
try: U = Hooked('U', (T,), {NewKey(): 1})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: U = Hooked('U', (T,), {NewKey(): 1})")
try:
    def from_the_key():
        print('the key reads', T.x, U.x, short(T.__mro__))
        P.x = 'second'
        print('the key reads', T.x, U.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def from_the_key():')
try:
    def act():
        print('R2.__bases__ = (R3,):', assign(R2, (R3,)))
        NewKey.act = from_the_key
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def act():')
try: Hooked.plan['U'] = act
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Hooked.plan['U'] = act")
try: print('T.__bases__ = (R2,):', 'assign(T, (R2,)) =>', assign(T, (R2,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(T, (R2,))')
try: print('short(T.__mro__) =>', short(T.__mro__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(T.__mro__)')
try: print('short(U.__mro__) =>', short(U.__mro__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(U.__mro__)')
try: print('T.x =>', T.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T.x')
try: print('U.x =>', U.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: U.x')
try: print('T().x =>', T().x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T().x')
try: P.x = 'third'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: P.x = 'third'")
try: print('T.x =>', T.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T.x')
try: print('U.x =>', U.x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: U.x')
try: print('T().x =>', T().x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: T().x')

# Three assignments to one class from inside one another: other bases, the old base again, the other bases again by the very same tuple. Then the first one fails and is taken back.
try:
    class G1(metaclass=Hooked): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class G1(metaclass=Hooked): pass')
try:
    class G2(metaclass=Hooked): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class G2(metaclass=Hooked): pass')
try:
    class B(metaclass=Hooked): w = 'first'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class B(metaclass=Hooked): w = 'first'")
try:
    class A(B): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A(B): pass')
try:
    class S(A): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class S(A): pass')
try: others = (G1,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: others = (G1,)')
try:
    def innermost():
        print('A.__bases__ = others:', assign(A, others))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def innermost():')
try:
    def inner():
        Hooked.plan['S'] = innermost
        print('A.__bases__ = (B,):', assign(A, (B,)))
        raise KeyError('the first one fails')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def inner():')
try: Hooked.plan['S'] = inner
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Hooked.plan['S'] = inner")
try: print('A.__bases__ = others:', 'assign(A, others) =>', assign(A, others))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(A, others)')
try: print('short(A.__bases__) =>', short(A.__bases__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(A.__bases__)')
try: print('short(A.__mro__) =>', short(A.__mro__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(A.__mro__)')
try: print('short(S.__mro__) =>', short(S.__mro__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(S.__mro__)')
try: a = A()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = A()')
try: read = lambda: [getattr(x, 'w', 'none') for x in (A, S, a)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: read = lambda: [getattr(x, 'w', 'none') for x in (A, S, a)]")
try: print(read())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: read()')
try: G1.w = 'of G1'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: G1.w = 'of G1'")
try: print(read())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: read()')
try: B.w = 'second'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: B.w = 'second'")
try: G1.w = 'of G1 again'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: G1.w = 'of G1 again'")
try: print(read())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: read()')
try: del G1.w
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del G1.w')
try: print(read())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: read()')
try: print('A.__bases__ = (B, G2):', 'assign(A, (B, G2)) =>', assign(A, (B, G2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(A, (B, G2))')
try: print('short(A.__mro__) =>', short(A.__mro__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(A.__mro__)')
try: print('short(S.__mro__) =>', short(S.__mro__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(S.__mro__)')
try: print('read() =>', read())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: read()')
try: B.w = 'third'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: B.w = 'third'")
try: print(read())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: read()')
try: del B.w
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del B.w')
try: print(read())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: read()')

# The same three, which leave A out of the list of its base B. Then B is given another base: no walk comes to A, which keeps an MRO with what B derived from.
try:
    class G1(metaclass=Hooked): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class G1(metaclass=Hooked): pass')
try:
    class G2(metaclass=Hooked): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class G2(metaclass=Hooked): pass')
try:
    class E(metaclass=Hooked): w = 'first'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class E(metaclass=Hooked): w = 'first'")
try:
    class F(metaclass=Hooked): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class F(metaclass=Hooked): pass')
try:
    class B(E): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class B(E): pass')
try:
    class A(B): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A(B): pass')
try:
    class S(A): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class S(A): pass')
try: others = (G1,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: others = (G1,)')
try: Hooked.plan['S'] = inner
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Hooked.plan['S'] = inner")
try: print('A.__bases__ = others:', 'assign(A, others) =>', assign(A, others))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(A, others)')
try: print('G1.__bases__ = (G2,):', 'assign(G1, (G2,)) =>', assign(G1, (G2,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(G1, (G2,))')
try: print('short(A.__bases__) =>', short(A.__bases__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(A.__bases__)')
try: print('short(A.__mro__) =>', short(A.__mro__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(A.__mro__)')
try: print('short(S.__mro__) =>', short(S.__mro__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(S.__mro__)')
try: print('short(B.__subclasses__()) =>', short(B.__subclasses__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(B.__subclasses__())')
try: print('short(G1.__subclasses__()) =>', short(G1.__subclasses__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(G1.__subclasses__())')
try: print('B.__bases__ = (F,):', 'assign(B, (F,)) =>', assign(B, (F,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(B, (F,))')
try: print('short(A.__mro__) =>', short(A.__mro__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(A.__mro__)')
try: print('short(B.__mro__) =>', short(B.__mro__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(B.__mro__)')
try: print('short(E.__subclasses__()) =>', short(E.__subclasses__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(E.__subclasses__())')
try: a = A()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a = A()')
try: print(read())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: read()')
try: E.w = 'second'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: E.w = 'second'")
try: print(read())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: read()')
try: del E.w
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del E.w')
try: print(read())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: read()')

# An assignment from inside gives the class its old base again, for each class of a chain. How often mro() is called for an assignment at the top afterwards.
try:
    class Counted(type):
        act = None
        calls = 0
        def mro(cls):
            Counted.calls += 1
            act, Counted.act = Counted.act, None
            if act:
                act()
            return type.mro(cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Counted(type):')
try:
    class H1(metaclass=Counted): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class H1(metaclass=Counted): pass')
try:
    class H2(metaclass=Counted): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class H2(metaclass=Counted): pass')
try:
    class Top(H1): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Top(H1): pass')
try: chain = [Top]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: chain = [Top]')
try:
    for i in range(14):
        try: chain.append(Counted('L%d' % i, (chain[-1],), {}))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: chain.append(Counted('L%d' % i, (chain[-1],), {}))")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for i in range(14):')
try:
    for c in chain[1:]:
        try: Counted.act = lambda c=c, base=c.__bases__[0]: setattr(c, '__bases__', (base,))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Counted.act = lambda c=c, base=c.__bases__[0]: setattr(c, '__bases__'...")
        try: c.__bases__ = (H2,)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.__bases__ = (H2,)')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for c in chain[1:]:')
try: print('short(Top.__subclasses__()) =>', short(Top.__subclasses__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(Top.__subclasses__())')
try: print('short(chain[1].__bases__) =>', short(chain[1].__bases__))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(chain[1].__bases__)')
try: print('short(H2.__subclasses__()) =>', short(H2.__subclasses__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(H2.__subclasses__())')
try: Counted.calls = 0
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Counted.calls = 0')
try: Top.__bases__ = (H2,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Top.__bases__ = (H2,)')
try: print('Counted.calls =>', Counted.calls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Counted.calls')
try: print('short(chain[-1].__mro__[-4:]) =>', short(chain[-1].__mro__[-4:]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(chain[-1].__mro__[-4:])')

# Who is in whose list after assignments to one class from inside one another, with every end.
try:
    def check(*classes):
        for c in classes:
            print(' ', c.__name__, short(c.__bases__), short(c.__mro__), short(c.__subclasses__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def check(*classes):')

try:
    def fresh():
        global B, G1, G2, A, S
        class B(metaclass=Hooked): pass
        class G1(metaclass=Hooked): pass
        class G2(metaclass=Hooked): pass
        class A(B): pass
        class S(A): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fresh():')

try:
    def fail():
        raise KeyError('fails')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def fail():')

try:
    def then(*acts):
        def act():
            for a in acts:
                a()
        return act
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def then(*acts):')

try:
    def inside(bases, *after):
        return then(lambda: print('  from inside,', short(bases), assign(A, bases)), *after)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def inside(bases, *after):')

try: print('another from inside')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'another from inside'")
try: fresh()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fresh()')
try: Hooked.plan['S'] = inside((G2,))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Hooked.plan['S'] = inside((G2,))")
try: print(assign(A, (G1,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(A, (G1,))')
try: check(A, B, G1, G2, S)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: check(A, B, G1, G2, S)')

try: print('another from inside, and the outer one fails')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'another from inside, and the outer one fails'")
try: fresh()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fresh()')
try: Hooked.plan['S'] = inside((G2,), fail)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Hooked.plan['S'] = inside((G2,), fail)")
try: print(assign(A, (G1,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(A, (G1,))')
try: check(A, B, G1, G2, S)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: check(A, B, G1, G2, S)')

try: print('the old base again from inside')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'the old base again from inside'")
try: fresh()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fresh()')
try: Hooked.plan['S'] = inside((B,))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Hooked.plan['S'] = inside((B,))")
try: print(assign(A, (G1,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(A, (G1,))')
try: check(A, B, G1, G2, S)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: check(A, B, G1, G2, S)')

try: print('the old base again from inside, and the outer one fails')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'the old base again from inside, and the outer one fails'")
try: fresh()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fresh()')
try: Hooked.plan['S'] = inside((B,), fail)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Hooked.plan['S'] = inside((B,), fail)")
try: print(assign(A, (G1,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(A, (G1,))')
try: check(A, B, G1, G2, S)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: check(A, B, G1, G2, S)')

try: print('the one from inside fails')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'the one from inside fails'")
try: fresh()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fresh()')
try: Hooked.plan['S'] = then(lambda: Hooked.plan.__setitem__('S', fail), inside((G2,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Hooked.plan['S'] = then(lambda: Hooked.plan.__setitem__('S', fail), i...")
try: print(assign(A, (G1,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(A, (G1,))')
try: check(A, B, G1, G2, S)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: check(A, B, G1, G2, S)')

try: print('three deep, the third by the tuple of the first, and the first fails')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'three deep, the third by the tuple of the first, and the first fails'")
try: fresh()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fresh()')
try: others = (G1,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: others = (G1,)')
try: Hooked.plan['S'] = then(lambda: Hooked.plan.__setitem__('S', inside(others)), inside((B,)), fail)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Hooked.plan['S'] = then(lambda: Hooked.plan.__setitem__('S', inside(o...")
try: print(assign(A, others))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(A, others)')
try: check(A, B, G1, G2, S)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: check(A, B, G1, G2, S)')

try: print('three deep, the third by the tuple of the first')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'three deep, the third by the tuple of the first'")
try: fresh()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fresh()')
try: others = (G1,)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: others = (G1,)')
try: Hooked.plan['S'] = then(lambda: Hooked.plan.__setitem__('S', inside(others)), inside((B, G2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Hooked.plan['S'] = then(lambda: Hooked.plan.__setitem__('S', inside(o...")
try: print(assign(A, others))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(A, others)')
try: check(A, B, G1, G2, S)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: check(A, B, G1, G2, S)')

try: print('bases that are kept, dropped and new at once')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'bases that are kept, dropped and new at once'")
try: fresh()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fresh()')
try: print(assign(A, (B, G1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(A, (B, G1))')
try: Hooked.plan['S'] = inside((G2, B), fail)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Hooked.plan['S'] = inside((G2, B), fail)")
try: print(assign(A, (G1, G2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(A, (G1, G2))')
try: check(A, B, G1, G2, S)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: check(A, B, G1, G2, S)')

try: print('an assignment that fails leaves the class in its place')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'an assignment that fails leaves the class in its place'")
try: fresh()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: fresh()')
try:
    class Later(B): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Later(B): pass')
try: Hooked.plan['S'] = fail
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: Hooked.plan['S'] = fail")
try: print('assign(A, (G1,)) =>', assign(A, (G1,)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(A, (G1,))')
try: print('short(B.__subclasses__()) =>', short(B.__subclasses__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(B.__subclasses__())')
try: print('assign(A, (B, G1)) =>', assign(A, (B, G1)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: assign(A, (B, G1))')
try: print('short(B.__subclasses__()) =>', short(B.__subclasses__()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: short(B.__subclasses__())')
