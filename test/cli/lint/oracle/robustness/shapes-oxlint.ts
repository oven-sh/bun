// More shapes, for the rules of oxlint's plugins: import, jest, jsdoc, jsx-a11y, nextjs, node, oxc, promise, react, react-perf,
// unicorn, vitest and vue. In the form of shapes.ts. What a rule of these loops over, or looks for around a node, is n wide in
// `wide(n)` and n deep in `deep(n)`. A file is a test for the rules of jest and vitest by its name.

const seq = (n: number, f: (i: number) => string, sep = "") => Array.from({ length: n }, (_, i) => f(i)).join(sep);
const rep = (text: string, n: number) => text.repeat(n);

/** A shape is made when it is asked for. */
function lazily(shapes: Record<string, () => string>): Record<string, string> {
  const made: Record<string, string> = {};
  for (const [name, make] of Object.entries(shapes)) Object.defineProperty(made, name, { get: make, enumerable: true });
  return made;
}

const hooksInConditions = (n: number) => seq(n, i => `if (c${i}) { useA${i}(); }\n`);
const component = (body: string) =>
  `import React from "react";\nexport function App(props) {\nreturn (\n${body}\n);\n}\n`;
const test = (body: string) => `it("a", async () => {\n${body}\n});\n`;
const describe = (body: string) => `describe("a", () => {\n${body}\n});\n`;
const executor = (body: string) => `new Promise((resolve, reject) => {\n${body}\n});\n`;
const then = (body: string) => `a.then(b => {\n${body}\n});\n`;
const vue = (script: string, attributes = "") =>
  `<template><div /></template>\n<script${attributes}>\n${script}\n</script>\n`;
const options = (body: string) => vue(`export default {\n${body}\n};`);

const aliased: Record<string, string> = {
  "object": "{}",
  "array": "[1]",
  "string": '"a"',
  "template": "`a`",
  "number": "1",
  "regex": "/a/",
  "arrow": "() => {}",
  "async-arrow": "async (req, res) => {}",
  "function": "function () {}",
  "class": "class {}",
  "jsx": "<i />",
  "new": "new Set()",
  "call": "f()",
  "promise": "Promise.resolve(1)",
  "parameter": "p",
  "global": "q",
  "jest-fn": "jest.fn()",
};

