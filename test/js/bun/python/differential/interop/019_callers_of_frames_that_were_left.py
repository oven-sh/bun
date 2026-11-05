# See 019_callers_of_frames_that_were_left.js.
import sys
def chain(frame):
    names = []
    while frame is not None:
        names.append(frame.f_code.co_name)
        frame = frame.f_back
    return '<'.join(names)
def look(e):
    rows = []
    tb = e.__traceback__
    while tb is not None:
        rows.append(chain(tb.tb_frame))
        tb = tb.tb_next
    return rows
def raises():
    {}['raises']
def through_two():
    raises()
def named(js, f):
    try:
        js(f)
    except KeyError as e:
        return look(e)
def not_looked_at_then_named(js, f):
    for i in range(3):
        try:
            js(f)
        except KeyError:
            pass
    return named(js, f)
def asked_for(js, f):
    try:
        js(f)
    except KeyError:
        return look(sys.exception())
def calls(js, f):
    return js(f)
def catches_and_does_not_look(f):
    try:
        f()
    except KeyError:
        return 'caught'
