# All signals are blocked, and some have been sent and wait to be taken, when faulthandler.dump_traceback_later() is called for the
# first time. An interpreter that needs a signal of its own then takes none of those.
import faulthandler, os, signal

REAL_TIME = range(signal.SIGRTMIN, signal.SIGRTMAX + 1)
signal.pthread_sigmask(signal.SIG_BLOCK, signal.valid_signals())
sent = [number for number in REAL_TIME if number >= signal.SIGRTMAX - 8]
for number in sent:
    os.kill(os.getpid(), number)
faulthandler.dump_traceback_later(1000)
print("pending:", sorted(signal.sigpending() & set(REAL_TIME)) == sent)
print("taken:", [signal.sigtimedwait([number], 10).si_signo for number in sent] == sent)
faulthandler.cancel_dump_traceback_later()
