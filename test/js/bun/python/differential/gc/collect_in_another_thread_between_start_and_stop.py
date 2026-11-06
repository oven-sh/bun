# The main thread is between "start" and "stop": its callback waits. Another thread calls gc.collect() meanwhile. Whoever listens hears "start" and "stop" in turn, never one collection within another: of a
# collection that the main thread has asked for, and of one that nobody has asked for.
import gc, sys, threading

class Cycle:
    def __init__(self): self.me = self

def scene(asks):
    main = threading.get_ident()
    is_inside = threading.Event(); may_go_on = threading.Event(); heard = []; has_waited = []
    def listen(phase, info):
        heard.append((phase, 'main' if threading.get_ident() == main else 'other'))
        if phase == 'start' and threading.get_ident() == main and not has_waited:
            has_waited.append(1); is_inside.set(); may_go_on.wait(60)
    def other():
        if is_inside.wait(60):
            Cycle(); gc.collect()
        may_go_on.set()
    thread = threading.Thread(target=other)
    gc.collect(); gc.callbacks.append(listen); thread.start()
    if asks: gc.collect()
    else:
        i = 0; junk = None
        while not has_waited and i < 400000:
            junk = [[None] * 200, Cycle()]; i += 1
    thread.join(60); gc.callbacks.remove(listen)
    # As far as the "stop" that belongs to the first "start" of the main thread.
    heard = heard[heard.index(('start', 'main')):]
    return heard[:heard.index(('stop', 'main')) + 1]

print('a collection that was asked for:', scene(True))
print('one that nobody has asked for:', scene(False))
