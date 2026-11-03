# A class may have as its own attribute a method of a built-in type it does not derive from. Using it must be refused, not believed.
import operator, collections, itertools, io, array, re, types, functools, weakref, struct, datetime, decimal, fractions
def outcome(f):
    try:
        f()
        return "ok"
    except RecursionError:
        return "RecursionError"
    except BaseException as e:
        return type(e).__name__
TRIGGERS = {
    "__len__": len, "__iter__": iter, "__next__": next, "__hash__": hash, "__repr__": repr, "__str__": str, "__bool__": bool,
    "__int__": int, "__float__": float, "__index__": operator.index, "__complex__": complex, "__bytes__": bytes,
    "__neg__": operator.neg, "__pos__": operator.pos, "__abs__": abs, "__invert__": operator.invert,
    "__reversed__": reversed, "__call__": lambda c: c(), "__enter__": lambda c: c.__enter__(), "__dir__": dir,
    "__getitem__": lambda c: c[0], "__setitem__": lambda c: operator.setitem(c, 0, 0), "__delitem__": lambda c: operator.delitem(c, 0),
    "__contains__": lambda c: 0 in c, "__format__": lambda c: format(c, ""), "__sizeof__": lambda c: c.__sizeof__(),
    "__getattribute__": lambda c: c.x, "__setattr__": lambda c: setattr(c, "x", 1), "__delattr__": lambda c: delattr(c, "x"),
    "__round__": round, "__trunc__": lambda c: __import__("math").trunc(c), "__floor__": lambda c: __import__("math").floor(c),
    "__ceil__": lambda c: __import__("math").ceil(c), "__length_hint__": operator.length_hint, "__copy__": lambda c: __import__("copy").copy(c),
    "__reduce__": lambda c: c.__reduce__(), "__reduce_ex__": lambda c: c.__reduce_ex__(2), "__init__": lambda c: type(c)(),
    "__new__": lambda c: type(c)(), "__del__": lambda c: c.__del__(), "__await__": lambda c: c.__await__(), "__aiter__": lambda c: c.__aiter__(),
    "__anext__": lambda c: c.__anext__(), "__buffer__": memoryview, "__fspath__": lambda c: __import__("os").fspath(c),
    "__get__": lambda c: type("H", (), {"a": c})().a, "__set__": lambda c: setattr(type("H", (), {"a": c})(), "a", 1),
    "__instancecheck__": lambda c: isinstance(1, c), "__subclasscheck__": lambda c: issubclass(int, c), "__class_getitem__": lambda c: type(c)[int],
    "__missing__": lambda c: c.__missing__(0), "__exit__": lambda c: c.__exit__(None, None, None),
}
for name, op in (("add", operator.add), ("sub", operator.sub), ("mul", operator.mul), ("truediv", operator.truediv), ("floordiv", operator.floordiv),
                 ("mod", operator.mod), ("pow", operator.pow), ("lshift", operator.lshift), ("rshift", operator.rshift), ("and", operator.and_),
                 ("or", operator.or_), ("xor", operator.xor), ("matmul", operator.matmul), ("divmod", divmod)):
    TRIGGERS["__%s__" % name] = lambda c, op=op: op(c, c)
    TRIGGERS["__r%s__" % name] = lambda c, op=op: op(1, c)
    if name != "divmod":
        TRIGGERS["__i%s__" % name] = lambda c, name=name: getattr(operator, "i" + name.rstrip("_") + ("_" if name in ("and", "or") else ""))(c, c)
for name, op in (("eq", operator.eq), ("ne", operator.ne), ("lt", operator.lt), ("le", operator.le), ("gt", operator.gt), ("ge", operator.ge)):
    TRIGGERS["__%s__" % name] = lambda c, op=op: op(c, c)
TYPES = [int, float, complex, bool, str, bytes, bytearray, list, tuple, dict, set, frozenset, range, slice, memoryview, type, object, property,
         staticmethod, classmethod, super, enumerate, zip, map, filter, reversed, BaseException, Exception, OSError, StopIteration, KeyError,
         types.FunctionType, types.MethodType, types.BuiltinFunctionType, types.CodeType, types.FrameType, types.GeneratorType, types.CoroutineType,
         types.ModuleType, types.SimpleNamespace, types.MappingProxyType, types.CellType, types.TracebackType, types.GenericAlias, types.UnionType,
         type(iter([])), type(iter(())), type(iter("")), type(iter({})), type({}.keys()), type({}.values()), type({}.items()), type(iter(set())), type(iter(range(1))),
         collections.deque, collections.defaultdict, collections.OrderedDict, collections.Counter, itertools.count, itertools.chain, itertools.islice,
         io.BytesIO, io.StringIO, io.FileIO, io.BufferedReader, io.TextIOWrapper, array.array, re.Pattern, re.Match, functools.partial,
         weakref.ref, weakref.ProxyType, struct.Struct, type(None), type(NotImplemented), type(Ellipsis)]
count = 0
# foreign_descriptors.py [index of a type [names to leave out...]]: for drive_foreign.py, which finds every crash, not only the first.
import sys
ONLY = int(sys.argv[1]) if len(sys.argv) > 1 else None
LEFT_OUT = set(sys.argv[2:])
for index, T in enumerate(TYPES):
    if ONLY is not None and index != ONLY:
        continue
    results = []
    for name, value in sorted(vars(T).items()):
        if name in LEFT_OUT:
            continue
        if ONLY is not None:
            print("@", T.__name__, name, file=sys.stderr, flush=True)
        if type(value).__name__ not in ("method_descriptor", "wrapper_descriptor", "builtin_function_or_method", "classmethod_descriptor", "getset_descriptor", "member_descriptor"):
            continue
        if name in ("__new__", "__init_subclass__", "__subclasshook__", "__getattribute__", "__setattr__", "__delattr__", "__init__") and T is object:
            continue
        try:
            C = type("C", (), {name: value})
            c = object.__new__(C)
        except BaseException as e:
            results.append((name, "class: " + type(e).__name__)); continue
        r = [outcome(lambda: getattr(c, name)), outcome(lambda: getattr(c, name)())]
        if name in TRIGGERS:
            r.append(outcome(lambda: TRIGGERS[name](c)))
        count += 1
        results.append((name, " ".join(r)))
    summary = collections.Counter(r for _, r in results)
    print(T.__name__, sorted(summary.items()))
    for name, r in results:
        if "ok" in r: print("   ", name, r)
print(count)
