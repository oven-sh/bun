print("run selfref")
lazy from selfref import thing
try:
    thing
except ImportError as e:
    print(type(e).__name__, e, e.name)
thing = 5
