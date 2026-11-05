# In CPython a line begins where the instruction laid out before is of another line. What is laid out before the end of a `for` loop is the last way
# out of its body: after a `return` in the loop that leaves a `with` statement or a `finally` clause, that is a copy of what the statement does when
# it is left. So when the loop ends and the same is done again, on the same line, the line is not told of. Handlers are laid out behind all the rest.
import sys

class Manager:
    def __enter__(self): return self
    def __exit__(self, *arguments): return False

def with_in_with(items):
    with Manager():
        with Manager():
            for i in items:
                return 1
def with_two_managers(items):
    with Manager(), Manager():
        for i in items:
            return 1
def finally_is_a_with(items):
    try:
        for i in items:
            return 1
    finally:
        with Manager():
            pass
def finally_is_a_with_on_one_line(items):
    try:
        for i in items:
            return 1
    finally:
        with Manager(): pass
def return_in_a_with(items):
    for i in items:
        with Manager():
            return 1
def return_in_a_try(items):
    for i in items:
        try:
            return 1
        finally:
            pass
def return_in_a_with_and_more(items):
    for i in items:
        with Manager():
            return 1
    x = 1
def return_in_a_try_and_more(items):
    for i in items:
        try:
            return 1
        finally:
            x = 2
    x = 1
def return_in_a_with_in_a_with(items):
    with Manager():
        for i in items:
            with Manager():
                return 1
def return_in_a_try_in_a_try(items):
    try:
        for i in items:
            try:
                return 1
            finally:
                x = 1
    finally:
        x = 2
def try_in_a_with(items):
    with Manager():
        try:
            for i in items:
                return 1
        finally:
            x = 1
def with_in_a_try(items):
    try:
        with Manager():
            for i in items:
                return 1
    finally:
        x = 1
def break_in_a_with(items):
    with Manager():
        for i in items:
            with Manager():
                break
def continue_in_a_with(items):
    with Manager():
        for i in items:
            with Manager():
                continue
def loop_in_a_loop(items):
    with Manager():
        for i in items:
            for j in items:
                return 1
def return_behind_a_condition(items):
    with Manager():
        for i in items:
            if i:
                return 1
def statement_behind_the_return(items):
    with Manager():
        for i in items:
            if i:
                return 1
            x = 1
def handler_before_the_end(items):
    with Manager():
        for i in items:
            try:
                x = 1 // i
            except ZeroDivisionError:
                return 1
def handler_and_more(items):
    for i in items:
        try:
            x = 1 // i
        except ZeroDivisionError:
            x = 2
    x = 3
def handler_in_front_of_the_same_line(items):
    try: x = 1 // len(items)
    except ZeroDivisionError: x = 2
    x = 3
def in_a_generator(items):
    with Manager():
        for i in items:
            if i:
                return 1
            yield i

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
main()
