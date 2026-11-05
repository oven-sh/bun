# Without the traceback module, exceptions are printed by the interpreter itself: nothing is underlined, and there are no hints.
import sys

sys.modules['traceback'] = None
sys.stderr = sys.stdout


class K:
    def __init__(self):
        self.nope = 1
        self._hidden = 2
        self.inner = self

    def name(self):
        return nope

    def name_like_local(self):
        nope_ = 1
        return nope

    def attribute(self):
        return self._hiden

    def nested(self):
        return self.nop

    def other(self):
        o = K()
        return o._hiden


def plain():
    value = 1
    return valu


def module():
    return collections


def generator():
    value = 1
    yield valu


class Body:
    try:
        attribute = 1
        attribut
    except NameError:
        sys.__excepthook__(*sys.exc_info())


for function in (K().name, K().name_like_local, K().attribute, K().nested, K().other, plain, module, lambda: next(generator()), lambda: [valu for value in (1,)], lambda: sys.modulez, lambda: (1).reel):
    try:
        function()
    except (NameError, AttributeError):
        sys.__excepthook__(*sys.exc_info())
print('done')
