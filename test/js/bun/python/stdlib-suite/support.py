"""What the translated tests need of Python: see README.md.

Two kinds of things are here. What JavaScript has no way to say (a class statement with all it entails, `with`, `raise ... from`,
`from x import y`), and the runner, which runs one test of a `unittest.TestCase` and says how it went. The runner is also what runs
the originals for comparison (`python3 support.py test.test_x`), so that both runs mean the same by every word.
"""

import collections.abc
import importlib
import importlib.util
import json
import os
import signal
import sys
import threading
import time
import traceback
import types
import unittest
import warnings
from _thread import get_ident

try:
    import _js
except ImportError:  # The originals can be run under any Python.
    _js = None


# ---- Statements ----


def make_class(name, bases, keywords, body, module, qualname, needs_cell):
    """class name(*bases, **keywords): body(namespace, the cell for __class__)"""

    def exec_body(namespace):
        namespace["__module__"] = module
        namespace["__qualname__"] = qualname
        if needs_cell:
            cell = types.CellType()
            body(namespace, cell)
            namespace["__classcell__"] = cell
        else:
            body(namespace)

    return types.new_class(name, tuple(bases), dict(keywords), exec_body)


# A function of JavaScript as a function of Python, which a class binds to its instances. Much in Python goes by the frame of the
# caller: the module of a new class, the file a warning is about. Code in JavaScript has no such frame, and the nearest one counts.
# So these functions are made as if they were written in the file that was translated.
_WRAPPERS = """
def __wrappers__(get_ident, main_thread, note_thread):
    def function(implementation):
        def function(*args, **kwargs):
            if get_ident() != main_thread:
                note_thread()
            return implementation(*args, **kwargs)
        return function
    def async_function(implementation):
        async def function(*args, **kwargs):
            return await implementation(*args, **kwargs)
        return function
    def coroutine_function(implementation, make):
        def function(*args, **kwargs):
            return make(implementation(*args, **kwargs))
        return function
    def call_boxed(function, /, *args, **kwargs):
        return [function(*args, **kwargs)]
    return function, async_function, coroutine_function, call_boxed
"""
_wrappers = {}


def _wrap(kind, implementation, name, qualname, module, doc):
    function = _wrappers[module][kind](implementation)
    function.__name__ = name
    function.__qualname__ = qualname
    function.__doc__ = doc
    return function


def function(implementation, name, qualname, module, doc=None):
    return _wrap(0, implementation, name, qualname, module, doc)


def async_function(implementation, name, qualname, module, doc=None):
    """The same for an async function: a coroutine function."""
    return _wrap(1, implementation, name, qualname, module, doc)


def _normalize(kind, value, what):
    if isinstance(kind, BaseException):
        return kind
    if isinstance(kind, type) and issubclass(kind, BaseException):
        return value if isinstance(value, kind) else kind() if value is None else kind(value)
    raise TypeError(f"exceptions must be classes or instances deriving from BaseException, not {type(kind).__name__}")


class Coroutine(collections.abc.Coroutine):
    """What an `async def` returns whose body is a generator of JavaScript's."""

    cr_frame = cr_code = cr_await = cr_origin = None

    def __init__(self, generator, name, qualname):
        self._generator = generator
        self._state = 0  # Made, begun, done.
        self.cr_running = False
        self.__name__ = name
        self.__qualname__ = qualname

    def __repr__(self):
        return f"<coroutine object {self.__qualname__} at {id(self):#x}>"

    def _resume(self, method, argument):
        if self.cr_running:
            raise ValueError("coroutine already executing")
        if self._state == 2:
            raise RuntimeError("cannot reuse already awaited coroutine")
        self._state = 1
        self.cr_running = True
        try:
            return method(argument)
        except BaseException:
            self._state = 2
            raise
        finally:
            self.cr_running = False

    def send(self, value):
        if self._state == 0 and value is not None:
            raise TypeError("can't send non-None value to a just-started coroutine")
        return self._resume(self._generator.send, value)

    def throw(self, kind, value=None, traceback=None):
        return self._resume(self._generator.throw, _normalize(kind, value, "coroutine"))

    def close(self):
        if self._state == 2:
            return
        try:
            self._resume(self._generator.throw, GeneratorExit())
        except (GeneratorExit, StopIteration):
            return
        raise RuntimeError("coroutine ignored GeneratorExit")

    def __await__(self):
        return _CoroutineIterator(self)

    def __del__(self):
        if self._state == 0:
            self._state = 2
            warnings.warn(f"coroutine '{self.__qualname__}' was never awaited", RuntimeWarning, source=self)


