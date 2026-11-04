# os.execv() and faulthandler.dump_traceback_later(): what is due is none of the new program's business, and a call that fails
# changes nothing about what is due.
import faulthandler, os, subprocess, sys, tempfile, threading, time


def count(log):
    return os.pread(log.fileno(), 1 << 20, 0).count(b"Timeout (")


def fail():
    try:
        os.execv("/nonexistent/program", ["program"])
    except FileNotFoundError:
        pass


def wait_for(condition, seconds=30):
    deadline = time.monotonic() + seconds
    while not condition() and time.monotonic() < deadline:
        time.sleep(0.01)
    return condition()


# Tracebacks fall due all the time while the program is replaced.
program = """
import faulthandler, os, tempfile
log = tempfile.TemporaryFile()
faulthandler.dump_traceback_later(5e-6, repeat=True, file=log)
while os.fstat(log.fileno()).st_size < 20000:
    pass
os.execv("/bin/echo", ["echo", "the new program"])
"""
children = [subprocess.Popen([sys.executable, "-c", program], stdout=subprocess.PIPE) for i in range(8)]
results = {(child.communicate()[0], child.returncode) for child in children}
print("replaced:", results)

# One that has been written is not written again.
log = tempfile.TemporaryFile()
faulthandler.dump_traceback_later(0.05, file=log)
print("written:", wait_for(lambda: count(log) == 1))
fail()
print("again:", wait_for(lambda: count(log) > 1, 0.5))
faulthandler.cancel_dump_traceback_later()

# What is cancelled before it could be written is not written later, into the file of the next one.
first = tempfile.TemporaryFile()
second = tempfile.TemporaryFile()


directory = tempfile.mkdtemp()
fifo = os.path.join(directory, "fifo")
os.mkfifo(fifo)


def change():
    wait_for(lambda: count(first) == 1)
    faulthandler.cancel_dump_traceback_later()
    faulthandler.dump_traceback_later(1000, file=second)
    open(fifo, "w").close()


thread = threading.Thread(target=change)
thread.start()
faulthandler.dump_traceback_later(0.05, file=first)
# (A call that goes on by itself when it is interrupted.)
os.system("cat " + fifo)
thread.join()
faulthandler.cancel_dump_traceback_later()
os.unlink(fifo)
os.rmdir(directory)
print("in the file of the next one:", os.pread(second.fileno(), 1 << 16, 0))

# The time goes on.
program = """
import faulthandler, os, time
faulthandler.dump_traceback_later(0.5, exit=True)
end = time.monotonic() + 30
while time.monotonic() < end:
    time.sleep(0.1)
    try:
        os.execv("/nonexistent/program", ["program"])
    except FileNotFoundError:
        pass
"""
result = subprocess.run([sys.executable, "-c", program], capture_output=True)
print("ended:", result.returncode, b"Timeout (0:00:00.500000)!" in result.stderr)

# It says where it was, although such calls are all it does.
program = """
import faulthandler, os
faulthandler.dump_traceback_later(0.05, exit=True)
while True:
    try:
        os.execv("/nonexistent/program", ["program"])
    except FileNotFoundError:
        pass
"""
result = subprocess.run([sys.executable, "-c", program], capture_output=True)
print("ended:", result.returncode, b"Timeout (0:00:00.050000)!" in result.stderr, b'File "<string>", line ' in result.stderr)
