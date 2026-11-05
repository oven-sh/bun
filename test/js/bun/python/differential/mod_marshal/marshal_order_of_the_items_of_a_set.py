# marshal writes the items of a set in the order of what each is written as on its own, so that the same set gives the same bytes whatever the hashes are. Each is written
# as something that is referred to from elsewhere, which shows in its first byte and so in the order. A set is written like a tuple but for the first byte: with that
# changed, what is read back shows the order.
import itertools, marshal

MAKERS = [
    lambda: -1, lambda: 0, lambda: 5, lambda: 64, lambda: 1024, lambda: 1025, lambda: 2**31, lambda: int('2305843009213693951'), lambda: -int('1180591620717411303424'),
    lambda: float('2.5'), lambda: float('-0.0'), lambda: float('1e300'), lambda: complex('1j'), lambda: complex('2.5+1j'),
    lambda: (), lambda: (1, 2), lambda: (1, 1), lambda: ('a', 'a'), lambda: (float('2.5'), 1), lambda: (int('1180591620717411303424'), 1), lambda: (tuple([1, 2]), 3), lambda: (None, True),
    lambda: 'a', lambda: 'ab', lambda: '\xe9', lambda: '€', lambda: '', lambda: 'x'.join(['y'] * 20),
    lambda: b'', lambda: b'a', lambda: bytes([97, 98]),
    lambda: None, lambda: True, lambda: False, lambda: Ellipsis, lambda: frozenset(), lambda: frozenset([1]),
]

def order(items, version):
    data = bytearray(marshal.dumps(items, version))
    assert data[0] & 0x7f in b'<>'
    data[0] = data[0] & 0x80 | ord('(')
    return marshal.loads(bytes(data))

def main():
    for version in (2, 3, 4, 5):
        print('version', version)
        print('   ', order(frozenset(make() for make in MAKERS), version))
        print('   ', order({make() for make in reversed(MAKERS)}, version))
    number = 0
    for size in (2, 3):
        for makers in itertools.combinations(MAKERS, size):
            number += 1
            if size == 3 and number % 5:
                continue
            print(order(frozenset(make() for make in makers), 5))
    # What it is for.
    names = ['name%d' % i for i in range(40)]
    print(marshal.dumps(frozenset(names)) == marshal.dumps(frozenset(reversed(names))))
    print(order(frozenset(names), 5) == tuple(sorted(names, key=lambda name: (len(name), name))))
main()
