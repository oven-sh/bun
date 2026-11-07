import functools, io, os, signal, sys, threading

readable, writable = os.pipe()
armed = False
callback = None

def handler(*ignored):
    global armed
    if armed:
        armed = False
        callback()

def install(function):
    global callback
    callback = function
    signal.signal(signal.SIGUSR1, handler)

# For a call that does not wait: an audit hook is code of the program too.
def install_audit_hook():
    sys.addaudithook(lambda event, arguments: handler() if event == "os.setxattr" else None)

def keep_a_thread():
    threading.Thread(target=threading.Event().wait, daemon=True).start()

def feed(count):
    os.write(writable, b"\xee" * count)
    if event is not None:
        os.eventfd_write(event, 0xeeeeeeeeeeeeee)
def drain(): os.read(readable, 1 << 20)
def fill():
    os.set_blocking(writable, False)
    try:
        while True: os.write(writable, b"." * 4096)
    except BlockingIOError: pass
    os.set_blocking(writable, True)
# What there is in the pipe when all is over.
def left_in_the_pipe():
    os.set_blocking(readable, False)
    try: return len(os.read(readable, 1 << 20))
    except BlockingIOError: return 0

# A raw stream that is asked whether it is closed by way of code of the program.
class Raw(io.RawIOBase):
    received = b""
    def readable(self): return True
    def writable(self): return True
    def readinto(self, target):
        target[:] = b"\xee" * len(target)
        return len(target)
    def write(self, data):
        Raw.received += bytes(data)
        return len(data)
    @property
    def closed(self):
        handler()
        return False

raw_reader = open(readable, "rb", buffering=0, closefd=False)
raw_writer = open(writable, "wb", buffering=0, closefd=False)
reader_over_raw = io.BufferedReader(Raw(), 8192)
whole = lambda memory: memory
# Functions written in C++, and what they are called with: see call().
calls = {
    "os.readinto()": (functools.partial(os.readinto, readable), whole),
    "os.readinto() of a part": (functools.partial(os.readinto, readable), lambda memory: memoryview(memory)[1024:2048]),
    "os.readv()": (functools.partial(os.readv, readable), lambda memory: [bytearray(0), memory]),
    "FileIO.readinto()": (raw_reader.readinto, whole),
    "BufferedReader.readinto()": (io.BufferedReader(raw_reader, 16).readinto, whole),
    "BufferedReader.readinto() of a part": (io.BufferedReader(raw_reader, 16).readinto, lambda memory: memoryview(memory)[1024:2048]),
    # (With all that is wanted in its buffer already.)
    "BufferedReader.readinto() over a stream of Python's": (reader_over_raw.readinto, lambda memory: (reader_over_raw.peek(1), memory)[1]),
    "os.write()": (functools.partial(os.write, writable), whole),
    "os.writev()": (functools.partial(os.writev, writable), lambda memory: [b"", memory]),
    "FileIO.write()": (raw_writer.write, whole),
    "BufferedWriter.write()": (io.BufferedWriter(raw_writer, 16).write, whole),
    "BufferedWriter.write() over a stream of Python's": (io.BufferedWriter(Raw(), 8192).write, whole),
}
event = None
if sys.platform == "linux":
    # Whether one of these can be read is not to be found out beforehand, so a file waits in read() itself. (For a pipe it waits until that can be read, and then reads.)
    event = os.eventfd(0)
    raw_event_reader = open(event, "rb", buffering=0, closefd=False)
    calls["FileIO.readinto() of an eventfd"] = raw_event_reader.readinto, whole
    calls["BufferedReader.readinto1() of an eventfd"] = io.BufferedReader(raw_event_reader, 16).readinto1, whole
    calls["os.setxattr()"] = functools.partial(os.setxattr, readable, "user.name"), whole

# The signal comes again and again. The handler does something once, when the call of the system has begun: between the assignment and that no function of Python's is entered and none
# written in C++ returns, so there is no place where handlers are called.
def call(name, memory):
    global armed
    function, prepare = calls[name]
    argument = prepare(memory)
    try:
        armed = True
        return function(argument)
    except BufferError as error:
        return f"BufferError: {error}"
    finally:
        armed = False
