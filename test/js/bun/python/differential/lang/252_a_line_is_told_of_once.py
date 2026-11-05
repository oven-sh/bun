# Two places where a line was told of twice. `a or [comprehension]`, written over two lines, when the comprehension is not run: what comes after is of the
# line the statement begins on, where the frame still is. And a `with` statement left after a loop that has ended: CPython's compiler drops what
# comes after a `return` in the loop, so that what is laid out before the end of the loop is the way out of the `with`, on the line of the `with`.
import sys

def note(value):
    return value
class Manager:
    def __enter__(self): return self
    def __exit__(self, *arguments): return False

def skipped_by_or():
    x = (note('a') or
         [note(i) for i in range(2)])
def skipped_by_or_then_more():
    x = (note('a')
         or [note(i)
             for i in
             range(2)
             ])
    return x
def not_skipped_by_or():
    x = (note('') or
         [note(i) for i in range(2)])
def skipped_by_and():
    x = (note('') and
         {note(i) for i in range(2)})
def not_skipped_by_and():
    x = (note('a') and
         {note(i): i for i in range(2)})
def one_of_two(which):
    x = ([note(i) for i in range(1)]
         if which else
         [note(i) for i in range(2)])
    return x
def as_an_argument():
    return note(note('a') or
                [note(i) for i in range(2)])
def in_a_condition():
    if (note('a') or
            [note(i) for i in range(2)]):
        return 1
def dead_statement_after_return():
    with Manager():
        for i in range(0):
            return i
            pass
def dead_assignment_after_return():
    with Manager():
        for i in range(0):
            return i
            i = 2
def dead_statement_after_return_over_two_lines():
    with Manager(), Manager():
        for i in range(0):
            return (i if note(1)
                    else 2)
            pass
def dead_statement_after_raise():
    with Manager():
        for i in range(0):
            raise KeyError
            pass
def dead_statement_after_continue():
    with Manager():
        for i in range(2):
            continue
            pass
def dead_statement_after_break():
    with Manager():
        for i in range(2):
            break
            pass

def main():
    events = []
    def trace(frame, event, argument):
        if frame.f_code.co_name in names and event in ('line', 'return'):
            events.append('%s%d' % (event[0], frame.f_lineno - frame.f_code.co_firstlineno))
        return trace
    calls = [(skipped_by_or,), (skipped_by_or_then_more,), (not_skipped_by_or,), (skipped_by_and,), (not_skipped_by_and,), (one_of_two, 0), (one_of_two, 1), (as_an_argument,), (in_a_condition,),
             (dead_statement_after_return,), (dead_assignment_after_return,), (dead_statement_after_return_over_two_lines,), (dead_statement_after_raise,), (dead_statement_after_continue,),
             (dead_statement_after_break,)]
    names = {call[0].__name__ for call in calls}
    for function, *arguments in calls:
        del events[:]
        sys.settrace(trace)
        try:
            function(*arguments)
        finally:
            sys.settrace(None)
        print(function.__name__, *arguments, ':', ' '.join(events))
main()
