# A debugger stops a thread in a callback, and another thread of its own asks the frame where it is.
import queue
import sys
import threading

requests = queue.Queue()
answers = queue.Queue()


def server():
    while True:
        frame = requests.get()
        if frame is None:
            return
        first = frame.f_code.co_firstlineno
        stack = sys._current_frames()[main_thread]
        while stack is not frame:
            stack = stack.f_back
        answers.put((frame.f_lineno - first, stack.f_lineno - first, [line - first for f, line in walk(frame)][:1]))


def walk(frame):
    while frame is not None and frame.f_code.co_filename == __file__:
        yield frame, frame.f_lineno
        frame = frame.f_back


def ask(frame):
    requests.put(frame)
    return answers.get()


def target(n):
    total = 0
    for i in range(n):
        total += i
    while total > 0:
        total -= 2
    if total:
        total = 0
    return [x
            for x in range(2)
            if x]


main_thread = threading.get_ident()
thread = threading.Thread(target=server)
thread.start()

print('settrace')


def tracer(frame, event, arg):
    if frame.f_code is target.__code__:
        here = frame.f_lineno - frame.f_code.co_firstlineno
        print(event, here, ask(frame))
        return tracer


sys.settrace(tracer)
target(2)
sys.settrace(None)

print('monitoring')
M = sys.monitoring
E = M.events


def on_line(code, line):
    frame = sys._getframe(1)
    print('line', line - code.co_firstlineno, frame.f_lineno - code.co_firstlineno, ask(frame))


def on_jump(code, source, destination):
    frame = sys._getframe(1)
    print('jump', frame.f_lineno - code.co_firstlineno, ask(frame))


M.use_tool_id(2, 'test')
M.register_callback(2, E.LINE, on_line)
M.register_callback(2, E.JUMP, on_jump)
M.set_local_events(2, target.__code__, E.LINE | E.JUMP)
target(2)
M.set_local_events(2, target.__code__, 0)
M.free_tool_id(2)

requests.put(None)
thread.join()
