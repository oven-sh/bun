import sys
def t(f):
    try:
        print(repr(f()))
    except BaseException as e:
        print(type(e).__name__ + ':', e)

print(sys.maxsize, sys.maxsize == 2 ** 63 - 1, sys.maxunicode, sys.byteorder, sys.platform, sys.getdefaultencoding(), sys.getfilesystemencoding(), sys.getfilesystemencodeerrors(), type(sys.version).__name__, sys.version.startswith("3.15"), sys.hexversion >= 0x030F0000, type(sys.hexversion).__name__)
vi = sys.version_info
print(vi[:2], vi.major, vi.minor, type(vi.micro).__name__, vi.releaselevel in ("alpha", "beta", "candidate", "final"), type(vi.serial).__name__, len(vi), type(vi).__name__, isinstance(vi, tuple), vi >= (3, 15), vi < (4,), vi[0] == vi.major, vi > (3, 14, 99), repr(vi).startswith("sys.version_info(major=3, minor=15, micro="), tuple(vi)[:2], vi.n_fields, vi.n_sequence_fields, vi.n_unnamed_fields, vi.count(3) >= 1, vi.index(3), hash(vi) == hash(tuple(vi)), vi == tuple(vi), vi[-1] == vi.serial, vi[1:2], [type(x).__name__ for x in vi])
t(lambda: type(vi)((1, 2, 3, 4, 5))); t(lambda: setattr(vi, "major", 4)); t(lambda: vi.nope); t(lambda: vi[5]); t(lambda: vi + (1,) == tuple(vi) + (1,)); major, minor, *rest = vi; print(major, minor, len(rest))
fi = sys.float_info
print(fi.max, fi.min, fi.epsilon, fi.dig, fi.mant_dig, fi.max_exp, fi.min_exp, fi.max_10_exp, fi.min_10_exp, fi.radix, fi.rounds, len(fi), type(fi).__name__, fi[0] == fi.max, repr(fi))
hi = sys.hash_info
print(hi.width, hi.modulus, hi.inf, hi.nan, hi.imag, hi.modulus == 2 ** 61 - 1, type(hi).__name__, type(hi.algorithm).__name__)
print(type(sys.int_info).__name__, sys.int_info.default_max_str_digits, sys.int_info.str_digits_check_threshold, sys.implementation.name if False else "", type(sys.implementation).__name__, sys.implementation.version[:2] if False else "", hasattr(sys.implementation, "name"), hasattr(sys.implementation, "cache_tag"), type(sys.thread_info).__name__)
print(type(sys.argv).__name__, len(sys.argv), sys.argv[0].rsplit("/", 1)[-1], type(sys.path).__name__, all(isinstance(p, str) for p in sys.path), type(sys.modules).__name__, "sys" in sys.modules, "builtins" in sys.modules, "__main__" in sys.modules, type(sys.builtin_module_names).__name__, "sys" in sys.builtin_module_names, "builtins" in sys.builtin_module_names, type(sys.executable).__name__, type(sys.prefix).__name__, type(sys.flags).__name__, type(sys.meta_path).__name__, type(sys.path_hooks).__name__, type(sys.path_importer_cache).__name__, type(sys.warnoptions).__name__, type(sys.orig_argv).__name__, type(sys.stdlib_module_names).__name__, "os" in sys.stdlib_module_names, type(sys.dont_write_bytecode).__name__, type(sys.copyright).__name__, type(sys.api_version).__name__, type(sys.platlibdir).__name__, sys.pycache_prefix, type(sys.abiflags).__name__, type(sys._xoptions).__name__)
# The limit on int <-> str conversions.
print(sys.get_int_max_str_digits())
big = 10 ** 4300
t(lambda: len(str(big))); t(lambda: len(repr(big))); t(lambda: int("1" * 4301)); t(lambda: len(str(10 ** 4299))); t(lambda: int("1" * 4300) > 0); t(lambda: f"{big}"); t(lambda: "%d" % big); t(lambda: format(big)); t(lambda: print(big)); t(lambda: len(hex(big)) > 0); t(lambda: len(bin(big)) > 0); t(lambda: len(oct(big)) > 0); t(lambda: len("%x" % big) > 0); t(lambda: int("f" * 5000, 16) > 0); t(lambda: int("1" * 5000, 2) > 0); t(lambda: int("1" * 5000, 3)); t(lambda: int("-" + "1" * 4301)); t(lambda: int("1_" * 4300 + "1")); t(lambda: int(" " * 5000 + "1")); t(lambda: int("0" * 5000 + "1")); t(lambda: len(str(-big))); t(lambda: big + 1 > big); t(lambda: big * big > big); t(lambda: float(big)); t(lambda: eval("1" * 4301)); t(lambda: compile("x = " + "1" * 4301, "<s>", "exec")); t(lambda: [big].__repr__()); t(lambda: str(big)[:1])
sys.set_int_max_str_digits(0); print(len(str(big)), len(str(int("1" * 5000))), sys.get_int_max_str_digits())
sys.set_int_max_str_digits(640); t(lambda: str(10 ** 640)); t(lambda: len(str(10 ** 639))); t(lambda: int("1" * 641)); print(sys.get_int_max_str_digits())
t(lambda: sys.set_int_max_str_digits(639)); t(lambda: sys.set_int_max_str_digits(1)); t(lambda: sys.set_int_max_str_digits(-1)); t(lambda: sys.set_int_max_str_digits("a")); t(lambda: sys.set_int_max_str_digits()); t(lambda: sys.set_int_max_str_digits(maxdigits=5000)); print(sys.get_int_max_str_digits())
sys.set_int_max_str_digits(4300)
# intern
a = "".join(["he", "llo"]); b = "".join(["hel", "lo"]); print(a is b, sys.intern(a) is sys.intern(b), sys.intern("x") == "x", sys.intern("é😀"))
t(lambda: sys.intern(1)); t(lambda: sys.intern(b"a")); t(lambda: sys.intern()); t(lambda: sys.intern(type("S", (str,), {})("a")))
# getsizeof and getrefcount exist; their values are not compared.
print(type(sys.getsizeof(1)).__name__, sys.getsizeof([]) > 0, sys.getsizeof("a" * 100) > sys.getsizeof("a"), sys.getsizeof([0] * 100) > sys.getsizeof([]), type(sys.getrefcount(object())).__name__)
class NoSize:
    def __sizeof__(s): return "x"
