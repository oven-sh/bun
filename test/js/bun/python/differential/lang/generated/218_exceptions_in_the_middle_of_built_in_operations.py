# An exception raised half way through an operation written in C ends the operation there: nothing of the program's runs after it.
try: import types
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import types')


try:
    class Spec:
        @property
        def _initializing(self):
            print("_initializing asked for")
            raise RuntimeError("no answer")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Spec:')


try:
    def annotate(format):
        print("annotate called")
        return {}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def annotate(format):')


try: module = types.ModuleType("m")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: module = types.ModuleType("m")')
try: module.__spec__ = Spec()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: module.__spec__ = Spec()')
try: module.__annotate__ = annotate
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: module.__annotate__ = annotate')
try:
    try:
        print(module.__annotations__)
    except RuntimeError as e:
        print("RuntimeError:", 'e =>', e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: print("__annotations__" in vars(module))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "__annotations__" in vars(module)')
