"""What these tests need and JavaScript has no way to say. Each function here is a gap: see README.md."""

import warnings

import _js


def make_class(name, bases, namespace, **kwargs):
    """class name(*bases, **kwargs), with what the object of JavaScript holds. Its functions become methods.

    For what `class name extends base` cannot say: several bases, keywords, functions that are made elsewhere.
    """
    body = {key: _js.JSMethod(value) if isinstance(value, _js.JSFunction) else value for key, value in namespace.items()}
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
