# test_logging.RotatingFileHandlerTest.test_should_not_rollover_named_pipe: open() of a FIFO waits for the other side without letting other threads run
import os, tempfile, threading
name = os.path.join(tempfile.mkdtemp(), "fifo")
os.mkfifo(name)
def other_side():
    with open(name, "rb") as f:
        print(f.read())
thread = threading.Thread(target=other_side)
thread.start()
with open(name, "wb") as f:
    f.write(b"data")
thread.join()
