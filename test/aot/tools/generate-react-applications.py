#!/usr/bin/env python3
"""generate-react-applications.py <folder> <count> <seed>: small React applications as people write them: components, hooks, context, memo, refs, lazy, reducers, barrels and star exports, in .tsx and .jsx files.
main calls every handler that the tree holds, twice, and prints each tree. Run them with run-react-programs.py."""
import os, random, sys
folder, count, seed = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])

REACT = '''
// A renderer for tests: state lives in the place of a component in the tree.
export const Fragment = Symbol.for("react.fragment");
type Slot = { state: any[]; at: number; caches: any[]; cache: number; effects: any[]; children: Map<string, Slot> };
const make = (): Slot => ({ state: [], at: 0, caches: [], cache: 0, effects: [], children: new Map() });
let current: Slot = make();
export const handlers: [string, any][] = [];
const sentinel = Symbol.for("react.memo_cache_sentinel");
export function c(size: number): any[] { const at = current.cache++; return (current.caches[at] ??= new Array(size).fill(sentinel)); }
export function useState(initial: any): any { const slot = current, at = slot.at++; if (!(at in slot.state)) slot.state[at] = typeof initial === "function" ? initial() : initial; return [slot.state[at], (slot.state as any)["set" + at] ??= (next: any) => { slot.state[at] = typeof next === "function" ? next(slot.state[at]) : next; }]; }
export function useReducer(reduce: any, initial: any, init?: any): any { const slot = current, at = slot.at++; if (!(at in slot.state)) slot.state[at] = init ? init(initial) : initial; return [slot.state[at], (slot.state as any)["dispatch" + at] ??= (action: any) => { slot.state[at] = reduce(slot.state[at], action); }]; }
export function useRef(initial: any): any { const slot = current, at = slot.at++; return (slot.state[at] ??= { current: initial }); }
export function useMemo(call: any, wanted?: any[]): any { const slot = current, at = slot.at++, old = slot.state[at]; if (old?.wanted && wanted && old.wanted.every((it: any, k: number) => Object.is(it, wanted[k]))) return old.value; const value = call(); slot.state[at] = { wanted: wanted ?? [], value }; return value; }
export const useCallback = (call: any, wanted?: any[]): any => useMemo(() => call, wanted);
export function useEffect(call: any, wanted?: any[]) { const slot = current, at = slot.at++, old = slot.state[at]; if (!old || !wanted || old.length !== wanted.length || old.some((it: any, k: number) => !Object.is(it, wanted[k]))) slot.effects.push(call); slot.state[at] = wanted; }
export const useLayoutEffect = useEffect;
export const useId = () => { current.at++; return "id"; };
export function useSyncExternalStore(subscribe: any, read: any): any { useEffect(() => subscribe(() => {}), [subscribe]); return read(); }
export function createContext(initial: any): any { const context: any = { value: initial, context: true }; context.Provider = { provider: context }; context.Consumer = { consumer: context }; return context; }
export const useContext = (context: any): any => context.value;
export const use = (it: any): any => it.value;
export const memo = (component: any): any => ({ memo: component });
export const forwardRef = (render: any): any => ({ forward: render });
export const lazy = (load: any): any => ({ load, loaded: undefined });
export const Suspense = ({ children }: any): any => children;
export const startTransition = (call: any) => call();
export const Children = { map: (children: any, call: any) => [children].flat(3).map(call), count: (children: any) => [children].flat(3).length, toArray: (children: any) => [children].flat(3) };
export const isValidElement = (it: any) => !!it && typeof it === "object" && "type" in it;
export const cloneElement = (element: any, props: any, ...children: any[]) => ({ ...element, props: { ...element.props, ...props, ...(children.length ? { children } : {}) } });
export const createElement = (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) } });
export const jsx = (type: any, props: any, key?: any) => ({ type, props, key });
export const jsxs = jsx, jsxDEV = jsx;
export class Component { props: any; state: any = {}; constructor(props: any) { this.props = props; } setState(next: any) { Object.assign(this.state, typeof next === "function" ? next(this.state) : next); } }
async function show(node: any, slot: Slot, path: string): Promise<string> {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (Array.isArray(node)) { let text = ""; for (let k = 0; k < node.length; k++) text += await show(node[k], slot, path + "." + (node[k]?.key ?? k)); return text; }
  if (typeof node === "function") return "fn";
  if (typeof node !== "object") return String(node);
  let { type, props } = node;
  const child = (slot.children.get(path) ?? (slot.children.set(path, make()), slot.children.get(path)!));
  if (type === Fragment) return show(props.children, child, "f");
  if (type?.load) { type.loaded ??= (await type.load()).default; type = type.loaded; }
  if (type?.provider) { const old = type.provider.value; type.provider.value = props.value; const text = await show(props.children, child, "p"); type.provider.value = old; return text; }
  if (type?.consumer) return show(props.children(type.consumer.value), child, "c");
  let call = type;
  if (type?.memo) call = type.memo;
  if (call?.forward) { const render = call.forward; call = (given: any) => render(given, given.ref ?? null); }
  if (call?.memo) call = call.memo;
  if (typeof call === "function") {
    child.at = 0; child.cache = 0; child.effects = [];
    const old = current; current = child;
    let made: any;
    if (call.prototype instanceof Component) { const instance = (child.state[0] ??= new call(props)); instance.props = props; made = instance.render(); }
    else made = call(props);
    current = old;
    const text = await show(made, child, "r");
    for (const effect of child.effects) { const cleanup = effect(); if (typeof cleanup === "function") handlers.push([path + " cleanup", cleanup]); }
    return text;
  }
  let text = "<" + String(type);
  for (const key of Object.keys(props)) {
    const value = props[key];
    if (key === "children") continue;
    if (typeof value === "function") { handlers.push([String(type) + "." + key, value]); text += " " + key; }
    else if (value !== undefined && value !== false && value !== null) text += " " + key + "=" + (typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  return text + ">" + (await show(props.children, child, "h")) + "</" + String(type) + ">";
}
const roots = new Map<any, Slot>();
export async function render(element: any): Promise<string> { const root = roots.get(element.type) ?? (roots.set(element.type, make()), roots.get(element.type)!); handlers.length = 0; return show(element, root, "root"); }
export default { createElement, Fragment, useState, useMemo, useCallback, useEffect, useRef, useContext, memo, lazy, forwardRef, createContext, Component };
'''
MAIN = '''
import { createElement, handlers, render } from "react";
%s
const log = console.log;
for (let turn = 0; turn < 3; turn++) {
  log(turn, await render(createElement(App, { title: "title", items: ["b", "a", "c"], user: { name: "n", tags: ["x"] } })));
  for (const [name, handler] of [...handlers]) {
    let answer: any;
    try { answer = handler({ target: { value: "v" + turn }, key: "Enter", preventDefault() {}, stopPropagation() {} }); if (answer && typeof answer.then === "function") answer = await answer; }
    catch (error: any) { answer = "threw " + error.message; }
    log(name, typeof answer === "function" ? "fn" : JSON.stringify(answer));
  }
}
'''

