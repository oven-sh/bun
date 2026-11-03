# A program that waits for what only the finalizer of something it has dropped brings about. With reference counts the finalizer
# has run before the wait begins.
import queue, threading, time

class Dropped:
    status = 200
    def __init__(self, action): self.action = action
    def __del__(self):
        self.action()

def make(action): return Dropped(action)

print("-- an event, no other thread")
event = threading.Event()
print(make(event.set).status, flush=True)
event.wait()
print("woke")

print("-- a lock")
lock = threading.Lock()
lock.acquire()
print(make(lock.release).status, flush=True)
lock.acquire()
print("acquired")

print("-- with a lock")
other = threading.Lock()
other.acquire()
print(make(other.release).status, flush=True)
with other:
    print("entered")

print("-- a queue")
items = queue.SimpleQueue()
print(make(lambda: items.put("item")).status, flush=True)
print(items.get())

print("-- a thread that waits for it, joined")
go = threading.Event()
thread = threading.Thread(target=go.wait)
thread.start()
print(make(go.set).status, flush=True)
thread.join()
print("joined")

print("-- while another thread sleeps")
stop = threading.Event()
sleeper = threading.Thread(target=stop.wait)
sleeper.start()
again = threading.Event()
print(make(again.set).status, flush=True)
again.wait()
print("woke")
stop.set()
sleeper.join()