export function wide(n: number): Record<string, string> {
  const shapes: Record<string, () => string> = {
    // ── JSX: jsx-a11y, react, react-perf, nextjs ──
    "ox-jsx-imgs.jsx": () => component("<div>\n" + rep('<img src="a" />\n', n) + "</div>"),
    "ox-jsx-imgs-alt.jsx": () =>
      component("<div>\n" + seq(n, i => `<img src="a" alt="image of photo ${i}" />\n`) + "</div>"),
    "ox-jsx-anchors.jsx": () =>
      component("<div>\n" + rep('<a href="#" target="_blank" onClick={() => {}}>a</a>\n', n) + "</div>"),
    "ox-jsx-anchors-ambiguous.jsx": () =>
      component("<div>\n" + rep('<a href="/a">click <b>here</b></a>\n', n) + "</div>"),
    "ox-jsx-buttons.jsx": () =>
      component(
        "<div>\n" + rep("<button onClick={() => a()} style={{ a: 1 }} b={[1]} c={<i />}>a</button>\n", n) + "</div>",
      ),
    "ox-jsx-clickable-divs.jsx": () =>
      component(
        "<div>\n" + rep('<div onClick={props.a} onMouseOver={props.b} role="button" tabIndex="1" />\n', n) + "</div>",
      ),
    "ox-jsx-roles.jsx": () =>
      component(
        "<div>\n" +
          rep('<div role="checkbox slider foo" aria-checked="a" aria-foo="b" aria-hidden="true" />\n', n) +
          "</div>",
      ),
    "ox-jsx-role-list.jsx": () => component(`<div role="${rep("button ", n)}" />`),
    "ox-jsx-aria-attrs.jsx": () => component("<div " + seq(n, i => `aria-a${i}="b"`, " ") + " />"),
    "ox-jsx-aria-attrs-valid.jsx": () =>
      component('<input role="switch" ' + rep('aria-label="b" aria-checked ', n) + " />"),
    "ox-jsx-handlers.jsx": () => component("<div " + seq(n, i => `onClick${i}={() => a(${i})}`, " ") + " />"),
    "ox-jsx-unknown-attrs.jsx": () => component("<div " + seq(n, i => `class${i}="b" data-A${i}="c"`, " ") + " />"),
    "ox-jsx-spreads-same.jsx": () => component("<div " + rep("{...props} ", n) + " />"),
    "ox-jsx-spreads-then-attr.jsx": () =>
      component("<img " + seq(n, i => `{...props.a${i}}`, " ") + ' alt="" key="a" />'),
    "ox-jsx-labels.jsx": () =>
      component("<div>\n" + rep("<label><span><span><input /></span></span></label>\n", n) + "</div>"),
    "ox-jsx-label-children.jsx": () => component("<label>\n" + rep("<span>a</span>\n", n) + "</label>"),
    "ox-jsx-label-children-empty.jsx": () => component("<label>\n" + rep("<span />\n", n) + "</label>"),
    "ox-jsx-labels-for.jsx": () =>
      component(
        "<div>\n" + seq(n, i => `<label htmlFor="a${i}" /><input id="a${i}" autoFocus accessKey="a" />\n`) + "</div>",
      ),
    "ox-jsx-headings.jsx": () =>
      component("<div>\n" + rep("<h1 /><h2><i /></h2><marquee /><iframe /><html />\n", n) + "</div>"),
    "ox-jsx-heading-children.jsx": () => component("<h1>\n" + rep('<span aria-hidden="true" />\n', n) + "</h1>"),
    "ox-jsx-anchor-children.jsx": () =>
      component("<a href='/a'>\n" + rep('<span aria-hidden="true">a</span>\n', n) + "</a>"),
    "ox-jsx-media.jsx": () => component("<div>\n" + rep('<video><track kind="a" /></video><audio />\n', n) + "</div>"),
    "ox-jsx-media-tracks.jsx": () => component("<video>\n" + rep('<track kind="subtitles" />\n', n) + "</video>"),
    "ox-jsx-array-no-keys.jsx": () => "const a = [\n" + rep("<div />,\n", n) + "];",
    "ox-jsx-array-same-keys.jsx": () => "const a = [\n" + rep('<div key="a" />,\n', n) + "];",
    "ox-jsx-array-keys.jsx": () => "const a = [\n" + seq(n, i => `<div key="a${i}" />,\n`) + "];",
    "ox-jsx-maps.jsx": () =>
      component("<div>\n" + rep("{props.a.map((b, i) => <div key={i} />)}\n{props.a.map(b => <i />)}\n", n) + "</div>"),
    "ox-jsx-map-returns.jsx": () => "a.map(b => {\n" + rep("if (b) return <div />;\n", n) + "});",
    "ox-jsx-index-key-uses.jsx": () =>
      "a.map((b, i) => <div>\n" + rep("<i key={`a${i}`} /><i key={i + 1} /><i key={String(i)} />\n", n) + "</div>);",
    "ox-jsx-children-prop.jsx": () =>
      component("<div>\n" + rep('<div children="a" dangerouslySetInnerHTML={{ __html: "a" }}>b</div>\n', n) + "</div>"),
    "ox-jsx-void-children.jsx": () => component("<div>\n" + rep("<br>a</br><input children='a' />\n", n) + "</div>"),
    "ox-jsx-fragments-useless.jsx": () =>
      component("<div>\n" + rep("<><i /></><React.Fragment>a</React.Fragment>\n", n) + "</div>"),
    "ox-jsx-curly.jsx": () => component("<div>\n" + rep('<i a={"b"} c={`d`}>{"e"}{\'f\'}</i>\n', n) + "</div>"),
    "ox-jsx-booleans.jsx": () => component("<div>\n" + rep("<i a={true} b={false} c />\n", n) + "</div>"),
    "ox-jsx-comment-text.jsx": () => component("<div>\n" + rep("// a\n/* b */\n", n) + "</div>"),
    "ox-jsx-script-urls.jsx": () =>
      component("<div>\n" + rep('<a href="javascript:void(0)" /><a href="  j\na\nvascript:" />\n', n) + "</div>"),
    "ox-jsx-string-refs.jsx": () => component("<div>\n" + rep('<i ref="a" /><i ref={`b`} />\n', n) + "</div>"),
    "ox-jsx-styles.jsx": () =>
      component("<div>\n" + rep('<i style="a" /><i style={props.a} /><i style={b} />\n', n) + "</div>"),
    "ox-jsx-undefined-tags.jsx": () => component("<div>\n" + seq(n, i => `<A${i} /><a.b${i} />\n`) + "</div>"),
    "ox-jsx-pascal-case.jsx": () => component("<div>\n" + seq(n, i => `<FOO_bar${i} /><a_b.C_d />\n`) + "</div>"),
    "ox-jsx-long-tag.jsx": () => component(`<A${rep("Aa", n)} />`),
    "ox-jsx-member-tag.jsx": () => component(`<A${rep(".B", n)} onClick={() => {}} />`),
    "ox-jsx-handler-names.jsx": () =>
      component(
        "<div>\n" +
          rep("<A onFoo={props.bar} handleFoo={this.handleFoo} onBar={this.props.handleBar} />\n", n) +
          "</div>",
      ),
    "ox-jsx-leaked-render.jsx": () =>
      component("<div>\n" + rep("{props.a && <i />}{props.a.length && <i />}{a ? <i /> : null}\n", n) + "</div>"),
    "ox-jsx-and-chain.jsx": () => component("<div>{" + rep("props.a && ", n) + "<i />}</div>"),
    "ox-jsx-cond-chain.jsx": () => component("<div>{" + rep("props.a ? <i /> : ", n) + "null}</div>"),
    "ox-jsx-iframes.jsx": () =>
      component("<div>\n" + rep('<iframe sandbox="allow-scripts allow-same-origin foo" /><iframe />\n', n) + "</div>"),
    "ox-jsx-iframe-sandbox.jsx": () => component(`<iframe sandbox="${rep("allow-scripts ", n)}" />`),
    "ox-jsx-autocomplete.jsx": () =>
      component(
        "<div>\n" + rep('<input autoComplete="foo bar" type="text" /><select><option /></select>\n', n) + "</div>",
      ),
    "ox-jsx-lang.jsx": () => component("<div>\n" + rep('<html lang="zz-ZZ" /><html lang={a} />\n', n) + "</div>"),
    "ox-jsx-scope.jsx": () =>
      component("<div>\n" + rep('<div scope="col" /><td scope /><Foo scope="a" />\n', n) + "</div>"),
    "ox-jsx-components.jsx": () =>
      'import React from "react";\n' +
      seq(
        n,
        i =>
          `export const A${i} = () => <div onClick={() => {}} />;\nfunction B${i}(props) { return <A${i} a={{}} b={[]} />; }\n`,
      ),
    "ox-jsx-memo-components.jsx": () =>
      'import React from "react";\n' +
      seq(
        n,
        i => `const A${i} = React.memo(() => <div />);\nconst B${i} = React.forwardRef((a, b) => <div ref={b} />);\n`,
      ),
    "ox-jsx-only-export-components.jsx": () =>
      seq(n, i => `export const A${i} = () => <div />;\nexport const b${i} = 1;\n`),
    "ox-jsx-new-values-in-component.jsx": () =>
      "function App(props) {\n" +
      seq(n, i => `const a${i} = {}; const b${i} = []; const c${i} = () => {};\n`) +
      "return <div>\n" +
      seq(n, i => `<A a={a${i}} b={b${i}} c={c${i}} />\n`) +
      "</div>;\n}",
    "ox-jsx-new-value-chain.jsx": () =>
      "function App(props) {\nconst a0 = {};\n" +
      seq(n, i => `const a${i + 1} = a${i};\n`) +
      `return <A a={a${n}} />;\n}`,
    "ox-jsx-new-value-or.jsx": () => "function App(props) {\nreturn <A a={" + rep("props.a || ", n) + "{}} />;\n}",
    "ox-jsx-new-value-same.jsx": () =>
      "function App(props) {\nconst a = {};\nreturn <div>\n" + rep("<A a={a} />\n", n) + "</div>;\n}",
    "ox-jsx-context-values.jsx": () =>
      "function App(props) {\nreturn <div>\n" +
      rep("<A.Provider value={{ a: 1 }}><i /></A.Provider>\n", n) +
      "</div>;\n}",
    "ox-react-class-methods.jsx": () =>
      'import React from "react";\nclass A extends React.Component {\n' +
      seq(n, i => `m${i}() { this.setState({ a: this.state.a }); this.state.b = 1; return this.refs.c; }\n`) +
      "render() { return <div />; }\n}",
    "ox-react-class-lifecycle.jsx": () =>
      'import React from "react";\n' +
      rep(
        "class A extends React.Component {\ncomponentDidMount() { this.setState({}); }\ncomponentWillMount() {}\nUNSAFE_componentWillUpdate() {}\nshouldComponentUpdate() {}\nrender() { return <div />; }\n}\n",
        n,
      ),
    "ox-react-class-no-render-return.jsx": () =>
      'import React from "react";\n' +
      rep("class A extends React.Component {\nrender() { if (a) { <div />; } }\n}\n", n),
    "ox-react-render-branches.jsx": () =>
      'import React from "react";\nclass A extends React.Component {\nrender() {\n' +
      rep("if (a) { b(); }\n", n) +
      "}\n}",
    "ox-react-render-returns.jsx": () =>
      'import React from "react";\nclass A extends React.Component {\nrender() {\n' +
      rep("if (a) { return <div />; }\n", n) +
      "}\n}",
    "ox-react-create-class.jsx": () =>
      rep(
        "createReactClass({ render() { return <div />; }, componentWillMount() {}, shouldComponentUpdate() {} });\n",
        n,
      ),
    "ox-react-create-element.js": () =>
      rep(
        'React.createElement("div", { children: "a", dangerouslySetInnerHTML: { __html: "" }, style: "a" }, "b");\n',
        n,
      ),
    "ox-react-create-element-props.js": () =>
      'React.createElement("br", {\n' + seq(n, i => `a${i}: ${i},\n`) + '}, "b");',
    "ox-react-dom-calls.js": () =>
      rep("ReactDOM.render(a, b); ReactDOM.findDOMNode(a); const c = ReactDOM.render(a, b); this.isMounted();\n", n),
    "ox-react-this-in-sfc.jsx": () =>
      "function App(props) {\n" + rep("this.props.a; this.state;\n", n) + "return <div />;\n}",
    "ox-react-state-hooks.jsx": () =>
      'import { useState } from "react";\nfunction App() {\n' +
      seq(n, i => `const [a${i}, b${i}] = useState(0);\n`) +
      "return <div />;\n}",
    // The routes from the start to a hook in a loop: 40 of these conditions were too many for react-hooks/rules-of-hooks.
    "ox-react-hooks-conditions-in-loops-try.js": () =>
      `class A {\nasync m() {\nwhile (a) {\nfor (;;) {\ntry {\n${hooksInConditions(n)}} catch (e) {\n${hooksInConditions(n)}break;\n}\n}\n}\n}\n}\n`,
    "ox-react-hooks-conditions-in-loops-try-component.js": () =>
      `function App() {\nwhile (a) {\nfor (;;) {\ntry {\n${hooksInConditions(n)}} catch (e) {\n${hooksInConditions(n)}break;\n}\n}\n}\n}\n`,
    "ox-react-hooks-conditions-in-loops.js": () =>
      `function useA() {\nfor (const a of b) {\ndo {\nwhile (c) {\n${hooksInConditions(n)}}\n} while (d);\n}\n}\n`,
    "ox-react-hooks-conditions-in-loop-breaks.js": () =>
      `function App() {\nfor (;;) {\nwhile (a) {\n${seq(n, i => `if (c${i}) { useA${i}(); break; }\nif (d${i}) continue;\n`)}}\n}\n}\n`,
    "ox-react-hooks-queue.ts": () =>
      "class A {\nasync run(count: number): Promise<boolean> {\nconst store = useStore();\ntry {\nwhile (this.items.length) {\n" +
      "const item = this.items.pop()!;\nfor (let i = 0; i < count; i++) {\ntry {\n" +
      seq(n, i => `if (item.a${i}) { await useStore().b${i}(item); }\nelse if (item.c${i}) { useOther().d(); }\n`) +
      "} catch (error) {\n" +
      seq(n, i => `if (error instanceof E${i}) { useDialog().show(error); }\n`) +
      "break;\n} finally {\n" +
      seq(n, i => `if (store.f${i}) { useStore().g${i} = null; }\n`) +
      "}\n}\n}\n} finally {\nthis.busy = false;\n}\nreturn true;\n}\n}\n",
    "ox-react-forward-refs.jsx": () =>
      rep("forwardRef(a => <div />); React.forwardRef(function (a) { return null; });\n", n),
    "ox-react-prop-destructuring.jsx": () =>
      "function App(props) {\n" + seq(n, i => `props.a${i};\n`) + "return <div />;\n}",
    "ox-react-display-names.jsx": () =>
      'import React from "react";\n' +
      "export default () => <div />;\n" +
      rep("module.exports.a = () => <div />; a(() => <div />); const b = { c: () => <div /> };\n", n),
    "ox-next-heads.jsx": () =>
      'import Head from "next/head";\nimport Script from "next/script";\n' +
      component(
        "<div>\n" +
          rep(
            '<Head><title>a</title><script src="a" /><link rel="stylesheet" href="a.css" /><Script strategy="beforeInteractive" /></Head>\n',
            n,
          ) +
          "</div>",
      ),
    "ox-next-head-children.jsx": () =>
      'import Head from "next/head";\n' +
      component(
        "<Head>\n" +
          rep(
            '<link href="https://fonts.googleapis.com/css?family=a" rel="stylesheet" /><meta name="viewport" />\n',
            n,
          ) +
          "</Head>",
      ),
    "ox-next-scripts.jsx": () =>
      'import Script from "next/script";\n' +
      component(
        "<div>\n" +
          rep(
            '<Script>{`a`}</Script><Script dangerouslySetInnerHTML={{ __html: "" }} /><script src="https://www.googletagmanager.com/gtag/js?id=a" /><script async src="https://polyfill.io/v3/polyfill.min.js?features=Array.prototype.copyWithin" />\n',
            n,
          ) +
          "</div>",
      ),
    "ox-next-polyfill-features.jsx": () =>
      component(
        `<script src="https://polyfill.io/v3/polyfill.min.js?features=${rep("Array.prototype.copyWithin%2C", n)}" />`,
      ),
    "ox-next-links.jsx": () =>
      component(
        "<div>\n" +
          rep('<a href="/a/">a</a><a href="/">b</a><link rel="preconnect" href="https://fonts.gstatic.com" />\n', n) +
          "</div>",
      ),
    "ox-next-typos.js": () =>
      seq(n, i => `export async function getStaticPropss${i}() {}\nexport const getServerSidePropss${i} = () => {};\n`),
    "ox-next-assign-module.js": () => rep("{ let module = 1; module = 2; }\n", n),
    "ox-next-client-async.jsx": () =>
      '"use client";\n' +
      seq(n, i => `export async function A${i}() { return <div />; }\n`) +
      "export default async function App() { return <div />; }",

    // ── jest, vitest ──
    "ox-jest-its.test.js": () => seq(n, i => `it("a${i}", () => { expect(a).toBe(${i}); });\n`),
    "ox-jest-its-same-title.test.js": () => rep('it("a", () => { expect(a).toBe(1); });\n', n),
    "ox-jest-its-in-describe.test.js": () => describe(seq(n, i => `it("a${i}", () => { expect(a).toBe(${i}); });\n`)),
    "ox-jest-its-same-title-in-describe.test.js": () => describe(rep('it("a", () => { expect(a).toBe(1); });\n', n)),
    "ox-jest-tests-and-its.test.js": () =>
      describe(
        rep(
          'it("A a", () => {});\ntest("should b.", function () {});\nxit("c ", () => {});\nfit(" d", () => {});\n',
          n,
        ),
      ),
    "ox-jest-its-no-expect.test.js": () => seq(n, i => `it("a${i}", () => { a(); });\n`),
    "ox-jest-its-done.test.js": () => seq(n, i => `it("a${i}", done => { expect(a).toBe(1); done(); });\n`),
    "ox-jest-its-return.test.js": () => seq(n, i => `it("a${i}", () => { return expect(a).resolves.toBe(1); });\n`),
    "ox-jest-its-timeouts.test.js": () =>
      seq(n, i => `it("a${i}", () => {}, 1000);\nit("b${i}", { timeout: 1 }, () => {});\n`),
    "ox-jest-describes.test.js": () =>
      seq(n, i => `describe("a${i}", () => { it("b", () => { expect(1).toBe(1); }); });\n`),
    "ox-jest-describes-same-title.test.js": () =>
      rep('describe("a", () => { it("b", () => { expect(1).toBe(1); }); });\n', n),
    "ox-jest-describes-bad.test.js": () =>
      rep(
        'describe("a", async () => { return 1; });\ndescribe("b", done => {});\ndescribe(() => {});\ndescribe("c");\n',
        n,
      ),
    "ox-jest-hooks.test.js": () =>
      describe(rep("beforeEach(() => {});\nafterAll(() => {});\nbeforeAll(() => {});\nafterEach(() => {});\n", n)),
    "ox-jest-hooks-top.test.js": () => rep("beforeEach(() => {});\nafterAll(() => {});\n", n),
    "ox-jest-hooks-and-its.test.js": () => describe(rep('it("a", () => {});\nbeforeEach(() => {});\n', n)),
    "ox-jest-hooks-per-describe.test.js": () =>
      rep(
        'describe("a", () => { afterEach(() => {}); beforeEach(() => {}); beforeEach(() => {}); it("b", () => {}); });\n',
        n,
      ),
    "ox-jest-expects.test.js": () => test(rep("expect(a).toBe(1);\n", n)),
    "ox-jest-expects-matchers.test.js": () =>
      test(
        rep(
          "expect(a).toEqual(null); expect(a.length).toBe(1); expect(a === b).toBe(true); expect(a > b).toBe(false); expect(a.includes(b)).toBe(true); expect(typeof a).toBe('b'); expect(a).toBeCalled(); expect(a).toThrow(); expect(a).not.toBeDefined(); expect(a instanceof B).toBeTruthy(); expect(a).toHaveBeenCalledTimes(1); expect(a).toBe(NaN); expect(a).toBe(undefined);\n",
          n,
        ),
      ),
    "ox-jest-expects-invalid.test.js": () =>
      test(
        rep(
          "expect(a); expect().toBe(1); expect(a, b).toBe(1); expect(a).toBe; expect(a).foo.toBe(1); expect(a).resolves.toBe(1); expect(a).not.not.toBe(1);\n",
          n,
        ),
      ),
    "ox-jest-expects-await.test.js": () =>
      test(rep("await expect(a).resolves.toBe(1);\nawait expect(a).rejects.toThrow();\nexpect(await a).toBe(1);\n", n)),
    "ox-jest-expects-promise-all.test.js": () =>
      test("await Promise.all([\n" + rep("expect(a).resolves.toBe(1),\n", n) + "]);"),
    "ox-jest-expects-standalone.test.js": () => rep("expect(a).toBe(1);\n", n),
    "ox-jest-expects-in-describe.test.js": () => describe(rep("expect(a).toBe(1);\n", n)),
    "ox-jest-expects-in-helpers.test.js": () =>
      seq(n, i => `function h${i}() { expect(a).toBe(1); }\n`) + test(seq(n, i => `h${i}();\n`)),
    "ox-jest-expects-conditional.test.js": () =>
      test(
        rep(
          "if (a) { expect(a).toBe(1); }\na && expect(a).toBe(1);\na ? expect(a).toBe(1) : 0;\ntry { b(); } catch (e) { expect(e).toBe(1); }\n",
          n,
        ),
      ),
    "ox-jest-expects-in-catch.test.js": () => test(rep("a.catch(e => expect(e).toBe(1));\n", n)),
    "ox-jest-expects-in-then.test.js": () => test(rep("a.then(b => { expect(b).toBe(1); });\n", n)),
    "ox-jest-expects-in-callbacks.test.js": () => test(rep("a(() => { expect(b).toBe(1); });\n", n)),
    "ox-jest-expects-in-loops.test.js": () => test(rep("for (const b of a) { expect(b).toBe(1); }\n", n)),
    "ox-jest-expect-not-chain.test.js": () => test("expect(a)" + rep(".not", n) + ".toBe(1);"),
    "ox-jest-expect-member-chain.test.js": () => test("expect(a)" + seq(n, i => `.a${i}`) + ".toBe(1);"),
    "ox-jest-expect-call-chain.test.js": () => test("expect(a)" + rep(".toBe(1)", n) + ";"),
    "ox-jest-expect-index-chain.test.js": () => test("expect(a)" + rep('["not"]', n) + '["toBe"](1);'),
    "ox-jest-expect-then-chain.test.js": () => test("expect(a).resolves.toBe(1)" + rep(".then(() => {})", n) + ";"),
    "ox-jest-expect-arguments.test.js": () =>
      test("expect(" + seq(n, i => `a${i}`, ", ") + ").toBe(" + seq(n, i => `b${i}`, ", ") + ");"),
    "ox-jest-expect-object.test.js": () =>
      test("expect(a).toEqual({\n" + seq(n, i => `a${i}: expect.any(Number),\n`) + "});"),
    "ox-jest-expect-assertions.test.js": () =>
      seq(
        n,
        i =>
          `it("a${i}", () => { expect.assertions(1); expect.hasAssertions(); expect(a).toBe(1); expect.assertions("a"); });\n`,
      ),
    "ox-jest-it-member-chain.test.js": () => "it" + rep(".only", n) + '("a", () => {});',
    "ox-jest-it-skip-chain.test.js": () => "it" + rep(".skip.failing.concurrent", n) + '("a", () => {});',
    "ox-jest-describe-each-chain.test.js": () => "describe" + rep(".each([1])", n) + '("a", () => {});',
    "ox-jest-each-rows.test.js": () =>
      "it.each([\n" + seq(n, i => `[${i}, ${i}],\n`) + ']) ("a %i", (a, b) => { expect(a).toBe(b); });',
    "ox-jest-each-template.test.js": () =>
      "it.each`\na | b\n" + seq(n, i => `\${${i}} | \${${i}}\n`) + '`("a $a", ({ a, b }) => { expect(a).toBe(b); });',
    "ox-jest-eachs.test.js": () =>
      seq(
        n,
        i =>
          `it.each([1])("a${i} %i", a => { expect(a).toBe(1); });\ndescribe.each([1])("b${i}", a => {});\ntest.for([1])("c${i}", a => {});\n`,
      ),
    "ox-jest-modifiers.test.js": () =>
      rep(
        'it.only("a", () => {});\nit.skip("b", () => {});\nit.todo("c");\ndescribe.only("d", () => {});\ntest.concurrent("e", async () => {});\nit("f");\n',
        n,
      ),
    "ox-jest-mocks.test.js": () => seq(n, i => `jest.mock("m${i}", () => ({}));\njest.mock("./__mocks__/m${i}");\n`),
    "ox-jest-fns.test.js": () =>
      rep(
        "a.b = jest.fn(); jest.fn().mockImplementation(() => 1); jest.fn().mockImplementation(() => Promise.resolve(1)); jest.spyOn(a, 'b'); jest.setTimeout(1); jest.resetModuleRegistry();\n",
        n,
      ),
    "ox-jest-mock-chain.test.js": () =>
      "jest.fn()" + rep(".mockReturnValueOnce(1).mockImplementationOnce(() => 1)", n) + ";",
    "ox-jest-mock-return-reads.test.js": () => "let a = 1;\n" + rep("b.mockImplementation(() => a + a + c);\n", n),
    "ox-jest-mock-return-big.test.js": () => "b.mockImplementation(() => [\n" + seq(n, i => `a${i},\n`) + "]);",
    "ox-jest-set-timeouts.test.js": () => rep("jest.setTimeout(1);\n", n),
    "ox-jest-set-timeouts-after-its.test.js": () => rep('it("a", () => {});\njest.setTimeout(1);\n', n),
    "ox-jest-called-pairs.test.js": () =>
      test(seq(n, i => `expect(a${i}).toHaveBeenCalledOnce();\nexpect(a${i}).toHaveBeenCalledWith(1);\n`)),
    "ox-jest-called-pairs-same.test.js": () =>
      test(rep("expect(a).toHaveBeenCalledOnce();\nexpect(a).toHaveBeenCalledWith(1);\n", n)),
    "ox-jest-snapshots.test.js": () =>
      test(
        rep(
          "expect(a).toMatchInlineSnapshot(`\na\nb\n`);\nexpect(a).toMatchSnapshot();\nexpect(a).toThrowErrorMatchingInlineSnapshot(`${b}`);\n",
          n,
        ),
      ),
    "ox-jest-snapshot-lines.test.js": () => test("expect(a).toMatchInlineSnapshot(`\n" + rep("a\n", n) + "`);"),
    "ox-jest-snapshot-file.snap": () => seq(n, i => `exports[\`a ${i}\`] = \`\na\nb\n\`;\n`),
    "ox-jest-commented-out.test.js": () => rep('// it("a", () => {});\n/* describe("b", () => {}); */\n', n),
    "ox-jest-comment-lines.test.js": () => "/*\n" + rep('it("a", () => {});\n', n) + "*/",
    "ox-jest-titles.test.js": () =>
      seq(
        n,
        i =>
          `it(\`a\${${i}}\`, () => {});\nit(a${i}, () => {});\nit(${i}, () => {});\nit("", () => {});\nit("a" + ${i}, () => {});\n`,
      ),
    "ox-jest-title-long.test.js": () => `it("${rep("a ", n)}", () => {});`,
    "ox-jest-title-concat.test.js": () => "it(" + rep('"a" + ', n) + '"b", () => {});',
    "ox-jest-title-template.test.js": () => "it(`" + seq(n, i => `a\${${i}}`) + "`, () => {});",
    "ox-jest-exports.test.js": () => 'it("a", () => {});\n' + seq(n, i => `export const a${i} = 1;\n`),
    "ox-jest-module-exports.test.js": () => 'it("a", () => {});\n' + seq(n, i => `module.exports.a${i} = 1;\n`),
    "ox-jest-globals-imports.test.js": () =>
      "import {\n" +
      seq(n, i => `it as it${i},\n`) +
      '} from "@jest/globals";\n' +
      seq(n, i => `it${i}("a${i}", () => {});\n`),
    "ox-jest-globals-import-statements.test.js": () =>
      seq(n, i => `import { it as it${i} } from "@jest/globals";\n`) + seq(n, i => `it${i}("a${i}", () => {});\n`),
    "ox-vitest-imports.test.ts": () =>
      "import {\n" +
      seq(n, i => `it as it${i},\n`) +
      '} from "vitest";\n' +
      seq(n, i => `it${i}("a${i}", () => {});\n`),
    "ox-vitest-its.test.ts": () =>
      'import { it, expect, vi, describe } from "vitest";\n' +
      seq(n, i => `it("a${i}", () => { expect(a).toBe(${i}); });\n`),
    "ox-vitest-vi.test.ts": () =>
      'import { vi, vitest } from "vitest";\n' +
      rep(
        'vi.mock("a"); vi.mock("./a", () => ({})); vi.fn(); vi.hoisted(() => {}); vitest.fn(); vi.setConfig({ testTimeout: 1 }); vi.importActual("a");\n',
        n,
      ),
    "ox-vitest-vi-in-functions.test.ts": () =>
      'import { vi, it } from "vitest";\n' + test(rep('vi.mock("a"); vi.hoisted(() => {}); vi.unmock("a");\n', n)),
    "ox-vitest-hoisted-imports.test.ts": () =>
      seq(n, i => `import a${i} from "a${i}";\n`) +
      'import { vi } from "vitest";\nfunction f() {\n' +
      rep('vi.mock("a");\n', n) +
      "}",
    "ox-vitest-describe-titles.test.ts": () =>
      seq(n, i => `import { a${i} } from "a";\n`) +
      'import { describe } from "vitest";\n' +
      seq(n, i => `describe("a${i}", () => {});\ndescribe(a${i}.name, () => {});\n`),
    "ox-vitest-concurrent-snapshots.test.ts": () =>
      'import { it, expect } from "vitest";\nit.concurrent("a", () => {\n' +
      rep("expect(a).toMatchSnapshot();\n", n) +
      "});",
    "ox-vitest-poll.test.ts": () =>
      'import { it, expect } from "vitest";\n' +
      test(rep("expect.poll(() => a).toBe(1);\nexpect.element(a).toBe(1);\n", n)),
    "ox-vitest-expect-type-of.test.ts": () =>
      'import { it, expectTypeOf } from "vitest";\n' +
      test(rep("expectTypeOf(a).toBeInstanceOf(Object);\nexpectTypeOf(a instanceof Object).toBeTruthy();\n", n)),
    "ox-vitest-globals-in-types.test.ts": () => seq(n, i => `let a${i}: vi.Mock; let b${i}: typeof expect;\n`),
    "ox-vitest-requires.test.js": () => rep('const { it, foo } = require("vitest");\n', n),
    "ox-vitest-require-names.test.js": () =>
      "const {\n" + seq(n, i => `a${i},\n`) + 'it } = require("vitest");\nexpect(1);',
    "ox-jest-padding.test.js": () =>
      describe(
        rep(
          'const a = 1;\nbeforeEach(() => {});\nit("a", () => {\nconst b = 1;\nexpect(b).toBe(1);\nb();\n});\n// c\ndescribe("d", () => {});\n',
          n,
        ),
      ),
    "ox-jest-padding-comments.test.js": () =>
      describe(rep("// a\n", n) + 'it("a", () => {});\n' + rep("/* b */\n", n) + 'it("b", () => {});'),
    "ox-jest-setup-code.test.js": () => rep("a();\nlet b = c();\n", n) + describe(rep("a();\nlet b = c();\n", n)),
    "ox-jest-jasmine.test.js": () =>
      rep(
        "jasmine.any(a); jasmine.DEFAULT_TIMEOUT_INTERVAL = 1; spyOn(a, 'b'); fail(); pending(); jasmine.createSpy();\n",
        n,
      ),
    "ox-jest-loops-of-its.test.js": () => rep('for (const a of b) { it("c", () => {}); }\n', n),
    "ox-jest-its-in-ifs.test.js": () => rep('if (a) { it("b", () => {}); }\n', n),
    "ox-jest-its-in-its.test.js": () => test(rep('it("b", () => {});\n', n)),
    "ox-jest-ifs-in-it.test.js": () => test(rep("if (a) { b(); }\nswitch (a) { case 1: }\nconst c = a ? 1 : 2;\n", n)),
    "ox-jest-functions-in-it.test.js": () => test(seq(n, i => `function f${i}() { if (a) { expect(1).toBe(1); } }\n`)),
    "ox-jest-helper-chain.test.js": () =>
      seq(n, i => `function h${i}() { h${i + 1}(); }\n`) + `function h${n}() { expect(1).toBe(1); }\n` + test("h0();"),
    "ox-jest-helper-calls.test.js": () =>
      "function h() { expect(1).toBe(1); }\n" + seq(n, i => `it("a${i}", () => { h(); });\n`),
    "ox-jest-helper-big.test.js": () =>
      "function h() {\n" + rep("a();\n", n) + "}\n" + seq(n, i => `it("a${i}", () => { h(); });\n`),
    "ox-jest-promise-vars.test.js": () =>
      test(seq(n, i => `const p${i} = a.then(b => { expect(b).toBe(1); });\n`) + seq(n, i => `await p${i};\n`)),
    "ox-jest-promise-var-reassigned.test.js": () =>
      test(
        "let p = a.then(b => { expect(b).toBe(1); });\n" +
          rep("p = p.then(b => { expect(b).toBe(1); });\n", n) +
          "await p;",
      ),
    "ox-jest-promise-var-statements.test.js": () =>
      test("const p = a.then(b => { expect(b).toBe(1); });\n" + rep("c();\n", n) + "await p;"),
    "ox-jest-promise-vars-statements.test.js": () =>
      test(seq(n, i => `const p${i} = a.then(b => { expect(b).toBe(1); });\nc();\n`)),
    "ox-jest-restricted.test.js": () =>
      test(rep("expect(a).toBeFalsy(); expect(a).resolves.not.toBeTruthy(); jest.advanceTimersByTime(1);\n", n)),
    "ox-jest-typed-mocks.test.ts": () =>
      rep(
        'jest.mock("a", () => ({})); (a as jest.Mock).mockReturnValue(1); (<jest.MockedFunction<typeof a>>a)(); jest.fn<number>();\n',
        n,
      ),
    "ox-jest-as-chain.test.ts": () => "(a" + rep(" as jest.Mock", n) + ").b();",

    // ── import ──
    "ox-import-defaults.js": () => seq(n, i => `import a${i} from "./m${i}";\n`),
    "ox-import-same-module.js": () => seq(n, i => `import { a${i} } from "./m";\n`),
    "ox-import-same-module-mixed.ts": () =>
      seq(
        n,
        i =>
          `import { a${i} } from "./m";\nimport type { b${i} } from "./m";\nimport c${i}, { type d${i} } from "./m";\n`,
      ),
    "ox-import-named.js": () => "import {\n" + seq(n, i => `a${i},\n`) + '} from "./m";',
    "ox-import-named-default.js": () => seq(n, i => `import { default as a${i} } from "./m${i}";\n`),
    "ox-import-named-types.ts": () =>
      "import {\n" +
      seq(n, i => `type a${i},\n`) +
      '} from "./m";\nimport type {\n' +
      seq(n, i => `b${i},\n`) +
      '} from "./n";',
    "ox-import-namespaces.js": () => seq(n, i => `import * as a${i} from "./m${i}";\na${i}.b; a${i}.c.d; a${i}[e];\n`),
    "ox-import-namespace-uses.js": () => 'import * as a from "./m";\n' + seq(n, i => `a.b${i};\n`),
    "ox-import-namespace-chain.js": () => 'import * as a from "./m";\na' + rep(".b", n) + ";",
    "ox-import-namespace-destructure.js": () =>
      'import * as a from "./m";\nconst {\n' + seq(n, i => `b${i},\n`) + "} = a;",
    "ox-import-side-effects.js": () => seq(n, i => `import "./m${i}";\nimport "./m${i}.css";\n`),
    "ox-import-empty.js": () => seq(n, i => `import {} from "./m${i}";\nimport a${i}, {} from "./n${i}";\n`),
    "ox-import-after-code.js": () => seq(n, i => `a();\nimport b${i} from "./m${i}";\n`),
    "ox-import-no-newline-after.js": () => seq(n, i => `import b${i} from "./m${i}";\nconst c${i} = 1;\n`),
    "ox-import-then-comments.js": () => 'import a from "./m";\n' + rep("// b\n", n) + "c();",
    "ox-import-kinds.js": () =>
      seq(
        n,
        i =>
          `import a${i} from "/abs/m${i}";\nimport b${i} from "../m${i}";\nimport c${i} from "fs";\nimport d${i} from "node:path";\nimport e${i} from "./m${i}.js";\nimport f${i} from "!!a-loader!./m${i}";\nimport g${i} from "./ox-import-kinds";\nimport h${i} from "@a/b${i}/c";\n`,
      ),
    "ox-import-long-path.js": () => `import a from "./${rep("a/", n)}b";\nimport c from "${rep("../", n)}d";`,
    "ox-import-long-loaders.js": () => `import a from "${rep("a!", n)}b";`,
    "ox-import-requires.js": () =>
      seq(n, i => `const a${i} = require("./m${i}");\nrequire(b${i});\nrequire("./" + c);\n`),
    "ox-import-amd.js": () => rep('define(["a"], function (a) {});\nrequire(["b"], function (b) {});\n', n),
    "ox-import-amd-dependencies.js": () => "define([\n" + seq(n, i => `"a${i}",\n`) + "], function () {});",
    "ox-import-dynamic.js": () =>
      seq(n, i => `import("./m${i}");\nimport(/* webpackChunkName: "a${i}" */ "./n${i}");\nimport(a${i});\n`),
    "ox-import-commonjs-exports.js": () => seq(n, i => `exports.a${i} = 1;\nmodule.exports.b${i} = 2;\n`),
    "ox-import-module-exports.js": () => rep("module.exports = {};\n", n),
    "ox-import-attributes.js": () => seq(n, i => `import a${i} from "./m${i}.json" with { type: "json" };\n`),
    // Scripts: without `import` and `export`.
    "ox-script-declarations.js": () => seq(n, i => `var a${i} = 1;\nfunction b${i}() {}\nc${i} = 1;\n`),
    "ox-script-same-names.js": () => rep("var a;\n", n) + rep("a = 1; b = 1; [c = 1] = [];\n", n),
    "ox-script-functions-in-blocks.js": () =>
      seq(n, i => `{ function a${i}() {} }\na${i} = 1;\n{ function b() {} function b() {} }\nb = 1;\n`),
    "ox-script-functions-in-blocks-of-functions.js": () =>
      seq(n, i => `function a${i}() { { function b() {} } b = 1; }\n`) + rep("b = 1;\n", n),
    "ox-script-vars-in-catches.js": () => rep("try {} catch (e) { var e; }\n", n) + rep("var e;\n", n),
    "ox-script-this-eval.js": () => rep('(function () { this.eval("a"); })();\nthis.eval("b");\n', n),
    // What eslint's rules do otherwise with a configuration of oxlint.
    "ox-loop-functions.js": () => "let a; var b;\nfor (;;) {\n" + rep("c(() => a + b); a = 1; b = 1;\n", n) + "}\n",
    "ox-loops-with-functions.js": () => "let a; var b;\n" + rep("for (;;) { c(() => a + b); a = 1; b = 1; }\n", n),
    "ox-loop-called-functions.js": () =>
      "var a;\nfor (;;) {\n" + rep("(function () { (() => { a; })(); })();\n", n) + "}\n",
    "ox-catches-that-throw.js": () =>
      rep('try {} catch (e) { throw new Error("a"); }\ntry {} catch { throw new Error("a"); }\n', n) +
      "try {} catch (e) {\n" +
      rep('throw new Error("a", { cause: e });\n', n) +
      "}\n",
    "ox-accessors-same-name.js": () =>
      "({\n" + rep("get a() { return 1; },\n", n) + "});\nclass A {\n" + rep("set a(b) {}\n", n) + "}\n",
    "ox-function-types-same-name.ts": () =>
      "type A = 1;\n" + seq(n, i => `type B${i} = <A>(A: A) => void;\ndeclare function c${i}<A>(A: A): void;\n`),
    "ox-namespace-of-types.ts": () =>
      "namespace A {\n" + seq(n, i => `interface B${i} {}\ntype C${i}<A> = A;\n`) + "}\n",
    "ox-returns-at-the-end.js": () =>
      "function a() {\n" + rep("if (b) { return; }\n", n) + "}\n" + seq(n, i => `function c${i}() { d(); return; }\n`),
    "ox-imports-same-source.js": () => seq(n, i => `import { a${i} } from "a";\nimport * as b${i} from "a";\n`),
    "ox-export-consts.js": () => seq(n, i => `export const a${i} = 1;\n`),
    "ox-export-lets.js": () => seq(n, i => `export let a${i} = 1;\nexport var b${i} = 1;\n`),
    "ox-export-functions.js": () => seq(n, i => `export function a${i}() {}\nexport class B${i} {}\n`),
    "ox-export-lists.js": () => seq(n, i => `const a${i} = 1;\nexport { a${i} };\n`),
    "ox-export-list.js": () => seq(n, i => `let a${i} = 1;\n`) + "export {\n" + seq(n, i => `a${i},\n`) + "};",
    "ox-export-list-same.js": () => "const a = 1;\nexport {\n" + seq(n, i => `a as b${i},\n`) + "};",
    "ox-export-same-name.js": () => "const a = 1;\n" + rep("export { a };\n", n),
    "ox-export-same-name-ts.ts": () =>
      rep("export function a(b: number): void;\n", n) +
      "export function a(b: any) {}\n" +
      rep("export namespace N { export const c = 1; }\n", n),
    "ox-export-destructured.js": () => "export const {\n" + seq(n, i => `a${i},\n`) + "} = b;",
    "ox-export-stars.js": () => seq(n, i => `export * from "./m${i}";\nexport * as a${i} from "./n${i}";\n`),
    "ox-export-stars-same.js": () => rep('export * from "./m";\n', n),
    "ox-export-from.js": () =>
      seq(n, i => `export { a${i} } from "./m${i}";\nexport { default as b${i} } from "./n${i}";\n`),
    "ox-export-from-same.js": () => seq(n, i => `export { a${i} } from "./m";\n`),
    "ox-export-then-code.js": () => seq(n, i => `export const a${i} = 1;\nb();\n`),
    "ox-export-types.ts": () =>
      seq(n, i => `export type A${i} = 1;\nexport interface B${i} {}\nexport type { A${i} as C${i} };\n`),
    "ox-export-default-anonymous.js": () => "export default [\n" + seq(n, i => `${i},\n`) + "];",
    "ox-import-then-export.js": () =>
      seq(
        n,
        i => `import a${i} from "./m${i}";\nimport { b${i} } from "./n${i}";\nimport * as c${i} from "./o${i}";\n`,
      ) + seq(n, i => `export { a${i}, b${i}, c${i} };\n`),
    "ox-import-then-export-one-module.js": () =>
      "import {\n" + seq(n, i => `a${i},\n`) + '} from "./m";\nexport {\n' + seq(n, i => `a${i},\n`) + "};",
    "ox-import-then-export-each-one-module.js": () =>
      seq(n, i => `import { a${i} } from "./m";\n`) + seq(n, i => `export { a${i} };\n`),
    "ox-import-then-export-const.js": () =>
      seq(n, i => `import a${i} from "./m${i}";\n`) + seq(n, i => `export const b${i} = a${i};\n`),
    "ox-import-then-export-and-from.js": () =>
      seq(n, i => `import { a${i} } from "./m";\nexport { a${i} };\nexport { b${i} } from "./m";\n`),
    "ox-import-default-members.js": () =>
      seq(n, i => `import a${i} from "./m${i}";\na${i}.b; const { c${i} } = a${i};\n`),
    "ox-import-default-member-uses.js": () => 'import a from "./m";\n' + seq(n, i => `a.b${i};\n`),
    "ox-import-unassigned-mixed.js": () => seq(n, i => `import "./a${i}";\nimport b${i} from "./b${i}";\n`),

    // ── jsdoc ──
    "ox-jsdoc-functions.js": () =>
      seq(n, i => `/**\n * A.\n * @param {string} a b\n * @returns {number} c\n */\nfunction f${i}(a) { return 1; }\n`),
    "ox-jsdoc-functions-wrong.js": () =>
      seq(
        n,
        i =>
          `/**\n * @param b\n * @arg {string}\n * @return\n * @foo\n * @private\n * @access public\n * @implements {A}\n * @yields\n */\nfunction f${i}(a, { c, d }, ...e) { return 1; }\n`,
      ),
    "ox-jsdoc-functions-missing.js": () =>
      seq(
        n,
        i =>
          `/** */\nfunction f${i}(a, b) { return a; }\n/** */\nconst g${i} = (a, b) => a;\n/** */\nfunction* h${i}() { yield 1; }\n`,
      ),
    "ox-jsdoc-params.js": () =>
      "/**\n" + seq(n, i => ` * @param {string} a${i} b\n`) + " */\nfunction f(" + seq(n, i => `a${i}`, ", ") + ") {}",
    "ox-jsdoc-params-missing.js": () => "/**\n */\nfunction f(" + seq(n, i => `a${i}`, ", ") + ") {}",
    "ox-jsdoc-params-extra.js": () => "/**\n" + seq(n, i => ` * @param {string} a${i} b\n`) + " */\nfunction f() {}",
    "ox-jsdoc-params-same.js": () => "/**\n" + rep(" * @param {string} a b\n", n) + " */\nfunction f(a) {}",
    "ox-jsdoc-params-reversed.js": () =>
      "/**\n" +
      seq(n, i => ` * @param {string} a${n - 1 - i} b\n`) +
      " */\nfunction f(" +
      seq(n, i => `a${i}`, ", ") +
      ") {}",
    "ox-jsdoc-params-nested.js": () =>
      "/**\n * @param {object} a b\n" +
      seq(n, i => ` * @param {string} a.b${i} c\n`) +
      " */\nfunction f({ " +
      seq(n, i => `b${i}`, ", ") +
      " }) {}",
    "ox-jsdoc-params-nested-missing.js": () =>
      "/**\n * @param {object} a b\n */\nfunction f({ " + seq(n, i => `b${i}`, ", ") + " }) {}",
    "ox-jsdoc-param-path.js": () =>
      "/**\n * @param {object} a b\n * @param {string} a" + rep(".b", n) + " c\n */\nfunction f(a) {}",
    "ox-jsdoc-param-paths.js": () =>
      "/**\n * @param {object} a b\n" +
      seq(n, i => ` * @param {string} a${rep(".b", i % 50)} c\n`) +
      " */\nfunction f(a) {}",
    "ox-jsdoc-properties.js": () =>
      "/**\n * @typedef {object} A\n" + seq(n, i => ` * @property {string} a${i} b\n`) + " */",
    "ox-jsdoc-properties-same.js": () =>
      "/**\n * @typedef {object} A\n" + rep(" * @property {string} a b\n", n) + " */",
    "ox-jsdoc-properties-bare.js": () =>
      "/**\n * @typedef {object} A\n" + rep(" * @property\n * @prop {a}\n", n) + " */",
    "ox-jsdoc-typedefs.js": () =>
      seq(n, i => `/**\n * @typedef {object} A${i}\n */\n/**\n * @namespace {Object} B${i}\n */\n`),
    "ox-jsdoc-tags-unknown.js": () => "/**\n" + seq(n, i => ` * @foo${i} a\n`) + " */\nfunction f() {}",
    "ox-jsdoc-tags-empty.js": () =>
      "/**\n" + rep(" * @abstract a\n * @async b\n * @override c\n", n) + " */\nfunction f() {}",
    "ox-jsdoc-tags-access.js": () =>
      "/**\n" + rep(" * @access foo\n * @public\n * @private\n", n) + " */\nfunction f() {}",
    "ox-jsdoc-tags-returns.js": () => "/**\n" + rep(" * @returns {a} b\n", n) + " */\nfunction f() { return 1; }",
    "ox-jsdoc-tags-one-line.js": () => "/** " + rep("@a {b} c ", n) + "*/\nfunction f() {}",
    "ox-jsdoc-description-lines.js": () => "/**\n" + rep(" * a b c.\n", n) + " * @param a\n */\nfunction f(a) {}",
    "ox-jsdoc-description-line.js": () => "/** " + rep("a ", n) + "\n * @param a\n */\nfunction f(a) {}",
    "ox-jsdoc-tag-description-lines.js": () => "/**\n * @param a\n" + rep(" * b c.\n", n) + " */\nfunction f(a) {}",
    "ox-jsdoc-stars.js": () => "/**" + rep("*", n) + "\n" + rep(" ** a\n", n) + " */\nfunction f() {}",
    "ox-jsdoc-blank-lines.js": () =>
      "/**\n" + rep(" *\n", n) + " * @param a\n" + rep("\n", n) + " */\nfunction f(a) {}",
    "ox-jsdoc-type-union.js": () => "/**\n * @param {" + seq(n, i => `A${i}`, "|") + "} a b\n */\nfunction f(a) {}",
    "ox-jsdoc-type-braces-open.js": () => "/**\n * @param {" + rep("{", n) + " a b\n */\nfunction f(a) {}",
    "ox-jsdoc-type-braces-each.js": () => "/**\n" + rep(" * @param {{a: {b: c}} a\n", n) + " */\nfunction f(a) {}",
    "ox-jsdoc-name-brackets.js": () =>
      "/**\n" +
      seq(n, i => ` * @param {a} [a${i}=[1, "]"]] b\n`) +
      " */\nfunction f(" +
      seq(n, i => `a${i}`, ", ") +
      ") {}",
    "ox-jsdoc-name-brackets-open.js": () => "/**\n * @param {a} " + rep("[", n) + " b\n */\nfunction f(a) {}",
    "ox-jsdoc-inline-tags.js": () => "/**\n" + rep(" * {@link a} {@code b} {@foo c}\n", n) + " */\nfunction f() {}",
    "ox-jsdoc-code-fences.js": () => "/**\n" + rep(" * ```\n * @a\n * ```\n", n) + " */\nfunction f() {}",
    "ox-jsdoc-at-signs.js": () => "/** " + rep("@", n) + " */\nfunction f() {}",
    "ox-jsdoc-comments-before-function.js": () => rep("/** @param a */\n", n) + "function f(a) {}",
    "ox-jsdoc-comments-alone.js": () => rep("/** @param a\n * @returns\n */\n", n),
    "ox-jsdoc-line-comments-between.js": () => "/** @param a */\n" + rep("// b\n", n) + "function f(a) {}",
    "ox-jsdoc-methods.js": () =>
      "class A {\n" +
      seq(
        n,
        i =>
          `/**\n * @param a\n * @returns {void}\n */\nm${i}(a, b) { return 1; }\n/** @type {a} */\nget g${i}() { return 1; }\n/** */\nconstructor${i}() {}\n`,
      ) +
      "}",
    "ox-jsdoc-object-methods.js": () =>
      "const a = {\n" +
      seq(
        n,
        i =>
          `/**\n * @param a\n */\nm${i}(a, b) { return 1; },\n/** @returns {a} */\nn${i}: function () {},\n/** */\no${i}: () => 1,\n`,
      ) +
      "};",
    "ox-jsdoc-returns-many.js": () => "/** */\nfunction f(a) {\n" + rep("if (a) return 1;\n", n) + "}",
    "ox-jsdoc-returns-none.js": () =>
      "/** @returns {a} b */\nfunction f(a) {\n" + rep("if (a) return;\nb(() => { return 1; });\n", n) + "}",
    "ox-jsdoc-returns-promises.js": () =>
      seq(
        n,
        i =>
          `/** */\nfunction f${i}() { return new Promise((resolve, reject) => { if (a) resolve(1); }); }\n/** */\nasync function g${i}() { return 1; }\n`,
      ),
    "ox-jsdoc-returns-promise-body.js": () =>
      "/** */\nfunction f() { return new Promise(resolve => {\n" + rep("if (a) { b(); }\n", n) + "resolve(1); }); }",
    "ox-jsdoc-yields-many.js": () => "/** */\nfunction* f(a) {\n" + rep("if (a) yield 1;\n", n) + "}",
    "ox-jsdoc-yields-none.js": () =>
      "/** @yields {a} b */\nfunction* f(a) {\n" + rep("b(function* () { yield 1; });\n", n) + "}",
    "ox-jsdoc-overloads.ts": () =>
      seq(n, i => `/** @param a */\nfunction f(a: ${i}): void;\n`) + "function f(a: any) {}",
    "ox-jsdoc-interfaces.ts": () =>
      "interface A {\n" + seq(n, i => `/**\n * @param a\n */\nm${i}(a: string, b: number): void;\n`) + "}",
    "ox-jsdoc-param-destructured-defaults.js": () =>
      "/**\n * @param a\n */\nfunction f({ " +
      seq(n, i => `b${i} = ${i}, c${i}: { d${i} }, e${i}: [g${i}]`, ", ") +
      " }) {}",
    "ox-jsdoc-param-array-pattern.js": () =>
      "/**\n * @param a\n */\nfunction f([" + seq(n, i => `b${i}`, ", ") + "]) {}",

    // ── promise ──
    "ox-promise-then-chain.js": () => "a" + rep(".then(b => b)", n) + ";",
    "ox-promise-then-chain-blocks.js": () => "a" + rep(".then(b => { c(b); })", n) + ";",
    "ox-promise-then-chain-catch.js": () => "a" + rep(".then(b => b)", n) + ".catch(c => {});",
    "ox-promise-catch-finally-chain.js": () => "a" + rep(".catch(b => b).finally(() => {})", n) + ";",
    "ox-promise-finally-chain.js": () => "a.catch(b => b)" + rep(".finally(() => { return 1; })", n) + ";",
    "ox-promise-then-two-chain.js": () => "a" + rep(".then(b => b, c => c)", n) + ";",
    "ox-promise-cy-chain.js": () => "cy.get(a)" + rep(".then(b => b)", n) + ";",
    "ox-promise-chain-returned.js": () => "function f() { return a" + rep(".then(b => { return b; })", n) + "; }",
    "ox-promise-chain-awaited.js": () => "async function f() { await a" + rep(".then(b => { c(); })", n) + "; }",
    "ox-promise-chain-assigned.js": () => "const d = a" + rep(".then(b => { c(); })", n) + ";",
    "ox-promise-thens.js": () => rep("a.then(b => { c(b); });\n", n),
    "ox-promise-thens-in-function.js": () =>
      "function f(a) {\n" + rep("a.then(b => { c(b); }).catch(d => {});\n", n) + "}",
    "ox-promise-thens-nested-once.js": () =>
      rep("a.then(b => c.then(d => b + d));\na.then(b => { return c.then(d => d); });\n", n),
    "ox-promise-thens-in-then.js": () => then(rep("c.then(d => d);\n", n)),
    "ox-promise-thens-in-then-using.js": () => then(rep("c.then(d => b + d);\n", n)),
    "ox-promise-thens-in-then-big-callback.js": () => then("return c.then(d => {\n" + rep("e(b, d);\n", n) + "});"),
    "ox-promise-thens-in-callback.js": () => "a((err, b) => {\n" + rep("c.then(d => d);\n", n) + "});",
    "ox-promise-callbacks-in-then.js": () => then(rep("cb(b); callback(null, b); next(); done(b);\n", n)),
    "ox-promise-callbacks-in-timeout-in-then.js": () => then(rep("setTimeout(() => cb(b));\nsetTimeout(cb);\n", n)),
    "ox-promise-callbacks.js": () => rep("a((err, b) => { cb(err); });\nfunction f(a, callback) { callback(); }\n", n),
    "ox-promise-then-branches.js": () => then(rep("if (b) { c(); }\n", n)),
    "ox-promise-then-branches-return.js": () => then(rep("if (b) { return 1; }\n", n)),
    "ox-promise-then-else-if.js": () => then(seq(n, i => `if (b === ${i}) { return 1; }`, " else ")),
    "ox-promise-then-switch.js": () => then("switch (b) {\n" + seq(n, i => `case ${i}: return 1;\n`) + "}"),
    "ox-promise-then-switch-fallthrough.js": () => then("switch (b) {\n" + seq(n, i => `case ${i}: c();\n`) + "}"),
    "ox-promise-then-tries.js": () => then(rep("try { c(); } catch (e) { return 1; } finally { d(); }\n", n)),
    "ox-promise-then-loops.js": () =>
      then(rep("for (const c of b) { if (c) break; }\nwhile (b) { if (c) continue; }\n", n)),
    "ox-promise-then-logical.js": () => then("return " + rep("b && ", n) + "c;"),
    "ox-promise-then-conds.js": () => then(rep("b ? c() : d();\nb && c();\nb ?? d();\n", n)),
    "ox-promise-then-functions.js": () => then(rep("function c() { return 1; }\nconst d = () => { e(); };\n", n)),
    "ox-promise-then-wraps.js": () =>
      then(rep("if (b) return Promise.resolve(1);\nif (c) return Promise.reject(2);\n", n)),
    "ox-promise-thens-wrap.js": () =>
      rep("a.then(b => Promise.resolve(b));\na.then(function () { return Promise.reject(1); }.bind(this));\n", n),
    "ox-promise-wraps-in-callbacks-in-then.js": () => then(rep("c(() => Promise.resolve(1));\n", n)),
    "ox-promise-executors.js": () => rep("new Promise((resolve, reject) => { resolve(1); });\n", n),
    "ox-promise-executors-twice.js": () =>
      rep("new Promise((resolve, reject) => { if (a) resolve(1); resolve(2); });\n", n),
    "ox-promise-executors-names.js": () =>
      rep("new Promise((a, b) => {});\nnew Promise(function (reject, resolve) {});\nnew Promise(c);\n", n),
    "ox-promise-executors-in-function.js": () =>
      "function f() {\n" + rep("new Promise((resolve, reject) => { if (a) resolve(1); else reject(2); });\n", n) + "}",
    "ox-promise-executor-resolves.js": () => executor(rep("resolve(1);\n", n)),
    "ox-promise-executor-if-resolves.js": () => executor(rep("if (a) resolve(1);\n", n)),
    "ox-promise-executor-if-resolve-return.js": () => executor(rep("if (a) { resolve(1); return; }\n", n)),
    "ox-promise-executor-else-if.js": () => executor(seq(n, i => `if (a === ${i}) { resolve(1); }`, " else ")),
    "ox-promise-executor-if-else.js": () =>
      executor(rep("if (a) { b(); } else { c(); }\n", n) + "resolve(1); resolve(2);"),
    "ox-promise-executor-switch.js": () =>
      executor("switch (a) {\n" + seq(n, i => `case ${i}: resolve(1); break;\n`) + "}\nresolve(2);"),
    "ox-promise-executor-switch-fallthrough.js": () =>
      executor("switch (a) {\n" + seq(n, i => `case ${i}: resolve(1);\n`) + "}"),
    "ox-promise-executor-switches.js": () =>
      executor(rep("switch (a) { case 1: resolve(1); break; case 2: b(); default: c(); }\n", n)),
    "ox-promise-executor-tries.js": () => executor(rep("try { a(); resolve(1); } catch (e) { reject(e); }\n", n)),
    "ox-promise-executor-try-body.js": () =>
      executor("try {\n" + rep("a();\n", n) + "resolve(1);\n} catch (e) { reject(e); }"),
    "ox-promise-executor-try-finally.js": () => executor(rep("try { a(); } finally { resolve(1); }\n", n)),
    "ox-promise-executor-loops.js": () =>
      executor(rep("for (const a of b) { resolve(a); }\nwhile (c) { if (d) break; reject(1); }\n", n)),
    "ox-promise-executor-labels.js": () =>
      executor(seq(n, i => `l${i}: for (;;) { if (a) break l${i}; resolve(1); }\n`)),
    "ox-promise-executor-callbacks.js": () =>
      executor(rep("a((err, b) => { if (err) reject(err); resolve(b); });\n", n)),
    "ox-promise-executor-callbacks-ok.js": () =>
      executor(rep("a((err, b) => { if (err) { reject(err); return; } resolve(b); });\n", n)),
    "ox-promise-executor-logical.js": () =>
      executor(rep("a && resolve(1);\nb || reject(2);\nc ?? resolve(3);\nd ? resolve(4) : reject(5);\n", n)),
    "ox-promise-executor-logical-chain.js": () => executor(rep("a && ", n) + "resolve(1); resolve(2);"),
    "ox-promise-executor-cond-chain.js": () => executor(rep("a ? resolve(1) : ", n) + "reject(2);"),
    "ox-promise-executor-arguments.js": () => executor("a(" + rep("resolve(1), ", n) + "b);"),
    "ox-promise-executor-statements.js": () => executor(rep("a();\n", n) + "resolve(1);"),
    "ox-promise-executor-throws.js": () => executor(rep("if (a) throw b;\n", n) + "resolve(1); resolve(2);"),
    "ox-promise-executor-awaits.js": () =>
      "new Promise(async (resolve, reject) => {\n" + rep("await a; resolve(1);\n", n) + "});",
    "ox-promise-statics.js": () =>
      rep(
        "new Promise.resolve(1); Promise.foo(); Promise.all(); Promise.resolve(1, 2); a.then(); a.catch(b, c); Promise.race(a, b);\n",
        n,
      ),
    "ox-promise-receivers.js": () => seq(n, i => `const a${i} = {};\na${i}.then(b => b);\n`),
    "ox-promise-receiver-chain.js": () =>
      "const a0 = {};\n" + seq(n, i => `const a${i + 1} = a${i};\n`) + `a${n}.then(b => b);`,
    "ox-promise-receiver-chain-uses.js": () =>
      "const a0 = {};\n" + seq(n, i => `const a${i + 1} = a${i};\na${i + 1}.then(b => b);\n`),
    "ox-promise-alls.js": () =>
      "async function f() {\n" +
      rep("await Promise.all([await a, b]); await Promise.all([a]); await Promise.race([await a]);\n", n) +
      "}",
    "ox-promise-all-elements.js": () => "async function f() {\nawait Promise.all([\n" + rep("await a,\n", n) + "]);\n}",

    // ── unicorn, oxc ──
    "ox-dots-called.js": () => "a" + rep(".b", n) + "();",
    "ox-dots-calls.js": () => "a" + rep(".b()", n) + ";",
    "ox-dots-calls-arguments.js": () => "a" + rep(".b(c, d => d)", n) + ";",
    "ox-dots-optional.js": () => "a" + rep("?.b", n) + ";",
    "ox-dots-optional-calls.js": () => "a" + rep("?.b?.()", n) + ";",
    "ox-dots-index.js": () => "a" + rep("[0]", n) + ";",
    "ox-dots-non-null.ts": () => "a" + rep("!.b", n) + ";",
    "ox-dots-await.js": () => "async function f() { (await a)" + rep(".b", n) + "; }",
    "ox-dots-assigned.js": () => "a" + rep(".b", n) + " = a" + rep(".b", n) + " + 1;",
    "ox-dots-compared.js": () =>
      "a" + rep(".b", n) + " === a" + rep(".b", n) + " || a" + rep(".b", n) + " < a" + rep(".b", n) + ";",
    "ox-dots-array-methods.js": () =>
      "a" +
      rep(".map(b => b).filter(Boolean).flat().reduce((c, d) => c).forEach(e).slice(0).concat([]).find(f)", n) +
      ";",
    "ox-dots-string-methods.js": () =>
      "a" + rep('.replace(/b/g, "c").substr(1).trimLeft().split("").charCodeAt(0).slice(1).startsWith("d")', n) + ";",
    "ox-dots-this.js": () => "class A { m() { this" + rep(".a", n) + "; } }",
    "ox-dots-process.js": () => "process" + rep(".env", n) + ";",
    "ox-dots-window.js": () => "window" + rep(".window", n) + ";",
    "ox-cases-braces.js": () => "switch (a) {\n" + seq(n, i => `case ${i}: { b(); break; }\n`) + "}",
    "ox-cases-empty-before-default.js": () => "switch (a) {\n" + seq(n, i => `case ${i}:\n`) + "default: b();\n}",
    "ox-cases-empty-braces-before-default.js": () =>
      "switch (a) {\n" + seq(n, i => `case ${i}: {}\n`) + "default: b();\n}",
    "ox-cases-default-first.js": () => "switch (a) {\ndefault:\n" + seq(n, i => `case ${i}: b();\n`) + "}",
    "ox-cases-in-functions.js": () => rep("function f(a) { switch (a) { case 1: case 2: default: return 1; } }\n", n),
    "ox-cases-lexical.js": () => "switch (a) {\n" + seq(n, i => `case ${i}: const b${i} = 1; break;\n`) + "}",
    "ox-class-static-members.js": () => "class A {\n" + seq(n, i => `static a${i} = ${i};\nstatic m${i}() {}\n`) + "}",
    "ox-class-static-members-semicolons.js": () => "class A {\n" + seq(n, i => `static m${i}() {};\n`) + "}",
    "ox-class-static-classes.js": () => rep("class A { static a = 1; static b() {} }\n", n),
    "ox-class-members.js": () =>
      "class A {\n" +
      seq(
        n,
        i =>
          `a${i} = ${i};\nm${i}() { return this.a${i}; }\nget g${i}() { return this.g${i}; }\nset g${i}(v) { this.g${i} = v; }\n#p${i} = 1;\n`,
      ) +
      "}",
    "ox-class-then-members.js": () => "class A {\n" + rep("then() {}\nstatic then = 1;\n", n) + "}",
    "ox-class-constructor-assignments.js": () =>
      "class A {\nconstructor() {\n" + seq(n, i => `this.a${i} = ${i};\n`) + "}\n}",
    "ox-class-constructor-assignments-same.js": () =>
      "class A {\na = 0;\nconstructor() {\n" + rep("this.a = 1;\n", n) + "}\n}",
    "ox-class-errors.js": () =>
      rep('class AError extends Error { constructor(a) { super(a); this.name = "B"; this.message = a; } }\n', n),
    "ox-class-accessors-recursion.js": () =>
      "class A {\nget a() {\n" + rep("this.a; const { a } = this;\n", n) + "return 1; }\n}",
    "ox-object-then.js": () => "const a = {\n" + rep("then() {},\n", n) + "};\n" + "export function then() {}\n",
    "ox-object-thens.js": () => rep("const a = { then: 1 }; b.then = 1; Object.defineProperty(c, 'then', {});\n", n),
    "ox-object-from-entries.js": () =>
      rep("a.reduce((b, c) => ({ ...b, [c]: 1 }), {});\na.reduce((b, c) => Object.assign(b, { [c]: 1 }), {});\n", n),
    "ox-object-getters.js": () => "const a = {\n" + seq(n, i => `get g${i}() { return this.g${i}; },\n`) + "};",
    "ox-template-long.js": () => "`" + rep("a\\n", n) + "`;",
    "ox-template-exprs.js": () => "`" + seq(n, i => `a\${b${i}}`) + "`;",
    "ox-template-escapes.js": () => "`" + rep("\\xa9\\uabcd\\u{1f600}\\\\", n) + "`;",
    "ox-template-lines-indented.js": () => "function f() {\n  return `\n" + rep("      a\n", n) + "  `;\n}",
    "ox-templates-indented.js": () => rep("a = `\n      b\n      c\n`;\n", n),
    "ox-string-escapes.js": () => '"' + rep("\\xa9\\uabcd\\u{1f600}\\\\\\cA", n) + '";',
    "ox-string-backslashes.js": () => '"' + rep("\\\\", n) + '";',
    "ox-strings-backslashes.js": () => rep('a = "b\\\\c\\\\d"; e = "\\x1b\\u001b";\n', n),
    "ox-strings-encodings.js": () => rep('a("UTF-8"); b = "utf8"; c = "ASCII"; new TextDecoder("utf-8");\n', n),
    "ox-strings-quotes.js": () => rep("a = \"b'c\"; d = 'e\"f'; g = 'h\\'i';\n", n),
    "ox-console-spaces.js": () => rep('console.log(" a ", "b ", " c"); console.error("d ", e);\n', n),
    "ox-console-arguments.js": () => "console.log(" + rep('" a ", ', n) + '"b");',
    "ox-console-long-spaces.js": () => `console.log("${rep(" ", n)}a${rep(" ", n)}", "b");`,
    "ox-numbers.js": () =>
      rep("a = 0XAB; b = 1E5; c = 10000000; d = 0b1; e = 1.50; f = 0xabn; g = 1_0000; h = .5; i = 5.;\n", n),
    "ox-number-long.js": () =>
      "a = 1" + rep("0", n) + "; b = 0x" + rep("ab", n) + "; c = 0." + rep("1", n) + "; d = 1" + rep("_000", n) + "n;",
    "ox-approx-constants.js": () => rep("a = 3.14159; b = 2.718281; c = 0.6931; d = 1.4142;\n", n),
    "ox-regexes.js": () =>
      rep(
        'a.replace(/b/g, "c"); a.match(/[0-9]/); /^a/.test(b); /a$/.test(b); a.search(/c/); new RegExp("d", "g"); a.replaceAll(/e/, "f"); a.matchAll(/g/);\n',
        n,
      ),
    "ox-regex-long.js": () => "a.replace(/" + rep("[0-9]a", n) + '/g, "c"); /^' + rep("a", n) + "/.test(b);",
    "ox-regex-flag-variable-chain.js": () =>
      "const a0 = /b/;\n" + seq(n, i => `const a${i + 1} = a${i};\n`) + `c.replaceAll(a${n}, "d");`,
    "ox-regex-flag-variable-chain-uses.js": () =>
      "const a0 = /b/;\n" + seq(n, i => `const a${i + 1} = a${i};\nc.replaceAll(a${i + 1}, "d");\n`),
    "ox-ternary-chain.js": () => "a = " + seq(n, i => `b${i} ? ${i} : `) + "0;",
    "ox-ternary-chain-parens.js": () => "a = " + seq(n, i => `b${i} ? ${i} : (`) + "0" + rep(")", n) + ";",
    "ox-ternary-chain-test.js": () => "a = " + rep("(", n) + "b" + seq(n, i => ` ? 1 : 0)`) + ";",
    "ox-ternaries.js": () =>
      rep("a = b ? c ? 1 : 2 : 3; d = !e ? 1 : 2; f = g ? g : h; i = j ? true : false; k = l > m ? l : m;\n", n),
    "ox-if-ternary.js": () =>
      "function f(a) {\n" +
      rep("if (a) { b = 1; } else { b = 2; }\nif (a) { return 1; } else { return 2; }\n", n) +
      "}",
    "ox-if-negated.js": () => rep("if (!a) { b(); } else { c(); }\nif (a !== b) { c(); } else { d(); }\n", n),
    "ox-if-lonely.js": () => rep("if (a) { if (b) { c(); } }\nif (a) { d(); } else { if (b) { c(); } }\n", n),
    "ox-if-else-if-shared.js": () =>
      seq(n, i => `if (a === ${i}) { b(); c(${i}); d(); }`, " else ") + " else { b(); d(); }",
    "ox-if-else-shared-bodies.js": () =>
      "if (a) {\n" + rep("b();\n", n) + "c();\n} else {\n" + rep("b();\n", n) + "d();\n}",
    "ox-if-else-shared-ends.js": () =>
      "if (a) {\nc();\n" + rep("b();\n", n) + "} else {\nd();\n" + rep("b();\n", n) + "}",
    "ox-if-else-shared.js": () => rep("if (a) { b(); c(); } else { b(); d(); }\n", n),
    "ox-if-else-shared-locals.js": () =>
      "if (a) {\n" +
      seq(n, i => `let b${i} = 1;\n`) +
      "c(b0);\n} else {\n" +
      seq(n, i => `let b${i} = 2;\n`) +
      "c(b0);\n}",
    "ox-if-else-shared-big-statement.js": () =>
      "if (a) { b(" + rep("c, ", n) + "d); e(); } else { b(" + rep("c, ", n) + "d); f(); }",
    "ox-compare-and-chain.js": () => "a = " + seq(n, i => `b < ${i}`, " && ") + ";",
    "ox-compare-and-chain-same.js": () => "a = " + rep("b < 1 && ", n) + "b < 1;",
    "ox-compare-and-chain-alternating.js": () => "a = " + rep("b > 0 && b < 1 && ", n) + "c;",
    "ox-compare-and-chain-different.js": () => "a = " + seq(n, i => `b${i} < ${i}`, " && ") + ";",
    "ox-compare-and-chain-right.js": () => "a = " + seq(n, i => `b < ${i} && (`) + "c" + rep(")", n) + ";",
    "ox-compare-or-chain.js": () => "a = " + rep("b == c || b < c || ", n) + "d;",
    "ox-compare-or-chain-same.js": () => "a = " + rep("b || ", n) + "b;",
    "ox-compare-or-chain-big-operands.js": () => "a = " + rep("(b + c * d - e.f.g(h)) || ", n) + "i;",
    "ox-compare-sequence.js": () => "a = b" + rep(" === c", n) + ";",
    "ox-compare-sequence-lt.js": () => "a = b" + rep(" < c", n) + ";",
    "ox-compares.js": () =>
      rep(
        "a = b < 1 && b < 2; c = d == e || d < e; f = g === g; h = i == j == k; l = [] == m; n = o.length === 0 || o.p; q = !r === s; t = u * 0; v = w & 0; x |= 'y';\n",
        n,
      ),
    "ox-plus-chain-same.js": () => "a += a" + rep(" + a", n) + ";",
    "ox-bitor-chain.js": () => "a = b" + rep(" | c", n) + "; d |= e" + rep(' + "f"', n) + ";",
    "ox-min-max.js": () =>
      rep("Math.min(Math.max(a, 1), 2); Math.max(Math.min(a, 2), 1); Math.min(1, Math.max(2, a));\n", n),
    "ox-min-max-arguments.js": () => "Math.min(" + rep("Math.max(a, 1), ", n) + "2);",
    "ox-pushes.js": () => rep("a.push(1);\n", n),
    "ox-pushes-many.js": () =>
      seq(
        n,
        i =>
          `a${i}.push(1);\na${i}.push(2);\nb.classList.add("c");\nb.classList.add("d");\nimportScripts("e");\nimportScripts("f");\n`,
      ),
    "ox-pushes-member.js": () => rep("a.b.c.d.push(1);\n", n),
    "ox-pushes-long-member.js": () => rep("a" + rep(".b", 200) + ".push(1);\n", Math.ceil(n / 100)),
    "ox-immediate-mutations.js": () =>
      seq(
        n,
        i =>
          `const a${i} = [];\na${i}.push(1);\nconst b${i} = {};\nb${i}.c = 1;\nconst d${i} = new Set();\nd${i}.add(1);\nconst e${i} = new Map();\ne${i}.set(1, 2);\n`,
      ),
    "ox-immediate-mutation-big-value.js": () =>
      "const a = [];\na.push(" +
      seq(n, i => `b${i}`, ", ") +
      ");\nconst c = {};\nc.d = [" +
      seq(n, i => `b${i}`, ", ") +
      "];",
    "ox-includes-same-array.js": () => "const a = [1, 2, 3];\n" + rep("a.includes(b);\n", n),
    "ox-includes-arrays.js": () => seq(n, i => `const a${i} = [1, 2, 3];\nfor (const b of c) a${i}.includes(b);\n`),
    "ox-array-holes.js": () => "const [" + rep(",", n) + "a] = b;\n[" + rep(",", n) + "c] = d;",
    "ox-array-spreads.js": () =>
      rep(
        "a = [...[1, 2]]; b = { ...{ c: 1 } }; d(...[e]); f = [...g.map(h)]; new Set([...i]); j = [...new Set(k)].length;\n",
        n,
      ),
    "ox-array-spread-elements.js": () => "a = [" + rep("...[1], ", n) + "];",
    "ox-array-callbacks.js": () =>
      rep(
        "a.map(b); a.forEach(c => d(c)); a.filter(e).length; a.find(f) !== undefined; a.findIndex(g => g === 1); a.some(h => h === 1); a.reduce(i); a.flatMap(j => j); a.sort(); a.reverse(); a.indexOf(k) !== -1; a.flat(1); a.join(); a.at(-1); a[a.length - 1]; a.slice(-1)[0];\n",
        n,
      ),
    "ox-array-news.js": () =>
      rep(
        "new Array(1); Array(2); new Array(3).map(a => a); new Array(b).fill(0); Array.from({ length: 1 }); Array.from(c); new Buffer(1); Date(); new Date(new Date()); new Error(); new TypeError;\n",
        n,
      ),
    "ox-arguments-undefined.js": () => "a(" + rep("undefined, ", n) + "undefined);",
    "ox-undefineds.js": () =>
      "function f(a = undefined) {\n" +
      rep("let b = undefined; c(undefined); d = () => undefined; e(1, undefined, undefined);\n", n) +
      "return undefined; }",
    "ox-arguments-object.js": () =>
      "function f() {\n" +
      rep(
        "arguments.map(a); arguments.slice(1); Array.prototype.slice.call(arguments); [].slice.call(arguments);\n",
        n,
      ) +
      "}",
    "ox-catches.js": () =>
      rep("try { a(); } catch (b) { c(b); }\nd.catch(e => f(e));\ng.then(undefined, h => h);\n", n),
    "ox-catches-names-taken.js": () =>
      "function f() {\n" +
      seq(n, i => `const error${i === 0 ? "" : "_" + i} = 1;\n`) +
      rep("try { a(); } catch (b) { c(b); }\n", n) +
      "}",
    "ox-catches-underscores-taken.js": () =>
      "function f() {\n" +
      seq(Math.min(n, 2000), i => `const error${"_".repeat(i)} = 1;\n`) +
      "try { a(); } catch (b) { c(b" +
      seq(Math.min(n, 2000), i => `, error${"_".repeat(i)}`) +
      "); }\n}",
    "ox-catch-uses.js": () => "try { a(); } catch (b) {\n" + rep("c(b);\n", n) + "}",
    "ox-functions-scoping.js": () =>
      "function f(a) {\n" + seq(n, i => `function g${i}(b) { return b; }\nconst h${i} = c => c;\n`) + "}",
    "ox-functions-scoping-uses.js": () =>
      "function f(a) {\n" + seq(n, i => `function g${i}(b) { return a + b; }\n`) + "}",
    "ox-functions-scoping-many-references.js": () =>
      "function f(a) {\nfunction g(b) {\n" + rep("b; c; d;\n", n) + "}\n}",
    "ox-functions-scoping-this.js": () =>
      "function f(a) {\n" + rep("const g = () => this; const h = () => arguments;\n", n) + "}",
    "ox-functions-recursion.js": () => seq(n, i => `function f${i}(a, b) { return f${i}(a, b + 1); }\n`),
    "ox-function-recursion-params.js": () =>
      "function f(" + seq(n, i => `a${i}`, ", ") + ") { return f(" + seq(n, i => `a${i}`, ", ") + "); }",
    "ox-function-recursion-calls.js": () => "function f(a, b) {\n" + rep("f(a, b);\n", n) + "}",
    "ox-function-recursion-calls-outside.js": () => "function f(a, b) { f(a, b); }\n" + rep("f(1, 2);\n", n),
    "ox-function-recursion-props.jsx": () =>
      "function F({ " + seq(n, i => `a${i}`, ", ") + " }) { return <F " + seq(n, i => `a${i}={a${i}}`, " ") + " />; }",
    "ox-function-default-params.js": () =>
      seq(n, i => `function f${i}(a) { a = a || 1; }\nfunction g${i}(a) { const b = a || 1; }\n`),
    "ox-function-default-param-uses.js": () => "function f(a) {\nconst b = a || 1;\n" + rep("a;\n", n) + "}",
    "ox-function-exported-this.js": () =>
      seq(n, i => `export function f${i}() { return this.a; }\nfunction g${i}() { this.b; }\nexport { g${i} };\n`),
    "ox-function-exported-this-uses.js": () => "export function f() {\n" + rep("this.a;\n", n) + "}",
    "ox-function-exported-often.js": () => "function f() { this.a; }\n" + seq(n, i => `export { f as g${i} };\n`),
    "ox-map-spreads.js": () => rep("a.map(b => ({ ...b, c: 1 }));\na.flatMap(b => [...b, 1]);\n", n),
    "ox-map-spread-chain.js": () => "a" + rep(".map(b => ({ ...b, c: 1 }))", n) + ";",
    "ox-map-spread-member-chain.js": () =>
      rep("a" + rep(".b", 200) + ".map(c => ({ ...c, d: 1 }));\n", Math.ceil(n / 100)),
    "ox-map-spread-returns.js": () => "a.map(b => {\n" + rep("if (b) return { ...b, c: 1 };\n", n) + "});",
    "ox-map-spread-variables.js": () =>
      "a.map(b => {\n" + seq(n, i => `const c${i} = { ...b };\n`) + "return " + seq(n, i => `c${i}`, " || ") + ";\n});",
    "ox-map-spread-variable-chain.js": () =>
      "a.map(b => {\nconst c0 = { ...b };\n" + seq(n, i => `const c${i + 1} = c${i};\n`) + `return c${n};\n});`,
    "ox-map-spread-variable-doubling.js": () =>
      "a.map(b => {\nconst c0 = { ...b };\n" +
      seq(n, i => `const c${i + 1} = c${i} || c${i};\n`) +
      `return c${n};\n});`,
    "ox-map-spread-rereads.js": () => "const a = [];\n" + rep("a.map(b => ({ ...b, c: 1 }));\n", n) + "a;",
    "ox-map-spread-properties.js": () => "a.map(b => ({ ...b,\n" + seq(n, i => `c${i}: ${i}, ...d${i},\n`) + "}));",
    "ox-reduce-spreads.js": () =>
      rep("a.reduce((b, c) => ({ ...b, c }), {});\na.reduce((b, c) => [...b, c], []);\n", n),
    "ox-loop-spreads.js": () => "let a = [];\nfor (const b of c) {\n" + rep("a = [...a, b];\n", n) + "}",
    "ox-endpoint-handlers.js": () =>
      rep('app.get("/a", async (req, res) => {});\nrouter.use(async function (req, res, next) {});\n', n),
    "ox-endpoint-handler-variables.js": () =>
      seq(n, i => `const h${i} = async (req, res) => {};\napp.get("/a", h${i});\n`),
    "ox-endpoint-handler-chain.js": () =>
      "const h0 = async (req, res) => {};\n" + seq(n, i => `const h${i + 1} = h${i};\n`) + `app.get("/a", h${n});`,
    "ox-endpoint-handler-chain-uses.js": () =>
      "const h0 = async (req, res) => {};\n" + seq(n, i => `const h${i + 1} = h${i};\napp.get("/a", h${i + 1});\n`),
    "ox-endpoint-handler-arguments.js": () => 'app.get("/a", ' + rep("async (req, res) => {}, ", n) + "b);",
    "ox-char-at.js": () => rep('a.charAt(0) === "bc"; "d"[0] == "ef"; var g = "h"; g.at(1) === "ij";\n', n),
    "ox-asyncs.js": () =>
      rep(
        "async function a() { await b; }\nconst c = async () => {};\nconst d = { async e() {} };\nclass F { async g() {} }\n",
        n,
      ),
    "ox-awaits-member.js": () =>
      "async function f() {\n" + rep("(await a).b; (await c)[0]; const d = (await e).g;\n", n) + "}",
    "ox-awaits-top-level.mjs": () =>
      rep("(async () => { await a; })();\nb().then(c => c);\nasync function d() {}\nd();\n", n),
    "ox-top-level-function-calls.mjs": () => "const a = async () => {};\n" + rep("a();\n", n),
    "ox-iifes.js": () => rep("(() => ({}))(); (function () {})(); (async () => {})(); const a = (() => 1)();\n", n),
    "ox-process-exits.js": () => rep("process.exit(1);\n", n),
    "ox-process-exits-in-listeners.js": () => rep('process.on("SIGINT", () => { process.exit(1); });\n', n),
    "ox-process-exits-in-listener.js": () => 'process.on("SIGINT", () => {\n' + rep("process.exit(1);\n", n) + "});",
    "ox-commonjs.js": () =>
      '"use strict";\n' +
      rep('var a = require("b"); module.exports = a; exports.c = 1; __dirname; __filename; require.resolve("d");\n', n),
    "ox-dom.js": () =>
      rep(
        'a.appendChild(b); a.removeChild(b); a.insertBefore(b, c); a.replaceChild(b, c); a.getAttribute("data-d"); a.setAttribute("data-e", 1); a.innerText; a.className = "f"; document.getElementById("g"); document.querySelector("#h"); a.onclick = i; a.addEventListener("keydown", j => j.keyCode); a.insertAdjacentElement("beforebegin", k); a.classList.contains("l") ? a.classList.remove("l") : a.classList.add("l");\n',
        n,
      ),
    "ox-key-codes.js": () =>
      'a.addEventListener("keydown", b => {\n' + rep("b.keyCode; b.which; var { charCode } = b;\n", n) + "});",
    "ox-globals.js": () =>
      rep(
        "window.a; self.b; global.c; globalThis.d; isNaN(e); parseInt(f); Number.parseFloat(g); typeof h === 'undefined'; i instanceof Array; j instanceof Error; structuredClone(k); JSON.parse(JSON.stringify(l));\n",
        n,
      ),
    "ox-coercions.js": () =>
      rep(
        "a.map(b => String(b)); a.filter(c => Boolean(c)); var d = e => Number(e); +f; `${g}`; !!h; i + ''; parseInt(j, 10); parseFloat(k);\n",
        n,
      ),
    "ox-urls.js": () =>
      rep('new URL("./a", b); new URL("c", d); new URL("../e", import.meta.url); new URL(`./f`, g);\n', n),
    "ox-url-long.js": () =>
      `new URL("./${rep("a/", n)}", b); new URL("${rep("a.", n)}", c); new URL("d", "http://${rep("a.", n)}b/");`,
    "ox-disable-comments.js": () =>
      rep(
        "// eslint-disable-next-line\na();\n/* eslint-disable */\n/* eslint-enable */\n// eslint-disable-line no-undef\n",
        n,
      ),
    "ox-empty-braces.js": () =>
      rep("a = {  }; function b() {  } class C {  } if (d) {  } try {  } catch {  } switch (e) {  }\n", n),
    "ox-empty-brace-long.js": () => "a = {" + rep(" ", n) + "}; function b() {" + rep("\n", n) + "}",
    "ox-empty-file-comments.js": () => rep("// a\n", n),
    "ox-empty-file-statements.js": () => rep(";{}\n", n) + '"use strict";',
    "ox-empty-file-directives.js": () => rep('"use strict";\n', n),
    "ox-import-styles.js": () =>
      seq(
        n,
        i =>
          `import a${i} from "node:util";\nimport { b${i} } from "path";\nimport * as c${i} from "chalk";\nimport d${i} from "fs/promises";\n`,
      ),
    "ox-import-attributes-empty.js": () =>
      seq(
        n,
        i =>
          `import a${i} from "./m${i}" with {};\nexport * from "./n${i}" with {};\nexport {} from "./o${i}";\nimport {} from "./p${i}";\n`,
      ),
    "ox-typeofs.js": () =>
      rep('typeof a === "undefined"; typeof b == "strnig"; typeof c === d; typeof e !== "object";\n', n),
    "ox-negations.js": () => rep("!a === b; !(c === d); !e in f; !g instanceof h; if (!(i && j)) {}\n", n),
    "ox-throws.js": () =>
      "function f() {\n" +
      rep(
        "if (a) throw new Error(); if (b) throw Error('c'); if (d) new Error('e'); if (g) throw new TypeError(1); if (h) throw new Error(`i`, { cause: j });\n",
        n,
      ) +
      "}",
    "ox-type-checks-then-throw.js": () =>
      "function f(a) {\n" +
      rep(
        "if (typeof a !== 'string') { throw new Error('b'); }\nif (!Array.isArray(a)) { throw new Error('c'); }\n",
        n,
      ) +
      "}",
    "ox-this-assignments.js": () => "function f() {\n" + rep("var a = this;  b = this; ({ c } = this);\n", n) + "}",
    "ox-for-loops.js": () =>
      rep("for (let i = 0; i < a.length; i++) { b(a[i]); }\nfor (const c in d) {}\na.forEach(e => { f(e); });\n", n),
    "ox-for-loop-uses.js": () => "for (let i = 0; i < a.length; i++) {\n" + rep("b(a[i]); c(i);\n", n) + "}",
    "ox-for-each-returns.js": () => "a.forEach(b => {\n" + rep("if (b) return;\n", n) + "});",
    "ox-destructurings.js": () =>
      rep("var { a } = b; var c = b.c; var [, , , d] = e; var f = e[0]; ({ g = undefined } = h);\n", n),
    "ox-destructuring-then-members.js": () => "const { a } = b;\n" + seq(n, i => `b.c${i};\n`),
    "ox-enums.ts": () => seq(n, i => `const enum A${i} { a = 1 }\nenum B${i} { b }\ndeclare const enum C${i} { c }\n`),
    "ox-enum-members.ts": () => "const enum A {\n" + seq(n, i => `a${i} = 3.14159,\n`) + "}",
    "ox-rest-spread.js": () =>
      rep("var { a, ...b } = c; d = { ...e }; ({ f, ...g } = h); function i({ ...j }) {}\n", n),
    "ox-optional-chains.js": () => rep("a?.b; c?.(); d?.[e]; f?.g.h?.i;\n", n),
    "ox-nested-calls-wide.js": () => rep("a(b(c(d(e(f(g()))))));\n", n),
    "ox-call-arguments-calls.js": () => "a(" + rep("b(c()), ", n) + "d);",
    "ox-bind-calls.js": () =>
      rep(
        "a(function () {}.bind(this)); b.call(c, d); e.apply(f, g); Reflect.apply(h, i, j); Function.prototype.call.call(k);\n",
        n,
      ),
    "ox-prototype-methods.js": () =>
      rep(
        "[].push.call(a, b); ({}).hasOwnProperty.call(c, d); Array.prototype.slice.apply(e); Object.prototype.toString.call(f); ''.trim.call(g);\n",
        n,
      ),
    "ox-dates.js": () =>
      rep("new Date().getTime(); +new Date(); Number(new Date()); new Date(a.getTime()); Date.now();\n", n),
    "ox-sets.js": () =>
      rep(
        "new Set(a).size; [...new Set(b)].length; Array.from(new Set(c)).length; new Set([]); new Map(null); new WeakSet(undefined);\n",
        n,
      ),
    "ox-math.js": () =>
      rep(
        "a ** 0.5; Math.sqrt(b * b + c * c); Math.log(d) * Math.LOG10E; e | 0; ~~f; g >> 0; Math.abs(h - i) ; j < 0 ? -j : j;\n",
        n,
      ),
    "ox-blobs.js": () => rep("new Response(a).text(); new FileReader().readAsText(b); c.readAsArrayBuffer(d);\n", n),
    "ox-labels-and-blocks.js": () => rep("a: { break a; }\n{ { b(); } }\n", n),
    "ox-barrel.js": () => seq(n, i => `export * from "./ox-barrel";\nexport * as a${i} from "./ox-barrel";\n`),

    // ── node ──
    "ox-node-env.js": () => seq(n, i => `process.env.A${i}; process.env["B${i}"]; const { C${i} } = process.env;\n`),
    "ox-node-exports.js": () => rep("exports = {}; module.exports = exports = {}; exports = module.exports = {};\n", n),
    "ox-node-new-require.js": () => rep('new require("a"); new (require("b"))(); new require("c").d();\n', n),
    "ox-node-path-concat.js": () => rep('__dirname + "/a"; __filename + b; `${__dirname}/c`; d + __dirname;\n', n),
    "ox-node-path-concat-chain.js": () => "__dirname" + rep(' + "/a"', n) + ";",
    "ox-node-path-concat-template.js": () => "`" + rep("${__dirname}/a", n) + "`;",
    "ox-node-callbacks.js": () => rep("function a(err, b) {}\nc(function (err) {});\nd((error, e) => { f(e); });\n", n),
    "ox-node-callback-uses.js": () => "function a(err) {\n" + rep("b(err);\n", n) + "}",
    "ox-node-globals.js": () =>
      rep(
        'Buffer.from("a"); new URL("b"); process.nextTick(c); console.log(d); new TextEncoder(); setImmediate(e); require("buffer").Buffer;\n',
        n,
      ),
    "ox-node-process-exit-as-throw.js": () => "function f(a) {\n" + rep("if (a) { process.exit(1); }\n", n) + "}",
    "ox-node-hashbang.js": () => "#!/usr/bin/env node" + rep(" a", n) + "\nb();",

    // ── vue ──
    "ox-vue-props.vue": () =>
      options(
        "props: {\n" +
          seq(
            n,
            i =>
              `a${i}: { type: String, default: "" },\n"b-${i}": Boolean,\nc${i}: { type: Object, default: {} },\nd${i}: null,\n`,
          ) +
          "},",
      ),
    "ox-vue-props-array.vue": () => options("props: [\n" + seq(n, i => `"a${i}",\n`) + "],"),
    "ox-vue-data.vue": () => options("data() {\nreturn {\n" + seq(n, i => `a${i}: ${i},\n`) + "};\n},"),
    "ox-vue-data-object.vue": () => options("data: {\n" + seq(n, i => `a${i}: ${i},\n`) + "},"),
    "ox-vue-computed.vue": () =>
      options(
        "computed: {\n" +
          seq(
            n,
            i =>
              `a${i}() { this.b = 1; return this.c${i}; },\nd${i}: { get() {}, set(v) {} },\ne${i}: async function () { await f; },\n`,
          ) +
          "},",
      ),
    "ox-vue-computed-branches.vue": () => options("computed: {\na() {\n" + rep("if (this.b) { c(); }\n", n) + "},\n},"),
    "ox-vue-methods.vue": () =>
      options(
        "methods: {\n" +
          seq(
            n,
            i => `a${i}() { this.$emit("b${i}"); this.$nextTick(() => {}); return this.c; },\nd${i}: () => this.e,\n`,
          ) +
          "},",
      ),
    "ox-vue-watch.vue": () =>
      options(
        "watch: {\n" + seq(n, i => `a${i}() {},\n"b.c${i}": () => {},\nd${i}: { handler() {}, deep: true },\n`) + "},",
      ),
    "ox-vue-emits.vue": () =>
      options(
        "emits: [\n" +
          seq(n, i => `"a${i}",\n`) +
          "],\nmethods: {\nb() {\n" +
          seq(n, i => `this.$emit("a${i}");\nthis.$emit("c${i}");\n`) +
          "},\n},",
      ),
    "ox-vue-emits-object.vue": () =>
      options("emits: {\n" + seq(n, i => `a${i}: null,\nb${i}() {},\nc${i}: v => { if (v) return true; },\n`) + "},"),
    "ox-vue-same-keys.vue": () =>
      options(
        "props: [" +
          seq(n, i => `"a${i}"`, ", ") +
          "],\ndata() { return {\n" +
          seq(n, i => `a${i}: 1,\n`) +
          "}; },\ncomputed: {\n" +
          seq(n, i => `a${i}() { return 1; },\n`) +
          "},\nmethods: {\n" +
          seq(n, i => `a${i}() {},\n`) +
          "},",
      ),
    "ox-vue-reserved-keys.vue": () =>
      options("data() { return {\n" + seq(n, i => `$a${i}: 1,\n_b${i}: 2,\n`) + "$el: 1 }; },"),
    "ox-vue-lifecycle.vue": () =>
      options(
        rep(
          "created() { this.a = 1; },\nasync mounted() { await b; },\nbeforeDestroy() {},\ndestroyed: () => {},\n",
          n,
        ),
      ),
    "ox-vue-options-order.vue": () =>
      options(seq(n, i => `a${i}: 1,\n`) + 'name: "b",\ndata() { return {}; },\nprops: {},'),
    "ox-vue-this-uses.vue": () =>
      options(
        "methods: {\na() {\n" +
          seq(n, i => `this.b${i}; this.$refs.c${i}; this.$slots.d; this.$listeners; this.$children;\n`) +
          "},\n},",
      ),
    "ox-vue-components.vue": () => options("components: {\n" + seq(n, i => `A${i},\n"b-${i}": B${i},\n`) + "},"),
    "ox-vue-setup-props.vue": () =>
      vue(
        "const props = defineProps({\n" +
          seq(n, i => `a${i}: { type: String, required: false },\nb${i}: Boolean,\n`) +
          "});",
        " setup",
      ),
    "ox-vue-setup-props-type.vue": () =>
      vue(
        "const props = defineProps<{\n" + seq(n, i => `a${i}: string;\nb${i}?: boolean;\n`) + "}>();",
        ' setup lang="ts"',
      ),
    "ox-vue-setup-props-defaults.vue": () =>
      vue(
        "const props = withDefaults(defineProps<{\n" +
          seq(n, i => `a${i}?: string;\n`) +
          "}>(), {\n" +
          seq(n, i => `a${i}: "b",\n`) +
          "});",
        ' setup lang="ts"',
      ),
    "ox-vue-setup-props-interface.vue": () =>
      vue(
        "interface A {\n" + seq(n, i => `a${i}?: string;\n`) + "}\nconst props = defineProps<A>();",
        ' setup lang="ts"',
      ),
    "ox-vue-setup-props-destructured.vue": () =>
      vue(
        "const {\n" +
          seq(n, i => `a${i} = ${i},\n`) +
          "} = defineProps<{\n" +
          seq(n, i => `a${i}?: number;\n`) +
          "}>();\n" +
          seq(n, i => `watch(a${i}, () => {});\n`),
        ' setup lang="ts"',
      ),
    "ox-vue-setup-props-uses.vue": () =>
      vue("const props = defineProps(['a']);\n" + rep("props.a = 1; props.a.b++; var { a } = props;\n", n), " setup"),
    "ox-vue-setup-emits.vue": () =>
      vue(
        "const emit = defineEmits([\n" +
          seq(n, i => `"a${i}",\n`) +
          "]);\n" +
          seq(n, i => `emit("a${i}"); emit("b${i}");\n`),
        " setup",
      ),
    "ox-vue-setup-emits-type.vue": () =>
      vue(
        "const emit = defineEmits<{\n" + seq(n, i => `(e: "a${i}", v: number): void;\n`) + "}>();",
        ' setup lang="ts"',
      ),
    "ox-vue-setup-emits-type-object.vue": () =>
      vue("const emit = defineEmits<{\n" + seq(n, i => `a${i}: [v: number];\n`) + "}>();", ' setup lang="ts"'),
    "ox-vue-setup-macros.vue": () =>
      vue(
        rep(
          "defineProps({}); defineEmits([]); defineExpose({}); defineOptions({ name: 'a' }); defineSlots(); defineModel();\n",
          n,
        ),
        " setup",
      ),
    "ox-vue-setup-refs.vue": () =>
      vue(
        'import { ref, reactive, computed, watch } from "vue";\n' +
          seq(
            n,
            i =>
              `const a${i} = ref(0);\na${i} + 1; a${i}++; if (a${i}) {}\nconst b${i} = reactive({});\nconst { c${i} } = b${i};\nconst d${i} = computed(() => { a${i}.value = 1; return 2; });\nwatch(a${i}.value, () => {});\n`,
          ),
        " setup",
      ),
    "ox-vue-setup-ref-uses.vue": () =>
      vue('import { ref } from "vue";\nconst a = ref(0);\n' + rep("a + 1; a.value; b(a);\n", n), " setup"),
    "ox-vue-setup-imports.vue": () =>
      vue(
        seq(
          n,
          i =>
            `import A${i} from "./A${i}.vue";\nimport { b${i} } from "vue";\nimport { defineProps as c${i} } from "vue";\n`,
        ),
        " setup",
      ),
    "ox-vue-setup-exports.vue": () =>
      vue(
        seq(n, i => `export const a${i} = 1;\n`),
        " setup",
      ),
    "ox-vue-setup-lifecycle-after-await.vue": () =>
      vue(
        'import { onMounted, watch } from "vue";\nawait a;\n' + rep("onMounted(() => {}); watch(b, () => {});\n", n),
        " setup",
      ),
    "ox-vue-setup-function.vue": () =>
      vue(
        'import { onMounted, ref } from "vue";\nexport default {\nasync setup(props, { emit }) {\n' +
          rep("await a; onMounted(() => {}); var { b } = props; emit('c');\n", n) +
          "return {};\n},\n};",
      ),
    "ox-vue-define-components.js": () =>
      'import { defineComponent } from "vue";\n' +
      rep(
        "defineComponent({ data: {}, props: ['a'], computed: { b() {} } });\nVue.component('c', { data: {} });\nnew Vue({ data: {} });\n",
        n,
      ),
    "ox-vue-template-elements.vue": () =>
      "<template>\n<div>\n" +
      seq(n, i => `<a :b${i}="c" @d="e" v-if="f">{{ g${i} }}</a>\n`) +
      "</div>\n</template>\n<script>\nexport default {};\n</script>\n",
    "ox-vue-scripts.vue": () => rep("<script>\nexport default {};\n</script>\n", Math.min(n, 1000)),
    "ox-vue-custom-blocks.vue": () => rep("<i18n>\n{}\n</i18n>\n", n) + "<script>\nexport default {};\n</script>\n",
    "ox-vue-script-attributes.vue": () =>
      "<script " + seq(n, i => `a${i}="b"`, " ") + " setup>\ndefineProps({});\n</script>\n",
  };
  // `const b = a, c = b ..`, each of which is used in all the ways in which a rule looks for the value of a variable.
  for (const [name, value] of Object.entries(aliased)) {
    const uses = (a: string) =>
      `use(${a}); ${a}.then(b => b); ${a}.includes(1); ${a}.slice(); ${a}.concat(1); c.replaceAll(${a}, ""); c.matchAll(${a}); ` +
      `fetch(d, ${a}); new Request(d, ${a}); new Set(${a}); [...${a}]; ({ ...${a} }); ${a}.length; ${a}(); new ${a}(); ` +
      `app.get("/", ${a}); e(<A b={${a}} style={${a}} key={${a}} {...${a}} />); ${a}.charAt(0) === "bc"; ${a}.at(0) === "bc"; ` +
      `${a}[0] === "bc"; typeof ${a} === "x"; f.addEventListener("x", ${a}); f.removeEventListener("x", ${a}); ` +
      `${a}.map(g => ({ ...g })); new URL(${a}, h); new RegExp(${a}, ${a}); JSON.parse(${a}); Object.assign(${a}, ${a}); ` +
      `expect(${a}).toBe(${a}); jest.mock(${a}, ${a}); it(${a}, ${a}); require(${a}); import(${a}); throw0(${a});\n`;
    const chain = () =>
      `function App(p) {\nconst a0 = ${value};\n` + seq(n, i => `const a${i + 1} = a${i};\n${uses(`a${i + 1}`)}`) + "}";
    shapes[`ox-alias-chain-${name}.jsx`] = chain;
    shapes[`ox-alias-chain-${name}.test.jsx`] = chain;
  }
  return lazily(shapes);
}

