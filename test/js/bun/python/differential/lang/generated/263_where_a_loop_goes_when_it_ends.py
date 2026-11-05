# Where a `for` loop is said to go when it ends: to the statement behind it, whatever that begins with.
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')

try:
    class O:
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class O:')
try:
    def generic_class():
        for p in (1, 2):
            pass
        class K[T](O, metaclass=type):
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def generic_class():')
try:
    def plain_class():
        for p in (1, 2):
            pass
        class K(O):
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def plain_class():')
try:
    def generic_function():
        for p in (1, 2):
            pass
        def y[T](): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def generic_function():')
try:
    def generic_function_with_defaults():
        for p in (1, 2):
            pass
        def y[T](a=1, *, b=2): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def generic_function_with_defaults():')
try:
    def plain_function():
        for p in (1, 2):
            pass
        def y(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def plain_function():')
try:
    def generic_alias():
        for p in (1, 2):
            pass
        type X[T] = int
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def generic_alias():')
try:
    def plain_alias():
        for p in (1, 2):
            pass
        type X = int
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def plain_alias():')
try:
    def decorated():
        for p in (1, 2):
            pass
        @staticmethod
        def y(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def decorated():')
try:
    def decorated_generic():
        for p in (1, 2):
            pass
        @staticmethod
        def y[T](): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def decorated_generic():')
try:
    def a_lambda():
        for p in (1, 2):
            pass
        x = lambda: 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a_lambda():')
try:
    def a_comprehension():
        for p in (1, 2):
            pass
        x = [i for i in ()]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a_comprehension():')
try:
    def a_with():
        for p in (1, 2):
            pass
        with open('/dev/null'): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a_with():')
try:
    def a_try():
        for p in (1, 2):
            pass
        try: pass
        finally: pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def a_try():')
try:
    def nothing():
        for p in (1, 2):
            pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def nothing():')

try:
    def line_of(code, offset):
        for start, end, line in code.co_lines():
            if start <= offset < end:
                return line - code.co_firstlineno if line else None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def line_of(code, offset):')

try:
    def main():
        monitoring = sys.monitoring
        monitoring.use_tool_id(1, 'test')
        events = []
        monitoring.register_callback(1, monitoring.events.BRANCH_RIGHT, lambda code, source, destination: events.append((line_of(code, source), line_of(code, destination))))
        for f in [value for name, value in globals().items() if hasattr(value, '__code__') and name not in ('main', 'line_of')]:
            monitoring.set_local_events(1, f.__code__, monitoring.events.BRANCH_RIGHT)
            events.clear()
            f()
            print(f.__name__, events, sorted({line - f.__code__.co_firstlineno for _, _, line in f.__code__.co_lines() if line}))
        monitoring.free_tool_id(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def main():')
try: main()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: main()')
