# A jump back is a place where code of the program may run that nobody called: the handler of a signal, a finalizer, another thread. A trace function is told of the line that the jump
# leads to once, whatever has run in between.
import signal, sys, threading
log = []; told = [0]; ran = []
def handler(number, frame):
    for i in range(2): ran.append(i)
signal.signal(signal.SIGUSR1, handler)
def tracer(frame, event, arg):
    code = frame.f_code
    if code is handler.__code__: return tracer
    if code.co_filename == __file__ and code.co_name in NAMES:
        log.append((event, code.co_name, frame.f_lineno))
        told[0] += 1
        if told[0] == WHEN: signal.raise_signal(signal.SIGUSR1)
    return tracer
def plain(n):
    total = 0
    for i in range(n):
        total += i
    return total
def one_line(n):
    for i in range(n): pass
def loop_in_loop(n):
    for i in range(n):
        for j in range(2): pass
def while_loop(n):
    while n: n -= 1
def while_lines(n):
    while n:
        n -= 1
        if n == 1: continue
def work():
    ''.join(str(v) for v in range(4))
    plain(3)
    [x for x in range(3)]
    one_line(3); loop_in_loop(2); while_loop(3); while_lines(3)
    {x: y for x in range(2) for y in range(2)}
    any(v > 5 for v in (1, 2, 3))
    return sum(v for v in (1, 2, 3))
NAMES = ('work', 'plain', 'one_line', 'loop_in_loop', 'while_loop', 'while_lines', '<genexpr>')
def run(when):
    global WHEN
    WHEN = when; log.clear(); told[0] = 0
    sys.settrace(tracer)
    try: work()
    finally: sys.settrace(None)
    return list(log)
good = run(0)
print(len(good), 'events')
for event in good: print(*event)
for k in range(1, len(good) + 1):
    del ran[:]
    got = run(k)
    if got != good or ran != [0, 1]: print('a signal in the call for event', k, good[k - 1], ':', len(got), 'events, the handler ran', ran)
# Another thread takes its turn at jumps back.
stop = []
def other():
    while not stop:
        for i in range(50): pass
old = sys.getswitchinterval(); sys.setswitchinterval(1e-5)
thread = threading.Thread(target=other); thread.start()
try: bad = sum(run(0) != good for i in range(300))
finally:
    stop.append(1); thread.join(); sys.setswitchinterval(old)
print('with another thread:', bad, 'runs of 300 differ')