class App:
    def __init__(self, r):
        self.r, self.files, self.names = r, {}, []
        self.typed = r.random() < 0.7
    def ext(self): return 'tsx' if self.typed or self.r.random() < 0.5 else 'jsx'
    def t(self, text): return text if self.now == 'tsx' else ''

def handler(r, a, state):
    """The text of a handler; state: the names that may be used."""
    set_ = state.get('set'); value = state.get('value', '1')
    forms = [f'() => {{ log({value}); }}', f'event => {{ event.preventDefault(); log(event.target.value, {value}); }}', f'async () => {{ await null; log({value}); return {value}; }}', f'() => log("x", {value})']
    if set_: forms += [f'() => {set_}(old => next(old))', f'event => {{ {set_}(event.target.value); log({value}); }}', f'() => {{ if (items.length > 1) {{ {set_}({value}); }} else {{ log("few"); }} }}', f'({{ target: {{ value: text }} }}) => {{ {set_}(text); }}', f'() => {{ items.forEach((item, at) => {{ if (at > 0) {set_}(item); }}); return items.map(item => item + {value}); }}']
    if state.get('ref'): forms += [f'() => {{ {state["ref"]}.current += 1; log({state["ref"]}.current); }}', f'() => {{ const held = {state["ref"]}; held.current = held.current * 2; return held.current; }}']
    if state.get('dispatch'): forms += [f'() => {state["dispatch"]}({{ type: "add", text: items[0] }})', f'event => {{ {state["dispatch"]}({{ type: event.key === "Enter" ? "add" : "drop", text: "k" }}); }}']
    if state.get('context'): forms += [f'() => {{ log({state["context"]}.theme); {state["context"]}.change?.({value}); }}']
    return r.choice(forms)

