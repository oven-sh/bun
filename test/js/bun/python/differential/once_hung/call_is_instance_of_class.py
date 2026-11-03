# test_descr.ClassPropertiesAndMethods.test_recursive_call: hangs instead of RecursionError
class A(object):
    pass
A.__call__ = A()
try:
    A()()
except RecursionError:
    print("RecursionError")
