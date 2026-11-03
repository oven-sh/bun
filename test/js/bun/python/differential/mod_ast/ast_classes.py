import _ast

names = sorted(n for n in dir(_ast) if not n.startswith("__"))
print(names)
for n in names:
    v = getattr(_ast, n)
    if isinstance(v, type):
        print(n, v.__name__, v.__qualname__, v.__module__, [b.__name__ for b in v.__bases__], [b.__name__ for b in v.__mro__])
        print("  fields", v._fields, v.__match_args__, v._fields is v.__match_args__)
        print("  attributes", v._attributes)
        print("  doc", repr(v.__doc__))
        print("  field_types", getattr(v, '_field_types', 'missing'))
        print("  annotations", v.__dict__.get('__annotations__', 'missing') is v.__dict__.get('_field_types', 'missing2'))
        print("  vars", sorted(vars(v)))
        print("  defaults", [(k, x) for k, x in sorted(vars(v).items()) if x is None])
        print("  repr", repr(v))
    else:
        print(n, repr(v))
