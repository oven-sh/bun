# Which __new__ makes an instance of a class with several built-in bases, and what a __new__ refuses to make.
import datetime, ast, collections, typing
def t(label, f):
    try:
        r = f()
        print(label, 'ok', type(r).__name__, type(r).__mro__[1].__name__)
    except Exception as e:
        print(label, type(e).__name__, e)
t('object.__new__(int)', lambda: object.__new__(int))
t('object.__new__(dict)', lambda: object.__new__(dict))
t('int.__new__(str)', lambda: int.__new__(str))
t('int.__new__(1)', lambda: int.__new__(1))
t('int.__new__()', lambda: int.__new__())
t('dict.__new__(OrderedDict)', lambda: dict.__new__(collections.OrderedDict))
t('tuple.__new__(time.struct_time)', lambda: tuple.__new__(type(__import__('time').gmtime())))
class A(dict): pass
t('object.__new__(A)', lambda: object.__new__(A))
t('dict.__new__(A)', lambda: dict.__new__(A))
class B(datetime.tzinfo, dict): pass
t('B()', lambda: B())
t('B.__new__(B)', lambda: B.__new__(B))
t('tzinfo.__new__(B)', lambda: datetime.tzinfo.__new__(B))
t('dict.__new__(B)', lambda: dict.__new__(B))
b = B(); b[1] = 2; print(b, isinstance(b, datetime.tzinfo), B.__base__)
class C(datetime.tzinfo, int): pass
t('C()', lambda: C())
t('C(5)', lambda: C(5))
print(C(5) + 1)
class D(datetime.tzinfo, Exception): pass
t('D()', lambda: D(1, 2))
print(D(1, 2).args)
class P:
    def __new__(cls, *a):
        print('P.__new__')
        return super().__new__(cls)
class E(datetime.tzinfo, P, dict): pass
t('E()', lambda: E())
class F(P, datetime.tzinfo, dict): pass
t('F()', lambda: F())
class G(typing.Generic[typing.TypeVar('T')], dict): pass
t('G()', lambda: G())
t('ast', lambda: type('X', (ast.AST, dict), {}))
class H(ast.AST): pass
t('H()', lambda: H())
t('object.__new__(H)', lambda: object.__new__(H))
t('object.__new__(ast.Name)', lambda: object.__new__(ast.Name))
t('ast.AST.__new__(ast.Name)', lambda: ast.AST.__new__(ast.Name))
t('object.__new__(tzinfo)', lambda: object.__new__(datetime.tzinfo))
class I(ValueError, OSError): pass
i = I(2, 'message')
print(I.__base__.__name__, i.errno, i.strerror, i.args)
class J(dict):
    __new__ = object.__new__
t('J()', lambda: J())
class K:
    __new__ = dict.__new__
t('K()', lambda: K())
