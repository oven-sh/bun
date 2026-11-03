import js
registry = {}
items = [1, 2]
class Holder:
    def __init__(self): self.value = None
holder = Holder()
def keep(name, value): registry[name] = value
def get(name): return registry[name]
def is_same(name, value): return registry[name] is value
def append(lst, v): lst.append(v); return lst
def length(x): return len(x)
def read(obj, name): return getattr(obj, name)
def read_item(obj, key): return obj[key]
def write(obj, name, v): setattr(obj, name, v)
def write_item(obj, key, v): obj[key] = v
def call_method(obj, name, *args): return getattr(obj, name)(*args)
def call_back(f, *args): return f(*args)
def apply_twice(f, x): return f(f(x))
def keys_of(obj): return sorted(obj)
def show(x): return repr(x)
def mutate_all(lst):
    for i, v in enumerate(lst): lst[i] = v * 2
def make_counter():
    n = 0
    def count():
        nonlocal n
        n += 1
        return n
    return count
def use_js_global(): return js.Math.max(1, 5), js.JSON.stringify([1, {"a": None}]), js.parseInt("12px")
def new_js(cls, *args): return cls.new(*args)
def has(obj, name): return hasattr(obj, name)
_private = 1
__all__ = ["registry"]