class _CoroutineIterator:
    def __init__(self, coroutine):
        self._coroutine = coroutine
        self.send = coroutine.send
        self.throw = coroutine.throw
        self.close = coroutine.close

    def __iter__(self):
        return self

    def __next__(self):
        return self._coroutine.send(None)


class Yielded:
    """What the generator behind an async generator yields for `yield value`. Anything else it yields is for the event loop."""

    __slots__ = ("value",)

    def __init__(self, value=None):
        self.value = value


class AsyncGenerator(collections.abc.AsyncGenerator):
    ag_frame = ag_code = ag_await = None

    def __init__(self, generator, name="<genexpr>", qualname="<genexpr>"):
        self._generator = generator
        self._is_begun = False
        self._is_done = False
        self._finalizer = None
        self.ag_running = False
        self.__name__ = name
        self.__qualname__ = qualname

    def __repr__(self):
        return f"<async_generator object {self.__qualname__} at {id(self):#x}>"

    def _step(self, kind, argument):
        if not self._is_begun and self._finalizer is None:
            first, self._finalizer = sys.get_asyncgen_hooks()
            if first is not None:
                first(self)
        return _AsyncGeneratorStep(self, kind, argument)

    def __aiter__(self):
        return self

    def __anext__(self):
        return self._step("__anext__", None)

    def asend(self, value):
        return self._step("asend", value)

    def athrow(self, kind, value=None, traceback=None):
        return self._step("athrow", _normalize(kind, value, "async generator"))

    def aclose(self):
        return self._step("aclose", None)

    def __del__(self):
        if self._is_begun and not self._is_done and self._finalizer is not None:
            self._finalizer(self)


class _AsyncGeneratorStep:
    def __init__(self, owner, kind, argument):
        self._owner = owner
        self._kind = kind
        self._argument = argument
        self._state = 0

    def __await__(self):
        return self

    __iter__ = __await__

    def __next__(self):
        return self.send(None)

    def _name(self):
        return "anext" if self._kind in ("__anext__", "asend") else self._kind

    def _begin(self):
        owner = self._owner
        if self._state == 2:
            raise RuntimeError(f"cannot reuse already awaited {'__anext__()/asend()' if self._name() == 'anext' else 'aclose()/athrow()'}")
        if self._state == 0:
            if owner.ag_running:
                self._state = 2
                raise RuntimeError(f"{self._name()}(): asynchronous generator is already running")
            self._state = 1
            owner.ag_running = True
            return True
        return False

    def _run(self, method, argument):
        owner = self._owner
        is_close = self._kind == "aclose"
        try:
            result = method(argument)
        except StopIteration:
            self._end(True)
            if is_close:
                raise StopIteration from None
            raise StopAsyncIteration from None
        except (GeneratorExit, StopAsyncIteration):
            self._end(True)
            if is_close:
                raise StopIteration from None
            raise
        except BaseException:
            self._end(True)
            raise
        if isinstance(result, Yielded):
            self._end(False)
            if is_close:
                raise RuntimeError("async generator ignored GeneratorExit")
            raise StopIteration(result.value)
        return result

    def _end(self, is_done):
        self._state = 2
        self._owner.ag_running = False
        if is_done:
            self._owner._is_done = True

    def send(self, value):
        owner = self._owner
        if not self._begin():
            return self._run(owner._generator.send, value)
        if self._kind in ("__anext__", "asend"):
            argument = self._argument if value is None else value
            if not owner._is_begun and argument is not None:
                self._end(False)
                raise TypeError("can't send non-None value to a just-started async generator")
            owner._is_begun = True
            return self._run(owner._generator.send, argument)
        if owner._is_done:
            self._end(True)
            raise StopIteration if self._kind == "aclose" else StopAsyncIteration
        owner._is_begun = True
        return self._run(owner._generator.throw, GeneratorExit() if self._kind == "aclose" else self._argument)

    def throw(self, kind, value=None, traceback=None):
        if self._begin():
            self._end(False)
            raise _normalize(kind, value, "async generator")
        return self._run(self._owner._generator.throw, _normalize(kind, value, "async generator"))

    def close(self):
        if self._state == 1:
            try:
                self.throw(GeneratorExit)
            except (GeneratorExit, StopIteration, StopAsyncIteration):
                return
            raise RuntimeError("coroutine ignored GeneratorExit")
        self._state = 2


