# What an audit hook may do on the events of gc.get_objects(), get_referrers() and get_referents(): wait, look at the heap itself, collect, keep what it is shown, raise. And an __index__ that waits. Meanwhile
# a generator runs in another thread, where it raises, catches and raises again. Whatever anybody is handed is whole: every traceback begins in the generator, every frame of deep() has its caller.
import gc, sys, threading, time, types

stop = False
def deep(n):
    if n == 0: {}['x']
    deep(n - 1)
def spin():
    for i in range(100): pass
def g():
    while not stop:
        try: deep(5)
        except KeyError: spin()
    yield 1
gen = g()
thread = threading.Thread(target=lambda: next(gen)); thread.start()
sys.setswitchinterval(0.0001)

held = []; shown = []; raised = set()
state = {'listens': True, 'is inside': False, 'calls': 0, 'exceptions': False}
class HookError(Exception): pass
def keep(objects):
    # (Noted here: of what is held only the last 4,000 stay, and one large look gives more frames than that.)
    new = [x for x in objects if isinstance(x, (KeyError, types.TracebackType, types.FrameType))]
    state['exceptions'] |= any(isinstance(x, KeyError) for x in new)
    held.extend(new)
def hook(event, args):
    if not state['listens'] or state['is inside'] or not event.startswith('gc.'): return
    state['is inside'] = True
    try:
        state['calls'] += 1; n = state['calls']
        shown.append(args); del shown[:-5]
        time.sleep(0.0003)
        if n % 5 == 0: keep(gc.get_referents(gen))
        if n % 11 == 0: gc.collect()
        if n % 13 == 0: keep(x for x in gc.get_objects() if isinstance(x, KeyError))
        time.sleep(0.0003)
        if n % 7 == 0: raise HookError(event)
    finally:
        state['is inside'] = False
sys.addaudithook(hook)
class Index:
    def __index__(self):
        time.sleep(0.0005)
        return 2

# (As many rounds as there is time for, and thirty at the least: a build with assertions is slow.)
rounds = 0; deadline = time.monotonic() + 12
while rounds < 1500 and (rounds < 30 or time.monotonic() < deadline):
    try: keep(gc.get_referents(gen))
    except HookError as error: raised.add(str(error))
    if rounds % 50 == 25:
        try: keep(x for x in gc.get_objects(Index()) if isinstance(x, (KeyError, types.TracebackType)))
        except HookError as error: raised.add(str(error))
        try: keep(gc.get_referrers(gen, deep))
        except HookError as error: raised.add(str(error))
    del held[:-4000]; rounds += 1
stop = True; thread.join(); state['listens'] = False

wrong = set()
def walk(frame):
    for i in range(50):
        if frame is None: break
        if frame.f_back is None and frame.f_code.co_name == 'deep': wrong.add('a frame of deep() without its caller')
        frame = frame.f_back
for x in held:
    if isinstance(x, KeyError):
        names = []; entry = x.__traceback__
        while entry is not None:
            names.append(entry.tb_frame.f_code.co_name); walk(entry.tb_frame); entry = entry.tb_next
        if names[:1] != ['g']: wrong.add('a traceback of ' + ' '.join(names))
    elif isinstance(x, types.TracebackType): walk(x.tb_frame)
    else: walk(x)
print('exceptions were handed out:', state['exceptions'])
print('a hook has raised out of gc.get_referents():', 'gc.get_referents' in raised)
print('wrong:', sorted(wrong))
