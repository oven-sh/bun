# What super().name(...) calls where the class behind has something of JavaScript by the name: the result is the same whether or not a tool is told of calls.
#
# A function of JavaScript in a class is bound like a function of Python, and gets the instance as `this`, not as its first argument.
import js, sys, cProfile
def F(source): return js.eval('(' + source + ')')
Animal = F("""class Animal {
    constructor(name) { this.name = name }
    speak(x) { return 'Animal ' + this.name + ' ' + x }
    get loud() { return (x) => this.name.toUpperCase() + x }
}""")
holder = F("{ name: 'holder', m(x) { return String(this && this.name) + ':' + String(x) } }")
class Base:
    name = 'base'
    def __repr__(self): return 'the instance'
    plain = F("function(x) { return String(this && this.name) + ':' + String(x) }")
    strict = F("function(x) { 'use strict'; return String(this && this.name) + ':' + String(x) }")
    arrow = F("(x) => 'arrow:' + String(x)")
    bound = F("function(x) { return String(this && this.name) + ':' + String(x) }.bind({ name: 'bound to this' })")
    bound_with_argument = F("function(x) { return String(this && this.name) + ':' + String(x) }.bind({ name: 'bound to this' }, 'first')")
    taken_from_an_object = holder.m
    rest = F("function(...a) { return String(this && this.name) + ':' + a.length }")
    native = F("Math.max")
    throws = F("function(x) { throw new TypeError('thrown ' + x) }")
    proxy = F("new Proxy(function(x) { return String(this && this.name) + ':' + String(x) }, {})")
    static = staticmethod(F("function(x) { return String(this && this.name) + ':' + String(x) }"))
    class_ = classmethod(F("function(x) { return String(this && this.__name__) + ':' + String(x) }"))
    class_of_js = F("class { constructor(x) { this.x = x } }")
    prop = property(lambda self: F("function(x) { return String(this && this.name) + ':' + String(x) }"))
NAMES = [n for n in vars(Base) if not n.startswith('__') and n != 'name']
ns = {'Base': Base, 'Animal': Animal}
exec('class Derived(Base):\n' + ''.join('    def %s(self, x): return super().%s(x)\n    def two_%s(self, x): return super(Derived, self).%s(x)\n' % (n, n, n, n) for n in NAMES), ns)
exec('class Dog(Animal):\n    def speak(self, x): return "Dog, " + super().speak(x)\n    def loud_(self, x): return super().loud(x)\n    def two(self, x): return super(Dog, self).speak(x)\n', ns)
Derived = ns['Derived']; Dog = ns['Dog']
CALLS = [(n, lambda n=n: getattr(Derived(), n)(5)) for n in NAMES] + [('two_' + n, lambda n=n: getattr(Derived(), 'two_' + n)(5)) for n in NAMES] + [
    ('a method of a class of JavaScript', lambda: Dog('Rex').speak('!')), ('the same, super with arguments', lambda: Dog('Rex').two('!')),
    ('a getter of a class of JavaScript', lambda: Dog('Rex').loud_('!'))]
def outcome(call):
    try:
        r = call()
        return str(r.x) + ' in an object' if hasattr(r, 'x') else repr(r)
    except Exception as e:
        return '%s: %s' % (type(e).__name__, e)
def profiled(call):
    sys.setprofile(lambda frame, event, arg: None)
    try: return outcome(call)
    finally: sys.setprofile(None)
def traced(call):
    def tr(frame, event, arg): return tr
    sys.settrace(tr)
    try: return outcome(call)
    finally: sys.settrace(None)
M = sys.monitoring
def monitored(call, answer=None):
    M.use_tool_id(3, 'test'); M.register_callback(3, M.events.CALL, lambda code, offset, f, a: answer); M.set_events(3, M.events.CALL)
    try: return [outcome(call), outcome(call)]
    finally:
        M.set_events(3, 0); M.register_callback(3, M.events.CALL, None); M.free_tool_id(3); M.restart_events()
def under_cprofile(call):
    p = cProfile.Profile(); p.enable()
    try: return outcome(call)
    finally: p.disable()
for name, call in CALLS:
    plainly = outcome(call)
    others = {'setprofile': profiled(call), 'settrace': traced(call), 'monitoring': monitored(call), 'monitoring, DISABLE': monitored(call, M.DISABLE), 'cProfile': under_cprofile(call), 'afterwards': outcome(call)}
    different = {k: v for k, v in others.items() if v != plainly and v != [plainly] * 2}
    print('%s: %s | %s' % (name, plainly, different or 'the same under every tool'))
