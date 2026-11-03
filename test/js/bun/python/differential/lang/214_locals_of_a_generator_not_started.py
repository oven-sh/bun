# The frame of a generator or a coroutine that has not started shows the variables of the enclosing functions too.
import inspect

def outer():
    shared = 'from outer'
    unset_yet = None
    del unset_yet
    def gen(a, b=2):
        local = a
        yield shared, local
        yield unset_yet
    async def coro(a=None):
        b = 'spam'
        return shared
    return gen, coro

gen, coro = outer()
g = gen(1)
print(inspect.getgeneratorstate(g), inspect.getgeneratorlocals(g), sorted(g.gi_frame.f_locals))
g.gi_frame.f_locals['shared'] = 'changed through the frame'
print(next(g), inspect.getgeneratorlocals(g))
g.close()
print(inspect.getgeneratorlocals(g))
c = coro()
print(inspect.getcoroutinestate(c), inspect.getcoroutinelocals(c))
c.close()
print(gen(5).gi_frame.f_locals['shared'], 'unset_yet' in gen(5).gi_frame.f_locals, gen.__code__.co_freevars)
