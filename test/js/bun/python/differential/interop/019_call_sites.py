# A place in a Python program that has called many things calls functions of JS like a place that has called nothing else: named arguments
# become a last object, whole floats numbers, a class is constructed.
import re

import js

describe = js.eval('''(function () { "use strict"; return typeof this + " " + Array.prototype.map.call(arguments, a =>
    a === null ? "null" : typeof a === "object" ? "{" + Object.keys(a).map(k => k + ":" + a[k]).join() + "}" : typeof a + ":" + a).join(" ") })''')
sloppy = js.eval('(function (a, b) { return (this === globalThis) + " " + arguments.length + " " + a + " " + b })')
arrow = js.eval('((a, b = "default") => a + "/" + b)')
Class = js.eval('(class Point { constructor(x, y) { this.x = x; this.y = y } toString() { return "Point(" + this.x + "," + this.y + ")" } })')
bound = js.eval('(function (a, b, c) { return [this.tag, a, b, c].join() }).bind({ tag: "bound" }, "first")')
proxy = js.eval('new Proxy(function (a, b) { return "target " + a + " " + b }, {})')
trapped = js.eval('new Proxy(function () {}, { apply(target, self, args) { return "trapped " + args.join() } })')
throws = js.eval('(function (a) { throw new RangeError("from JS " + a) })')
foreign = [describe, sloppy, arrow, Class, bound, proxy, trapped, throws, js.Math.max, js.String, js.Array.of, js.JSON.stringify, js.parseInt]


def python1(a=None, b=None, **kw): return 'python1 %r %r %r' % (a, b, kw)
def python2(*args, **kw): return 'python2 %r %r' % (args, kw)
def closure(n): return lambda a=None, b=None, **kw: 'closure %d %r %r %r' % (n, a, b, kw)


class Callable:
    def __call__(self, *args, **kw): return 'called %r %r' % (args, kw)


pythons = [python1, python2, closure(1), closure(2), Callable(), Callable().__call__, str, len, '{}{}'.format]


def at0(f): return f()
def at1(f): return f(7)
def at2(f): return f(7, 8)
def at_float(f): return f(2.0, 2.5)
def at_keyword(f): return f(7, b=8)
def at_keywords(f): return f(a=1.0, b='two')
def at_star(f): return f(*(7, 8.0))
def at_star_star(f): return f(7, **{'b': 8.0})


sites = [at0, at1, at2, at_float, at_keyword, at_keywords, at_star, at_star_star]


def outcome(site, f):
    try:
        return re.sub('0x[0-9a-f]+', 'ADDRESS', str(site(f)))
    except Exception as error:
        return '%s: %s' % (type(error).__name__, error)


# What each gives at a place that has called nothing else.
alone = {}
source = {'at0': 'f()', 'at1': 'f(7)', 'at2': 'f(7, 8)', 'at_float': 'f(2.0, 2.5)', 'at_keyword': 'f(7, b=8)', 'at_keywords': "f(a=1.0, b='two')",
          'at_star': 'f(*(7, 8.0))', 'at_star_star': "f(7, **{'b': 8.0})"}
for i, f in enumerate(foreign + pythons):
    for site in sites:
        namespace = {}
        exec('def fresh(f): return ' + source[site.__name__], namespace)
        alone[i, site] = outcome(namespace['fresh'], f)

different = 0
for order in (foreign + pythons, pythons + foreign, list(reversed(foreign + pythons))):
    for turn in range(3):
        for f in order:
            i = (foreign + pythons).index(f)
            for site in sites:
                for again in range(2):
                    result = outcome(site, f)
                    if result != alone[i, site]:
                        different += 1
                        print('differs', site.__name__, i, result, '|', alone[i, site])
print('different:', different)
for i, f in enumerate(foreign):
    for site in sites:
        print(i, site.__name__, alone[i, site])

# What a function of JS gets for named arguments is an object like any other when it is Python that passes it on, whatever it passes it to.
marked = js.eval('(x) => x')(a=2)


class Taking:
    def method(self, *args, **kw): return 'method %d %r' % (len(args), sorted(kw))
    def __call__(self, *args, **kw): return 'called %d %r' % (len(args), sorted(kw))
    def one(self, x): return 'one ' + type(x).__name__


def taking(*args, **kw): return 'function %d %r' % (len(args), sorted(kw))
def passing(f, x): return f(x)
def passing_star(f, x): return f(*[x])


for turn in range(4):
    print([site(f, marked) for site in (passing, passing_star) for f in (taking, Taking().method, Taking(), Taking().one, len)])

# The same once JS has looked at the functions, which are laid out otherwise from then on.
looks = js.eval('(f) => { f.extra = 1; return [typeof f.name, typeof f.length, Object.keys(f).includes("extra")].join() }')
print(looks(taking), looks(Taking.method), looks(Taking.__call__), looks(Taking.one))
for turn in range(4):
    print([site(f, marked) for site in (passing, passing_star) for f in (taking, Taking().method, Taking(), Taking().one, len)])

# It is named arguments when JS passes it: also where a function of JS leaves its frame to what it calls, so that what called that is next,
# and where Python code calls a Proxy, which is JS.
returns = js.eval('(function (f, x) { const result = f(x); return result })')
leaves = js.eval('(function (f, x) { "use strict"; return f(x) })')
wrapped = js.eval('(f) => new Proxy(f, {})')
for turn in range(4):
    print([via(f, marked) for via in (returns, leaves) for f in (taking, Taking().method, Taking())],
          [site(wrapped(f), marked) for site in (passing, passing_star) for f in (taking, Taking().method, Taking())])
