# Each byte that is read was written by the handler of a signal, and the signals come thick: before the read, in the look whether there is
# something to read, in the wait, in the read itself.
import os, signal

r, w = os.pipe()
handled = 0
def handler(number, frame):
    global handled
    handled += 1
    os.write(w, b".")
signal.signal(signal.SIGALRM, handler)
signal.setitimer(signal.ITIMER_REAL, 0.0002, 0.0002)
count = 0
while count < 3000:
    count += len(os.read(r, 1))
signal.setitimer(signal.ITIMER_REAL, 0, 0)
print(count, handled >= count)

# The same with a handler that raises, now and then: only while the loop is in its `try`, or nobody would catch it.
class Now(Exception): pass
def raises(number, frame):
    global handled, may_raise
    handled += 1
    os.write(w, b".")
    if may_raise and handled % 7 == 0:
        may_raise = False
        raise Now
signal.signal(signal.SIGALRM, raises)
os.set_blocking(r, False)
try:
    while True: os.read(r, 65536)
except BlockingIOError: pass
os.set_blocking(r, True)
handled = count = raised = 0
may_raise = False
signal.setitimer(signal.ITIMER_REAL, 0.0002, 0.0002)
while raised < 200:
    try:
        may_raise = True
        while True: count += len(os.read(r, 1))
    except Now: raised += 1
signal.setitimer(signal.ITIMER_REAL, 0, 0)
print(raised, count > 0)
