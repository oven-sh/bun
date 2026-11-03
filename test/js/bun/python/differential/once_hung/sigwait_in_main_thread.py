# test_signal.PendingSignalsTests.test_sigwait_thread: signal.sigwait() does not let other threads run
import os, threading, time, signal
signum = signal.SIGUSR1
def kill_later():
    time.sleep(0.2)
    os.kill(os.getpid(), signum)
signal.pthread_sigmask(signal.SIG_BLOCK, [signum])
killer = threading.Thread(target=kill_later)
killer.start()
print(signal.sigwait([signum]) == signum)
killer.join()
