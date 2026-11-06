# gc.get_referents() of a generator that is running in another thread, where it raises, catches and raises again. One of its referents is the exception that it is handling. An audit hook
# waits on 'gc.get_referents', so the other thread runs between the hook and the look. Whatever is handed out is whole: asked in the ordinary way (__traceback__, tb_frame, tb_next, f_back), every
# traceback begins in the generator and every frame but the generator's has its caller.
import gc, sys, threading, time

stop = False
def deep(n):
    if n == 0: {}['x']
    deep(n - 1)
def spin():
    for i in range(200): pass
def g():
    while not stop:
        try: deep(5)
        except KeyError: spin()
    yield 1
gen = g()
thread = threading.Thread(target=lambda: next(gen)); thread.start()
sys.setswitchinterval(0.0001)
listens = True
def hook(event, args):
    if listens and event == 'gc.get_referents': time.sleep(0.0005)
sys.addaudithook(hook)

# (As many rounds as there is time for, and thirty at the least: a build with assertions is slow.)
held = []; rounds = 0; deadline = time.monotonic() + 6
while rounds < 4000 and (rounds < 30 or time.monotonic() < deadline):
    held += [r for r in gc.get_referents(gen) if isinstance(r, KeyError)]; rounds += 1
stop = True; thread.join(); listens = False

wrong = set()
for error in held:
    names = []; entry = error.__traceback__
    while entry is not None:
        frame = entry.tb_frame; names.append(frame.f_code.co_name)
        if frame.f_back is None and names[-1] != 'g': wrong.add('a frame of %s() without its caller' % names[-1])
        entry = entry.tb_next
    if names != ['g'] + ['deep'] * 6: wrong.add('a traceback of ' + ' '.join(names))
print('exceptions were handed out:', bool(held))
print('wrong:', sorted(wrong))
