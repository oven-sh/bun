# Object-oriented programs.
try:
    class InsufficientFunds(Exception):
        def __init__(self, need, have): super().__init__("need %.2f, have %.2f" % (need, have)); self.need = need; self.have = have
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class InsufficientFunds(Exception):')
try:
    class Account:
        count = 0; interest = 0.0
        def __init__(self, owner, balance=0.0):
            self.owner = owner; self._balance = balance; self.history = []; Account.count += 1; self.id = Account.count
        @property
        def balance(self): return self._balance
        def deposit(self, amount):
            if amount <= 0: raise ValueError("deposit must be positive")
            self._balance += amount; self.history.append(("deposit", amount)); return self
        def withdraw(self, amount):
            if amount > self._balance: raise InsufficientFunds(amount, self._balance)
            self._balance -= amount; self.history.append(("withdraw", amount)); return self
        def transfer(self, other, amount): self.withdraw(amount); other.deposit(amount)
        def add_interest(self): self._balance *= 1 + self.interest
        def __repr__(self): return "%s(%r, %.2f)" % (type(self).__name__, self.owner, self._balance)
        def __lt__(self, other): return self._balance < other._balance
        def __eq__(self, other): return isinstance(other, Account) and self.id == other.id
        def __hash__(self): return hash(self.id)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Account:')
try:
    class Savings(Account):
        interest = 0.05
        def withdraw(self, amount):
            if len([h for h in self.history if h[0] == "withdraw"]) >= 2: raise PermissionError("too many withdrawals")
            return super().withdraw(amount)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Savings(Account):')
