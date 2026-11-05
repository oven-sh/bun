# A frame that an exception has left knows its caller: f_back of the frame of every entry of a traceback, whatever kind of code was left, however the exception was caught and
# whenever somebody comes to look. Most exceptions are caught by a handler that never looks, and then nobody can tell.
import functools, gc, sys, threading

def chain(frame):
    names = []
    while frame is not None:
        names.append(frame.f_code.co_name)
        frame = frame.f_back
    return '<'.join(names[:names.index('main') + 1] if 'main' in names else names)

def look(e):
    rows = []
    tb = e.__traceback__
    while tb is not None:
        rows.append(chain(tb.tb_frame))
        tb = tb.tb_next
    return rows

class Error(Exception):
    pass

# ---- What is left ----

def function():
    {}['function']
def through_two():
    function()
def through_three():
    through_two()
def recursive(n=4):
    if not n:
        [][0]
    recursive(n - 1)
def with_a_lambda():
    (lambda: {}['lambda'])()
def with_a_closure():
    key = 'closure'
    def inner():
        {}[key]
    inner()
class Thing:
    def method(self):
        {}['method']
    @property
    def attribute(self):
        return {}['property']
    def __getattr__(self, name):
        return {}[name]
    def __len__(self):
        return {}['len']
def with_a_method():
    Thing().method()
def with_a_property():
    Thing().attribute
def with_getattr():
    Thing().missing
def with_a_special_method():
    len(Thing())
def with_a_class_body():
    class Body:
        {}['class body']
def with_a_class_body_that_calls():
    class Body:
        function()
def with_a_comprehension():
    [function() for i in (1,)]
def with_a_generator_expression():
    list(function() for i in (1,))
def with_a_generator():
    def generator():
        yield 1
        function()
    for i in generator():
        pass
def with_a_coroutine():
    async def coroutine():
        function()
    coroutine().send(None)
def with_exec():
    exec("function()", {'function': function})
def with_a_key_function():
    sorted([2, 1], key=lambda x: function())
def with_map():
    list(map(lambda x: function(), [1]))
def with_partial():
    functools.partial(function)()
def with_a_decorator():
    def decorator(f):
        @functools.wraps(f)
        def wrapper():
            return f()
        return wrapper
    decorator(function)()
def with_arguments_that_do_not_fit():
    function(1)
def with_a_default_handler_on_the_way():
    try:
        function()
    except ValueError:
        pass
def with_finally_on_the_way():
    try:
        function()
    finally:
        pass
def with_a_with_on_the_way():
    class Manager:
        def __enter__(self): return self
        def __exit__(self, *arguments): return False
    with Manager():
        function()
def raised_again_on_the_way():
    try:
        function()
    except LookupError:
        raise
def another_on_the_way():
    try:
        function()
    except LookupError:
        raise Error('another')
def another_from_it_on_the_way():
    try:
        function()
    except LookupError as e:
        raise Error('from it') from e
def own_class():
    raise Error('own class')
def statement():
    raise KeyError('statement')
def an_object_that_was_there():
    raise OBJECT
OBJECT = KeyError('kept')

LEFT = [value for name, value in list(globals().items()) if hasattr(value, '__code__') and name not in ('chain', 'look')]

# ---- How it is caught, and when somebody looks ----

def named(f):
    try:
        f()
    except Exception as e:
        return look(e)
def named_and_kept(f):
    try:
        f()
    except Exception as e:
        kept = e
    return look(kept)
def returned(f):
    def catches():
        try:
            f()
        except Exception as e:
            return e
    def calls():
        return catches()
    return look(calls())
def asked_for(f):
    try:
        f()
    except Exception:
        return look(sys.exception())
def asked_for_in_a_callee(f):
    def callee():
        return look(sys.exception())
    try:
        f()
    except Exception:
        return callee()
def asked_for_late(f):
    def catches():
        try:
            f()
        except Exception:
            x = 1
            x += 1
            return sys.exception()
    return look(catches())
def found_in_the_heap(f):
    def catches():
        gc.collect()
        try:
            f()
        except Exception:
            return [o for o in gc.get_objects() if isinstance(o, (LookupError, Error, TypeError)) and o is not OBJECT and o.__traceback__ is not None]
    return sorted(map(look, catches()))
def by_current_exceptions(f):
    try:
        f()
    except Exception:
        return [look(e) for e in sys._current_exceptions().values() if e is not None]
def as_a_context(f):
    try:
        try:
            f()
        except Exception:
            raise Error('in the handler')
    except Error as e:
        return look(e), look(e.__context__)
