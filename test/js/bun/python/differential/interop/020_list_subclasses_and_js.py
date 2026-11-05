# An instance of a class derived from list is an array to JS. What JS does to it does not confuse the places in Python code that have read
# attributes of such objects before.
import js

set_property = js.eval('(function (a, k, v) { a[k] = v })')
get_property = js.eval('(function (a, k) { return a[k] })')
delete_property = js.eval('(function (a, k) { return delete a[k] })')
define_property = js.eval('(function (a, k, v) { Object.defineProperty(a, k, { value: v, configurable: true, writable: true, enumerable: false }) })')
set_length = js.eval('(function (a, n) { a.length = n })')
push = js.eval('(function (a, v) { return a.push(v) })')
keys = js.eval('(function (a) { return Object.keys(a).join() })')
is_array = js.Array.isArray
call_method = js.eval('(function (a, k, v) { return a[k](v) })')
freeze = js.eval('(function (a) { try { Object.freeze(a); return "frozen" } catch (e) { return e.constructor.name } })')


def attempt(function, *args):
    try:
        return function(*args)
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)


class L(list):
    flag = 'flag of the class'
    def method(self, x=0): return ('method', len(self), x)


class M(list):
    flag = 'flag of M'
    def method(self, x=0): return ('method of M', len(self), x)


def flag(o): return o.flag
def method(o): return o.method(1)
def own(o): return o.own
# (It does not ask for the __dict__: an object that has been asked for it is another matter to those places.)
def state(o): return (flag(o), method(o), attempt(own, o), list(o))


o = L([1, 2])
other = L([1, 2])
for _ in range(3):
    print(state(o), state(other))

print('--- JS reads')
print(is_array(o), get_property(o, 0), get_property(o, 'length'), get_property(o, 'flag'), call_method(o, 'method', 5), keys(o))

print('--- JS adds items')
print(push(o, 3), state(o))
set_property(o, 3, 4)
print(state(o))
set_property(o, 6, 7)
print(attempt(state, o))
set_length(o, 2)
print(state(o))
set_length(o, 0)
print(state(o), state(other))
push(o, 1.5)
push(o, 'text')
print(state(o))

print('--- JS sets what Python reads')
set_property(o, 'own', 'set by JS')
print(state(o), state(other))
set_property(o, 'flag', 'flag set by JS')
print(state(o), state(other))
print(get_property(o, 'flag'), get_property(o, 'own'), keys(o))
print(delete_property(o, 'flag'), state(o))
print(delete_property(o, 'own'), state(o))
print(attempt(define_property, o, 'flag', 'defined by JS'), state(o), state(other))
print(attempt(delete_property, o, 'flag'), state(o))

print('--- Python sets what JS reads')
o.own = 'set by Python'
print(get_property(o, 'own'), keys(o), state(o))
del o.own
print(get_property(o, 'own'), state(o))
L.flag = 'changed in the class'
print(get_property(o, 'flag'), state(o), state(other))

print('--- another class')
o.__class__ = M
print(get_property(o, 'flag'), call_method(o, 'method', 5), state(o), state(other))
o.__class__ = L
print(get_property(o, 'flag'), state(o))

print('--- frozen')
print(freeze(other), attempt(state, other), attempt(other.append, 1), attempt(setattr, other, 'own', 1), attempt(state, other))

print('--- the same once the objects have been asked for their __dict__')
fresh = L([1])
print(state(fresh), fresh.__dict__, state(fresh))
set_property(fresh, 'own', 'set by JS')
print(state(fresh), fresh.__dict__)
fresh.__dict__['flag'] = 'through the dict'
print(state(fresh), get_property(fresh, 'flag'), o.__dict__)
