# test_descr.MroTest.test_incomplete_super: super() of a class whose __mro__ is not there yet
class M(type):
    def mro(cls):
        if cls.__mro__ is None:
            try:
                super(cls, cls).xxx
            except AttributeError as e:
                print("AttributeError", e)
        return type.mro(cls)
class A(metaclass=M):
    pass
