# A list is empty for as long as it is sorted. What a key or a comparison does to it is noticed if it puts an item in, though the item be taken out again.
acts = {
    'nothing': lambda x: None,
    'append + pop': lambda x: (x.append(1), x.pop()),
    'insert + del': lambda x: (x.insert(0, 1), x.__delitem__(0)),
    'extend + clear': lambda x: (x.extend([1, 2]), x.clear()),
    '+= and del [:]': lambda x: (x.__iadd__([1]), x.__delitem__(slice(None))),
    'x[:] = [1]; x[:] = []': lambda x: (x.__setitem__(slice(None), [1]), x.__setitem__(slice(None), [])),
    '100 items and clear': lambda x: (x.extend(range(100)), x.clear()),
    'append': lambda x: x.append(9),
    'clear': lambda x: x.clear(),
    'reverse': lambda x: x.reverse(),
    'sort': lambda x: x.sort(),
    'sort with a key': lambda x: x.sort(key=abs),
    'append + pop, sort': lambda x: (x.append(1), x.pop(), x.sort()),
    'append + pop, sort with a key': lambda x: (x.append(1), x.pop(), x.sort(key=abs)),
    '100 items and clear, sort with a key': lambda x: (x.extend(range(100)), x.clear(), x.sort(key=abs)),
    'append, sort with a key, pop': lambda x: (x.append(1), x.sort(key=abs), x.pop()),
    'extend by nothing': lambda x: x.extend([]),
    '*= 2': lambda x: x.__imul__(2),
    'x[:] = []': lambda x: x.__setitem__(slice(None), []),
    'copy': lambda x: x.copy(),
    'len': lambda x: len(x),
    'repr': lambda x: repr(x),
}


class Item:
    def __init__(self, value, act=None):
        self.value, self.act = value, act
    def __lt__(self, other):
        if self.act:
            act, self.act = self.act, None
            act()
        return self.value < other.value
    def __repr__(self):
        return str(self.value)


for count in (1, 3, 64, 65, 200):
    for name, act in acts.items():
        x = list(range(count, 0, -1))
        seen = []
        def key(v):
            if not seen:
                seen.append(len(x))
                act(x)
            return v
        try:
            x.sort(key=key)
            result = 'sorted'
        except ValueError as e:
            result = str(e)
        x.append(0)
        print(count, name, '|', result, '|', seen, x == list(range(1, count + 1)) + [0])
        if count > 1:
            x = [Item(i) for i in range(count, 0, -1)]
            x[0].act = lambda: act(x)
            try:
                x.sort()
                result = 'sorted'
            except ValueError as e:
                result = str(e)
            x.append(Item(0))
            print(count, name, 'in a comparison |', result, '|', [i.value for i in x] == list(range(1, count + 1)) + [0])

# The key raises, having touched the list: the items are back, in the order in which they were.
x = [3, 1, 2]
def key(v):
    x.append(v)
    raise KeyError(v)
try:
    x.sort(key=key)
except KeyError as e:
    print('KeyError', e, x)
x.append(4)
print(x)
