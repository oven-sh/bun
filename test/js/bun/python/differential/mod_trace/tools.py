# trace, bdb, doctest's debugger, a coverage tool in the manner of coverage.py, timeit under a profiler.
import bdb
import doctest
import io
import sys
import threading
import trace


def helper(n):
    if n > 1:
        return n * 2
    return n


def work(n):
    total = 0
    for i in range(n):
        total += helper(i)
    return total


print('== trace: counts')
tracer = trace.Trace(count=1, trace=0)
print(tracer.runfunc(work, 3))
first = helper.__code__.co_firstlineno
for (filename, line), count in sorted(tracer.results().counts.items()):
    if filename == __file__:
        print('  ', line - first, count)

print('== trace: lines as they run')
out = sys.stdout
sys.stdout = captured = io.StringIO()
try:
    trace.Trace(count=0, trace=1).runfunc(work, 2)
finally:
    sys.stdout = out
for line in captured.getvalue().splitlines():
    print('  ', line.replace(__file__, 'FILE'))

print('== trace: who calls whom')
tracer = trace.Trace(count=0, trace=0, countcallers=1)
tracer.runfunc(work, 1)
for (caller, callee) in sorted(tracer.results().callers):
    if callee[0] == __file__:
        print('  ', caller[2].rsplit('.', 1)[-1], '->', callee[2])  # The class is found with gc.get_referrers().

print('== trace: functions called')
tracer = trace.Trace(count=0, trace=0, countfuncs=1)
tracer.runfunc(work, 1)
print(sorted(name for filename, module, name in tracer.results().calledfuncs if filename == __file__))

print('== trace: executable lines')
print(sorted(line - first for line in trace._find_executable_linenos(__file__) if line is not None and first <= line <= first + 12))


print('== bdb')


class Recorder(bdb.Bdb):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.log = []

    def where(self, frame):
        return frame.f_code.co_name, frame.f_lineno - first

    def user_call(self, frame, args):
        self.log.append(('call',) + self.where(frame))

    def user_line(self, frame):
        self.log.append(('line',) + self.where(frame))
        if len(self.log) > 12:
            self.set_continue()
        else:
            self.set_step()

    def user_return(self, frame, value):
        self.log.append(('return',) + self.where(frame) + (value,))

    def user_exception(self, frame, info):
        self.log.append(('exception',) + self.where(frame) + (info[0].__name__,))


for backend in ('settrace', 'monitoring'):
    recorder = Recorder(backend=backend)
    print(backend, recorder.runcall(work, 2))
    for entry in recorder.log:
        print('  ', *entry)


class Breaker(Recorder):
    def user_line(self, frame):
        self.log.append(('line',) + self.where(frame) + (dict(frame.f_locals),))
        self.set_continue()

    def user_call(self, frame, args):
        pass

    def user_return(self, frame, value):
        pass


for backend in ('settrace', 'monitoring'):
    breaker = Breaker(backend=backend)
    breaker.set_break(__file__, first + 2)
    print(backend, breaker.runcall(work, 4))
    for entry in breaker.log:
        print('  ', *entry)
    breaker.clear_all_breaks()


print('== doctest with pdb')


def documented():
    """
    >>> x = 41
    >>> import pdb; pdb.set_trace()
    >>> print(x + 1)
    42
    """


real_stdin = sys.stdin
sys.stdin = io.StringIO('p x\nc\n')
out = sys.stdout
sys.stdout = captured = io.StringIO()
try:
    runner = doctest.DocTestRunner(verbose=False)
    for test in doctest.DocTestFinder().find(documented, 'documented', globs={}):
        runner.run(test)
finally:
    sys.stdout = out
    sys.stdin = real_stdin
print(captured.getvalue())
print(runner.summarize(verbose=False))


print('== a coverage tool')
m = sys.monitoring
seen = set()


def line_seen(code, line):
    if code.co_filename == __file__:
        seen.add(line - first)
    return m.DISABLE


m.use_tool_id(m.COVERAGE_ID, 'cover')
m.register_callback(m.COVERAGE_ID, m.events.LINE, line_seen)
m.set_events(m.COVERAGE_ID, m.events.LINE)
work(1)
m.set_events(m.COVERAGE_ID, 0)
m.free_tool_id(m.COVERAGE_ID)
executable = {line - first for code in (helper.__code__, work.__code__) for _, _, line in code.co_lines() if line is not None}
print(sorted(line for line in seen if line <= 12), sorted(executable), sorted(executable - seen))


print('== threads')
log = []


def thread_trace(frame, event, arg):
    if frame.f_code is helper.__code__:
        log.append((threading.current_thread().name, event))
        return thread_trace


threading.settrace(thread_trace)
print(threading.gettrace() is thread_trace)
threads = [threading.Thread(target=helper, args=(i,), name='t%d' % i) for i in range(2)]
for t in threads:
    t.start()
    t.join()
helper(0)
threading.settrace(None)
print(log)

del log[:]


def thread_profile(frame, event, arg):
    if frame.f_code is helper.__code__:
        log.append((threading.current_thread().name, event))


threading.setprofile(thread_profile)
print(threading.getprofile() is thread_profile)
t = threading.Thread(target=helper, args=(0,), name='p')
t.start()
t.join()
threading.setprofile(None)
print(log)

del log[:]
ready = threading.Event()
go = threading.Event()


def waits():
    ready.set()
    go.wait()
    helper(0)


t = threading.Thread(target=waits, name='waiting')
t.start()
ready.wait()
threading.settrace_all_threads(thread_trace)
go.set()
t.join()
helper(0)
threading.settrace_all_threads(None)
helper(0)
print(log, sys.gettrace())

del log[:]
ready.clear()
go.clear()
t = threading.Thread(target=waits, name='waiting')
t.start()
ready.wait()
threading.setprofile_all_threads(thread_profile)
go.set()
t.join()
threading.setprofile_all_threads(None)
print(log, sys.getprofile())
