# A Future keeps its callbacks, but for the first, in a list of tuples (callback, context). gc.get_referents() hands out the list, and each item was taken for such a tuple, unseen.
import asyncio, gc
loop = asyncio.new_event_loop()
def future():
    f = loop.create_future(); f.add_done_callback(print); f.add_done_callback(repr)
    return f, [o for o in gc.get_referents(f) if type(o) is list]
for junk in (1, 'junk', (), (1, 2, 3), object()):
    for name, use in (('remove_done_callback', lambda f: f.remove_done_callback(str)), ('set_result', lambda f: f.set_result(1)), ('cancel', lambda f: f.cancel())):
        f, lists = future()
        for l in lists: l.append(junk)
        try: print(len(lists), 'no exception:', use(f))
        except SystemError as e: print(len(lists), type(junk).__name__, name, 'SystemError:', e)
loop.close()