def coroutine(implementation, name, qualname, module, doc=None):
    """async def, for a function of JavaScript that returns the generator that is the body."""
    import inspect

    function = _wrappers[module][2](implementation, lambda generator: Coroutine(generator, name, qualname))
    function.__name__ = name
    function.__qualname__ = qualname
    function.__doc__ = doc
    return inspect.markcoroutinefunction(function)


def async_generator(implementation, name, qualname, module, doc=None):
    function = _wrappers[module][2](implementation, lambda generator: AsyncGenerator(generator, name, qualname))
    function.__name__ = name
    function.__qualname__ = qualname
    function.__doc__ = doc
    return function


# What follows hands JavaScript coroutines, which it gets as promises when a function returns them: so they come in a list.


def boxed_caller(module):
    """A function (function, *args, **kwargs) that returns [function(*args, **kwargs)]."""
    return _wrappers[module][3]


def await_iterator(awaitable):
    """[what `await awaitable` sends to and throws into]"""
    if isinstance(awaitable, (Coroutine, types.CoroutineType)):
        return [awaitable]
    if isinstance(awaitable, types.GeneratorType) and awaitable.gi_code.co_flags & 0x100:  # types.coroutine()
        return [awaitable]
    try:
        method = type(awaitable).__await__
    except AttributeError:
        raise TypeError(f"'{type(awaitable).__name__}' object can't be awaited") from None
    iterator = method(awaitable)
    if isinstance(iterator, (Coroutine, types.CoroutineType)):
        raise TypeError("__await__() returned a coroutine")
    if not hasattr(type(iterator), "__next__"):
        raise TypeError(f"__await__() returned non-iterator of type '{type(iterator).__name__}'")
    return [iterator]


def step(iterator, value):
    """[whether it is done, what it yielded or returned]"""
    try:
        if value is None and not hasattr(iterator, "send"):
            return [False, next(iterator)]
        return [False, iterator.send(value)]
    except StopIteration as stop:
        return [True, stop.value]


def step_throw(iterator, thrown):
    exception = exception_for(thrown)
    try:
        throw = iterator.throw
    except AttributeError:
        raise exception from None
    try:
        return [False, throw(exception)]
    except StopIteration as stop:
        return [True, stop.value]


def close_iterator(iterator):
    close = getattr(iterator, "close", None)
    if close is not None:
        close()


def aenter_raw(manager):
    enter = _manager_method(manager, "__aenter__", "async with", "__enter__")
    _manager_method(manager, "__aexit__", "async with", "__exit__")
    return [enter(manager)]


def aexit_raw(manager, thrown=None, has_thrown=False):
    if not has_thrown:
        return [type(manager).__aexit__(manager, None, None, None)]
    exception = exception_for(thrown)
    return [type(manager).__aexit__(manager, type(exception), exception, exception.__traceback__)]


def aiter_raw(iterable):
    try:
        method = type(iterable).__aiter__
    except AttributeError:
        raise TypeError(f"'async for' requires an object with __aiter__ method, got {type(iterable).__name__}") from None
    iterator = method(iterable)
    if not hasattr(type(iterator), "__anext__"):
        raise TypeError(f"'async for' received an object from __aiter__ that does not implement __anext__: {type(iterator).__name__}")
    return [iterator]


def anext_raw(iterator):
    return [type(iterator).__anext__(iterator)]


def annotator(entries, module=None):
    """The function that gives the annotations of a class or a function when they are asked for, in the format that is asked for.

    Each entry is [name, a function that evaluates the annotation, its source]."""

    def __annotate__(format, /):
        if format <= 2:
            return {name: evaluate() for name, evaluate, source in entries}
        if format == 4:
            return {name: source for name, evaluate, source in entries}
        import annotationlib

        result = {}
        for name, evaluate, source in entries:
            try:
                result[name] = evaluate()
            except NameError:
                result[name] = annotationlib.ForwardRef(source, module=module)
        return result

    if module is not None:
        __annotate__.__module__ = module
    return __annotate__


def annotated(function, entries):
    function.__annotate__ = annotator(entries)
    return function


def annotate(namespace, name, annotation):
    """name: annotation, in the body of a class"""
    try:
        annotations = namespace["__annotations__"]
    except KeyError:
        annotations = namespace["__annotations__"] = {}
    annotations[name] = annotation


