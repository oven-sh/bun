"""What these tests need and JavaScript has no way to say. Each function here is a gap: see README.md."""

import warnings

import _js


def with_(manager, body):
    """with manager as value: return body(value)"""
    with manager as value:
        return body(value)


async def async_with(manager, body):
    """async with manager as value: return await body(value)"""
    async with manager as value:
        return await body(value)


def method(function, name=None, qualname=None):
    """A function of JavaScript as a method: `this` is the instance."""

    def method(self, /, *args, **kwargs):
        return function.call(self, *args, **kwargs)

    method.__name__ = name or function.name or "method"
    method.__qualname__ = qualname or method.__name__
    return method


def make_class(name, bases, namespace, **kwargs):
    """class name(*bases, **kwargs), with what the object of JavaScript holds. Its functions become methods."""
    body = {
        key: method(value, key, f"{name}.{key}") if isinstance(value, _js.JSFunction) else value
        for key, value in namespace.items()
    }
    body.setdefault("__module__", __name__)
    return type(bases[0] if bases else object)(name, tuple(bases), body, **kwargs)


def warns(category, body):
    """The warnings of the category that body() gave, as warnings.catch_warnings(record=True) has them."""
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        body()
    return [warning for warning in caught if issubclass(warning.category, category)]


def call(function, args=(), kwargs={}):
    """function(*args, **kwargs), for keywords that are no names of JavaScript's or come from a dict"""
    return function(*args, **kwargs)


async def _wait(awaitable):
    return await awaitable


def create_task(owner, awaitable, **kwargs):
    """owner.create_task(coroutine), for a promise. JavaScript never holds a coroutine: to call an `async def` gives it a promise."""
    return owner.create_task(_wait(awaitable), **kwargs)
