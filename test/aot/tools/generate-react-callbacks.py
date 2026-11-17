#!/usr/bin/env python3
"""generate-react-callbacks.py <folder> <count> <seed>: programs whose components pass callbacks in many forms. main.ts calls every callback that it can reach. Run them with run-react-programs.py."""
import os, random, sys
folder, count, seed = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
PARTS = '''
export const callbacks: any[] = [];
export function collect(value: any, seen: Set<any> = new Set()) {
  if (value === null || (typeof value !== "object" && typeof value !== "function") || seen.has(value)) return;
  seen.add(value);
  if (typeof value === "function") { callbacks.push(value); return; }
  for (const key of Object.keys(value)) collect(value[key], seen);
}
function render(name: string, props: any): string { collect(props); return "<" + name + ">" + [props.children].flat(3).filter(it => typeof it === "string").join("") + "</" + name + ">"; }
export function List(props: any): string { return render("list", props); }
List.Item = (props: any): string => render("item", props);
List.Deep = { Row: (props: any): string => render("row", props) };
export const Plain = ({ children, ...rest }: any): string => render("plain", { ...rest, children });
export function memo(component: any) { return (props: any) => component(props); }
export function useStore<T>(store: T): T { return store; }
export function useCall(callback: any): any { return callback; }
export function normalize<T>(value: T): T { return value; }
export function register(value: any): number { collect(value); return callbacks.length; }
'''
MAIN = '''
import { callbacks, collect } from "./parts";
const log = (...texts: any[]) => console.log("log", ...texts);
const it: any = %s;
const render = it.%s;
const made = render({ store: { names: ["a", "b", "c"] }, log, flag: true, as: (props: any) => { collect({ ...props }); return "as"; } });
console.log(typeof made === "string" ? made : typeof made);
for (let k = 0; k < callbacks.length && k < 80; k++) {
  let answer: any;
  try {
    answer = callbacks[k](1, { key: "x" });
    if (answer && typeof answer.then === "function") answer = await answer;
    if (answer && typeof answer.next === "function") answer = [...answer].join();
  } catch (error: any) { answer = "threw " + error.message; }
  if (typeof answer === "function") callbacks.push(answer);
  console.log(k, typeof answer === "object" ? JSON.stringify(answer) : typeof answer === "function" ? "function" : String(answer));
}
'''

def body(r):
    n = r.choice(['surface.names.length', 'surface.names[index]', 'surface.names[index - stops]'])
    kind = r.randrange(7)
    if kind == 0: return f'log({n})'
    if kind == 1: return f'log({n}, stops)'
    if kind == 2: return f'surface.names.filter(name => name !== {n}).join()'
    if kind == 3: return f'helper({n})'
    if kind == 4: return f'surface.names.map(name => {{ log(name, {n}); return name; }}).length'
    if kind == 5: return f'(setProblem({n}), {n})'
    return f'nested(({{ at }}) => {{ log(at, {n}); }})'

def callback(r):
    b = body(r)
    return r.choice([
        f'index => {b}', f'index => {{ {b}; }}', f'index => {{ const x = {b}; return x; }}', f'async index => {{ {b}; return index; }}',
        f'function (index) {{ return {b}; }}', f'function named(index) {{ return index > 0 ? {b} : named; }}', f'(index, second = () => {b}) => second === undefined',
        f'index => () => {b}', f'({{ length = 1 }}, index = length) => {b}', f'index => {{ [1].forEach(() => {{ {b}; }}); }}',
        f'index => {{ try {{ return {b}; }} catch (error) {{ return helper(error); }} }}', f'index => {{ const inner = () => {b}; return inner(); }}',
        f'function* (index) {{ yield {b}; }}', f'index => flag ? {b} : other(index)',
    ])

