// __snapshots__/dom-nodes-jest.test.js.snap was written by Jest 30.5.2, which runs this file as it is:
//   npx jest --rootDir test/js/bun/test/printing dom-nodes-jest
// Bun has to agree with every byte of it. Never update it with Bun.
const { JSDOM } = require("jsdom");
const { Window } = require("happy-dom");

let utils;
expect.extend({
  toCaptureUtils() {
    utils = this.utils;
    return { pass: true, message: () => "" };
  },
});
expect(0).toCaptureUtils();

describe.each([
  ["jsdom", () => new JSDOM("<!doctype html><html><body></body></html>").window],
  ["happy-dom", () => new Window()],
])("%s", (_, createWindow) => {
  const window = createWindow();
  const { document } = window;
  const html = markup => {
    const container = document.createElement("div");
    container.innerHTML = markup;
    return container.firstChild;
  };
  const withAttribute = (tag, name, value) => {
    const element = document.createElement(tag);
    element.setAttribute(name, value);
    return element;
  };
  const chain = (length, leaf) => {
    const root = document.createElement("section");
    let last = root;
    for (let i = 0; i < length; i++) {
      last.appendChild(document.createTextNode(`t${i}`));
      last = last.appendChild(document.createElement(i % 2 ? "span" : "div"));
    }
    last.textContent = leaf;
    return root;
  };
  const host = html(
    `<div id="host" class="b a  c" data-foo-bar="1" data-a="2"><span>1</span>text<!--c--><i>2</i></div>`,
  );
  const button = html(`<button class="b a" id="x">go</button>`);
  window.customElements.define("x-named", class XNamed extends window.HTMLElement {});
  window.customElements.define("x-anonymous", class extends window.HTMLElement {});

  // What `toMatchSnapshot()` stores, and what a matcher message, `this.utils.stringify()`,
  // `printReceived()` and `printExpected()` say.
  test.each([
    ["empty element", document.createElement("div")],
    ["one attribute", html(`<div id="a"></div>`)],
    ["sorted attributes", html(`<div title="t" id="i" class="c" aria-label="l" data-z="1" data-a="2"></div>`)],
    ["text child", html(`<button>go</button>`)],
    ["attributes and text", button],
    ["nested", html(`<ul class="l"><li>one</li><li class="x">two<b>bold</b>tail</li><li></li></ul>`)],
    ["comment child", html(`<div><!-- a comment --><span></span></div>`)],
    ["text node", document.createTextNode("just text")],
    ["empty text node", document.createTextNode("")],
    ["empty text child", html(`<p></p>`).appendChild(document.createTextNode("")).parentNode],
    ["comment node", document.createComment(` <b> & "q" `)],
    ["text escapes", document.createTextNode(`a < b > c & d "e" 'f' \\ \` \${x}`)],
    ["element text escapes", html(`<p>a &lt; b &gt; c &amp; d "e" 'f' \\ \` \${x}</p>`)],
    ["attribute escapes", withAttribute("a", "title", `q"q 's' \\ < > & \` \${x}`)],
    ["attribute line ends", withAttribute("a", "title", "l1\nl2\r\nl3\rl4\tt")],
    ["text line ends", document.createTextNode("l1\nl2\r\nl3\rl4\tt")],
    ["whitespace text", html(`<div>\n  <span> a </span>\n  \n</div>`)],
    ["empty attribute values", html(`<input disabled="" value="" type="text">`)],
    [
      "beyond ASCII",
      withAttribute("p", "title", "café 日本語 \u{1F600}  ").appendChild(
        document.createTextNode("café 日本語 \u{1F600}  "),
      ).parentNode,
    ],
    ["attribute name order", html(`<p z="" _x="" a1="" a.b="" a-b="" B="" a="" é=""></p>`)],
    ["fragment", html(`<template><b>x</b>t</template>`).content],
    ["empty fragment", document.createDocumentFragment()],
    ["template", html(`<template><p>in</p></template>`)],
    [
      "svg",
      html(
        `<svg viewBox="0 0 1 1"><linearGradient id="g"><stop offset="0"></stop></linearGradient><a xlink:href="#x"></a><foreignObject><div>h</div></foreignObject></svg>`,
      ),
    ],
    ["unknown element", html(`<blink>x</blink>`)],
    ["custom element that is not defined", html(`<x-undefined a="1">x</x-undefined>`)],
    ["custom element", html(`<x-named a="1"><i>x</i></x-named>`)],
    ["custom element of a class without a name", html(`<div><x-anonymous a="1"><i>x</i></x-anonymous></div>`)],
    ["is attribute", html(`<button is="fancy-button">x</button>`)],
    [
      "form",
      html(
        `<form action="/a"><input name="n" value="v"><select name="s"><option value="1" selected="">one</option><option>two</option></select><textarea>t</textarea></form>`,
      ),
    ],
    ["select", html(`<select multiple=""><optgroup label="g"><option>a</option></optgroup></select>`)],
    ["table", html(`<table><thead><tr><th>h</th></tr></thead><tbody><tr><td colspan="2">d</td></tr></tbody></table>`)],
    ["script and style", html(`<div><script>if (a < b && c > d) {}</script><style>a > b { color: red }</style></div>`)],
    ["void elements", html(`<p><br><img src="a.png" alt=""></p>`)],
    ["40 levels", chain(40, "leaf")],
    ["NodeList of childNodes", host.childNodes],
    ["NodeList of querySelectorAll", host.querySelectorAll("*")],
    ["empty NodeList", host.querySelectorAll("nope")],
    ["HTMLCollection", host.children],
    ["empty HTMLCollection", host.getElementsByTagName("nope")],
    ["HTMLFormControlsCollection", html(`<form><input name="n"><button>b</button></form>`).elements],
    ["HTMLOptionsCollection", html(`<select><option>a</option><option>b</option></select>`).options],
    ["NamedNodeMap", host.attributes],
    ["empty NamedNodeMap", document.createElement("div").attributes],
    ["DOMTokenList", host.classList],
    ["empty DOMTokenList", document.createElement("div").classList],
    ["12 items", html(`<p>${"<i></i>".repeat(12)}</p>`).childNodes],
    ["12 attributes", html(`<p a0 a1 a2 a3 a4 a5 a6 a7 a8 a9 a10 a11></p>`).attributes],
  ])("%s", (_, value) => {
    expect(value).toMatchSnapshot();
    expect(utils.stringify(value)).toMatchSnapshot();
  });

  // A message prints these in the style of the runner.
  test.each([
    ["in an object", { el: button, n: 1 }],
    ["in an array", [button, html(`<i></i>`), "s"]],
    ["deep in objects and arrays", { a: { b: [{ c: button }] } }],
    ["in a Map", new Map([["k", button]])],
    ["in a Set", new Set([button])],
    ["collections in an object", { list: host.children, attrs: host.attributes }],
  ])("%s", (_, value) => {
    expect(value).toMatchSnapshot();
  });

  test.each([
    ["12 levels", chain(12, "leaf")],
    [
      "too long at 10 and 5 levels",
      html(`<ul>${`<li><a><span class="${"x".repeat(200)}">label</span></a></li>`.repeat(50)}</ul>`),
    ],
    [
      "too long at 2 levels",
      html(`<ul>${`<li class="${"x".repeat(200)}"><a><span>label</span></a></li>`.repeat(50)}</ul>`),
    ],
    ["too long at any depth", html(`<p>${"0123456789".repeat(1200)}</p>`)],
    ["too long with 10 and 5 items", html(`<p>${`<!--${"x".repeat(3000)}-->`.repeat(4)}</p>`).childNodes],
  ])("message: %s", (_, value) => {
    expect(utils.stringify(value)).toMatchSnapshot();
  });
});

test("jsdom: DOMStringMap", () => {
  const { document } = new JSDOM(`<div data-foo-bar="1" data-a="2" data-z=""></div><p></p>`).window;
  for (const { dataset } of [document.querySelector("div"), document.querySelector("p")]) {
    expect(dataset).toMatchSnapshot();
    expect(utils.stringify(dataset)).toMatchSnapshot();
  }
});
