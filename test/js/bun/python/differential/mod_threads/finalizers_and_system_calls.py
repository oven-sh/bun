# A thread that is in a system call when its finalizers fall due. Nobody asks for a collection.
# Where the call has transferred nothing yet, the thread makes the calls at once and goes on waiting.
# Where it may have done a part (write, send, recv with MSG_WAITALL), nothing is sent to get it out: a signal would make the call return
# that part. (That the call then does all it was asked for is in finalizers_leave_system_calls_whole.py.)
import os, select, signal, socket, threading, time

# What gets a thread out of a system call is SIGURG, and a handler of the program's hears of it as of any other.
urgent = []
signal.signal(signal.SIGURG, lambda number, frame: urgent.append(number))

said = []   # (what, the thread that finalized it)


class A:
    def __init__(self, what):
        self.what = what

    def __del__(self):
        said.append((self.what, threading.current_thread().name))


def churn(until):
    # With reference counts there is nothing to wait for; a collector comes when enough has been allocated.
    deadline = time.monotonic() + 60
    while not until() and time.monotonic() < deadline:
        [[i] for i in range(1000)]
    return until()


def a_collection_has_come(n=[0]):
    # What this thread drops now is found no earlier than what another thread dropped before.
    n[0] += 1
    mine = "of the main thread %d" % n[0]
    a = A(mine); del a
    return churn(lambda: (mine, "MainThread") in said)


def in_a_thread(name, target, daemon=False):
    result = []
    thread = threading.Thread(target=lambda: result.append(target()), name=name, daemon=daemon)
    thread.start()
    return thread, result


# ---- Calls that wait and have nothing to lose
def waits(name, begin, block, end=None):
    state = begin()
    is_about_to_block = threading.Event()

    def target():
        a = A(name); del a
        is_about_to_block.set()
        return block(state)

    thread, result = in_a_thread(name, target, daemon=not end)
    is_about_to_block.wait()
    came = churn(lambda: (name, name) in said)
    if not end:
        print(name, "| finalized by its maker while that waited:", came, "| and the call goes on:", thread.is_alive(), flush=True)
        return
    end(state)
    thread.join()
    print(name, "| finalized by its maker while that waited:", came, "| then the call returned", result[0], flush=True)


def listener():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); s.listen()
    return s


def connect_to(s):
    socket.create_connection(s.getsockname()).close()


waits("recv", socket.socketpair, lambda p: p[0].recv(10), lambda p: p[1].send(b"x"))
waits("recv_into", socket.socketpair, lambda p: p[0].recv_into(bytearray(10)), lambda p: p[1].send(b"xy"))
waits("recvfrom", socket.socketpair, lambda p: p[0].recvfrom(10)[0], lambda p: p[1].send(b"x"))
waits("recvmsg", socket.socketpair, lambda p: p[0].recvmsg(10)[0], lambda p: p[1].send(b"x"))
waits("accept", listener, lambda s: type(s.accept()[0]).__name__, connect_to)
waits("os.read", os.pipe, lambda p: os.read(p[0], 10), lambda p: os.write(p[1], b"x"))
waits("os.readv", os.pipe, lambda p: os.readv(p[0], [bytearray(10)]), lambda p: os.write(p[1], b"xyz"))
waits("FileIO.read", os.pipe, lambda p: open(p[0], "rb", buffering=0, closefd=False).read(10), lambda p: os.write(p[1], b"x"))
waits("select", os.pipe, lambda p: select.select([p[0]], [], [], 120)[0] == [p[0]], lambda p: os.write(p[1], b"x"))
waits("poll", os.pipe, lambda p: (lambda q: (q.register(p[0], select.POLLIN), q.poll(120000))[1])(select.poll()) == [(p[0], select.POLLIN)], lambda p: os.write(p[1], b"x"))
waits("sleep", lambda: None, lambda _: time.sleep(1000))   # Nothing ends it: the program leaves it behind.

# ---- Calls that may have done a part
SIZE = 6 * 1024 * 1024


def writes(name, begin, write, read, end):
    mine, other = begin()

    def target():
        data = bytes(SIZE)
        for i in range(10):
            a = A(name); del a
        write(mine, data)
        end(mine)
        # Now they are made.
        return churn(lambda: said.count((name, name)) == 10)

    thread, result = in_a_thread(name, target)
    select.select([other], [], [])   # It has begun, has filled what room there is, and waits for more.
    urgent.clear()
    collections = sum(a_collection_has_come() for i in range(5))
    signals = len(urgent)
    while read(other, 65536):
        pass
    thread.join()
    print(name, "| collections meanwhile:", collections, "| signals to get it out:", signals, "| afterwards finalized by its maker:", result[0], flush=True)


def pipe():
    r, w = os.pipe()
    return w, r


writes("os.write", pipe, os.write, os.read, os.close)
writes("os.writev", pipe, lambda fd, data: os.writev(fd, [data[:SIZE // 2], data[SIZE // 2:]]), os.read, os.close)
writes("FileIO.write", pipe, lambda fd, data: open(fd, "wb", buffering=0, closefd=False).write(data), os.read, os.close)
writes("send", socket.socketpair, lambda s, data: s.send(data), lambda s, n: s.recv(n), lambda s: s.shutdown(socket.SHUT_WR))
writes("sendmsg", socket.socketpair, lambda s, data: s.sendmsg([data]), lambda s, n: s.recv(n), lambda s: s.shutdown(socket.SHUT_WR))


def all_of_it():
    a, b = socket.socketpair()

    def target():
        x = A("recv(MSG_WAITALL)"); del x
        is_about_to_block.set()
        a.recv(10, socket.MSG_WAITALL)
        return churn(lambda: ("recv(MSG_WAITALL)", "recv(MSG_WAITALL)") in said)

    is_about_to_block = threading.Event()
    thread, result = in_a_thread("recv(MSG_WAITALL)", target)
    is_about_to_block.wait()
    b.send(b"0123")
    urgent.clear()
    collections = sum(a_collection_has_come() for i in range(5))
    signals = len(urgent)
    b.send(b"456789")
    b.close()
    thread.join()
    print("recv(MSG_WAITALL) | collections meanwhile:", collections, "| signals to get it out:", signals, "| afterwards finalized by its maker:", result[0], flush=True)


all_of_it()
print(sorted(set(entry for entry in said if not entry[0].startswith("of the main thread"))))
