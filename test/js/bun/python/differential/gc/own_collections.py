# The collector's own collections are told to gc.callbacks, and find cycles, without anybody asking.
import gc, weakref
events = []
def callback(phase, info): events.append((phase, info["generation"], sorted(info)))
class Node: pass
found = []
def make():
    n = Node(); n.me = n
    return weakref.ref(n, found.append)
gc.callbacks.append(callback)
r = make()
junk = []
for i in range(3_000_000):
    junk.append([i])
    if len(junk) > 5000: junk.clear()
    if found and len(events) >= 2: break
gc.callbacks.remove(callback)
print("found", bool(found), r() is None)
phases = [e[0] for e in events]
print("told", bool(events), phases[0], all(a == "start" and b == "stop" for a, b in zip(phases[::2], phases[1::2])))
print(all(e[1] in (0, 1, 2) for e in events), events[0][2])
print(all(a[1] == b[1] for a, b in zip(events[::2], events[1::2])))
# Not while it is disabled.
gc.disable(); events.clear(); gc.callbacks.append(callback)
for i in range(200_000):
    junk.append([i])
    if len(junk) > 5000: junk.clear()
print("disabled", events, gc.isenabled())
print(gc.collect() >= 0, [e[:2] for e in events])
gc.enable(); gc.callbacks.clear()
