# A function of JS's that has been inlined in a hot one has no frame of its own. Python, called from it, tries to resize a bytearray of which there is a view,
# and so asks what the frames hold. The view is held each time, so the answer is a BufferError whatever lies about on the stack.
import js
from bun import jsc
data = bytearray(b'abcdefgh')
warm = [True]
said = []
def resize():
    if not warm[0]:
        try:
            data.extend(b'x'); said.append('resized')
        except BufferError:
            said.append('BufferError')
    return 1
def make():
    return memoryview(data)
def use(view):
    if warm[0]:
        view.release()
    else:
        try:
            said.append(view[0])
        except ValueError:
            said.append('released')
    return 1
def until_compiled(function, call):
    # Not for ever, should nothing be compiled at all.
    for _ in range(400):
        call(5000)
        if jsc.numberOfDFGCompiles(function):
            break
    # (With the compilers turned off it pretends a million.)
    print('compiled:', bool(jsc.numberOfDFGCompiles(function)))
holder = js.eval('(resize) => ({ get x() { return resize() } })')(resize)

# Two calls deep. Python has the view.
outer = js.eval('''(() => {
  function inner(o) { return o.x }
  function middle(o) { let a = 1, b = 2, c = 3; a += b; b += c; c += a; a += b; b += c; c += a; a += b; b += c; c += a; a += b; b += c; c += a; return inner(o) + a + b + c }
  return function outer(o, n) { let s = 0; for (let i = 0; i < n; i++) s += middle(o); return s }
})()''')
until_compiled(outer, lambda n: outer(holder, n))
kept = memoryview(data)
warm[0] = False
print(outer(holder, 3), said, len(data), kept[0])
kept.release()

# A call in tail position: of the frame of the compiled code only the function that was inlined is shown. That frame alone has the view.
warm[0] = True
said.clear()
outer, drive = js.eval('''(() => { "use strict";
  function inner(o, view, use) { const r = o.x; return r + use(view) }
  function outer(o, make, use) { return inner(o, make(), use) }
  return [outer, (o, make, use, n) => { for (let i = 0; i < n; i++) outer(o, make, use) }]
})()''')
until_compiled(outer, lambda n: drive(holder, make, use, n))
warm[0] = False
print(outer(holder, make, use), said, len(data))

# The same, and what was inlined is a closure.
warm[0] = True
said.clear()
outer, drive = js.eval('''(() => { "use strict";
  const k = 1;
  const inner = (o, view, use) => { const r = o.x; return r + k + use(view) };
  function outer(o, make, use) { return inner(o, make(), use) }
  return [outer, (o, make, use, n) => { for (let i = 0; i < n; i++) outer(o, make, use) }]
})()''')
until_compiled(outer, lambda n: drive(holder, make, use, n))
warm[0] = False
print(outer(holder, make, use), said, len(data))
