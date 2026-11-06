# Threads raise exceptions some calls deep and catch them without looking at them, while the main thread walks the heap. Whatever gc gives of that is whole: a frame has the caller it had, by
# whichever way it is reached. (A runtime that puts off part of the work for an exception until somebody looks at it must not hand out what it has not finished.)
import gc, threading, time, types

over = []
def deep(n):
    if n: return deep(n - 1)
    raise KeyError(n)
def catches():
    try: deep(12)
    except KeyError: pass
class O: pass
def work():
    o = O()
    while not over:
        catches(); hasattr(o, 'nothing')
threads = [threading.Thread(target=work) for _ in range(3)]
for thread in threads: thread.start()

without_caller = {'frames': 0, 'tracebacks': 0, 'exceptions': 0}
def walk(frame, way):
    # deep() was called by deep() or catches(), and catches() by work().
    while frame is not None:
        caller = frame.f_back
        if caller is None and frame.f_code.co_name in ('deep', 'catches'): without_caller[way] += 1
        frame = caller
# (Six looks, or as many as there is time for, two at the least: a build with assertions is slow.)
looks = 0; deadline = time.monotonic() + 10
try:
    while looks < 6 and (looks < 2 or time.monotonic() < deadline):
        objects = gc.get_objects()
        for o in objects:
            if type(o) is types.FrameType: walk(o, 'frames')
            elif type(o) is types.TracebackType: walk(o.tb_frame, 'tracebacks')
            elif type(o) is KeyError or type(o) is AttributeError:
                entry = o.__traceback__
                while entry is not None:
                    walk(entry.tb_frame, 'exceptions'); entry = entry.tb_next
        objects = o = None
        for o in gc.get_referrers(deep):
            if type(o) is types.FrameType: walk(o, 'frames')
        o = None; looks += 1
finally:
    over.append(1)
for thread in threads: thread.join()
print('frames of deep() and catches() that lack their caller, by the way they were reached:', without_caller)