def body(r, a, name, children):
    lines, state = [], {}
    if r.random() < 0.7:
        lines.append(r.choice(['const [value, setValue] = useState(0);', 'const [value, setValue] = useState(() => items.length);', 'const state = useState("s"); const [value, setValue] = state;', 'const { 0: value, 1: setValue } = useState(items[0]);']))
        state.update(value='value', set='setValue')
    if r.random() < 0.35: lines.append('const box = useRef(1);'); state['ref'] = 'box'
    if r.random() < 0.3: lines.append(r.choice(['const [list, dispatch] = useReducer(reduce, items);', 'const [list, dispatch] = useReducer(reduce, items, start => [...start]);'])); state['dispatch'] = 'dispatch'
    if r.random() < 0.35: lines.append(r.choice(['const theme = useContext(ThemeContext);', 'const theme = useTheme();', 'const theme = use(ThemeContext);'])); state['context'] = 'theme'
    if r.random() < 0.4: lines.append(r.choice(['const sorted = useMemo(() => [...items].sort(), [items]);', 'const sorted = [...items].sort();', 'const sorted = items.filter(item => item !== "c").map(next);', 'const sorted = []; for (const item of items) { if (item === "c") continue; sorted.push(item); }', 'const sorted = useSorted(items);']))
    else: lines.append('const sorted = items;')
    if r.random() < 0.3: lines.append(r.choice([f'useEffect(() => {{ log("effect", sorted.length); }}, [sorted.length]);', f'useEffect(() => {{ const at = sorted.length; return () => log("clean", at); }}, [sorted]);', f'useEffect(() => {{ const run = {handler(r, a, state)}; run({{ preventDefault() {{}}, target: {{ value: "f" }}, key: "k" }}); }}, []);', 'useLayoutEffect(() => { log("layout"); });']))
    if r.random() < 0.3: lines.append(r.choice(['const surface = normalize(useStore(store)); const [extra] = useState("e");', 'const surface = useStore(store);', 'const surface = normalize(useSyncExternalStore(subscribe, readStore)); useEffect(() => {}, []);'])); lines.append('const shown = surface.names;')
    else: lines.append('const shown = ["p", "q"];')
    if r.random() < 0.5: lines.append(r.choice([f'const onPick = useCallback({handler(r, a, state)}, [items]);', f'const onPick = {handler(r, a, state)};', f'function onPick(event) {{ return ({handler(r, a, state)})(event); }}', f'const actions = {{ pick: {handler(r, a, state)} }}; const onPick = actions.pick;']))
    else: lines.append(f'const onPick = {handler(r, a, state)};')
    if r.random() < 0.2: lines.append(r.choice(['if (items.length === 0) return null;', 'if (items.length > 9) { return <p onClick={onPick}>many</p>; }', 'try { log(items[0].length); } catch { log("bad"); }', 'const unused = () => log(next(1));']))
    parts = []
    for _ in range(r.choice([1, 2, 2, 3])):
        k = r.randrange(13)
        h = handler(r, a, state)
        if k == 0: parts.append(f'<button onClick={{{h}}}>{{title}}</button>')
        elif k == 1: parts.append(f'<ul>{{sorted.map(item => <li key={{item}} onClick={{() => log(item)}}>{{item}}</li>)}}</ul>')
        elif k == 2: parts.append(f'<List items={{shown}} emptyMessage="none" onSelect={{index => {{ log(shown[index], {state.get("value", "0")}); }}}}>{{shown.map(name => <List.Item key={{name}} label={{name}} />)}}</List>')
        elif k == 3: parts.append(f'{{shown.length > 1 ? <b onClick={{{h}}}>{{shown[0]}}</b> : <i>one</i>}}')
        elif k == 4: parts.append(f'{{user?.name && <span title={{user.name}} onKeyDown={{{h}}}>{{user.tags.join()}}</span>}}')
        elif k == 5: parts.append(f'<input {{...{{ value: title, onChange: {h} }}}} ref={{null}} />')
        elif k == 6: parts.append(f'<Wrapper render={{given => <em onClick={{{h}}}>{{given}}</em>}}>{{title}}</Wrapper>')
        elif k == 7: parts.append('<ThemeContext.Consumer>{it => <u>{it.theme}</u>}</ThemeContext.Consumer>')
        elif k == 8: parts.append(f'<Boxed as="section" onClick={{onPick}}>{{title.toUpperCase()}}</Boxed>')
        elif k == 9: parts.append(f'<><hr /><p {{...rest}}>{{`${{title}} ${{sorted.length}}`}}</p></>')
        elif k == 10: parts.append(f'<Counter start={{sorted.length}} onStep={{step => {{ log("step", step); ({h})({{ preventDefault() {{}}, target: {{ value: "t" }} }}); }}}} />')
        elif k == 11 and children: c = r.choice(children); parts.append(f'<{c} title={{title}} items={{sorted}} user={{user}} />')
        else: parts.append(f'<a href={{"#" + title}} onClick={{onPick}}>link</a>')
    for c in children:
        if r.random() < 0.7: parts.append(f'<{c} title={{title + "!"}} items={{items}} user={{user}}{" key={title}" if r.random() < 0.3 else ""} />')
    tree = '\n      '.join(parts)
    if r.random() < 0.3: tree = f'<ThemeContext.Provider value={{{{ theme: title, change: {handler(r, a, state)} }}}}>\n      {tree}\n      </ThemeContext.Provider>'
    wrap = r.choice(['div', 'div', 'section', '', 'List'])
    if wrap == 'List': tree = f'<List onSelect={{{handler(r, a, state)}}}>\n      {tree}\n      </List>'
    else: tree = f'<{wrap}>\n      {tree}\n    </{wrap}>'
    lines.append(f'return (\n    {tree}\n  );')
    return '\n  '.join(lines)