def two_frames_up(f):
    def middle():
        f()
    def outer():
        middle()
    try:
        outer()
    except Exception as e:
        return look(e)
def not_looked_at_then_again(f):
    for i in range(3):
        try:
            f()
        except Exception:
            pass
    try:
        f()
    except Exception as e:
        return look(e)
def in_a_generator(f):
    def generator():
        try:
            f()
        except Exception as e:
            yield look(e)
    return list(generator())
def in_a_finally(f):
    def leaves():
        try:
            f()
        finally:
            found.append(look(sys.exception()))
    found = []
    try:
        leaves()
    except Exception:
        pass
    return found

CAUGHT = [named, named_and_kept, returned, asked_for, asked_for_in_a_callee, asked_for_late, found_in_the_heap, by_current_exceptions, as_a_context, two_frames_up, not_looked_at_then_again, in_a_generator, in_a_finally]

# ---- A frame object that the program has already, when an exception that nobody looks at leaves its call ----

def frame_known_from_an_earlier_exception():
    kept = []
    def left():
        try:
            {}['seen']
        except KeyError as e:
            kept.append(e.__traceback__.tb_frame)
        {}['not looked at']
    def catches():
        try:
            left()
        except KeyError:
            pass
    catches()
    return chain(kept[0])
def frame_known_by_getframe():
    kept = []
    def left():
        kept.append(sys._getframe())
        {}['not looked at']
    def catches():
        try:
            left()
        except KeyError:
            pass
    catches()
    return chain(kept[0])
def frame_known_to_a_callee():
    kept = []
    def callee():
        kept.append(sys._getframe(1))
    def left():
        callee()
        {}['not looked at']
    def catches():
        try:
            left()
        except KeyError:
            pass
    catches()
    return chain(kept[0])
def found_while_it_is_on_its_way():
    # What a loop goes through is closed when the exception leaves the loop: code of the program, which asks for all the objects there are.
    kept = []
    def generator():
        try:
            yield 1
        finally:
            kept.extend(o for o in gc.get_objects() if isinstance(o, KeyError) and o.args == ('on its way',))
    def left():
        for i in generator():
            {}['on its way']
    def middle():
        left()
    def catches():
        try:
            middle()
        except KeyError:
            pass
    gc.collect()
    catches()
    return [look(e) for e in kept]

def another_is_raised_while_it_is_on_its_way():
    # By what closes the generator. Nobody can catch that: it is handed to sys.unraisablehook.
    unraisable = []
    def generator():
        try:
            yield 1
        finally:
            raise Error('from the finally clause')
    def left():
        for i in generator():
            {}['on its way']
    def catches(looks):
        try:
            left()
        except KeyError as e:
            return look(e) if looks else None
    hook, sys.unraisablehook = sys.unraisablehook, lambda info: unraisable.append((type(info.exc_value).__name__, look(info.exc_value)))
    try:
        return catches(False), catches(True), unraisable
    finally:
        sys.unraisablehook = hook
def another_thread_asks():
    entered, leave = threading.Event(), threading.Event()
    def worker():
        try:
            through_two()
        except LookupError:
            entered.set()
            leave.wait()
    thread = threading.Thread(target=worker)
    thread.start()
    entered.wait()
    e = sys._current_exceptions()[thread.ident]
    first = look(e)
    leave.set()
    thread.join()
    return first, look(e)
def many_frames():
    def deep(n):
        if not n:
            {}['deep']
        deep(n - 1)
    def catches(looks):
        try:
            deep(200)
        except KeyError as e:
            return [row.count('<') for row in look(e)] == list(range(2, 204)) if looks else None
    return catches(False), catches(True), catches(False), catches(True)
def the_end_of_the_stack():
    def deep():
        deep()
    def catches(looks):
        try:
            deep()
        except RecursionError as e:
            rows = look(e)
            return all(row.count('<') == i + 2 for i, row in enumerate(rows)) if looks else None
    return catches(False), catches(True)

def main():
    for caught in CAUGHT:
        print(caught.__name__)
        # (To go through the heap takes long.)
        for left in LEFT[::5] if caught is found_in_the_heap else LEFT:
            OBJECT.__traceback__ = None
            print('   ', left.__name__, caught(left))
    for f in (frame_known_from_an_earlier_exception, frame_known_by_getframe, frame_known_to_a_callee, found_while_it_is_on_its_way, another_is_raised_while_it_is_on_its_way, another_thread_asks, many_frames, the_end_of_the_stack):
        print(f.__name__, f())
main()
