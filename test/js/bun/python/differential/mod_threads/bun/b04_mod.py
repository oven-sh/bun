import asyncio, threading, time
async def in_thread(n):
    return await asyncio.to_thread(lambda: (time.sleep(0.02), n * 2, threading.current_thread() is not threading.main_thread()))
def blocking_join(n):
    out = []
    ts = [threading.Thread(target=lambda i=i: out.append(i)) for i in range(n)]
    [t.start() for t in ts]; [t.join() for t in ts]
    return sorted(out)
class Counter:
    def __init__(self): self.n = 0; self.lock = threading.Lock(); self.threads = []
    def start(self, k):
        def run():
            for _ in range(200):
                with self.lock: self.n += 1
        self.threads = [threading.Thread(target=run) for _ in range(k)]
        [t.start() for t in self.threads]
    def wait(self):
        [t.join() for t in self.threads]; return self.n