export function deep(n: number): Record<string, string> {
  const nest = (open: string, inner: string, close: string) => rep(open, n) + inner + rep(close, n);
  // n deep, with 20 n of something at the bottom, each of which may look for what is around it.
  const under = (open: string, leaf: string, close: string) => rep(open, n) + rep(leaf, 20 * n) + rep(close, n);
  return lazily({
    // ── JSX ──
    "ox-deep-jsx-labels.jsx": () => component(nest("<label>", "<input />", "</label>")),
    "ox-deep-jsx-label-spans.jsx": () => component("<label>" + nest("<span>", "a", "</span>") + "</label>"),
    "ox-deep-jsx-label-spans-empty.jsx": () => component("<label>" + nest("<span>", "", "</span>") + "</label>"),
    "ox-deep-jsx-anchors.jsx": () => component(nest('<a href="#" onClick={a}>', "b", "</a>")),
    "ox-deep-jsx-anchor-content.jsx": () => component('<a href="/a">' + nest("<span>", "", "</span>") + "</a>"),
    "ox-deep-jsx-headings.jsx": () => component(nest("<h1>", "", "</h1>")),
    "ox-deep-jsx-interactive.jsx": () => component(nest('<div role="button" onClick={a}>', "<button />", "</div>")),
    "ox-deep-jsx-hidden.jsx": () => component(nest('<div aria-hidden="true">', "<input />", "</div>")),
    "ox-deep-jsx-fragments-keyed.jsx": () => component(nest("<React.Fragment key='a'>", "<i />", "</React.Fragment>")),
    "ox-deep-jsx-maps.jsx": () =>
      component("<div>" + nest("{a.map((b, i) => <div key={i}>", "c", "</div>)}") + "</div>"),
    "ox-deep-jsx-props.jsx": () => component(nest("<A b={", "<i />", "} />")),
    "ox-deep-jsx-prop-objects.jsx": () => component("<A b={" + nest("{ c: ", "1", " }") + "} />"),
    "ox-deep-jsx-prop-functions.jsx": () => component("<A b={" + nest("() => ", "1", "") + "} />"),
    "ox-deep-jsx-and.jsx": () => component("<div>" + nest("{a && <div>", "b", "</div>}") + "</div>"),
    "ox-deep-jsx-components.jsx": () => nest("function A() { return <div onClick={() => {}} />;\n", "", "}\n"),
    "ox-deep-jsx-under-elements.jsx": () =>
      component(under("<div>", '<img src="a" onClick={() => {}} /><a href="#" />', "</div>")),
    "ox-deep-jsx-under-labels.jsx": () => component(under("<label>", "<input />", "</label>")),
    "ox-deep-jsx-under-maps.jsx": () =>
      component("<div>" + under("{a.map((b, i) => <div>", "<i key={i} />", "</div>)}") + "</div>"),
    "ox-deep-jsx-under-functions.jsx": () =>
      "function App() {\n" + under("a(() => {\n", "b(<A c={{}} d={() => {}} />);\n", "});\n") + "}",
    "ox-deep-react-classes.jsx": () =>
      nest("class A extends React.Component { render() { this.state.a = 1;\n", "", "return <div />; } }\n"),
    "ox-deep-react-under-callbacks.jsx": () =>
      "class A extends React.Component { componentDidMount() {\n" +
      under("a(() => {\n", "this.setState({}); this.state.b = 1; this.refs.c;\n", "});\n") +
      "} render() { return <div />; } }",

    // ── jest, vitest ──
    "ox-deep-jest-describes.test.js": () =>
      nest('describe("a", () => {\n', 'it("b", () => { expect(1).toBe(1); });\n', "});\n"),
    "ox-deep-jest-describes-hooks.test.js": () =>
      nest('describe("a", () => {\nbeforeEach(() => {});\nbeforeEach(() => {});\nit("b", () => {});\n', "", "});\n"),
    "ox-deep-jest-its.test.js": () => nest('it("a", () => {\n', "expect(1).toBe(1);\n", "});\n"),
    "ox-deep-jest-callbacks.test.js": () => test(nest("a(() => {\n", "expect(1).toBe(1);\n", "});\n")),
    "ox-deep-jest-ifs.test.js": () => test(nest("if (a) {\n", "expect(1).toBe(1);\n", "}\n")),
    "ox-deep-jest-thens.test.js": () => test(nest("a.then(() => {\n", "expect(1).toBe(1);\n", "});\n")),
    "ox-deep-jest-thens-returned.test.js": () =>
      test("return " + nest("a.then(() => { return ", "expect(1).toBe(1)", "; })") + ";"),
    "ox-deep-jest-expect-arguments.test.js": () => test(nest("expect(", "a", ").toBe(1)") + ";"),
    "ox-deep-jest-matcher-arguments.test.js": () => test(nest("expect(a).toBe(", "1", ")") + ";"),
    "ox-deep-jest-expect-objects.test.js": () =>
      test("expect(a).toEqual(" + nest("expect.objectContaining({ a: ", "1", " })") + ");"),
    "ox-deep-jest-mock-returns.test.js": () => nest("a.mockImplementation(() => ", "1", ")") + ";",
    "ox-deep-jest-mock-factories.test.js": () => nest('jest.mock("a", () => { ', "", " });"),
    "ox-deep-jest-functions.test.js": () => test(nest("function f() {\n", "expect(1).toBe(1);\n", "}\n")),
    "ox-deep-jest-awaits.test.js": () => test(nest("await (", "expect(a).resolves.toBe(1)", ")") + ";"),
    "ox-deep-jest-promise-alls.test.js": () =>
      test("await " + nest("Promise.all([", "expect(a).resolves.toBe(1)", "])") + ";"),
    "ox-deep-jest-under-describes.test.js": () =>
      under('describe("a", () => {\n', 'it("b", () => { expect(1).toBe(1); });\nbeforeEach(() => {});\n', "});\n"),
    "ox-deep-jest-under-describes-titles.test.js": () =>
      rep('describe("a", () => {\n', n) + seq(20 * n, i => `it("b${i}", () => {});\n`) + rep("});\n", n),
    "ox-deep-jest-under-callbacks.test.js": () => test(under("a(() => {\n", "expect(1).toBe(1);\n", "});\n")),
    "ox-deep-jest-under-callbacks-no-test.test.js": () => under("a(() => {\n", "expect(1).toBe(1);\n", "});\n"),
    "ox-deep-jest-under-ifs.test.js": () => test(under("if (a) {\n", "expect(1).toBe(1);\n", "}\n")),
    "ox-deep-jest-under-blocks.test.js": () =>
      test(under("{\n", "expect(1).toBe(1); jest.setTimeout(1); vi.mock('a');\n", "}\n")),
    "ox-deep-jest-under-thens.test.js": () => test(under("a.then(() => {\n", "expect(1).toBe(1);\n", "});\n")),
    "ox-deep-jest-under-arguments.test.js": () =>
      test(rep("a(", n) + rep("expect(1).toBe(1), ", 20 * n) + "b" + rep(")", n) + ";"),

    // ── jsdoc ──
    "ox-deep-jsdoc-types.js": () => "/**\n * @param {" + nest("Array<", "a", ">") + "} b c\n */\nfunction f(b) {}",
    "ox-deep-jsdoc-type-braces.js": () => "/**\n * @param {" + nest("{a: ", "b", "}") + "} c d\n */\nfunction f(c) {}",
    "ox-deep-jsdoc-name-brackets.js": () => "/**\n * @param {a} " + nest("[", "b", "]") + " c\n */\nfunction f(b) {}",
    "ox-deep-jsdoc-inline-tags.js": () => "/**\n * " + nest("{@link ", "a", "}") + "\n */\nfunction f() {}",
    "ox-deep-jsdoc-functions.js": () =>
      nest("/**\n * @param a\n * @returns {b}\n */\nfunction f(a, c) {\n", "return 1;\n", "}\n"),
    "ox-deep-jsdoc-returns-blocks.js": () =>
      "/** */\nfunction f() {\n" + nest("if (a) {\n", "return 1;\n", "}\n") + "}",
    "ox-deep-jsdoc-returns-functions.js": () =>
      "/** @returns {a} */\nfunction f() {\n" + nest("b(() => {\n", "return 1;\n", "});\n") + "}",
    "ox-deep-jsdoc-returns-each.js": () => nest("/** */\nfunction f() {\nif (a) return 1;\n", "", "}\n"),
    "ox-deep-jsdoc-param-patterns.js": () => "/**\n * @param a\n */\nfunction f(" + nest("{ b: ", "c", " }") + ") {}",
    "ox-deep-jsdoc-param-arrays.js": () => "/**\n * @param a\n */\nfunction f(" + nest("[", "c", "]") + ") {}",
    "ox-deep-jsdoc-classes.js": () => nest("/** */\nclass A {\n/** @param a */\nm(b) {\n", "", "}\n}\n"),
    "ox-deep-jsdoc-under-functions.js": () =>
      under("function f() {\n", "/** @param a */\nfunction g(b) { return 1; }\n", "}\n"),
    "ox-deep-jsdoc-returns-under-blocks.js": () =>
      "/** */\nfunction f() {\n" + under("{\n", "if (a) return 1;\n", "}\n") + "}",

    // ── promise ──
    "ox-deep-promise-thens.js": () => nest("a.then(b => {\n", "c();\n", "});\n"),
    "ox-deep-promise-thens-arrow.js": () => nest("a.then(b => ", "c", ")") + ";",
    "ox-deep-promise-thens-returned.js": () => nest("a.then(b => { return ", "c", "; })") + ";",
    "ox-deep-promise-thens-using.js": () =>
      seq(n, i => `a.then(b${i} => `) + seq(n, i => `b${i}`, " + ") + rep(")", n) + ";",
    "ox-deep-promise-catches.js": () => nest("a.catch(b => {\n", "c();\n", "}).finally(() => { return 1; });\n"),
    "ox-deep-promise-executors.js": () =>
      nest("new Promise((resolve, reject) => {\n", "resolve(1);\n", "resolve(2);\n});\n"),
    "ox-deep-promise-executors-arrow.js": () => nest("new Promise(resolve => resolve(", "1", "))") + ";",
    "ox-deep-promise-executor-ifs.js": () => executor(nest("if (a) {\nresolve(1);\n", "", "}\n") + "resolve(2);"),
    "ox-deep-promise-executor-if-else.js": () =>
      executor(nest("if (a) { resolve(1); } else {\n", "reject(2);\n", "}\n")),
    "ox-deep-promise-executor-tries.js": () =>
      executor(nest("try {\na();\n", "resolve(1);\n", "} catch (e) { reject(e); }\n")),
    "ox-deep-promise-executor-try-finally.js": () =>
      executor(nest("try {\na();\n", "resolve(1);\n", "} finally { b(); }\n")),
    "ox-deep-promise-executor-catches.js": () => executor(nest("try { a(); } catch (e) {\n", "reject(e);\n", "}\n")),
    "ox-deep-promise-executor-loops.js": () =>
      executor(nest("for (const a of b) {\nif (c) break;\n", "resolve(1);\n", "}\n")),
    "ox-deep-promise-executor-whiles.js": () =>
      executor(nest("while (a) {\nif (c) continue;\n", "resolve(1);\n", "}\n")),
    "ox-deep-promise-executor-switches.js": () =>
      executor(nest("switch (a) {\ncase 1:\n", "resolve(1);\n", "break;\ndefault: b();\n}\n")),
    "ox-deep-promise-executor-labels.js": () =>
      executor(seq(n, i => `l${i}: {\nif (a) break l${i};\n`) + "resolve(1);\n" + rep("}\n", n) + "resolve(2);"),
    "ox-deep-promise-executor-labels-outer.js": () =>
      executor(seq(n, i => `l${i}: {\nif (a) break l0;\n`) + "resolve(1);\n" + rep("}\n", n) + "resolve(2);"),
    "ox-deep-promise-executor-callbacks.js": () =>
      executor(nest("a(err => {\nif (err) reject(err);\n", "resolve(1);\n", "});\n")),
    "ox-deep-promise-executor-logical.js": () => executor(nest("a && (", "resolve(1)", ")") + "; resolve(2);"),
    "ox-deep-promise-executor-conds.js": () => executor(nest("a ? (", "resolve(1)", ") : reject(2)") + ";"),
    "ox-deep-promise-then-ifs.js": () => then(nest("if (b) {\n", "return 1;\n", "}\n")),
    "ox-deep-promise-then-if-else.js": () => then(nest("if (b) { return 1; } else {\n", "c();\n", "}\n")),
    "ox-deep-promise-then-tries.js": () => then(nest("try {\n", "return 1;\n", "} catch (e) { c(); }\n")),
    "ox-deep-promise-then-loops.js": () => then(nest("for (;;) {\nif (b) break;\n", "return 1;\n", "}\n")),
    "ox-deep-promise-callbacks.js": () => nest("a((err, b) => {\n", "c.then(d => d);\ncb();\n", "});\n"),
    "ox-deep-promise-under-thens.js": () => under("a.then(b => {\n", "c.then(d => d); cb();\n", "});\n"),
    "ox-deep-promise-under-thens-using.js": () => under("a.then(b => {\n", "c.then(d => b);\n", "});\n"),
    "ox-deep-promise-under-callbacks.js": () => under("a((err, b) => {\n", "c.then(d => d);\n", "});\n"),
    "ox-deep-promise-under-functions.js": () => under("a(() => {\n", "c.then(d => d); cb(e => f);\n", "});\n"),
    "ox-deep-promise-under-awaits.js": () =>
      "async function f() {\n" + rep("await a(", n) + rep("c.then(d => d), ", 20 * n) + "e" + rep(")", n) + ";\n}",
    "ox-deep-promise-under-executors.js": () =>
      under("new Promise((resolve, reject) => {\n", "a(() => { b(); });\n", "resolve(1);\n});\n"),
    "ox-deep-promise-under-executors-resolving.js": () =>
      under("new Promise((resolve, reject) => {\n", "a(() => { resolve(1); });\n", "resolve(1);\n});\n"),
    "ox-deep-promise-executors-under-blocks.js": () =>
      under("{\n", "new Promise((resolve, reject) => { if (a) resolve(1); resolve(2); });\n", "}\n"),
    "ox-deep-promise-resolves-under-blocks.js": () => executor(under("{\n", "if (a) resolve(1);\n", "}\n")),
    "ox-deep-promise-resolves-under-ifs.js": () => executor(under("if (a) {\n", "resolve(1);\n", "}\n")),
    "ox-deep-promise-resolves-under-tries.js": () =>
      executor(under("try {\n", "a(); resolve(1);\n", "} catch (e) { reject(e); }\n")),
    "ox-deep-promise-resolves-under-loops.js": () => executor(under("for (;;) {\n", "if (a) resolve(1);\n", "}\n")),

    // ── unicorn, oxc, node, import ──
    "ox-deep-calls.js": () => nest("a(", "b", ")") + ";",
    "ox-deep-calls-member.js": () => nest("a.b(", "c", ")") + ";",
    "ox-deep-calls-second-argument.js": () => nest("a(b, ", "c", ")") + ";",
    "ox-deep-calls-callbacks.js": () => nest("a(() => ", "b", ")") + ";",
    "ox-deep-news.js": () => nest("new A(", "b", ")") + ";",
    "ox-deep-array-from.js": () => nest("Array.from(", "a", ")") + ";",
    "ox-deep-array-spreads.js": () => nest("[...", "a", "]") + ";",
    "ox-deep-array-concat.js": () => nest("[].concat(", "a", ")") + ";",
    "ox-deep-array-flat.js": () => nest("[", "a", "].flat()") + ";",
    "ox-deep-array-maps.js": () => nest("a.map(b => ", "({ ...b })", ")") + ";",
    "ox-deep-array-maps-blocks.js": () => nest("a.map(b => {\nreturn ", "{ ...b }", ";\n})") + ";",
    "ox-deep-array-for-each.js": () => nest("a.forEach(b => {\n", "c(b);\n", "});\n"),
    "ox-deep-array-reduce.js": () => nest("a.reduce((b, c) => ({ ...b, d: ", "1", " }), {})") + ";",
    "ox-deep-object-spreads.js": () => "a = " + nest("{ ...", "b", " }") + ";",
    "ox-deep-ternaries-parens.js": () => "a = " + nest("b ? (", "1", ") : 2") + ";",
    "ox-deep-ternaries-alternate.js": () => "a = " + nest("b ? 1 : (", "2", ")") + ";",
    "ox-deep-ternaries-test.js": () => "a = " + nest("(", "b", " ? 1 : 2)") + ";",
    "ox-deep-ternaries-negated.js": () => "a = " + nest("!b ? (", "1", ") : 2") + ";",
    "ox-deep-lonely-ifs.js": () => nest("if (a) {\n", "b();\n", "}\n"),
    "ox-deep-lonely-else-ifs.js": () => nest("if (a) { b(); } else {\n", "c();\n", "}\n"),
    "ox-deep-if-else-shared.js": () => nest("if (a) {\nb();\n", "", "c();\n} else {\nb();\nd();\n}\n"),
    "ox-deep-switches.js": () => nest("switch (a) {\ncase 1:\ncase 2: {\n", "b();\n", "}\ndefault:\n}\n"),
    "ox-deep-functions-scoping.js": () => nest("function f(a) {\n", "return a;\n", "}\n"),
    "ox-deep-arrows-scoping.js": () => "const f = " + nest("a => ", "b", "") + ";",
    "ox-deep-arrows-scoping-blocks.js": () => nest("const f = () => {\n", "", "};\n"),
    "ox-deep-functions-scoping-outer-use.js": () =>
      "function f(z) {\n" + nest("function g(a) {\n", "return z;\n", "}\n") + "}",
    "ox-deep-functions-recursion.js": () => nest("function f(a, b) {\nf(a, b);\n", "", "}\n"),
    "ox-deep-functions-this.js": () => "export function f() {\n" + nest("a(() => {\n", "this.b;\n", "});\n") + "}",
    "ox-deep-classes-static.js": () => nest("class A { static a = ", "1", "; }"),
    "ox-deep-classes-members.js": () => nest("class A { m() {\n", "", "} }\n"),
    "ox-deep-class-fields.js": () => nest("class A { constructor() { this.a = 1;\n", "", "} }\n"),
    "ox-deep-awaits.js": () => "async function f() { " + nest("(await ", "a", ").b") + "; }",
    "ox-deep-awaits-plain.js": () => "async function f() { " + rep("await ", n) + "a; }",
    "ox-deep-iifes.js": () => nest("(() => {\n", "", "})();\n"),
    "ox-deep-iifes-async.mjs": () => nest("(async () => {\nawait a;\n", "", "})();\n"),
    "ox-deep-nots.js": () => rep("!", n) + "a === b;",
    "ox-deep-negations.js": () => nest("!(", "a === b", ")") + ";",
    "ox-deep-typeofs.js": () => rep("typeof ", n) + 'a === "undefined";',
    "ox-deep-parens-compare.js": () => nest("(", "a", ")") + " === " + nest("(", "a", ")") + ";",
    "ox-deep-compare-and.js": () => "a = " + nest("b < 1 && (", "b < 2", ")") + ";",
    "ox-deep-compare-or.js": () => "a = " + nest("b == c || (", "b < c", ")") + ";",
    "ox-deep-same-expressions.js": () => "a = " + nest("-(", "b", ")") + " < " + nest("-(", "b", ")") + ";",
    "ox-deep-same-templates.js": () => "a = " + nest("`${", "b", "}`") + " === " + nest("`${", "b", "}`") + ";",
    "ox-deep-same-index.js": () => "a = " + nest("b[", "c", "]") + " || " + nest("b[", "c", "]") + ";",
    "ox-deep-templates.js": () => nest("`a${", "b", "}`") + ";",
    "ox-deep-templates-indented.js": () => nest("`\n    a\n    ${", "b", "}\n`") + ";",
    "ox-deep-tries.js": () => nest("try {\n", "a();\n", "} catch (b) { c(b); }\n"),
    "ox-deep-catches.js": () => nest("try { a(); } catch (b) {\n", "c(b);\n", "}\n"),
    "ox-deep-catches-named.js": () => nest("try { a(); } catch (error) {\n", "c(error);\n", "}\n"),
    "ox-deep-destructuring.js": () => "const " + nest("[, , , ", "a", "]") + " = b;",
    "ox-deep-default-parameters.js": () => nest("function f(a) {\na = a || 1;\n", "", "}\n"),
    "ox-deep-min-max.js": () => nest("Math.min(Math.max(", "a", ", 1), 2)") + ";",
    "ox-deep-path-concat.js": () => nest("(__dirname + ", '"a"', ")") + ";",
    "ox-deep-requires.js": () => nest("require(", '"a"', ")") + ";",
    "ox-deep-imports-dynamic.js": () => nest("import(", '"a"', ")") + ";",
    "ox-deep-namespaces.ts": () => nest("export namespace A {\nexport const a = 1;\n", "", "}\n"),
    "ox-deep-process-exit.js": () => nest("a(() => {\n", "process.exit(1);\n", "});\n"),
    "ox-deep-endpoint-handlers.js": () => nest('app.get("/a", async (req, res) => {\n', "", "});\n"),
    "ox-deep-undefined-arguments.js": () => nest("a(undefined, ", "undefined", ")") + ";",
    "ox-deep-bind.js": () => nest("a(function () {\n", "", "}.bind(this));\n"),
    "ox-deep-under-functions.js": () =>
      under("function f(a) {\n", "function g(b) { return b; }\nthis.c; process.exit(1); arguments.map(d);\n", "}\n"),
    "ox-deep-under-arrows.js": () =>
      "export function f() {\n" + under("a(() => {\n", "this.b; var c = d => d; e.forEach(g => g);\n", "});\n") + "}",
    "ox-deep-under-calls.js": () => rep("a(", n) + rep("b(c()), ", 20 * n) + "d" + rep(")", n) + ";",
    "ox-deep-under-ternaries.js": () =>
      "a = " + rep("b ? (", n) + rep("c ? 1 : 2, ", 20 * n) + "3" + rep(") : 4", n) + ";",
    "ox-deep-under-compare.js": () =>
      "a = " + rep("b === (", n) + rep("c === d === e, ", 20 * n) + "f" + rep(")", n) + ";",
    "ox-deep-under-loops.js": () =>
      "let a = [];\n" + under("for (const b of c) {\n", "a = [...a, b]; d.includes(b); await0(e);\n", "}\n"),
    "ox-deep-under-reduces.js": () => under("a.reduce((b, c) => {\n", "d({ ...b });\n", "}, {});\n"),
    "ox-deep-under-maps.js": () => under("a.map(b => {\n", "if (c) return { ...b };\n", "});\n"),
    "ox-deep-under-switches.js": () =>
      under("switch (a) {\ncase 1: {\n", "switch (b) { case 1: case 2: default: c(); }\n", "}\n}\n"),
    "ox-deep-under-tries.js": () => under("try {\n", "try { a(); } catch (b) { c(b); }\n", "} catch (d) {}\n"),
    "ox-deep-under-catches.js": () =>
      under("try { z(); } catch (error) {\n", "try { a(); } catch (b) { c(b); }\n", "}\n"),
    "ox-deep-script-under-blocks.js": () =>
      "try {} catch (e) {\n{ function f() {} }\n" + under("{\n", "var e; a = 1; f = 1;\n", "}\n") + "}\n",
    "ox-deep-script-under-catches.js": () =>
      "try {} catch (f) {\n" + under("try {} catch (e) {\n", "var f;\n", "}\n") + "}\n",
    "ox-deep-script-under-functions.js": () =>
      "{ function f() {} }\n" + under("(function () {\n", 'a = 1; f = 1; this.eval("b");\n', "})();\n"),
    "ox-deep-script-functions-in-blocks.js": () =>
      nest('function a() {\n{ function b() {} }\nb = 1; c = 1; this.eval("d");\n', "", "}\n"),
    "ox-deep-under-classes.js": () => under("class A { m() {\n", "class B { static c = 1; }\nthis.d;\n", "} }\n"),
    "ox-deep-loops-with-functions.js": () =>
      "let a; var b;\n" + nest("for (;;) { c(() => a + b);\n", "a = 1; b = 1;", "}\n"),
    "ox-deep-loop-called-functions.js": () =>
      "var a;\nfor (;;) {\n" + nest("(function () {\n", "a;", "})();\n") + "}\n",
    "ox-deep-loops-in-functions.js": () => "var a;\n" + nest("for (;;) { b(function () { a;\n", "a = 1;", "}); }\n"),
    "ox-deep-under-loops-functions.js": () =>
      "let a; var b;\n" + under("for (;;) {\n", "c(() => a + b); a = 1; b = 1;\n", "}\n"),
    "ox-deep-namespaces-of-types.ts": () => nest("namespace A {\n", "interface A {}", "}\n"),
    "ox-deep-function-types.ts": () => "type A = " + nest("<A>(a: ", "A", ") => void") + ";\n",
    "ox-deep-catches-that-throw.js": () => nest("try {} catch (e) {\n", 'throw new Error("a");', "}\n"),
    "ox-deep-returns-at-the-end.js": () => "function a() {\n" + nest("if (b) {\n", "return;", "}\n") + "}\n",
    "ox-deep-under-ifs-returns.js": () =>
      "function a() {\n" + under("if (b) {\n", "if (c) { return; }\n", "}\n") + "}\n",
    "ox-deep-under-awaits.mjs": () => under("a(async () => {\n", "(await b).c; d.then(e => e);\n", "});\n"),
    "ox-deep-under-blocks-top-level.mjs": () => under("{\n", "a.then(b => b); (async () => {})();\n", "}\n"),
    "ox-deep-under-namespaces.ts": () =>
      under("namespace A {\n", "export const enum B { c }\nexport function d(this: any) { this.e; }\n", "}\n"),

    // ── vue ──
    "ox-deep-vue-data.vue": () => options("data() { return " + nest("{ a: ", "1", " }") + "; },"),
    "ox-deep-vue-props.vue": () =>
      options("props: { a: { type: Object, default: " + nest("{ b: ", "1", " }") + " } },"),
    "ox-deep-vue-computed.vue": () =>
      options("computed: { a() {\n" + nest("if (this.b) {\n", "this.c = 1; return 1;\n", "}\n") + "} },"),
    "ox-deep-vue-methods-callbacks.vue": () =>
      options("methods: { a() {\n" + nest("b(() => {\n", 'this.$emit("c"); this.d;\n', "});\n") + "} },"),
    "ox-deep-vue-setup-callbacks.vue": () =>
      vue(
        'import { onMounted, ref } from "vue";\nconst a = ref(0);\n' +
          nest("b(() => {\n", "onMounted(() => {}); a + 1;\n", "});\n"),
        " setup",
      ),
    "ox-deep-vue-setup-types.vue": () =>
      vue("defineProps<" + nest("{ a: ", "string", " }") + ">();", ' setup lang="ts"'),
    "ox-deep-vue-under-callbacks.vue": () =>
      options(
        "computed: { a() {\n" + under("b(() => {\n", 'this.c = 1; this.$emit("d");\n', "});\n") + "return 1; } },",
      ),
    "ox-deep-vue-setup-under-callbacks.vue": () =>
      vue(
        'import { onMounted, ref, watch } from "vue";\nconst a = ref(0);\nconst props = defineProps(["b"]);\n' +
          under("c(() => {\n", "onMounted(() => {}); a + 1; props.b = 1; watch(a.value, () => {});\n", "});\n"),
        " setup",
      ),
    "ox-deep-vue-template.vue": () =>
      "<template>" + nest("<div>", "a", "</div>") + "</template>\n<script>\nexport default {};\n</script>\n",
  });
}
