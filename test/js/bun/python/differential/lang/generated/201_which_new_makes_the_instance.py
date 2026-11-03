# Which __new__ makes an instance of a class with several built-in bases, and what a __new__ refuses to make.
try: import datetime, ast, collections, typing
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import datetime, ast, collections, typing')
try:
    def t(label, f):
        try:
            r = f()
            print(label, 'ok', type(r).__name__, type(r).__mro__[1].__name__)
        except Exception as e:
            print(label, type(e).__name__, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def t(label, f):')
try: t('object.__new__(int)', lambda: object.__new__(int))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('object.__new__(int)', lambda: object.__new__(int))")
try: t('object.__new__(dict)', lambda: object.__new__(dict))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('object.__new__(dict)', lambda: object.__new__(dict))")
try: t('int.__new__(str)', lambda: int.__new__(str))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('int.__new__(str)', lambda: int.__new__(str))")
try: t('int.__new__(1)', lambda: int.__new__(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('int.__new__(1)', lambda: int.__new__(1))")
try: t('int.__new__()', lambda: int.__new__())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('int.__new__()', lambda: int.__new__())")
try: t('dict.__new__(OrderedDict)', lambda: dict.__new__(collections.OrderedDict))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('dict.__new__(OrderedDict)', lambda: dict.__new__(collections.Order...")
try: t('tuple.__new__(time.struct_time)', lambda: tuple.__new__(type(__import__('time').gmtime())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('tuple.__new__(time.struct_time)', lambda: tuple.__new__(type(__imp...")
try:
    class A(dict): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A(dict): pass')
try: t('object.__new__(A)', lambda: object.__new__(A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('object.__new__(A)', lambda: object.__new__(A))")
try: t('dict.__new__(A)', lambda: dict.__new__(A))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('dict.__new__(A)', lambda: dict.__new__(A))")
try:
    class B(datetime.tzinfo, dict): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class B(datetime.tzinfo, dict): pass')
try: t('B()', lambda: B())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('B()', lambda: B())")
try: t('B.__new__(B)', lambda: B.__new__(B))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('B.__new__(B)', lambda: B.__new__(B))")
try: t('tzinfo.__new__(B)', lambda: datetime.tzinfo.__new__(B))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('tzinfo.__new__(B)', lambda: datetime.tzinfo.__new__(B))")
try: t('dict.__new__(B)', lambda: dict.__new__(B))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('dict.__new__(B)', lambda: dict.__new__(B))")
try: b = B()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b = B()')
try: b[1] = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b[1] = 2')
try: print('b =>', b)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: b')
try: print('isinstance(b, datetime.tzinfo) =>', isinstance(b, datetime.tzinfo))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(b, datetime.tzinfo)')
try: print('B.__base__ =>', B.__base__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: B.__base__')
try:
    class C(datetime.tzinfo, int): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C(datetime.tzinfo, int): pass')
try: t('C()', lambda: C())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('C()', lambda: C())")
try: t('C(5)', lambda: C(5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('C(5)', lambda: C(5))")
try: print(C(5) + 1)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: C(5) + 1')
try:
    class D(datetime.tzinfo, Exception): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class D(datetime.tzinfo, Exception): pass')
try: t('D()', lambda: D(1, 2))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('D()', lambda: D(1, 2))")
try: print(D(1, 2).args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: D(1, 2).args')
try:
    class P:
        def __new__(cls, *a):
            print('P.__new__')
            return super().__new__(cls)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class P:')
try:
    class E(datetime.tzinfo, P, dict): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class E(datetime.tzinfo, P, dict): pass')
try: t('E()', lambda: E())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('E()', lambda: E())")
try:
    class F(P, datetime.tzinfo, dict): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class F(P, datetime.tzinfo, dict): pass')
try: t('F()', lambda: F())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('F()', lambda: F())")
try:
    class G(typing.Generic[typing.TypeVar('T')], dict): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: class G(typing.Generic[typing.TypeVar('T')], dict): pass")
try: t('G()', lambda: G())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('G()', lambda: G())")
try: t('ast', lambda: type('X', (ast.AST, dict), {}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('ast', lambda: type('X', (ast.AST, dict), {}))")
try:
    class H(ast.AST): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class H(ast.AST): pass')
try: t('H()', lambda: H())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('H()', lambda: H())")
try: t('object.__new__(H)', lambda: object.__new__(H))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('object.__new__(H)', lambda: object.__new__(H))")
try: t('object.__new__(ast.Name)', lambda: object.__new__(ast.Name))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('object.__new__(ast.Name)', lambda: object.__new__(ast.Name))")
try: t('ast.AST.__new__(ast.Name)', lambda: ast.AST.__new__(ast.Name))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('ast.AST.__new__(ast.Name)', lambda: ast.AST.__new__(ast.Name))")
try: t('object.__new__(tzinfo)', lambda: object.__new__(datetime.tzinfo))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('object.__new__(tzinfo)', lambda: object.__new__(datetime.tzinfo))")
try:
    class I(ValueError, OSError): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class I(ValueError, OSError): pass')
try: i = I(2, 'message')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: i = I(2, 'message')")
try: print('I.__base__.__name__ =>', I.__base__.__name__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: I.__base__.__name__')
try: print('i.errno =>', i.errno)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i.errno')
try: print('i.strerror =>', i.strerror)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i.strerror')
try: print('i.args =>', i.args)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: i.args')
try:
    class J(dict):
        __new__ = object.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class J(dict):')
try: t('J()', lambda: J())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('J()', lambda: J())")
try:
    class K:
        __new__ = dict.__new__
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class K:')
try: t('K()', lambda: K())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + "> in: t('K()', lambda: K())")
