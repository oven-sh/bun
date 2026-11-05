# The order in which a set gives its items shows how it was filled. A display of three to thirty constants is an empty set updated with a frozenset, which makes room for
# all of them at once; a display with anything else in it, or a longer one, is filled item by item, and the table grows on the way. (Ints: their hashes are the same in every process.)
def main():
    one = 1
    for stride in (1, 7, 8, 10, 16, 31, 64, 1000003):
        for count in list(range(1, 45)) + [64, 100]:
            items = ', '.join(str(i * stride) for i in range(count))
            namespace = {'one': one}
            exec(compile('display = {%s}\n'
                         'looped = [v for v in {%s}]\n'
                         'frozen = frozenset({%s})\n'
                         'with_a_variable = {%s, one}\n'
                         'starred = {*(%s,)}\n'
                         'def f(): return {%s}\n' % ((items,) * 6), '<source>', 'exec'), namespace)
            shown = [list(namespace[name]) for name in ('display', 'looped', 'frozen', 'with_a_variable', 'starred')] + [list(namespace['f']()), list(namespace['f']())]
            print(stride, count, *(' '.join(map(str, order)) for order in dict.fromkeys(map(tuple, shown))), sep=' | ')
            constants = [c for c in namespace['f'].__code__.co_consts if isinstance(c, frozenset)]
            print('   ', [sorted(c) == sorted(namespace['display']) for c in constants])
    # What is popped, added and removed afterwards goes by the table too.
    s = {10, 20, 30, 40, 50}
    s.add(60); s.discard(20); s.add(70)
    print(list(s), s.pop(), s.pop(), list(s))
    # Equal constants, and constants of several kinds.
    print(list({1, 1.0, True, 2, 2.0, 3}), list({0, False, 0.0, -0.0, 5, 6}), list({None, 1, 2, 3, ..., (1, 2), 4.5}) == list({None, 1, 2, 3, ..., (1, 2), 4.5}))
try: main()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: main()')