class NegSize:
    def __sizeof__(s): return -1
class OkSize:
    def __sizeof__(s): return 100
t(lambda: sys.getsizeof(NoSize())); t(lambda: sys.getsizeof(NoSize(), 5)); t(lambda: sys.getsizeof(NegSize())); t(lambda: sys.getsizeof(OkSize()) >= 100); t(lambda: sys.getsizeof())
# Hooks.
print(sys.excepthook is sys.__excepthook__, sys.displayhook is sys.__displayhook__, sys.breakpointhook is sys.__breakpointhook__, sys.unraisablehook is sys.__unraisablehook__, sys.stdout is sys.__stdout__, sys.stderr is sys.__stderr__, sys.stdin is sys.__stdin__)
sys.displayhook(None); sys.displayhook(5); sys.displayhook("s"); sys.displayhook([1, "a"]); print(sys.modules["builtins"]._); del sys.modules["builtins"]._
t(lambda: sys.displayhook()); t(lambda: sys.displayhook(1, 2))
print(sys.gettrace(), sys.getprofile(), type(sys.getswitchinterval()).__name__, sys.getrecursionlimit(), sys.is_finalizing(), sys.exception(), sys.exc_info(), type(sys.getallocatedblocks()).__name__, sys.get_coroutine_origin_tracking_depth(), type(sys.getunicodeinternedsize()).__name__ if hasattr(sys, "getunicodeinternedsize") else "int", sys.is_stack_trampoline_active() if hasattr(sys, "is_stack_trampoline_active") else False)
# audit hooks and events are accepted.
print(sys.audit("custom.event", 1, 2)); t(lambda: sys.audit()); t(lambda: sys.audit(1))
# sys is an ordinary module object.
sys.custom_attribute = 1; print(sys.custom_attribute); del sys.custom_attribute; t(lambda: sys.custom_attribute); t(lambda: sys.no_such_thing)
saved = sys.maxsize; sys.maxsize = 5; print(sys.maxsize); sys.maxsize = saved
saved = sys.argv; sys.argv = ["replaced"]; print(sys.argv); sys.argv = saved
print(sorted(n for n in dir(sys) if n.startswith("get") and not n.startswith("getw"))[:40])
print(sorted(n for n in dir(sys) if n.startswith("set")))
print(sorted(n for n in dir(sys) if n.startswith("std") or n.startswith("__std") or n.startswith("exc") or n.startswith("max") or n.startswith("float") or n.startswith("int") or n.startswith("hash")))
t(lambda: sys.exit.__name__); t(lambda: sys.exit.__module__); t(lambda: repr(sys.exit)); t(lambda: type(sys.exit).__name__); t(lambda: sys.exit.__self__ is sys); t(lambda: sys.getrecursionlimit.__qualname__); t(lambda: sys.getrecursionlimit.__doc__ is not None); t(lambda: sys.intern.__text_signature__)
