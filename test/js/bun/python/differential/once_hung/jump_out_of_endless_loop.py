# test_sys_settrace.JumpTestCase.test_no_jump_infinite_while_loop: frame.f_lineno = ... must raise ValueError; here it does nothing, and the loop goes on
import sys
def f(output):
    output.append(1)
    while True:
        output.append(3)
    output.append(4)
first = f.__code__.co_firstlineno
def trace(frame, event, arg):
    if event == "line" and frame.f_lineno == first + 3:
        frame.f_lineno = first + 4
    return trace
sys.settrace(trace)
try:
    f([])
except ValueError as e:
    print("ValueError", e)
