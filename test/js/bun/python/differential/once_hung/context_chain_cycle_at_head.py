# test_exceptions.ExceptionTests.test_no_hang_on_context_chain_cycle2 (and 3): raising anything while an exception in a cycle of __context__ is being handled
class A(Exception): pass
class B(Exception): pass
a, b = A(), B()
a.__context__ = b
b.__context__ = a
try:
    raise a
except A:
    try:
        raise KeyError
    except KeyError as e:
        print(type(e.__context__))
print("done")
