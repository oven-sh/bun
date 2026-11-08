# A list is empty for as long as it is sorted. What a key or a comparison does to it is noticed if it puts an item in, though the item be taken out again.
try: acts = {
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: acts = { 'nothing': lambda x: None, 'append + pop': lambda x: (x.appe...")


try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Item:')


try:
    for count in (1, 3, 64, 65, 200):
        for name, act in acts.items():
            try: x = list(range(count, 0, -1))
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = list(range(count, 0, -1))')
            try: seen = []
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen = []')
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
            try: x.append(0)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.append(0)')
            try: print('count [' + 'count=' + (repr(count) if type(count) in (str, int, float, bytes, bool, type(None)) or (type(count) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in count)) else count.__name__ if type(count) is type else type(count).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'act=' + (repr(act) if type(act) in (str, int, float, bytes, bool, type(None)) or (type(act) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in act)) else act.__name__ if type(act) is type else type(act).__name__) + '] =>', count)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: count')
            try: print('name [' + 'count=' + (repr(count) if type(count) in (str, int, float, bytes, bool, type(None)) or (type(count) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in count)) else count.__name__ if type(count) is type else type(count).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'act=' + (repr(act) if type(act) in (str, int, float, bytes, bool, type(None)) or (type(act) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in act)) else act.__name__ if type(act) is type else type(act).__name__) + '] =>', name)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
            try: print('|', 'result [' + 'count=' + (repr(count) if type(count) in (str, int, float, bytes, bool, type(None)) or (type(count) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in count)) else count.__name__ if type(count) is type else type(count).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'act=' + (repr(act) if type(act) in (str, int, float, bytes, bool, type(None)) or (type(act) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in act)) else act.__name__ if type(act) is type else type(act).__name__) + '] =>', result)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: result')
            try: print('|', 'seen [' + 'count=' + (repr(count) if type(count) in (str, int, float, bytes, bool, type(None)) or (type(count) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in count)) else count.__name__ if type(count) is type else type(count).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'act=' + (repr(act) if type(act) in (str, int, float, bytes, bool, type(None)) or (type(act) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in act)) else act.__name__ if type(act) is type else type(act).__name__) + '] =>', seen)
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: seen')
            try: print('x == list(range(1, count + 1)) + [0] [' + 'count=' + (repr(count) if type(count) in (str, int, float, bytes, bool, type(None)) or (type(count) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in count)) else count.__name__ if type(count) is type else type(count).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'act=' + (repr(act) if type(act) in (str, int, float, bytes, bool, type(None)) or (type(act) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in act)) else act.__name__ if type(act) is type else type(act).__name__) + '] =>', x == list(range(1, count + 1)) + [0])
            except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x == list(range(1, count + 1)) + [0]')
            if count > 1:
                try: x = [Item(i) for i in range(count, 0, -1)]
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = [Item(i) for i in range(count, 0, -1)]')
                try: x[0].act = lambda: act(x)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x[0].act = lambda: act(x)')
                try:
                    x.sort()
                    result = 'sorted'
                except ValueError as e:
                    result = str(e)
                try: x.append(Item(0))
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.append(Item(0))')
                try: print('count [' + 'count=' + (repr(count) if type(count) in (str, int, float, bytes, bool, type(None)) or (type(count) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in count)) else count.__name__ if type(count) is type else type(count).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'act=' + (repr(act) if type(act) in (str, int, float, bytes, bool, type(None)) or (type(act) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in act)) else act.__name__ if type(act) is type else type(act).__name__) + '] =>', count)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: count')
                try: print('name [' + 'count=' + (repr(count) if type(count) in (str, int, float, bytes, bool, type(None)) or (type(count) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in count)) else count.__name__ if type(count) is type else type(count).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'act=' + (repr(act) if type(act) in (str, int, float, bytes, bool, type(None)) or (type(act) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in act)) else act.__name__ if type(act) is type else type(act).__name__) + '] =>', name)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: name')
                try: print('in a comparison |', 'result [' + 'count=' + (repr(count) if type(count) in (str, int, float, bytes, bool, type(None)) or (type(count) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in count)) else count.__name__ if type(count) is type else type(count).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'act=' + (repr(act) if type(act) in (str, int, float, bytes, bool, type(None)) or (type(act) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in act)) else act.__name__ if type(act) is type else type(act).__name__) + '] =>', result)
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: result')
                try: print('|', '[i.value for i in x] == list(range(1, count + 1)) + [0] [' + 'count=' + (repr(count) if type(count) in (str, int, float, bytes, bool, type(None)) or (type(count) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in count)) else count.__name__ if type(count) is type else type(count).__name__) + ", " + 'name=' + (repr(name) if type(name) in (str, int, float, bytes, bool, type(None)) or (type(name) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in name)) else name.__name__ if type(name) is type else type(name).__name__) + ", " + 'act=' + (repr(act) if type(act) in (str, int, float, bytes, bool, type(None)) or (type(act) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in act)) else act.__name__ if type(act) is type else type(act).__name__) + '] =>', [i.value for i in x] == list(range(1, count + 1)) + [0])
                except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [i.value for i in x] == list(range(1, count + 1)) + [0]')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for count in (1, 3, 64, 65, 200):')

# The key raises, having touched the list: the items are back, in the order in which they were.
try: x = [3, 1, 2]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x = [3, 1, 2]')
try:
    def key(v):
        x.append(v)
        raise KeyError(v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def key(v):')
try:
    try:
        x.sort(key=key)
    except KeyError as e:
        print('KeyError', 'e =>', e)
        print('x =>', x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
try: x.append(4)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x.append(4)')
try: print(x)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: x')