PARTS = '''
import { Component, createContext, forwardRef, memo, useContext, useMemo, useReducer, useState } from "react";
export const log = (...texts%s) => console.log("log", ...texts);
export const next = (it%s) => (typeof it === "number" ? it + 1 : it + "+");
export const ThemeContext = createContext({ theme: "dark" });
export const useTheme = () => useContext(ThemeContext);
export const useSorted = (items%s) => useMemo(() => [...items].sort().reverse(), [items]);
export const store = { names: ["s", "t"] };
export const useStore = (given%s) => given;
export const normalize = (given%s) => given;
export const subscribe = (call%s) => () => {};
export const readStore = () => store;
export function reduce(list%s, action%s) { switch (action.type) { case "add": return [...list, action.text]; case "drop": return list.slice(1); default: return list; } }
export function List({ items, emptyMessage, onSelect, children }%s) { return <ol onClick={() => onSelect?.(1)}>{items?.length === 0 ? emptyMessage : children}</ol>; }
List.Item = function Item({ label }%s) { return <li>{label}</li>; };
export const Wrapper = ({ render, children }%s) => <div>{render(children)}</div>;
export const Boxed = memo(({ as: Tag = "div", children, ...rest }%s) => <Tag {...rest}>{children}</Tag>);
export const Field = forwardRef(function Field(props%s, ref%s) { return <input {...props} data-ref={ref ? "ref" : "none"} />; });
export function Counter({ start, onStep }%s) { const [count, setCount] = useState(start); return <button onClick={() => { setCount(count + 1); onStep(count); }}>{count}</button>; }
export class Old extends Component { render() { return <del onClick={() => this.setState({ n: 1 })}>{JSON.stringify(this.state)}</del>; } }
'''
r = random.Random(seed)
for n in range(count):
    a = App(r)
    path = os.path.join(folder, f'p{seed}-{n:05}'); os.makedirs(os.path.join(path, 'parts'), exist_ok=True)
    any_ = ': any'
    parts_ext = 'tsx' if r.random() < 0.7 else 'jsx'
    text = PARTS.replace('%s', any_ if parts_ext == 'tsx' else '')
    text = text.replace('...texts: any)', '...texts: any[])')
    head = '// @ts-nocheck\n' if parts_ext == 'tsx' else ''
    open(os.path.join(path, 'parts', 'parts.' + parts_ext), 'w').write(head + text)
    barrel = r.choice(['star', 'names', 'stars', 'default-and-star', 'namespace'])
    imports = 'List, Wrapper, Boxed, Field, Counter, Old, ThemeContext, log, next, normalize, readStore, reduce, store, subscribe, useSorted, useStore, useTheme'
    index = {'star': 'export * from "./parts";\n', 'names': f'export {{ {imports} }} from "./parts";\n', 'stars': 'export * from "./again";\n', 'default-and-star': 'export * from "./parts";\nexport { List as default } from "./parts";\n', 'namespace': 'export * from "./parts";\nexport * as everything from "./parts";\n'}[barrel]
    open(os.path.join(path, 'parts', 'index.ts'), 'w').write(index)
    if barrel == 'stars': open(os.path.join(path, 'parts', 'again.ts'), 'w').write('export * from "./parts";\nexport const own = 1;\n')
    hooks = 'createContext, forwardRef, lazy, memo, use, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, Suspense'
    total = r.choice([1, 2, 3, 4])
    made = []
    for k in range(total):
        name = 'App' if k == total - 1 else f'Part{k}'
        ext = 'tsx' if r.random() < 0.75 else 'jsx'
        children = [c for c in made if r.random() < 0.8]
        lines = ['// @ts-nocheck'] if ext == 'tsx' else []
        lines.append(f'import {{ {hooks} }} from "react";')
        lines.append(r.choice([f'import {{ {imports} }} from "./parts";', f'import {{ {imports} }} from "./parts/parts";', f'import * as parts from "./parts";\nconst {{ {imports} }} = parts;'] if r.random() < 0.8 else [f'import {{ {imports} }} from "./parts/index";']))
        for c in children:
            lines.append(r.choice([f'import {{ {c} }} from "./{c}";', f'import {{ {c} }} from "./{c}";', f'import * as of{c} from "./{c}";\nconst {c} = of{c}.{c};', f'const {c} = lazy(() => import("./{c}").then(it => ({{ default: it.{c} }})));']))
        props = r.choice(['{ title, items, user, ...rest }', '{ title = "none", items, user = null, ...rest }'])
        typed = ': { title: string; items: string[]; user?: any; [key: string]: any }' if ext == 'tsx' and r.random() < 0.6 else ''
        b = body(r, a, name, children)
        form = r.randrange(8)
        if form <= 2: lines.append(f'export function {name}({props}{typed}) {{\n  {b}\n}}')
        elif form == 3: lines.append(f'export const {name} = ({props}{typed}) => {{\n  {b}\n}};')
        elif form == 4: lines.append(f'export const {name} = memo(function {name}({props}{typed}) {{\n  {b}\n}});')
        elif form == 5: lines.append(f'function {name}({props}{typed}) {{\n  {b}\n}}\nexport {{ {name} }};')
        elif form == 6: lines.append(f'const With{name} = Inner => function Wrapped(given) {{ const [w] = useState("w"); return <Inner {{...given}} data-w={{w}} />; }};\nexport const {name} = With{name}(function {name}({props}{typed}) {{\n  {b}\n}});')
        else: lines.append(f'export const {name} = forwardRef(({props}{typed}, ref) => {{\n  {b}\n}});')
        open(os.path.join(path, f'{name}.{ext}'), 'w').write('\n'.join(lines) + '\n')
        made.append(name)
    load = r.choice(['import { App } from "./App";', 'const { App } = await import("./App");', 'import * as all from "./App";\nconst { App } = all;', 'import { App } from "./entry";'])
    if 'entry' in load: open(os.path.join(path, 'entry.ts'), 'w').write(r.choice(['export * from "./App";\n', 'export { App } from "./App";\n', 'export * from "./App";\nexport * from "./parts";\n']))
    open(os.path.join(path, 'main.ts'), 'w').write('// @ts-nocheck\n' + (MAIN % load) + 'export {};\n')
open(os.path.join(folder, 'react.ts'), 'w').write('// @ts-nocheck\n' + REACT)
open(os.path.join(folder, 'tsconfig.json'), 'w').write('{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "jsx": "react-jsx", "strict": false, "allowJs": true, "noEmit": true, "types": [], "paths": { "react": ["./react.ts"], "react/jsx-runtime": ["./react.ts"], "react/jsx-dev-runtime": ["./react.ts"], "react/compiler-runtime": ["./react.ts"] } } }\n')
