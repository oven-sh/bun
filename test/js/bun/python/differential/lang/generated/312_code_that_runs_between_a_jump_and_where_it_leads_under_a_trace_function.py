# A jump back is a place where code of the program may run that nobody called: the handler of a signal, a finalizer, another thread. A trace function is told of the line that the jump
# leads to once, whatever has run in between.
try: import signal, sys, threading
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import signal, sys, threading')
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try: told = [0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: told = [0]')
try: ran = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ran = []')
try:
    def handler(number, frame):
        for i in range(2): ran.append(i)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def handler(number, frame):')
try: signal.signal(signal.SIGUSR1, handler)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: signal.signal(signal.SIGUSR1, handler)')
try:
    def tracer(frame, event, arg):
        code = frame.f_code
        if code is handler.__code__: return tracer
        if code.co_filename == __file__ and code.co_name in NAMES:
            log.append((event, code.co_name, frame.f_lineno))
            told[0] += 1
            if told[0] == WHEN: signal.raise_signal(signal.SIGUSR1)
        return tracer
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def tracer(frame, event, arg):')
try:
    def plain(n):
        total = 0
        for i in range(n):
            total += i
        return total
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def plain(n):')
try:
    def one_line(n):
        for i in range(n): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def one_line(n):')
try:
    def loop_in_loop(n):
        for i in range(n):
            for j in range(2): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def loop_in_loop(n):')
try:
    def while_loop(n):
        while n: n -= 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def while_loop(n):')
try:
    def while_lines(n):
        while n:
            n -= 1
            if n == 1: continue
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def while_lines(n):')
try:
    def work():
        ''.join(str(v) for v in range(4))
        plain(3)
        [x for x in range(3)]
        one_line(3); loop_in_loop(2); while_loop(3); while_lines(3)
        {x: y for x in range(2) for y in range(2)}
        any(v > 5 for v in (1, 2, 3))
        return sum(v for v in (1, 2, 3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def work():')
try: NAMES = ('work', 'plain', 'one_line', 'loop_in_loop', 'while_loop', 'while_lines', '<genexpr>')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: NAMES = ('work', 'plain', 'one_line', 'loop_in_loop', 'while_loop', '...")
try:
    def run(when):
        global WHEN
        WHEN = when; log.clear(); told[0] = 0
        sys.settrace(tracer)
        try: work()
        finally: sys.settrace(None)
        return list(log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def run(when):')
try: good = run(0)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: good = run(0)')
try: print('len(good) =>', len(good))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(good)')
try: print('events')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'events'")
try:
    for event in good: print(*event)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for event in good: print(*event)')
try:
    for k in range(1, len(good) + 1):
        try: del ran[:]
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: del ran[:]')
        try: got = run(k)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: got = run(k)')
        if got != good or ran != [0, 1]: print('a signal in the call for event', k, good[k - 1], ':', len(got), 'events, the handler ran', ran)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for k in range(1, len(good) + 1):')
# Another thread takes its turn at jumps back.
try: stop = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: stop = []')
try:
    def other():
        while not stop:
            for i in range(50): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def other():')
try: old = sys.getswitchinterval()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: old = sys.getswitchinterval()')
try: sys.setswitchinterval(1e-5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.setswitchinterval(1e-5)')
try: thread = threading.Thread(target=other)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thread = threading.Thread(target=other)')
try: thread.start()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: thread.start()')
try:
    try: bad = sum(run(0) != good for i in range(300))
    finally:
        stop.append(1)
        thread.join()
        sys.setswitchinterval(old)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: bad = sum(run(0) != good for i in range(300))')
try: print('with another thread:', 'bad =>', bad)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bad')
try: print('runs of 300 differ')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'runs of 300 differ'")