try:
    class Overdraft(Account):
        def __init__(self, owner, balance=0.0, limit=100.0): super().__init__(owner, balance); self.limit = limit
        def withdraw(self, amount):
            if amount > self._balance + self.limit: raise InsufficientFunds(amount, self._balance + self.limit)
            self._balance -= amount; self.history.append(("withdraw", amount)); return self
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Overdraft(Account):')
try: a, s, o = Account("ann", 100), Savings("sam", 1000), Overdraft("oli", 50)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a, s, o = Account("ann", 100), Savings("sam", 1000), Overdraft("oli",...')
try: a.deposit(50).withdraw(30)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.deposit(50).withdraw(30)')
try: s.withdraw(100).withdraw(100)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s.withdraw(100).withdraw(100)')
try: o.withdraw(120)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o.withdraw(120)')
try: a.transfer(s, 20)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.transfer(s, 20)')
try:
    for acct in (a, s, o): acct.add_interest()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for acct in (a, s, o): acct.add_interest()')
try: print('a =>', a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a')
try: print('s =>', s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: s')
try: print('o =>', o)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: o')
try: print('Account.count =>', Account.count)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Account.count')
try: print('sorted([a, s, o]) =>', sorted([a, s, o]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted([a, s, o])')
try: print('max(a, s, o) =>', max(a, s, o))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: max(a, s, o)')
try: print('a.history =>', a.history)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a.history')
try: print('a == a =>', a == a)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a == a')
try: print('a == s =>', a == s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: a == s')
try: print('len({a, s, o, a}) =>', len({a, s, o, a}))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len({a, s, o, a})')
try:
    for f in (lambda: a.withdraw(1e6), lambda: s.withdraw(1), lambda: o.withdraw(1000), lambda: a.deposit(-5), lambda: setattr(a, "balance", 5)):
        try: f()
        except Exception as e: print(type(e).__name__ + ":", e, getattr(e, "need", ""))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (lambda: a.withdraw(1e6), lambda: s.withdraw(1), lambda: o.w...')
# Shapes.
try:
    class Shape:
        sides = None
        def area(self): raise NotImplementedError(type(self).__name__ + ".area")
        def perimeter(self): raise NotImplementedError
        def describe(self): return "%s with area %.2f and perimeter %.2f" % (type(self).__name__, self.area(), self.perimeter())
        def __lt__(self, o): return self.area() < o.area()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Shape:')
try:
    class Rect(Shape):
        sides = 4
        def __init__(self, w, h): self.w, self.h = w, h
        def area(self): return self.w * self.h
        def perimeter(self): return 2 * (self.w + self.h)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Rect(Shape):')
try:
    class Square(Rect):
        def __init__(self, s): super().__init__(s, s)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Square(Rect):')
try:
    class Circle(Shape):
        def __init__(self, r): self.r = r
        def area(self): return 3.141592653589793 * self.r ** 2
        def perimeter(self): return 2 * 3.141592653589793 * self.r
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Circle(Shape):')
try:
    class Triangle(Shape):
        sides = 3
        def __init__(self, a, b, c): self.abc = (a, b, c)
        def perimeter(self): return sum(self.abc)
        def area(self): p = self.perimeter() / 2; a, b, c = self.abc; return (p * (p - a) * (p - b) * (p - c)) ** 0.5
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Triangle(Shape):')
try:
    class Blob(Shape): pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Blob(Shape): pass')
try: shapes = [Rect(2, 3), Square(2), Circle(1), Triangle(3, 4, 5)]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: shapes = [Rect(2, 3), Square(2), Circle(1), Triangle(3, 4, 5)]')
try:
    for sh in sorted(shapes): print(sh.describe(), sh.sides, isinstance(sh, Rect))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for sh in sorted(shapes): print(sh.describe(), sh.sides, isinstance(s...')
try:
    try: Blob().describe()
    except NotImplementedError as e: print("NotImplementedError:", e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: Blob().describe()')
try: print('sum(sh.area() for sh in shapes if sh.sides) =>', sum(sh.area() for sh in shapes if sh.sides))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(sh.area() for sh in shapes if sh.sides)')
try: print('[type(sh).__mro__[1].__name__ for sh in shapes] =>', [type(sh).__mro__[1].__name__ for sh in shapes])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [type(sh).__mro__[1].__name__ for sh in shapes]')
try: print('{type(sh).__name__: round(sh.area(), 1) for sh in shapes} =>', {type(sh).__name__: round(sh.area(), 1) for sh in shapes})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {type(sh).__name__: round(sh.area(), 1) for sh in shapes}')
# Containers.
try:
    class LinkedList:
        class _Node:
            __slots__ = ("v", "next")
            def __init__(self, v, nxt=None): self.v = v; self.next = nxt
        def __init__(self, it=()):
            self.head = None; self.n = 0
            for v in it: self.append(v)
        def append(self, v):
            node = self._Node(v)
            if not self.head: self.head = node
            else:
                cur = self.head
                while cur.next: cur = cur.next
                cur.next = node
            self.n += 1
        def prepend(self, v): self.head = self._Node(v, self.head); self.n += 1
        def __iter__(self):
            cur = self.head
            while cur: yield cur.v; cur = cur.next
        def __len__(self): return self.n
        def __getitem__(self, i):
            if isinstance(i, slice): return LinkedList(list(self)[i])
            if i < 0: i += self.n
            if not 0 <= i < self.n: raise IndexError("index out of range")
            for j, v in enumerate(self):
                if j == i: return v
        def __contains__(self, v): return any(x == v for x in self)
        def __repr__(self): return "LinkedList([%s])" % ", ".join(map(repr, self))
        def __add__(self, o): return LinkedList(list(self) + list(o))
        def __eq__(self, o): return list(self) == list(o)
        def __bool__(self): return self.n > 0
        def reverse(self):
            prev = None; cur = self.head
            while cur: cur.next, prev, cur = prev, cur, cur.next
            self.head = prev
        def remove(self, v):
            prev = None; cur = self.head
            while cur:
                if cur.v == v:
                    if prev: prev.next = cur.next
                    else: self.head = cur.next
                    self.n -= 1; return
                prev, cur = cur, cur.next
            raise ValueError("%r not in list" % (v,))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class LinkedList:')
try: ll = LinkedList("abc")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ll = LinkedList("abc")')
try: ll.prepend("z")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ll.prepend("z")')
try: ll.append("d")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ll.append("d")')
try: print('ll =>', ll)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ll')
try: print('len(ll) =>', len(ll))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(ll)')
try: print('ll[0] =>', ll[0])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ll[0]')
try: print('ll[-1] =>', ll[-1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ll[-1]')
try: print('ll[1:3] =>', ll[1:3])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ll[1:3]')
try: print('"c" in ll =>', "c" in ll)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "c" in ll')
try: print('"q" in ll =>', "q" in ll)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: "q" in ll')
try: print('ll + [1] =>', ll + [1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ll + [1]')
try: print('list(reversed(list(ll))) =>', list(reversed(list(ll))))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(reversed(list(ll)))')
try: print('bool(ll) =>', bool(ll))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool(ll)')
try: print('bool(LinkedList()) =>', bool(LinkedList()))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool(LinkedList())')
try: print('ll == list("zabcd") =>', ll == list("zabcd"))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ll == list("zabcd")')
try: ll.reverse()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ll.reverse()')
try: ll.remove("b")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ll.remove("b")')
try: print(ll, [v.upper() for v in ll], dict(enumerate(ll)), max(ll), sorted(ll), "-".join(ll), *ll)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: print(ll, [v.upper() for v in ll], dict(enumerate(ll)), max(ll), sort...')
try:
    for f in (lambda: ll[10], lambda: ll.remove("nope")):
        try: f()
        except Exception as e: print(type(e).__name__ + ":", e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (lambda: ll[10], lambda: ll.remove("nope")):')
try:
    class BST:
        def __init__(self): self.root = None; self.size = 0
        def insert(self, k, v=None):
            if self.root is None: self.root = [k, v, None, None]; self.size += 1; return
            n = self.root
            while True:
                if k == n[0]: n[1] = v; return
                i = 2 if k < n[0] else 3
                if n[i] is None: n[i] = [k, v, None, None]; self.size += 1; return
                n = n[i]
        def __contains__(self, k):
            n = self.root
            while n:
                if k == n[0]: return True
                n = n[2] if k < n[0] else n[3]
            return False
        def __iter__(self):
            def walk(n):
                if n: yield from walk(n[2]); yield n[0]; yield from walk(n[3])
            return walk(self.root)
        def height(self):
            def h(n): return 0 if n is None else 1 + max(h(n[2]), h(n[3]))
            return h(self.root)
        def __len__(self): return self.size
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class BST:')
try: t = BST()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t = BST()')
try:
    for k in (50, 30, 70, 20, 40, 60, 80, 30, 65, 10): t.insert(k)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for k in (50, 30, 70, 20, 40, 60, 80, 30, 65, 10): t.insert(k)')
try: print('list(t) =>', list(t))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(t)')
try: print('len(t) =>', len(t))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(t)')
try: print('t.height() =>', t.height())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: t.height()')
try: print('60 in t =>', 60 in t)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 60 in t')
try: print('61 in t =>', 61 in t)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 61 in t')
try: print('min(t) =>', min(t))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: min(t)')
try: print('max(t) =>', max(t))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: max(t)')
try: print('sum(t) =>', sum(t))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum(t)')
try:
    class Stack:
        def __init__(self): self._d = []
        def push(self, v): self._d.append(v); return self
        def pop(self):
            if not self._d: raise IndexError("pop from empty stack")
            return self._d.pop()
        peek = property(lambda self: self._d[-1])
        def __len__(self): return len(self._d)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Stack:')
try:
    def balanced(s):
        st = Stack(); pairs = {")": "(", "]": "[", "}": "{"}
        for c in s:
            if c in "([{": st.push(c)
            elif c in pairs:
                if not st or st.pop() != pairs[c]: return False
        return not st
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def balanced(s):')
try: print('[balanced(s) for s in ("", "()", "([]{})", "(]", "((", "())", "{[()()... =>', [balanced(s) for s in ("", "()", "([]{})", "(]", "((", "())", "{[()()]}")])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [balanced(s) for s in ("", "()", "([]{})", "(]", "((", "())", "{[()()...')
try: print('Stack().push(1).push(2).peek =>', Stack().push(1).push(2).peek)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Stack().push(1).push(2).peek')
# Value types with operators.
try:
    class Vec:
        __slots__ = ("x", "y")
        def __init__(self, x, y): self.x, self.y = x, y
        def __repr__(self): return "Vec(%r, %r)" % (self.x, self.y)
        def __add__(self, o): return Vec(self.x + o.x, self.y + o.y)
        def __sub__(self, o): return Vec(self.x - o.x, self.y - o.y)
        def __mul__(self, k): return self.x * k.x + self.y * k.y if isinstance(k, Vec) else Vec(self.x * k, self.y * k)
        __rmul__ = __mul__
        def __neg__(self): return Vec(-self.x, -self.y)
        def __abs__(self): return (self.x ** 2 + self.y ** 2) ** 0.5
        def __eq__(self, o): return isinstance(o, Vec) and (self.x, self.y) == (o.x, o.y)
        def __hash__(self): return hash((self.x, self.y))
        def __iter__(self): return iter((self.x, self.y))
        def __bool__(self): return bool(self.x or self.y)
        def __getitem__(self, i): return (self.x, self.y)[i]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Vec:')
try: v, w = Vec(3, 4), Vec(1, -2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: v, w = Vec(3, 4), Vec(1, -2)')
try: print('v + w =>', v + w)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: v + w')
try: print('v - w =>', v - w)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: v - w')
try: print('v * 2 =>', v * 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: v * 2')
try: print('2 * v =>', 2 * v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 2 * v')
try: print('v * w =>', v * w)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: v * w')
try: print('-v =>', -v)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: -v')
try: print('abs(v) =>', abs(v))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: abs(v)')
try: print('v == Vec(3, 4) =>', v == Vec(3, 4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: v == Vec(3, 4)')
try: print('v != w =>', v != w)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: v != w')
try: print('bool(Vec(0, 0)) =>', bool(Vec(0, 0)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: bool(Vec(0, 0))')
try: print('tuple(v) =>', tuple(v))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: tuple(v)')
try: print('v[1] =>', v[1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: v[1]')
try: print('{v: 1}[Vec(3, 4)] =>', {v: 1}[Vec(3, 4)])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {v: 1}[Vec(3, 4)]')
try: print('sum([v, w, v], Vec(0, 0)) =>', sum([v, w, v], Vec(0, 0)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum([v, w, v], Vec(0, 0))')
try: print('[*w] =>', [*w])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [*w]')
try: print('max(v) =>', max(v))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: max(v)')
try:
    def gcd(a, b):
        while b: a, b = b, a % b
        return a
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def gcd(a, b):')
try:
    class Frac:
        def __init__(self, n, d=1):
            if d == 0: raise ZeroDivisionError("Frac(%d, 0)" % n)
            g = gcd(abs(n), abs(d)) or 1; s = -1 if d < 0 else 1; self.n, self.d = s * n // g, s * d // g
        def _c(o): return o if isinstance(o, Frac) else Frac(o) if isinstance(o, int) else None
        def __add__(self, o): o = Frac._c(o); return NotImplemented if o is None else Frac(self.n * o.d + o.n * self.d, self.d * o.d)
        __radd__ = __add__
        def __sub__(self, o): o = Frac._c(o); return NotImplemented if o is None else Frac(self.n * o.d - o.n * self.d, self.d * o.d)
        def __rsub__(self, o): return Frac._c(o) - self
        def __mul__(self, o): o = Frac._c(o); return NotImplemented if o is None else Frac(self.n * o.n, self.d * o.d)
        __rmul__ = __mul__
        def __truediv__(self, o): o = Frac._c(o); return NotImplemented if o is None else Frac(self.n * o.d, self.d * o.n)
        def __rtruediv__(self, o): return Frac._c(o) / self
        def __pow__(self, k): return Frac(self.n ** k, self.d ** k) if k >= 0 else Frac(self.d ** -k, self.n ** -k)
        def __neg__(self): return Frac(-self.n, self.d)
        def __eq__(self, o): o = Frac._c(o); return o is not None and (self.n, self.d) == (o.n, o.d)
        def __lt__(self, o): o = Frac._c(o); return self.n * o.d < o.n * self.d
        def __le__(self, o): return self == o or self < o
        def __hash__(self): return hash((self.n, self.d))
        def __float__(self): return self.n / self.d
        def __int__(self): return self.n // self.d if self.n >= 0 else -(-self.n // self.d)
        def __repr__(self): return "%d/%d" % (self.n, self.d) if self.d != 1 else str(self.n)
        def __format__(self, spec): return format(float(self), spec) if spec else repr(self)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Frac:')
try: h, th = Frac(1, 2), Frac(1, 3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h, th = Frac(1, 2), Frac(1, 3)')
try: print('h + th =>', h + th)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h + th')
try: print('h - th =>', h - th)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h - th')
try: print('h * th =>', h * th)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h * th')
try: print('h / th =>', h / th)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h / th')
try: print('h ** 3 =>', h ** 3)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h ** 3')
try: print('h ** -2 =>', h ** -2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h ** -2')
try: print('-h =>', -h)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: -h')
try: print('1 + h =>', 1 + h)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 1 + h')
try: print('1 - h =>', 1 - h)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 1 - h')
try: print('2 * h =>', 2 * h)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 2 * h')
try: print('1 / th =>', 1 / th)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: 1 / th')
try: print('h == Frac(2, 4) =>', h == Frac(2, 4))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h == Frac(2, 4)')
try: print('h < th =>', h < th)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h < th')
try: print('sorted([h, th, Frac(3, 4), Frac(-1, 5)]) =>', sorted([h, th, Frac(3, 4), Frac(-1, 5)]))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sorted([h, th, Frac(3, 4), Frac(-1, 5)])')
try: print('float(h) =>', float(h))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: float(h)')
try: print('int(Frac(7, 2)) =>', int(Frac(7, 2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: int(Frac(7, 2))')
try: print('int(Frac(-7, 2)) =>', int(Frac(-7, 2)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: int(Frac(-7, 2))')
try: print('f"{th:.3f} {th}" =>', f"{th:.3f} {th}")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: f"{th:.3f} {th}"')
try: print('sum((Frac(1, n * (n + 1)) for n in range(1, 20)), Frac(0)) =>', sum((Frac(1, n * (n + 1)) for n in range(1, 20)), Frac(0)))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: sum((Frac(1, n * (n + 1)) for n in range(1, 20)), Frac(0))')
try: print('Frac(6, -8) =>', Frac(6, -8))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Frac(6, -8)')
try: print('h == 0.5 =>', h == 0.5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: h == 0.5')
try: print('Frac(4, 2) == 2 =>', Frac(4, 2) == 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Frac(4, 2) == 2')
try:
    for f in (lambda: Frac(1, 0), lambda: h + "x", lambda: h / 0, lambda: h + 1.5):
        try: print(f())
        except Exception as e: print(type(e).__name__ + ":", e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (lambda: Frac(1, 0), lambda: h + "x", lambda: h / 0, lambda:...')
# Patterns: observer, state machine, mixins, registry via decorator and metaclass, a hand-made dataclass.
try:
    class Event:
        def __init__(self): self._subs = []
        def subscribe(self, fn): self._subs.append(fn); return fn
        def unsubscribe(self, fn): self._subs.remove(fn)
        def fire(self, *a, **k): return [fn(*a, **k) for fn in self._subs]
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Event:')
try: ev = Event()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ev = Event()')
try: log = []
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log = []')
try:
    @ev.subscribe
    def first(x): log.append(("first", x)); return x + 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def first(x): log.append(("first", x)); return x + 1')
try: second = ev.subscribe(lambda x: log.append(("second", x)) or x * 2)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: second = ev.subscribe(lambda x: log.append(("second", x)) or x * 2)')
try: print('ev.fire(10) =>', ev.fire(10))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ev.fire(10)')
try: print('log =>', log)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log')
try: ev.unsubscribe(first)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ev.unsubscribe(first)')
try: print('ev.fire(5) =>', ev.fire(5))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: ev.fire(5)')
try: print('log[-1] =>', log[-1])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: log[-1]')
try:
    class Machine:
        transitions = {("idle", "start"): "running", ("running", "pause"): "paused", ("paused", "start"): "running", ("running", "stop"): "idle", ("paused", "stop"): "idle"}
        def __init__(self): self.state = "idle"; self.trace = []
        def send(self, event):
            try: new = self.transitions[self.state, event]
            except KeyError: raise RuntimeError("cannot %s while %s" % (event, self.state)) from None
            getattr(self, "on_" + new, lambda: None)(); self.trace.append((self.state, event, new)); self.state = new; return self
        def on_running(self): self.trace.append("engine on")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Machine:')
try: mch = Machine()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mch = Machine()')
try: mch.send("start").send("pause").send("start").send("stop")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mch.send("start").send("pause").send("start").send("stop")')
try: print('mch.state =>', mch.state)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mch.state')
try: print('mch.trace =>', mch.trace)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: mch.trace')
try:
    try: mch.send("pause")
    except RuntimeError as e: print("RuntimeError:", e, e.__cause__, e.__suppress_context__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try: mch.send("pause")')
try:
    class ReprMixin:
        def __repr__(self): return "%s(%s)" % (type(self).__name__, ", ".join("%s=%r" % kv for kv in sorted(vars(self).items())))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class ReprMixin:')
try:
    class EqMixin:
        def __eq__(self, o): return type(self) is type(o) and vars(self) == vars(o)
        __hash__ = None
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class EqMixin:')
try:
    class JsonMixin:
        def to_json(self): return "{" + ", ".join('"%s": %s' % (k, '"%s"' % v if isinstance(v, str) else v) for k, v in sorted(vars(self).items())) + "}"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class JsonMixin:')
try:
    class Person(ReprMixin, EqMixin, JsonMixin):
        def __init__(self, name, age): self.name = name; self.age = age
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Person(ReprMixin, EqMixin, JsonMixin):')
try: p = Person("Ann", 30)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p = Person("Ann", 30)')
try: print('p =>', p)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p')
try: print('p == Person("Ann", 30) =>', p == Person("Ann", 30))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p == Person("Ann", 30)')
try: print('p == Person("Bob", 30) =>', p == Person("Bob", 30))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p == Person("Bob", 30)')
try: print('p.to_json() =>', p.to_json())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: p.to_json()')
try: print('[c.__name__ for c in Person.__mro__] =>', [c.__name__ for c in Person.__mro__])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: [c.__name__ for c in Person.__mro__]')
try:
    def dataclass(cls):
        fields = list(cls.__annotations__)
        def __init__(self, *a, **k):
            if len(a) > len(fields): raise TypeError("%s() takes %d arguments but %d were given" % (cls.__name__, len(fields), len(a)))
            vals = dict(zip(fields, a)); vals.update(k)
            for f in fields:
                if f in vals: setattr(self, f, vals[f])
                elif hasattr(cls, f): setattr(self, f, getattr(cls, f))
                else: raise TypeError("%s() missing argument %r" % (cls.__name__, f))
        cls.__init__ = __init__
        cls.__repr__ = lambda self: "%s(%s)" % (cls.__name__, ", ".join("%s=%r" % (f, getattr(self, f)) for f in fields))
        cls.__eq__ = lambda self, o: type(o) is cls and all(getattr(self, f) == getattr(o, f) for f in fields)
        cls.__match_args__ = tuple(fields)
        return cls
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def dataclass(cls):')
try:
    @dataclass
    class Item:
        name: str
        price: float
        qty: int = 1
        def total(self): return self.price * self.qty
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Item:')
try: it = Item("pen", 1.5)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it = Item("pen", 1.5)')
try: print('it =>', it)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it')
try: print('Item("ink", 4.0, qty=3).total() =>', Item("ink", 4.0, qty=3).total())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Item("ink", 4.0, qty=3).total()')
try: print('it == Item("pen", 1.5, 1) =>', it == Item("pen", 1.5, 1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it == Item("pen", 1.5, 1)')
try: print('it == Item("pen", 2.0) =>', it == Item("pen", 2.0))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: it == Item("pen", 2.0)')
try: print('Item.__match_args__ =>', Item.__match_args__)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Item.__match_args__')
try:
    match Item("cap", 9.0, 2):
        case Item(n, price=pr, qty=q) if q > 1: print("bulk", n, pr * q)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: match Item("cap", 9.0, 2):')
try:
    for f in (lambda: Item("x"), lambda: Item(1, 2, 3, 4)):
        try: f()
        except TypeError as e: print("TypeError:", e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (lambda: Item("x"), lambda: Item(1, 2, 3, 4)):')
try:
    class EnumMeta(type):
        def __new__(m, name, bases, ns):
            members = {k: v for k, v in ns.items() if not k.startswith("_") and not callable(v)}
            cls = super().__new__(m, name, bases, {k: v for k, v in ns.items() if k not in members}); cls._members = {}
            for k, v in members.items():
                inst = object.__new__(cls); inst.name = k; inst.value = v; cls._members[k] = inst; type.__setattr__(cls, k, inst)
            return cls
        def __iter__(cls): return iter(cls._members.values())
        def __len__(cls): return len(cls._members)
        def __getitem__(cls, k): return cls._members[k]
        def __call__(cls, v):
            for mem in cls:
                if mem.value == v: return mem
            raise ValueError("%r is not a valid %s" % (v, cls.__name__))
        def __setattr__(cls, k, v):
            if k in getattr(cls, "_members", ()): raise AttributeError("cannot reassign member " + k)
            super().__setattr__(k, v)
        def __contains__(cls, x): return x in cls._members.values()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class EnumMeta(type):')
try:
    class Color(metaclass=EnumMeta):
        RED = 1; GREEN = 2; BLUE = 3
        def __repr__(self): return "<%s.%s: %r>" % (type(self).__name__, self.name, self.value)
        def shout(self): return self.name + "!"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Color(metaclass=EnumMeta):')
try: print('Color.RED =>', Color.RED)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Color.RED')
try: print('list(Color) =>', list(Color))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: list(Color)')
try: print('len(Color) =>', len(Color))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: len(Color)')
try: print('Color["GREEN"] =>', Color["GREEN"])
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Color["GREEN"]')
try: print('Color(3) =>', Color(3))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Color(3)')
try: print('Color.RED is Color(1) =>', Color.RED is Color(1))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Color.RED is Color(1)')
try: print('Color.BLUE.shout() =>', Color.BLUE.shout())
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Color.BLUE.shout()')
try: print('Color.RED in Color =>', Color.RED in Color)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: Color.RED in Color')
try: print('isinstance(Color.RED, Color) =>', isinstance(Color.RED, Color))
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: isinstance(Color.RED, Color)')
try: print('{c.name: c.value for c in Color} =>', {c.name: c.value for c in Color})
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: {c.name: c.value for c in Color}')
try:
    for f in (lambda: Color(9), lambda: setattr(Color, "RED", 5), lambda: Color["PINK"]):
        try: f()
        except Exception as e: print(type(e).__name__ + ":", e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: for f in (lambda: Color(9), lambda: setattr(Color, "RED", 5), lambda:...')
try:
    class Transaction:
        def __init__(self, store): self.store = store
        def __enter__(self): self.backup = dict(self.store); return self.store
        def __exit__(self, t, v, tb):
            if t is not None: self.store.clear(); self.store.update(self.backup); return t is KeyError
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class Transaction:')
try: store = {"a": 1}
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: store = {"a": 1}')
try:
    with Transaction(store) as st: st["b"] = 2
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with Transaction(store) as st: st["b"] = 2')
try: print(store)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: store')
try:
    with Transaction(store) as st: st["c"] = 3; raise KeyError("rolled back and swallowed")
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: with Transaction(store) as st: st["c"] = 3; raise KeyError("rolled ba...')
try: print(store)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: store')
try:
    try:
        with Transaction(store) as st: st.clear(); raise RuntimeError("rolled back and propagated")
    except RuntimeError as e: print(store, e)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: try:')
