# In CPython a line begins where the instruction laid out before is of another line. What is laid out before the end of a `for` loop is the last way
# out of its body: after a `return` in the loop that leaves a `with` statement or a `finally` clause, that is a copy of what the statement does when
# it is left. So when the loop ends and the same is done again, on the same line, the line is not told of. Handlers are laid out behind all the rest.
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')

try:
    class Manager:
        def __enter__(self): return self
        def __exit__(self, *arguments): return False
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Manager:')

try:
    def with_in_with(items):
        with Manager():
            with Manager():
                for i in items:
                    return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def with_in_with(items):')
try:
    def with_two_managers(items):
        with Manager(), Manager():
            for i in items:
                return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def with_two_managers(items):')
try:
    def finally_is_a_with(items):
        try:
            for i in items:
                return 1
        finally:
            with Manager():
                pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def finally_is_a_with(items):')
try:
    def finally_is_a_with_on_one_line(items):
        try:
            for i in items:
                return 1
        finally:
            with Manager(): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def finally_is_a_with_on_one_line(items):')
try:
    def return_in_a_with(items):
        for i in items:
            with Manager():
                return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def return_in_a_with(items):')
try:
    def return_in_a_try(items):
        for i in items:
            try:
                return 1
            finally:
                pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def return_in_a_try(items):')
try:
    def return_in_a_with_and_more(items):
        for i in items:
            with Manager():
                return 1
        x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def return_in_a_with_and_more(items):')
try:
    def return_in_a_try_and_more(items):
        for i in items:
            try:
                return 1
            finally:
                x = 2
        x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def return_in_a_try_and_more(items):')
try:
    def return_in_a_with_in_a_with(items):
        with Manager():
            for i in items:
                with Manager():
                    return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def return_in_a_with_in_a_with(items):')
try:
    def return_in_a_try_in_a_try(items):
        try:
            for i in items:
                try:
                    return 1
                finally:
                    x = 1
        finally:
            x = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def return_in_a_try_in_a_try(items):')
try:
    def try_in_a_with(items):
        with Manager():
            try:
                for i in items:
                    return 1
            finally:
                x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def try_in_a_with(items):')
try:
    def with_in_a_try(items):
        try:
            with Manager():
                for i in items:
                    return 1
        finally:
            x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def with_in_a_try(items):')
try:
    def break_in_a_with(items):
        with Manager():
            for i in items:
                with Manager():
                    break
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def break_in_a_with(items):')
try:
    def continue_in_a_with(items):
        with Manager():
            for i in items:
                with Manager():
                    continue
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def continue_in_a_with(items):')
try:
    def loop_in_a_loop(items):
        with Manager():
            for i in items:
                for j in items:
                    return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop_in_a_loop(items):')
try:
    def return_behind_a_condition(items):
        with Manager():
            for i in items:
                if i:
                    return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def return_behind_a_condition(items):')
try:
    def statement_behind_the_return(items):
        with Manager():
            for i in items:
                if i:
                    return 1
                x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def statement_behind_the_return(items):')
try:
    def handler_before_the_end(items):
        with Manager():
            for i in items:
                try:
                    x = 1 // i
                except ZeroDivisionError:
                    return 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def handler_before_the_end(items):')
try:
    def handler_and_more(items):
        for i in items:
            try:
                x = 1 // i
            except ZeroDivisionError:
                x = 2
        x = 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def handler_and_more(items):')
try:
    def handler_in_front_of_the_same_line(items):
        try: x = 1 // len(items)
        except ZeroDivisionError: x = 2
        x = 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def handler_in_front_of_the_same_line(items):')
try:
    def in_a_generator(items):
        with Manager():
            for i in items:
                if i:
                    return 1
                yield i
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def in_a_generator(items):')

try:
    def main():
        functions = [value for name, value in globals().items() if hasattr(value, '__code__') and name != 'main']
        codes = {function.__code__ for function in functions}
        events = []
        def trace(frame, event, argument):
            if frame.f_code in codes:
                if event in ('line', 'return'):
                    events.append('%s%d' % (event[0], frame.f_lineno - frame.f_code.co_firstlineno))
                return trace
        for function in functions:
            print(function.__name__)
            for items in ((), (0,), (1,), (0, 0), (0, 1)):
                del events[:]
                sys.settrace(trace)
                try:
                    result = function(items)
                    if hasattr(result, 'send'):
                        list(result)
                finally:
                    sys.settrace(None)
                print('   ', items, ' '.join(events))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def main():')
try: main()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: main()')
