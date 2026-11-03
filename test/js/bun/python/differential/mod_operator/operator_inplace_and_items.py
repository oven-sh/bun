# In-place operators on sequences, and items of what cannot be changed: what _operator passes on to the interpreter.
import _operator as op


def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__, e)


class R:
    def __radd__(self, other):
        return 'radd', other

    def __rmul__(self, other):
        return 'rmul', other


# For `list += x` and `list *= x`, the methods of numbers are tried on both operands before the list has its say.
t(lambda: op.iadd([1], R()))
t(lambda: op.imul([1], R()))
t(lambda: op.iadd(bytearray(b'a'), R()))
t(lambda: op.imul([1, 2], [2]))
t(lambda: op.imul([1, 2], 'a'))
t(lambda: op.imul(bytearray(b'a'), 1.5))
# An index, for a sequence that cannot be changed
t(lambda: op.delitem('ab', 0))
t(lambda: op.delitem((1,), 0))
t(lambda: op.delitem('ab', 'x'))
t(lambda: op.setitem('ab', 0, 'x'))
t(lambda: op.setitem('ab', 'x', 'x'))
