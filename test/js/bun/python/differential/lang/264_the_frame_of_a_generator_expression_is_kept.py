# A generator expression that is dropped closes what it was going through, if that was made for it. Not if somebody has kept its frame: f_locals['.0'] of that is the generator, which is
# still suspended and can be gone on with.
import sys
# (Each has a log of its own: what is still suspended when a function is done is closed whenever the collector finds it.)
def g(log):
    try:
        yield 0
        yield 1
        yield 2
    finally:
        log.append('finally')
F = []
def grab(x):
    F.append(sys._getframe(1))
    return x
def by_getframe():
    del F[:]
    log = []
    first = next(grab(x) for x in g(log))
    before = list(log)
    rest = next(F[0].f_locals['.0'])
    return first, before, rest, list(log)
def grab_further_down(x):
    def inner():
        F.append(sys._getframe().f_back.f_back)
    inner()
    return x
def by_f_back():
    del F[:]
    log = []
    first = next(grab_further_down(x) for x in g(log))
    before = list(log)
    rest = next(F[0].f_locals['.0'])
    return first, before, rest, list(log)
def grab_from_a_traceback(x):
    try:
        raise ValueError
    except ValueError as e:
        F.append(e.__traceback__.tb_frame.f_back)
    return x
def by_tb_frame():
    del F[:]
    log = []
    first = next(grab_from_a_traceback(x) for x in g(log))
    before = list(log)
    rest = next(F[0].f_locals['.0'])
    return first, before, rest, list(log)
def by_gi_frame():
    del F[:]
    log = []
    e = (x for x in g(log))
    F.append(e.gi_frame)
    first = next(e)
    e.close()
    return first, list(log)
def any_with_a_kept_frame():
    del F[:]
    log = []
    found = any(grab(x) == 0 for x in g(log))
    before = list(log)
    rest = next(F[0].f_locals['.0'])
    return found, before, rest, list(log)
def a_loop_with_a_kept_frame():
    del F[:]
    log = []
    for first in (grab(x) for x in g(log)):
        break
    before = list(log)
    rest = next(F[0].f_locals['.0'])
    return first, before, rest, list(log)
def a_search_with_a_kept_frame():
    del F[:]
    log = []
    found = 0 in (grab(x) for x in g(log))
    before = list(log)
    rest = next(F[0].f_locals['.0'])
    return found, before, rest, list(log)
def a_tracer_that_keeps_nothing():
    del F[:]
    log = []
    seen = []
    def trace(frame, event, argument):
        seen.append((frame.f_code.co_name, event))
        return None
    sys.settrace(trace)
    try:
        first = next(x for x in g(log))
    finally:
        sys.settrace(None)
    return first, list(log), seen
def nobody_keeps_it():
    del F[:]
    log = []
    first = next(x for x in g(log))
    return first, list(log)
for f in (by_getframe, by_f_back, by_tb_frame, by_gi_frame, any_with_a_kept_frame, a_loop_with_a_kept_frame, a_search_with_a_kept_frame, a_tracer_that_keeps_nothing, nobody_keeps_it):
    print(f.__name__, f())
