# The frame of a generator or a coroutine that has not started shows the variables of the enclosing functions too.
try: import inspect
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import inspect')

try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def outer():')

try: gen, coro = outer()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gen, coro = outer()')
try: g = gen(1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g = gen(1)')
try: print('inspect.getgeneratorstate(g) =>', inspect.getgeneratorstate(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inspect.getgeneratorstate(g)')
try: print('inspect.getgeneratorlocals(g) =>', inspect.getgeneratorlocals(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inspect.getgeneratorlocals(g)')
try: print('sorted(g.gi_frame.f_locals) =>', sorted(g.gi_frame.f_locals))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(g.gi_frame.f_locals)')
try: g.gi_frame.f_locals['shared'] = 'changed through the frame'
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: g.gi_frame.f_locals['shared'] = 'changed through the frame'")
try: print('next(g) =>', next(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: next(g)')
try: print('inspect.getgeneratorlocals(g) =>', inspect.getgeneratorlocals(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inspect.getgeneratorlocals(g)')
try: g.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: g.close()')
try: print(inspect.getgeneratorlocals(g))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inspect.getgeneratorlocals(g)')
try: c = coro()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c = coro()')
try: print('inspect.getcoroutinestate(c) =>', inspect.getcoroutinestate(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inspect.getcoroutinestate(c)')
try: print('inspect.getcoroutinelocals(c) =>', inspect.getcoroutinelocals(c))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: inspect.getcoroutinelocals(c)')
try: c.close()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: c.close()')
try: print("gen(5).gi_frame.f_locals['shared'] =>", gen(5).gi_frame.f_locals['shared'])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: gen(5).gi_frame.f_locals['shared']")
try: print("'unset_yet' in gen(5).gi_frame.f_locals =>", 'unset_yet' in gen(5).gi_frame.f_locals)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: 'unset_yet' in gen(5).gi_frame.f_locals")
try: print('gen.__code__.co_freevars =>', gen.__code__.co_freevars)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: gen.__code__.co_freevars')
