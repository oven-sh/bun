import gc
import warnings

warnings.simplefilter("ignore")

asked = []


class Key:
    def __init__(self, text, how):
        self.text, self.how = text, how

    def __hash__(self):
        return hash(self.text)

    def __eq__(self, other):
        asked.append(other)
        if self.how == 'raises':
            raise KeyError(other)
        if self.how == 'collects':
            gc.collect()
        if self.how == 'allocates':
            [[] for _ in range(100)]
        return self.how != 'says no' and self.text == other


def call(self, *args):
    return 'called'


def instance(how, **others):
    return type('By_' + how.replace(' ', '_'), (), {Key('__call__', how): call, **others})()


only_by_key = instance('says yes')
derived = type('Derived', (type(only_by_key),), {})()
beside_a_key = instance('says no', __call__=call)
not_at_all = instance('says no')
raises, collects, allocates = instance('raises'), instance('collects'), instance('allocates')


def is_callable(o):
    return callable(o)


def call_it(o):
    try:
        return o()
    except TypeError:
        return 'TypeError'


def times_asked():
    count = len(asked)
    asked.clear()
    return count