def namespace_get(namespace, name):
    """[value] if the namespace of a class body has the name, else None."""
    try:
        return [namespace[name]]
    except KeyError:
        return None


def _manager_method(manager, name, statement, other):
    try:
        return getattr(type(manager), name)
    except AttributeError:
        pass
    protocol = "asynchronous context manager" if statement == "async with" else "context manager"
    message = f"'{type(manager).__qualname__}' object does not support the {protocol} protocol (missed {name} method)"
    if hasattr(type(manager), other):
        second = "context manager" if statement == "async with" else "asynchronous context manager"
        hint = "with" if statement == "async with" else "async with"
        message += f" but it supports the {second} protocol. Did you mean to use '{hint}'?"
    raise TypeError(message)


def enter(manager):
    enter = _manager_method(manager, "__enter__", "with", "__aenter__")
    _manager_method(manager, "__exit__", "with", "__aexit__")
    return enter(manager)


def exit(manager, thrown=None, has_thrown=False):
    """True: the exception is not to go on."""
    if not has_thrown:
        type(manager).__exit__(manager, None, None, None)
        return False
    exception = exception_for(thrown)
    traceback = exception.__traceback__
    try:
        # It is being handled while the manager looks at it.
        raise exception
    except BaseException:
        exception.__traceback__ = traceback
        return bool(type(manager).__exit__(manager, type(exception), exception, traceback))


async def aenter(manager):
    enter = _manager_method(manager, "__aenter__", "async with", "__enter__")
    _manager_method(manager, "__aexit__", "async with", "__exit__")
    return await enter(manager)


async def aexit(manager, thrown=None, has_thrown=False):
    if not has_thrown:
        await type(manager).__aexit__(manager, None, None, None)
        return False
    exception = exception_for(thrown)
    return bool(await type(manager).__aexit__(manager, type(exception), exception, exception.__traceback__))


def exception_for(thrown):
    return thrown if _js is None or isinstance(thrown, BaseException) else _js.exception_for(thrown)


_missing = object()


def _exception(value, what):
    if isinstance(value, type) and issubclass(value, BaseException):
        return value()
    if not isinstance(value, BaseException):
        raise TypeError(what)
    return value


def exception(value, cause=_missing):
    """What `raise value from cause` raises."""
    value = _exception(value, "exceptions must derive from BaseException")
    if cause is not _missing:
        value.__cause__ = None if cause is None else _exception(cause, "exception causes must derive from BaseException")
    return value


def matches(exception, types):
    """except types:"""
    for item in types if isinstance(types, tuple) else (types,):
        if not (isinstance(item, type) and issubclass(item, BaseException)):
            raise TypeError("catching classes that do not inherit from BaseException is not allowed")
    return isinstance(exception, types)


def unpack(iterable, before, after):
    """a, b = iterable (after < 0); a, *b, c = iterable. A list of before + 1 + after items, or of `before`."""
    try:
        iterator = iter(iterable)
    except TypeError:
        raise TypeError(f"cannot unpack non-iterable {type(iterable).__name__} object") from None
    items = []
    for item in iterator:
        items.append(item)
        if after < 0 and len(items) > before:
            raise ValueError(f"too many values to unpack (expected {before})")
    if after < 0:
        if len(items) < before:
            raise ValueError(f"not enough values to unpack (expected {before}, got {len(items)})")
        return items
    if len(items) < before + after:
        raise ValueError(f"not enough values to unpack (expected at least {before + after}, got {len(items)})")
    return items[:before] + [items[before : len(items) - after]] + items[len(items) - after :]


def call(function, args, mappings):
    """[function(*args, **mapping, **mapping)]"""
    if len(mappings) == 1:
        return [function(*args, **mappings[0])]
    if len(mappings) == 2:
        return [function(*args, **mappings[0], **mappings[1])]
    if len(mappings) == 3:
        return [function(*args, **mappings[0], **mappings[1], **mappings[2])]
    raise NotImplementedError("more than three groups of keyword arguments")


def build_dict(parts):
    """{k: v, **m}: each part is [k, v] or [m]."""
    result = {}
    for part in parts:
        if len(part) == 2:
            result[part[0]] = part[1]
        else:
            result.update(part[0])
    return result


def is_mapping_type(cls):
    return issubclass(cls, (dict, collections.abc.Mapping)) or cls.__name__ == "frozendict"


