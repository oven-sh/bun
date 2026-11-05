# Where a `for` loop is said to go when it ends: to the statement behind it, whatever that begins with.
import sys

class O:
    pass
def generic_class():
    for p in (1, 2):
        pass
    class K[T](O, metaclass=type):
        pass
def plain_class():
    for p in (1, 2):
        pass
    class K(O):
        pass
def generic_function():
    for p in (1, 2):
        pass
    def y[T](): pass
def generic_function_with_defaults():
    for p in (1, 2):
        pass
    def y[T](a=1, *, b=2): pass
def plain_function():
    for p in (1, 2):
        pass
    def y(): pass
def generic_alias():
    for p in (1, 2):
        pass
    type X[T] = int
def plain_alias():
    for p in (1, 2):
        pass
    type X = int
def decorated():
    for p in (1, 2):
        pass
    @staticmethod
    def y(): pass
def decorated_generic():
    for p in (1, 2):
        pass
    @staticmethod
    def y[T](): pass
def a_lambda():
    for p in (1, 2):
        pass
    x = lambda: 1
def a_comprehension():
    for p in (1, 2):
        pass
    x = [i for i in ()]
def a_with():
    for p in (1, 2):
        pass
    with open('/dev/null'): pass
def a_try():
    for p in (1, 2):
        pass
    try: pass
    finally: pass
def nothing():
    for p in (1, 2):
        pass

def line_of(code, offset):
    for start, end, line in code.co_lines():
        if start <= offset < end:
            return line - code.co_firstlineno if line else None

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
main()
