# Whoever names a str by its address names the one that id() gives, also if the str has been put together and nobody has read it yet.
try: import pickle, io
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import pickle, io')
try:
    def parts(): return 'a long enough beginning, ' * 3, 'and a long enough end' * 3
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: def parts(): return 'a long enough beginning, ' * 3, 'and a long enou...")
try: a, b = parts()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a, b = parts()')
try: s = a + b
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s = a + b')
try: r = object.__repr__(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = object.__repr__(s)')
try: print('hex(id(s)) in r =>', hex(id(s)) in r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hex(id(s)) in r')
try: print("r.startswith('<str object at 0x') =>", r.startswith('<str object at 0x'))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: r.startswith('<str object at 0x')")
try: s = a + b
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s = a + b')
try: r = object.__repr__(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: r = object.__repr__(s)')
try: n = id(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n = id(s)')
try: len(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(s)')
try: s[0]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s[0]')
try: hash(s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hash(s)')
try: print('hex(n) in r =>', hex(n) in r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hex(n) in r')
try: print('n == id(s) =>', n == id(s))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: n == id(s)')
try: print('object.__repr__(s) == r =>', object.__repr__(s) == r)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: object.__repr__(s) == r')
try:
    class S(str): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class S(str): pass')
try: s = S(a + b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s = S(a + b)')
try: print(hex(id(s)) in object.__repr__(s))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: hex(id(s)) in object.__repr__(s)')
try:
    for protocol in range(pickle.HIGHEST_PROTOCOL + 1):
        try: s = a + b
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s = a + b')
        try: f = io.BytesIO()
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f = io.BytesIO()')
        try: p = pickle.Pickler(f, protocol)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p = pickle.Pickler(f, protocol)')
        try: p.dump([s, s, (s, s)])
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.dump([s, s, (s, s)])')
        try: print('protocol [' + 'protocol=' + (repr(protocol) if type(protocol) in (str, int, float, bytes, bool, type(None)) or (type(protocol) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in protocol)) else protocol.__name__ if type(protocol) is type else type(protocol).__name__) + '] =>', protocol)
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: protocol')
        try: print('id(s) in p.memo.copy() [' + 'protocol=' + (repr(protocol) if type(protocol) in (str, int, float, bytes, bool, type(None)) or (type(protocol) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in protocol)) else protocol.__name__ if type(protocol) is type else type(protocol).__name__) + '] =>', id(s) in p.memo.copy())
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: id(s) in p.memo.copy()')
        try: print('sorted(type(v[1]).__name__ for v in p.memo.copy().values()) [' + 'protocol=' + (repr(protocol) if type(protocol) in (str, int, float, bytes, bool, type(None)) or (type(protocol) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in protocol)) else protocol.__name__ if type(protocol) is type else type(protocol).__name__) + '] =>', sorted(type(v[1]).__name__ for v in p.memo.copy().values()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted(type(v[1]).__name__ for v in p.memo.copy().values())')
        try: print('all(k == id(v[1]) for k, v in p.memo.copy().items()) [' + 'protocol=' + (repr(protocol) if type(protocol) in (str, int, float, bytes, bool, type(None)) or (type(protocol) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in protocol)) else protocol.__name__ if type(protocol) is type else type(protocol).__name__) + '] =>', all(k == id(v[1]) for k, v in p.memo.copy().items()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: all(k == id(v[1]) for k, v in p.memo.copy().items())')
        try: print('len(f.getvalue()) [' + 'protocol=' + (repr(protocol) if type(protocol) in (str, int, float, bytes, bool, type(None)) or (type(protocol) is tuple and all(type(_i) in (str, int, float, bytes, bool, type(None)) for _i in protocol)) else protocol.__name__ if type(protocol) is type else type(protocol).__name__) + '] =>', len(f.getvalue()))
        except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(f.getvalue())')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for protocol in range(pickle.HIGHEST_PROTOCOL + 1):')