# ---- Modules ----


def module(name, is_package):
    """The module that the translated file stands for: what pickle, repr() and sys.modules[__name__] find."""
    spec = importlib.util.find_spec(name)
    module = types.ModuleType(name)
    module.__file__ = spec.origin
    module.__spec__ = spec
    module.__loader__ = spec.loader
    module.__package__ = name if is_package else name.rpartition(".")[0]
    if is_package:
        module.__path__ = list(spec.submodule_search_locations)
    sys.modules[name] = module
    namespace = vars(module)
    exec(compile(_WRAPPERS, spec.origin, "exec"), namespace)
    _wrappers[name] = namespace.pop("__wrappers__")(get_ident, _main_thread, _note_thread)
    return module


def forget_module(name):
    sys.modules.pop(name, None)
    _wrappers.pop(name, None)


def export(module, names, values):
    for name, value in zip(names, values):
        setattr(module, name, value)


def import_module(name):
    """import a.b.c: [a, a.b.c]"""
    top = __import__(name)
    return [top, sys.modules[name]]


def import_from(name, attribute):
    """from name import attribute"""
    module = __import__(name, None, None, [attribute], 0)
    try:
        return getattr(module, attribute)
    except AttributeError:
        pass
    try:
        return sys.modules[f"{name}.{attribute}"]
    except KeyError:
        pass
    raise ImportError(
        f"cannot import name {attribute!r} from {name!r} ({getattr(module, '__file__', 'unknown location')})",
        name=name,
        path=getattr(module, "__file__", None),
    )


def import_star(name):
    """from name import *: a dict"""
    module = __import__(name, None, None, ["*"], 0)
    names = getattr(module, "__all__", None)
    if names is None:
        names = [name for name in vars(module) if not name.startswith("_")]
    return {name: getattr(module, name) for name in names}


# ---- The runner ----


def prepare():
    """As regrtest leaves things for a test that asks for no resources."""
    try:
        from test import support
    except ImportError:  # The standard library inside bun has no tests.
        pass
    else:
        support.use_resources = ()
        support.verbose = 0
    if _js is not None:
        threading.excepthook = _thread_failed
        sys.unraisablehook = _unraisable
        signal.signal(_INTERRUPT, _interrupted)


# JavaScript runs on one thread. A test that has another thread run a function of its own cannot be translated, which shows
# only when it runs.
_NEEDS_THREAD = "JavaScript can only be used from the main thread"
_thread_needed_javascript = False
_report_thread_failure = threading.excepthook
_report_unraisable = sys.unraisablehook
_main_thread = get_ident()
_INTERRUPT = signal.SIGRTMIN + 7


class _Interrupted(BaseException):
    pass


def _interrupted(number, frame):
    raise _Interrupted


def _note_thread():
    global _thread_needed_javascript
    # The test may wait for that thread for ever.
    if not _thread_needed_javascript:
        _thread_needed_javascript = True
        signal.pthread_kill(_main_thread, _INTERRUPT)


def _thread_failed(args):
    if args.exc_type is RuntimeError and _NEEDS_THREAD in str(args.exc_value):
        _note_thread()
    else:
        _report_thread_failure(args)


def _unraisable(args):
    if args.exc_type is RuntimeError and _NEEDS_THREAD in str(args.exc_value):
        _note_thread()
    else:
        _report_unraisable(args)


def test_classes(names, values, module):
    """What unittest's loader finds in a module: [[qualified name, class, [test names]]]"""
    loader = unittest.TestLoader()
    found = []
    seen = set()
    for name, value in sorted(zip(names, values), key=lambda pair: pair[0]):
        if (
            isinstance(value, type)
            and issubclass(value, unittest.TestCase)
            and value not in (unittest.TestCase, unittest.FunctionTestCase)
            and value not in seen
        ):
            seen.add(value)
            tests = [test for test in loader.getTestCaseNames(value) if _is_translated(value, test, module)]
            if tests:
                found.append([value.__qualname__, value, tests])
    return found


def _is_translated(cls, test, module):
    """Whether the test is written in the file. What a class inherits from another module has not been translated."""
    for base in cls.__mro__:
        if test in vars(base):
            return base.__module__ == module or base.__module__ in _wrappers
    return False


