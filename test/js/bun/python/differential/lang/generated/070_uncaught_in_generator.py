def g():
    yield 1
    raise LookupError("from the generator")
for v in g(): print(v)