def attribute(r, k, names):
    c, f = callback(r), r.randrange(14)
    if f <= 3: return f'on{k}={{{c}}}'
    if f == 4: return f'on{k}={{flag ? {c} : {callback(r)}}}'
    if f == 5: return f'on{k}={{flag && ({c})}}'
    if f == 6: return f'on{k}={{{{ a: {c}, b: [{callback(r)}] }}}}'
    if f == 7: return f'{{...{{ on{k}: {c} }}}}'
    if f == 8: return f'on{k}={{[{c}]}}'
    if f == 9 and names: return f'on{k}={{{r.choice(names)}}}'
    if f == 10: return f'on{k}={{normalize({c})}}'
    if f == 11: return f'on{k}={{surface.missing ?? ({c})}}'
    return f'on{k}={{{c}}} key{k}={{surface.names.length}}'

def element(r, names, depth=0):
    tag = r.choice(['List', 'List', 'List', 'List.Item', 'List.Deep.Row', 'Plain', 'As', 'Local', 'div'])
    attributes = ' '.join(attribute(r, k, names) for k in range(r.choice([1, 1, 2, 3])))
    children = []
    for _ in range(r.choice([0, 1, 2])):
        c = r.randrange(6)
        if c == 0 and depth < 2: children.append(element(r, names, depth + 1))
        elif c == 1: children.append('{surface.names.map(name => <List.Item key={name} label={name} pick={() => log(name)} />)}')
        elif c == 2: children.append('{problem !== null && <Plain>{problem}</Plain>}')
        elif c == 3: children.append('{stops === 0 && <List.Item label="stop" />}')
        elif c == 4: children.append(f'{{{callback(r)}}}')
        else: children.append('text')
    return f'<{tag} {attributes}>{"".join(children)}</{tag}>'

def component(r, name, form):
    lines, names = [], []
    lines.append(r.choice(['const surface = useStore(props.store);', 'const surface = normalize(useStore(props.store));', 'const surface = normalize(useStore(props.store));',
        'let surface = { names: [] }; surface.names.push(...useStore(props.store).names);', 'const surface = { ...useStore(props.store) };']))
    lines.append(r.choice(['const [problem, setProblem] = useState(null);', 'const problem = null, setProblem = useCall(() => {});']))
    lines.append('const stops = surface.names.length > 5 ? 1 : 0;')
    lines.append('const { log, flag, as: As } = props;')
    helpers = ['const helper = value => { log("helper", value); return value; };', 'function nested(call) { return call({ at: stops }); }', 'const other = index => log("other", index, surface.names.length);',
        'const Local = local => { log("local", typeof local); for (const value of Object.values(local)) if (typeof value === "function") register(value); return "local"; };']
    r.shuffle(helpers)
    lines += helpers
    for k in range(r.choice([0, 0, 1, 2])):
        names.append(f'made{k}')
        lines.append(r.choice([f'const made{k} = {callback(r)};', f'const made{k} = useCallback({callback(r)}, [surface]);', f'const made{k} = useMemo(() => ({callback(r)}), [surface]);', f'let made{k} = {callback(r)}; if (stops) made{k} = {callback(r)};', f'function made{k}(index) {{ return {body(r)}; }}']))
    extra = r.randrange(8)
    if extra == 0: lines.append(f'useEffect({callback(r)}, [surface]);')
    if extra == 1: lines.append(f'const held = useRef({callback(r)}); register(held);')
    if extra == 2: lines.append(f'if (surface.names.length > 7) return <List early={{{callback(r)}}} />;')
    if extra == 3: lines.append('surface.names.forEach(name => { register(() => log(name)); });')
    if extra == 4: lines.append(f'for (const name of surface.names) {{ if (name === "b") continue; register({callback(r)}); }}')
    if extra == 5: lines.append(f'try {{ register({callback(r)}); }} catch {{ log("caught"); }}')
    if extra == 6: lines.append(f'switch (surface.names.length) {{ case 3: register({callback(r)}); break; default: register({callback(r)}); }}')
    e = element(r, names)
    result = f'<>{e}{element(r, names)}</>' if r.randrange(4) == 0 else e
    lines.append(f'return {result};')
    text = '\n  '.join(lines)
    if form == 'declaration': return f'export function {name}(props) {{\n  {text}\n}}'
    if form == 'default': return f'export default function {name}(props) {{\n  {text}\n}}'
    if form == 'arrow': return f'export const {name} = (props) => {{\n  {text}\n}};'
    if form == 'memo': return f'export const {name} = memo(function {name}Inner(props) {{\n  {text}\n}});'
    if form == 'memoarrow': return f'export const {name} = memo((props) => {{\n  {text}\n}});'
    if form == 'siblings':
        unused = '(props) => { const all = useStore(props.store); return <List gone={index => all[index]} />; }'
        return f'export const Unused{name} = {unused}, {name} = (props) => {{\n  {text}\n}}, Last{name} = {unused};'
    if form == 'inner': return f'function make{name}(label) {{\n  return function {name}(props) {{\n  {text}\n}};\n}}\nexport const {name} = make{name}("x");'
    if form == 'hook': return f'function use{name}(props) {{\n  {text}\n}}\nexport function {name}(props) {{ return use{name}(props); }}'
    if form == 'object': return f'const components = {{ {name}: (props) => {{\n  {text}\n}} }};\nexport const {name} = components.{name};'
    raise SystemExit(form)

