# Without the traceback module, exceptions are printed by the interpreter itself: nothing is underlined, and there are no hints.
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')

try: sys.modules['traceback'] = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: sys.modules['traceback'] = None")
try: sys.stderr = sys.stdout
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.stderr = sys.stdout')


try:
    class K:
        def __init__(self):
            self.nope = 1
            self._hidden = 2
            self.inner = self

        def name(self):
            return nope

        def name_like_local(self):
            nope_ = 1
            return nope

        def attribute(self):
            return self._hiden

        def nested(self):
            return self.nop

        def other(self):
            o = K()
            return o._hiden
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class K:')


try:
    def plain():
        value = 1
        return valu
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def plain():')


try:
    def module():
        return collections
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def module():')


try:
    def generator():
        value = 1
        yield valu
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def generator():')


try:
    class Body:
        try:
            attribute = 1
            attribut
        except NameError:
            sys.__excepthook__(*sys.exc_info())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Body:')


try:
    for function in (K().name, K().name_like_local, K().attribute, K().nested, K().other, plain, module, lambda: next(generator()), lambda: [valu for value in (1,)], lambda: sys.modulez, lambda: (1).reel):
        try:
            function()
        except (NameError, AttributeError):
            sys.__excepthook__(*sys.exc_info())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for function in (K().name, K().name_like_local, K().attribute, K().ne...')
try: print('done')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'done'")