def _describe(error):
    kind, value, trace = error
    name = kind.__qualname__ if kind.__module__ in ("builtins", "__main__") else f"{kind.__module__}.{kind.__qualname__}"
    try:
        message = str(value)
    except Exception as failure:
        message = f"<str() failed: {type(failure).__name__}>"
    stack = ""
    if _js is not None and isinstance(value, _js.JSError):
        thrown = value.value
        try:
            name = f"JS {thrown.name}"
            message = str(thrown.message)
            stack = str(thrown.stack)
        except Exception:
            name = "JS throw"
    else:
        try:
            stack = "".join(traceback.format_exception(kind, value, trace, limit=-6))
        except Exception as failure:
            stack = f"<traceback failed: {type(failure).__name__}: {failure}>"
    return [name, message[:2000], stack[-3000:]]


class _Result(unittest.TestResult):
    def __init__(self):
        super().__init__()
        self.status = "ok"
        self.detail = None

    def _set(self, status, detail):
        # The first problem is the one that is told.
        if self.status in ("ok", "skip"):
            self.status = status
            self.detail = detail

    def addError(self, test, err):
        self._set("error", _describe(err))

    def addFailure(self, test, err):
        self._set("fail", _describe(err))

    def addSubTest(self, test, subtest, err):
        if err is not None:
            detail = _describe(err)
            detail[1] = f"{subtest._subDescription()} {detail[1]}"
            self._set("fail" if issubclass(err[0], test.failureException) else "error", detail)

    def addSkip(self, test, reason):
        if self.status == "ok":
            self.status = "skip"
            self.detail = ["skip", str(reason), ""]

    def addExpectedFailure(self, test, err):
        self._set("xfail", None)

    def addUnexpectedSuccess(self, test):
        self._set("fail", ["UnexpectedSuccess", "the test is expected to fail and did not", ""])


def run_test(cls, name):
    """[status, [kind of exception, message, stack] or None]; status: ok, skip, xfail, fail, error."""
    global _thread_needed_javascript
    _thread_needed_javascript = False
    result = _Result()
    try:
        try:
            case = cls(name)
        except Exception:
            return ["error", _describe(sys.exc_info())]
        case.run(result)
        if _thread_needed_javascript:
            time.sleep(0.01)  # The interrupt is under way.
    except _Interrupted:
        pass
    if _thread_needed_javascript or (result.detail and _NEEDS_THREAD in result.detail[1]):
        return ["thread", ["thread", _NEEDS_THREAD, ""]]
    return [result.status, result.detail]


def _fixture(function):
    try:
        function()
    except unittest.SkipTest as skip:
        return ["skip", ["skip", str(skip), ""]]
    except BaseException:
        return ["error", _describe(sys.exc_info())]
    return None


def set_up_class(cls):
    """None, or what goes for each of its tests."""
    if getattr(cls, "__unittest_skip__", False):
        return None
    outcome = _fixture(cls.setUpClass)
    if outcome is not None:
        _fixture(cls.doClassCleanups)
    return outcome


def tear_down_class(cls):
    if getattr(cls, "__unittest_skip__", False):
        return None
    return _fixture(cls.tearDownClass) or _fixture(cls.doClassCleanups)


def call_fixture(function):
    return _fixture(function)


def tear_down_module(function):
    outcome = _fixture(function) if function is not None else None
    return outcome or _fixture(unittest.case.doModuleCleanups)


# ---- The originals, for comparison ----


def main(name, log_path, libraries):
    _wrappers.update(dict.fromkeys(libraries))
    with open(log_path, "a") as log:

        def write(**record):
            log.write(json.dumps(record) + "\n")
            log.flush()

        prepare()
        try:
            module = importlib.import_module(name)
        except unittest.SkipTest as skip:
            write(t="file", status="skip", detail=["skip", str(skip), ""])
            return
        except BaseException:
            write(t="file", status="error", detail=_describe(sys.exc_info()))
            return
        set_up = getattr(module, "setUpModule", None)
        for_all = _fixture(set_up) if set_up is not None else None
        for qualname, cls, names in test_classes(list(vars(module)), list(vars(module).values()), name):
            for_class = for_all or set_up_class(cls)
            for test in names:
                identifier = f"{qualname}.{test}"
                write(t="start", id=identifier)
                status, detail = for_class or run_test(cls, test)
                write(t="end", id=identifier, status=status, detail=detail)
            if for_class is None:
                tear_down_class(cls)
        if for_all is None:
            tear_down_module(getattr(module, "tearDownModule", None))
        write(t="done")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