REACT = '''
export const useState = (value: any) => [value, (next: any) => { console.log("set", typeof next); }];
export const useCallback = (call: any, d: any) => call;
export const useMemo = (make: any, d: any) => make();
export const useEffect = (call: any, d: any) => { call(1); };
export const useRef = (current: any) => ({ current });
'''
r = random.Random(seed)
for n in range(count):
    form = r.choice(['declaration', 'declaration', 'default', 'arrow', 'memo', 'memoarrow', 'siblings', 'inner', 'hook', 'object'])
    path = os.path.join(folder, f'p{seed}-{n:05}')
    os.makedirs(path, exist_ok=True)
    imports = '// @ts-nocheck\nimport { useState, useCallback, useMemo, useEffect, useRef } from "react";\nimport { List, Plain, memo, normalize, register, useCall, useStore } from "./parts";\n\n'
    open(os.path.join(path, 'Panel.tsx'), 'w').write(imports + component(r, 'Panel', form) + '\n')
    open(os.path.join(path, 'parts.ts'), 'w').write(PARTS)
    load = r.choice(['await import("./Panel")', 'await import("./Panel")', 'require("./Panel")', 'panel'])
    main = MAIN % (load, 'default' if form == 'default' else 'Panel')
    if load == 'panel': main = 'import * as panel from "./Panel";\n' + main
    open(os.path.join(path, 'main.ts'), 'w').write('// @ts-nocheck\n' + main + '\nexport {};\n')
STAND_INS = {
    'react.ts': REACT,
    'compiler-runtime.js': 'export function c(size) {\n  console.error("[react-compiler] a cache of " + size);\n  return new Array(size).fill(Symbol.for("react.memo_cache_sentinel"));\n}\n',
    'jsx-runtime.js': 'export function jsx(type, props) {\n  return typeof type === "function" ? type(props) : "<" + type + ">" + [].concat(props.children ?? []).flat(3).filter(it => typeof it !== "function").join("") + "</" + type + ">";\n}\nexport const jsxs = jsx;\nexport const jsxDEV = jsx;\nexport const Fragment = "fragment";\n',
    'tsconfig.json': '{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "jsx": "react-jsx", "strict": false, "allowJs": true, "noEmit": true, "types": [], "paths": { "react": ["./react.ts"], "react/jsx-runtime": ["./jsx-runtime.js"], "react/jsx-dev-runtime": ["./jsx-runtime.js"], "react/compiler-runtime": ["./compiler-runtime.js"] } } }\n',
}
for name, text in STAND_INS.items():
    open(os.path.join(folder, name), 'w').write(text)
