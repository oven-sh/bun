# The module ends; the process idles in Bun's event loop, and the threads go on.
import js, threading, time
log = []
def work():
    for i in range(5):
        time.sleep(0.01); log.append(i)
def spin():
    n = 0
    t = time.monotonic()
    while time.monotonic() - t < 0.1: n += 1
    log.append("spun")
threading.Thread(target=work).start()
threading.Thread(target=spin).start()
js.setTimeout(lambda: print("timer", sorted(map(str, log))), 400)
print("module over")
