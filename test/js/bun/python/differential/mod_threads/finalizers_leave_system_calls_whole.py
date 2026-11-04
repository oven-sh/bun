# A thread is in a system call that has done a part of what it was asked for, and its finalizers fall due. Nobody asks for a collection.
# A program that trusts a blocking call does not look at what it returns: the call does it all, as if nothing had happened.
import os, select, socket, threading, time

said = []   # (what, the thread that finalized it)
SIZE = 6 * 1024 * 1024


class A:
    def __init__(self, what):
        self.what = what

    def __del__(self):
        said.append((self.what, threading.current_thread().name))


def a_collection_has_come(n=[0]):
    # With reference counts there is nothing to wait for; a collector comes when enough has been allocated.
    # What this thread drops now is found no earlier than what another thread dropped before.
    n[0] += 1
    mine = ("of the main thread %d" % n[0], "MainThread")
    a = A(mine[0]); del a
    deadline = time.monotonic() + 60
    while mine not in said and time.monotonic() < deadline:
        [[i] for i in range(1000)]
    return mine in said


def in_a_thread(name, target):
    result = []
    thread = threading.Thread(target=lambda: result.append(target()), name=name)
    thread.start()
    return thread, result


def writes(name, begin, write, read, end):
    mine, other = begin()

    def target():
        data = bytes(SIZE)
        for i in range(10):
            a = A(name); del a
        count = write(mine, data)
        end(mine)
        return count

    thread, result = in_a_thread(name, target)
    select.select([other], [], [])   # It has begun, has filled what room there is, and waits for more.
    total, collections = 0, 0
    while piece := read(other, 65536):
        total += len(piece)
        if collections < 5:
            collections += a_collection_has_come()
    thread.join()
    print(name, "| collections meanwhile:", collections, "| written:", result[0] == SIZE, "| read:", total == SIZE, flush=True)


def pipe():
    r, w = os.pipe()
    return w, r


writes("os.write", pipe, os.write, os.read, os.close)
writes("os.writev", pipe, lambda fd, data: os.writev(fd, [data[:SIZE // 2], data[SIZE // 2:]]), os.read, os.close)
writes("FileIO.write", pipe, lambda fd, data: open(fd, "wb", buffering=0, closefd=False).write(data), os.read, os.close)
writes("send", socket.socketpair, lambda s, data: s.send(data), lambda s, n: s.recv(n), lambda s: s.shutdown(socket.SHUT_WR))
writes("sendmsg", socket.socketpair, lambda s, data: s.sendmsg([data]), lambda s, n: s.recv(n), lambda s: s.shutdown(socket.SHUT_WR))

a, b = socket.socketpair()


def receives():
    x = A("recv(MSG_WAITALL)"); del x
    return a.recv(10, socket.MSG_WAITALL)


thread, result = in_a_thread("recv(MSG_WAITALL)", receives)
b.send(b"0123")
collections = sum(a_collection_has_come() for i in range(3))
b.send(b"456789")
b.close()
thread.join()
print("recv(MSG_WAITALL) | collections meanwhile:", collections, "| received:", result[0], flush=True)
