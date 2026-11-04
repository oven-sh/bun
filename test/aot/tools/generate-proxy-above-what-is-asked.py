#!/usr/bin/env python3
# generate-proxy-above-what-is-asked.py test/aot/parallel/proxy-above-what-is-asked: a proxy whose get trap answers every key, on top or ABOVE what is handed over, and each way in which the engine or the host asks an object for a method of its own. One deed a program:
# what a build makes of a program goes by all that the build holds, and beside others a fault may not show.
import os, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
ANSWER = '''const answer = function (first, second, third) {
  return "answered " + typeof first + " " + typeof second + " " + (typeof third === "function" ? third([1]) : typeof third);
};
const proxy = new Proxy({}, { get: () => answer });
'''
places = {
  'itself': ('the proxy itself', 'const asked = proxy;'),
  'above-by-object-create': ('an object that Object.create() puts below it', 'const asked = Object.create(proxy);'),
  'above-by-set-prototype-of': ('an object that Object.setPrototypeOf() puts below it', 'const asked = Object.setPrototypeOf({ own: 1 }, proxy);'),
  'above-by-proto-in-a-literal': ('a literal with __proto__', 'const asked = { __proto__: proxy, own: 1 };'),
  'above-a-class': ('an instance of a class below a function whose prototype it is', 'function Base() {}\nBase.prototype = proxy;\nclass Below extends Base {}\nconst asked = new Below();'),
  'two-above': ('an object two below it', 'const asked = Object.create(Object.create(proxy));'),
}
deeds = {
  'console-log': ('console.log', 'console.log(asked);'),
  'console-log-inside-a-list': ('console.log of a list that holds it', 'console.log([asked]);'),
  'console-error': ('console.error', 'console.error(asked);'),
  'bun-inspect': ('Bun.inspect', 'console.log(Bun.inspect(asked));'),
  'util-format': ('util.format', 'import { format } from "node:util";\nconsole.log(format("%o", asked));'),
  'json-stringify': ('JSON.stringify', 'console.log(JSON.stringify(asked), JSON.stringify({ held: asked }));'),
  'string': ('String()', 'console.log(String(asked));'),
  'template': ('a template', 'console.log(`${asked}`);'),
  'plus': ('an operator', 'console.log(asked + "", +(asked + "").length);'),
  'await': ('await', 'const caught = await Promise.race([Promise.resolve(asked).then(value => "fulfilled " + typeof value, error => "rejected " + typeof error), new Promise(done => setTimeout(done, 20, "the trap was asked for then and never called back"))]);\nconsole.log(caught);'),
  'spread': ('a spread', 'try {\n  console.log([...asked]);\n} catch (error) {\n  console.log(error.name);\n}'),
  'instanceof': ('instanceof', 'try {\n  console.log({} instanceof asked);\n} catch (error) {\n  console.log(error.name);\n}'),
  'error-message': ('the message of an error of the host', 'try {\n  new URL(asked);\n} catch (error) {\n  console.log(error.name);\n}'),
}
n = 0
for place, (where, made) in places.items():
    for deed, (what, does) in deeds.items():
        imports = '\n'.join(l for l in does.split('\n') if l.startswith('import '))
        rest = '\n'.join(l for l in does.split('\n') if not l.startswith('import '))
        name = '%s-%s.mjs' % (deed, place)
        text = '// A proxy whose get trap answers every key with a function of the program. Asked by %s: %s.\n' % (what, where) + (imports + '\n' if imports else '') + ANSWER + made + '\n' + rest + '\n'
        open(os.path.join(out, name), 'w').write(text); n += 1
print(n, 'programs')
