class V:
    calls = 0

    def __init__(self, x):
        self.x = x

    def _v(o):
        return o if isinstance(o, (int, float)) else o.x

    def __eq__(self, o):
        V.calls += 1
        return isinstance(o, V) and self.x == o.x

    def __hash__(self):
        return hash(self.x)

    def __lt__(self, o):
        V.calls += 1
        return self.x < V._v(o)

    def __le__(self, o):
        V.calls += 1
        return self.x <= V._v(o)

    def __gt__(self, o):
        V.calls += 1
        return self.x > V._v(o)

    def __ge__(self, o):
        V.calls += 1
        return self.x >= V._v(o)

    def __add__(self, o):
        return V(self.x + V._v(o))

    def __radd__(self, o):
        return V(V._v(o) + self.x + 1000)

    def __sub__(self, o):
        return V(self.x - V._v(o))

    def __rsub__(self, o):
        return V(V._v(o) - self.x + 1000)

    def __mul__(self, o):
        return V(self.x * V._v(o))

    def __rmul__(self, o):
        return V(V._v(o) * self.x + 1000)

    def __or__(self, o):
        return V(self.x | V._v(o))

    def __neg__(self):
        return V(-self.x)

    def __invert__(self):
        return V(~self.x)


class Plain:
    pass


def calls():
    n = V.calls
    V.calls = 0
    return n


vs = [V(i % 4) for i in range(8)]
ws = [V(i % 3) for i in range(8)]
plains = [Plain() for i in range(8)]
tuples = [(i % 4, "t") for i in range(8)]
tuples2 = [(i % 3, "t") for i in range(8)]
floats = [float(i % 4) for i in range(8)]
floats2 = [float(i % 3) for i in range(8)]
# To JS these are arrays and functions like any other: the same if identical.
lists = [[i % 4] for i in range(8)]
lists2 = [[i % 4] for i in range(8)]
functions = [(lambda i=i: i) for i in range(8)]
# In a list a NaN is an object to JS, and not equal to itself.
nans = [float("nan") if i % 2 else float(i) for i in range(8)]
