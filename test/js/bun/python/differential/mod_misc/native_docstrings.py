# The docstrings of what is written in C in CPython: modules, functions, types, and what the types have.
import hashlib, importlib, sys, types

NAMES = """builtins sys _abc _ast _bisect _codecs _collections _contextvars _csv _functools _heapq _io _json _operator _pickle
_random _sre _stat _string _struct _thread _tracemalloc _typing _warnings _weakref array atexit binascii cmath errno faulthandler
gc itertools marshal math posix pyexpat select time unicodedata zlib _datetime _asyncio _queue _socket _signal _imp _locale
_opcode _symtable _statistics _posixsubprocess fcntl grp pwd resource mmap termios syslog""".split()

def digest(doc):
    return None if doc is None else hashlib.md5(doc.encode()).hexdigest()[:10] if isinstance(doc, str) else type(doc).__name__

for name in NAMES:
    try:
        module = importlib.import_module(name)
    except ImportError:
        print(name, "is not there")
        continue
    print(name, digest(module.__doc__))
    for attribute, value in sorted(vars(module).items()):
        if attribute.startswith("__"):
            continue
        if isinstance(value, types.BuiltinFunctionType):
            print(" ", name, attribute, digest(value.__doc__))
        elif isinstance(value, type) and "__firstlineno__" not in vars(value):
            print(" ", name, attribute, digest(value.__doc__))
            for member, what in sorted(vars(value).items()):
                if isinstance(what, (types.MethodDescriptorType, types.WrapperDescriptorType, types.ClassMethodDescriptorType, types.GetSetDescriptorType, types.MemberDescriptorType, types.BuiltinFunctionType)):
                    print("   ", name, attribute, member, digest(what.__doc__))
