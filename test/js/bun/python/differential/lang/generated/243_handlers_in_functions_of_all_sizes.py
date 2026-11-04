# What is being handled before, in and after handlers of every kind, in functions with a few variables, with hundreds and with tens
# of thousands: the instruction a handler begins with has operands of one, two and four bytes.
try: import sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import sys')

try: BODY = '''
    out = []
    def now(label):
        e = sys.exception()
        out.append((label, type(e).__name__, repr(e.args) if e else None))
    class Manager:
        def __init__(self, swallows): self.swallows = swallows
        def __enter__(self): now('enter'); return self
        def __exit__(self, kind, value, traceback):
            now('exit')
            out.append(('given', kind and kind.__name__, value and value.args, traceback is not None))
            return self.swallows
    now('start')
    try:
        raise KeyError(1)
    except KeyError:
        now('except')
    now('after except')
    try:
        raise KeyError(2)
    except KeyError as e:
        now('except as')
        out.append(e.args)
    now('after except as')
    try:
        try:
            raise KeyError(3)
        finally:
            now('finally')
    except KeyError:
        now('outer of finally')
    now('after finally')
    try:
        raise KeyError(4)
    except KeyError:
        try:
            raise ValueError(5)
        except ValueError as inner:
            now('nested')
            out.append(('context', inner.__context__.args))
        now('back in the outer')
    now('after nested')
    try:
        try:
            raise KeyError(6)
        except KeyError:
            now('before raising in a handler')
            raise ValueError(7)
    except ValueError as e:
        now('raised in a handler')
        out.append(('context', e.__context__.args))
    now('after raising in a handler')
    try:
        try:
            raise KeyError(8)
        except KeyError as named:
            raise ValueError(9) from named
    except ValueError as e:
        now('raised from')
        out.append(('cause', e.__cause__.args, 'named' in locals()))
    try:
        try:
            raise KeyError(10)
        except ValueError:
            now('never')
    except KeyError:
        now('no clause matched')
    now('after no clause matched')
    try:
        try:
            raise KeyError(11)
        except KeyError:
            raise
    except KeyError as e:
        now('raised again')
        out.append(('context', e.__context__))
    with Manager(True):
        raise KeyError(12)
    now('after with')
    try:
        with Manager(False):
            raise KeyError(13)
    except KeyError:
        now('through with')
    try:
        raise KeyError(14)
    except KeyError:
        with Manager(True):
            now('with in a handler')
            raise ValueError(15)
        now('after with in a handler')
    for i in range(3):
        try:
            raise KeyError(16, i)
        except KeyError:
            now('in a loop')
            if i == 1:
                continue
            if i == 2:
                break
        finally:
            now('finally in a loop')
    now('after the loop')
    try:
        raise ExceptionGroup('g', [KeyError(17), ValueError(18), TypeError(19)])
    except* KeyError as group:
        now('except*')
        out.append(group.exceptions[0].args)
    except* ValueError:
        now('second except*')
    except* TypeError:
        now('third except*')
    now('after except*')
    def leaves():
        try:
            raise KeyError(20)
        except KeyError:
            return sys.exception().args
        finally:
            now('finally of a return')
    out.append(leaves())
    now('after a return in a handler')
    try:
        [1 / (1 - j) for j in range(3)]
    except ZeroDivisionError:
        now('out of a comprehension')
    now('end')
    return out
'''
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: BODY = ''' out = [] def now(label): e = sys.exception() out.append((l...")

try: GENERATOR = '''
    try:
        raise KeyError(1)
    except KeyError:
        yield type(sys.exception()).__name__
        yield type(sys.exception()).__name__
    yield type(sys.exception()).__name__
    try:
        yield 'in try'
    except ValueError as e:
        yield ('thrown in', e.args, type(sys.exception()).__name__)
    finally:
        yield ('finally', type(sys.exception()).__name__)
    yield type(sys.exception()).__name__
'''
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: GENERATOR = ''' try: raise KeyError(1) except KeyError: yield type(sy...")


try:
    def make(name, body, variables):
        # The variables that come first only take up room: nothing is ever assigned to them.
        room = '    if p is ...:\n        ' + ' = '.join('v%d' % i for i in range(variables)) + ' = 0\n'
        namespace = {'sys': sys}
        exec(compile('def %s(p):\n%s%s' % (name, room, body), '<sizes>', 'exec'), namespace)
        return namespace[name]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def make(name, body, variables):')


try:
    def drive(function):
        seen = []
        g = function(None)
        seen.append(next(g))
        try:
            raise OSError('outside')
        except OSError:
            # It has its own, and behind that the caller's.
            seen.append(next(g))
            seen.append(next(g))
            seen.append(type(sys.exception()).__name__)
        seen.append(next(g))
        seen.append(g.throw(ValueError(2)))
        seen.append(next(g))
        seen.append(next(g))
        seen.append(list(g))
        return seen
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def drive(function):')


try: first = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: first = None')
try:
    for variables in (1, 300, 33000):
        try: result = make('f', BODY, variables)(None), drive(make('g', GENERATOR, variables))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: result = make('f', BODY, variables)(None), drive(make('g', GENERATOR,...")
        if first is None:
            try: first = result
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: first = result')
            for row in result[0]:
                try: print('row [' + 'variables=' + (repr(variables) if type(variables) in (str, int, float, bytes, bool, type(None)) or (type(variables) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in variables)) else variables.__name__ if type(variables) is type else type(variables).__name__) + ", " + 'row=' + (repr(row) if type(row) in (str, int, float, bytes, bool, type(None)) or (type(row) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in row)) else row.__name__ if type(row) is type else type(row).__name__) + '] =>', row)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: row')
            try: print('result[1] [' + 'variables=' + (repr(variables) if type(variables) in (str, int, float, bytes, bool, type(None)) or (type(variables) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in variables)) else variables.__name__ if type(variables) is type else type(variables).__name__) + '] =>', result[1])
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: result[1]')
        try: print('variables [' + 'variables=' + (repr(variables) if type(variables) in (str, int, float, bytes, bool, type(None)) or (type(variables) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in variables)) else variables.__name__ if type(variables) is type else type(variables).__name__) + '] =>', variables)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: variables')
        try: print('result == first [' + 'variables=' + (repr(variables) if type(variables) in (str, int, float, bytes, bool, type(None)) or (type(variables) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in variables)) else variables.__name__ if type(variables) is type else type(variables).__name__) + '] =>', result == first)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: result == first')
        try: print('sys.exception() [' + 'variables=' + (repr(variables) if type(variables) in (str, int, float, bytes, bool, type(None)) or (type(variables) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in variables)) else variables.__name__ if type(variables) is type else type(variables).__name__) + '] =>', sys.exception())
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sys.exception()')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for variables in (1, 300, 33000):')
