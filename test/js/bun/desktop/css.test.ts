import { desktopInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS } from "harness";

let nextFontScope = 5000;

function open(html = "", doctype = "<!doctype html>") {
  const page = desktopInternals.createPage({ native: null, surface: 0, fontScope: nextFontScope++ });
  page.parseHTML(doctype + html);
  const $ = (selector: string) => page.document.querySelector(selector);
  const computed = (target: any, property: string, pseudo?: string) =>
    page.window.getComputedStyle(typeof target === "string" ? $(target) : target, pseudo).getPropertyValue(property);
  return { ...page, $, computed, [Symbol.dispose]: page.dispose };
}

test.each([
  ["width", "calc(1px + 2px * 3)", "calc(7px)", "7px"],
  ["width", "calc-size(calc-size(auto, size), size * 2)", null, null],
  ["column-count", "calc(0)", null, "1"],
  ["line-height", "calc(-1)", null, "0px"],
  ["aspect-ratio", "calc(-1) / 2", null, "0 / 2"],
  ["opacity", "200%", "2", "1"],
  ["color", "color-mix(in srgb, red, blue)", null, "color(srgb 0.5 0 0.5)"],
  ["color", "rgb(from red r g b / 50%)", null, "color(srgb 1 0 0 / 0.5)"],
  ["color", "light-dark(red, blue)", null, "rgb(255, 0, 0)"],
  ["grid-auto-flow", "row dense", "dense", "dense"],
  ["background-size", "10px", "10px auto", "10px auto"],
  ["background-image", 'url("data:,a" cross-origin(anonymous))', null, null],
  ["width", "random(fixed 0.5, 10px, 20px)", null, "15px"],
  ["timeline-trigger", "--a view() contain", null, null],
])("%s: %s", (property, value, specified, computed) => {
  using page = open("<p style='display: none'></p>");
  const { style } = page.$("p");
  style.setProperty(property, value);
  expect(style.getPropertyValue(property)).toBe(specified ?? value.replace("size * 2", "2 * size"));
  expect(page.computed("p", property)).toBe(computed ?? style.getPropertyValue(property));
});

test.each([
  ["width", "calc(1px + 1)"],
  ["color", "ff0000"],
  ["grid-template-areas", '"a b" "b a"'],
  ["column-count", "0"],
  ["background-image", 'url("a" nonsense(1))'],
])("%s: %s is invalid", (property, value) => {
  using page = open();
  expect(page.window.CSS.supports(property, value)).toBe(false);
});

test("nested calc-size() takes time that is linear in its length", () => {
  using page = open("<p></p>");
  let value = "auto";
  for (let i = 0; i < 24; i++) value = `calc-size(${value}, size + size + size)`;
  const animation = page.$("p").animate({ height: ["0px", value] }, 1000);
  animation.pause();
  expect(page.computed("p", "height")).toBe("0px");
});

describe("declarations", () => {
  test("the other longhands stay when one of a shorthand is overridden", () => {
    using page = open("<p></p>");
    page.$("p").style.margin = "1px 2px";
    page.$("p").style.marginTop = "3px";
    expect(page.computed("p", "margin")).toBe("3px 2px 1px");
  });

  test("a system font is serialized as it is", () => {
    using page = open("<p style='font: menu'></p>");
    expect([page.$("p").style.font, page.$("p").style.fontSize]).toEqual(["menu", ""]);
  });

  test("a typed value comes back as it was set", () => {
    using page = open("<p></p>");
    const { CSS, CSSMathSum } = page.window;
    page.$("p").attributeStyleMap.set("width", new CSSMathSum(CSS.percent(1), CSS.percent(2)));
    expect(String(page.$("p").attributeStyleMap.get("width"))).toBe("calc(1% + 2%)");
  });
});

describe("cascade", () => {
  test("the system colors of selections are those of the platform", () => {
    using page = open("<p></p>");
    const colors = (scheme: string) =>
      ["Highlight", "HighlightText", "SelectedItem", "SelectedItemText"].map(it => {
        page.$("p").style.cssText = `color-scheme: ${scheme}; color: ${it}`;
        return page.computed("p", "color");
      });
    expect([colors("light"), colors("dark")]).toEqual(
      isMacOS
        ? [
            ["rgba(128, 188, 254, 0.6)", "rgb(0, 0, 0)", "rgb(179, 215, 255)", "rgb(0, 0, 0)"],
            ["rgba(179, 215, 255, 0.8)", "rgb(0, 0, 0)", "rgb(153, 200, 255)", "rgb(59, 59, 59)"],
          ]
        : [
            ["rgba(0, 65, 198, 0.8)", "rgb(255, 255, 255)", "rgb(25, 103, 210)", "rgb(255, 255, 255)"],
            ["rgba(0, 65, 198, 0.8)", "rgb(255, 255, 255)", "rgb(153, 200, 255)", "rgb(59, 59, 59)"],
          ],
    );
  });

  test("the style of an element that is not rendered follows what it depends on", () => {
    using page =
      open(`<style>main { display: none; color: rgb(0, 0, 1) } .a main { color: rgb(0, 0, 2) } .b i { order: 1 }
      .b:has(+ b) i { order: 2 } i { z-index: sibling-index() }</style><main><p><i></i></p></main>`);
    const i = page.$("i");
    const changes = [
      () => {},
      () => (page.document.body.className = "a"),
      () => (page.$("p").className = "b"),
      () => page.$("p").after(page.document.createElement("b")),
      () => i.before(page.document.createElement("u")),
      () => (page.$("p").style.color = "rgb(0, 0, 3)"),
      () => page.document.styleSheets[0].insertRule("u + i { order: 3 !important }"),
      () => (page.document.styleSheets[0].cssRules[0].style.cssText = "order: 4 !important"),
      () => (page.document.styleSheets[0].disabled = true),
    ];
    const read = () => ["color", "order", "z-index"].map(it => page.computed(i, it)).join(" ");
    expect(changes.map(change => (change(), read()))).toEqual([
      ...["rgb(0, 0, 1) 0 1", "rgb(0, 0, 2) 0 1", "rgb(0, 0, 2) 1 1", "rgb(0, 0, 2) 2 1", "rgb(0, 0, 2) 2 2"],
      ...["rgb(0, 0, 3) 2 2", "rgb(0, 0, 3) 3 2", "rgb(0, 0, 3) 4 2", "rgb(0, 0, 3) 0 auto"],
    ]);
  });

  test("a layer is not declared by a media query that does not match", () => {
    using page = open(
      `<style>@media print { @layer b; } @layer a { p { order: 1 } } @layer b { p { order: 2 } }</style><p></p>`,
    );
    expect(page.computed("p", "order")).toBe("2");
  });

  test("anonymous layers of equal sheets are different", () => {
    const sheet = "<style>@layer { p { order: 1 !important; z-index: 1 } }</style>";
    using page = open(`${sheet}<style>@layer a { p { order: 2 !important; z-index: 2 } }</style>${sheet}<p></p>`);
    expect([page.computed("p", "order"), page.computed("p", "z-index")]).toEqual(["1", "1"]);
  });

  test("revert-layer in the fallback of var()", () => {
    using page = open(`<style>@layer a { p { --x: 1 } } p { --x: var(--none, revert-layer) }</style><p></p>`);
    expect(page.computed("p", "--x")).toBe("1");
  });

  test("units of the root element", () => {
    using page = open(
      `<style>html { font-size: 2rem; line-height: 2rem } p { width: 1rem; line-height: 2lh }</style><p></p>`,
    );
    page.$("html").style.color = "red";
    expect(["font-size", "line-height"].map(it => page.computed("html", it))).toEqual(["32px", "64px"]);
    expect(["width", "line-height"].map(it => page.computed("p", it))).toEqual(["32px", "128px"]);
  });

  test("zoom scales what is inherited", () => {
    using page = open(`<div style="font-size: 10px; text-indent: 5px"><p style="zoom: 2; width: 1em"></p></div>`);
    expect([page.computed("p", "text-indent"), page.$("p").getBoundingClientRect().width]).toEqual(["5px", 20]);
    expect(page.$("p").currentCSSZoom).toBe(2);
  });

  test("attr() cannot make a URL", () => {
    using page = open(`<style>p { --x: attr(a); background-image: image-set(var(--x)) }</style><p a="data:,"></p>`);
    expect([page.computed("p", "--x"), page.computed("p", "background-image")]).toEqual(['"data:,"', "none"]);
  });

  test("only some properties apply to ::marker and ::first-line", () => {
    using page = open(`<style>::marker, ::first-line { color: rgb(1, 2, 3); position: absolute }</style><li>a`);
    for (const pseudo of ["::marker", "::first-line"]) {
      expect([page.computed("li", "color", pseudo), page.computed("li", "position", pseudo)]).toEqual([
        "rgb(1, 2, 3)",
        "static",
      ]);
    }
  });

  test("quirks mode", () => {
    using page = open(`<style>.A#B { width: 7; color: 010203 }</style><p class=a id=b></p>`, "");
    expect([page.computed("p", "width"), page.computed("p", "color")]).toEqual(["7px", "rgb(1, 2, 3)"]);
    expect(page.document.scrollingElement).toBe(page.document.body);
  });
});

describe("at-rules", () => {
  test.each(["(color : red) or ( color:blue )", "(width: 0) and (padding: 0) and (border: black)"])(
    "@supports %s",
    condition => {
      using page = open(`<style>@supports ${condition} {}</style>`);
      expect(page.$("style").sheet.cssRules[0].conditionText).toBe(condition);
    },
  );

  test("a universal @property without a value is guaranteed-invalid", () => {
    using page = open(
      `<style>@property --x { syntax: "*"; inherits: false; initial-value: 1 } p { --x: var(--none) }</style><p>`,
    );
    expect(page.computed("p", "--x")).toBe("");
  });

  test("the order of layers decides among @keyframes", () => {
    using page =
      open(`<style></style><style>@layer a { @keyframes k { from { order: 1 } } } @layer b { @keyframes k { from { order: 2 } } }
      p { animation: k 9s paused }</style><p>`);
    const before = page.computed("p", "order");
    page.$("style").sheet.insertRule("@layer b {}");
    expect([before, page.computed("p", "order")]).toEqual(["2", "1"]);
  });

  test("ch in a media query is of the initial font", () => {
    using page = open("<html style='font-size: 99px'><p style='font: initial; width: 10ch'>");
    const ch = page.window.innerWidth / (page.$("p").getBoundingClientRect().width / 10);
    expect([ch - 1, ch + 1].map(it => page.window.matchMedia(`(min-width: ${it}ch)`).matches)).toEqual([true, false]);
  });

  test("@import keeps its modifiers", () => {
    using page = open(`<style>@import url("data:text/css," referrer-policy(origin) cross-origin(anonymous));
      @import url("data:text/css," cross-origin(anonymous) cross-origin(anonymous));</style>`);
    expect(Array.from(page.$("style").sheet.cssRules, (it: any) => it.cssText)).toEqual([
      '@import url("data:text/css," cross-origin(anonymous) referrer-policy(origin));',
    ]);
  });

  test("a rule that cannot be nested", () => {
    using page = open("<style>p {}</style>");
    expect(() => page.$("style").sheet.cssRules[0].insertRule("@font-face {}")).toThrow(
      expect.objectContaining({ name: "HierarchyRequestError" }),
    );
  });

  test("a face is loaded when a character is written that it is for", async () => {
    using page =
      open(`<style>@font-face { font-family: a; src: local(x) } @font-face { font-family: a; src: local(y); unicode-range: U+400-4FF }
      </style><p style="font-family: a">a`);
    const untouched = async () => (
      await page.document.fonts.ready,
      Array.from(page.document.fonts, (it: any) => it.status == "unloaded")
    );
    const before = await untouched();
    page.$("p").append("\u0416");
    expect([before, await untouched()]).toEqual([
      [false, true],
      [false, false],
    ]);
  });
});

describe("containers", () => {
  test("their own automatic scrollbars do not count", () => {
    using page = open(
      "<div style='container-type: inline-size; width: 400px; height: 9px; overflow-y: auto'><p style='width: 100cqi; height: 99px'>",
    );
    expect(page.computed("p", "width")).toBe("400px");
  });

  test("a scrollbar that makes itself unnecessary stays, and starts no transition", () => {
    using page =
      open(`<style>p { height: 200px; margin: 0; order: 1 } @container (max-width: 99px) { p { height: 9px; order: 5; transition: order 9s } }</style>
      <div style="overflow: auto; width: 100px; height: 100px"><div style="container-type: inline-size"><p>`);
    expect([page.$("p").offsetWidth < 100, page.computed("p", "order"), page.$("p").getAnimations()]).toEqual([
      true,
      "5",
      [],
    ]);
  });

  test("@starting-style goes by the new size", () => {
    using page = open(`<style>p { transition: order 9s step-end; order: 1; display: none }
      @container (width > 300px) { @starting-style { p { order: 2 } } } @container (width < 200px) { @starting-style { p { order: 3 } } }</style>
      <div style="container-type: inline-size; width: 100px"><p>`);
    page.$("div").offsetWidth;
    page.$("div").style.width = "400px";
    page.$("p").style.display = "block";
    expect(page.computed("p", "order")).toBe("2");
  });

  test("an element is the container of its highlights", () => {
    using page = open(
      "<style>p::highlight(a) { text-decoration-thickness: 10cqw }</style><p style='container-type: inline-size; width: 200px'>",
    );
    expect(page.computed("p", "text-decoration-thickness", "::highlight(a)")).toBe("20px");
  });
});

test.each([
  ["outline-width", "3px"],
  ["scroll-margin-top", "5px"],
  ["filter", "blur(5px)"],
  ["transform", "matrix(1, 0, 0, 1, 5, 6)"],
  ["border-spacing", "1px 2px"],
])("zoom is not in the computed %s", (property, value) => {
  using page = open(`<div style="zoom: 2; ${property}: ${value}"><p style="zoom: 3; ${property}: inherit">`);
  expect([page.computed("div", property), page.computed("p", property)]).toEqual([value, value]);
});

test("color: initial follows the color scheme", () => {
  using page = open("<p style='color-scheme: dark; color: initial'>");
  expect(page.computed("p", "color")).toBe("rgb(255, 255, 255)");
});

test("a modal dialog stays where it is while it fades out", () => {
  using page = open("<dialog style='transition: overlay 9s allow-discrete, display 9s allow-discrete'>a</dialog>");
  const dialog = page.$("dialog");
  dialog.showModal();
  const before = dialog.getBoundingClientRect().toJSON();
  dialog.close();
  expect([page.computed(dialog, "position"), dialog.getBoundingClientRect().toJSON()]).toEqual(["fixed", before]);
});

test("the viewport snaps to what escapes from a scroll container", () => {
  using page = open(`<html style="overflow: scroll; scroll-snap-type: y mandatory"><body style="overflow: scroll">
    <p style="position: absolute; top: 0; height: 4000px; width: 9px; margin: 0">
    <p style="position: absolute; top: 0; height: 9px; width: 9px; margin: 0; scroll-snap-align: start">
    <p style="position: absolute; top: 1000px; height: 9px; width: 9px; margin: 0; scroll-snap-align: start">`);
  page.window.scrollTo(0, 900);
  expect(page.window.scrollY).toBe(1000);
});

test("adoptedStyleSheets is emptied in another document", () => {
  using page = open("<p>");
  const root = page.$("p").attachShadow({ mode: "open" });
  root.adoptedStyleSheets = [new page.window.CSSStyleSheet()];
  page.document.implementation.createHTMLDocument().body.append(page.$("p"));
  expect(root.adoptedStyleSheets.length).toBe(0);
});

describe("selectors", () => {
  test(":scope of a document is its root element", () => {
    using page = open();
    expect([page.$(":scope"), page.$(":scope > body")]).toEqual([page.document.documentElement, page.document.body]);
  });

  test(":nth-last-child(of) follows the later siblings", () => {
    using page = open(`<style>:nth-last-child(1 of .a) { order: 1 }</style><p class=a></p><p id=last class=a></p>`);
    expect(page.computed("p", "order")).toBe("0");
    page.$("#last").className = "";
    expect(page.computed("p", "order")).toBe("1");
  });

  test(":nth-child() among many siblings", () => {
    using page = open(`<style>:nth-child(2n of .a) { order: 1 } p:nth-last-child(50) { z-index: 1 }</style>
      <div>${"<p class=a></p>".repeat(100)}</div>`);
    const all = Array.from(page.$("div").children);
    const places = (property: string) => all.flatMap((it, i) => (page.computed(it, property) === "1" ? [i] : []));
    expect([places("order").slice(-2), places("z-index")]).toEqual([[97, 99], [50]]);
    all[0].className = "";
    all[99].remove();
    expect([places("order").slice(-2), places("z-index")]).toEqual([[96, 98], [49]]);
  });

  test("nested :nth-child(of), layers and chained anchors take linear time", () => {
    const anchors = Array.from(
      { length: 2000 },
      (_, i) =>
        `<b style="position: fixed; height: 1px; anchor-name: --a${i}; top: anchor(--a${i - 1} bottom, 0px)"></b>`,
    );
    using page = open(`<style>${":nth-child(n of ".repeat(30)}p${")".repeat(30)} { order: 1 }
      @layer ${"a.".repeat(20_000)}a { i { order: 2 } } @layer a.a { i { order: 3 } }</style>
      <div>${"<p></p>".repeat(9)}<i></i></div>${anchors.join("")}`);
    expect(["p:last-of-type", "i"].map(it => page.computed(it, "order"))).toEqual(["1", "3"]);
    expect(page.$("b:last-child").offsetTop).toBe(1999);
  });

  test("querySelectorAll() follows whatever a selector looks at", () => {
    using page = open("<form><input type=checkbox><p lang=en></p><x-a></x-a></form>");
    const selector = ":checked, :lang(de), :focus, [title], .a, p:not(:empty), :defined:state(on), :dir(rtl)";
    let internals: any;
    const changes = [
      () => (page.$("input").checked = true),
      () => page.$("form").reset(),
      () => (page.$("p").lang = "de"),
      () => page.$("p").removeAttribute("lang"),
      () => page.$("p").append("a"),
      () => (page.$("p").firstChild.data = ""),
      () => page.$("x-a").classList.add("a"),
      () => page.$("x-a").classList.remove("a"),
      () =>
        page.window.customElements.define(
          "x-a",
          class extends page.window.HTMLElement {
            constructor() {
              super();
              internals = this.attachInternals();
            }
          },
        ),
      () => internals.states.add("on"),
      () => internals.states.clear(),
      () => (page.$("form").dir = "rtl"),
      () => page.$("input").remove(),
    ];
    const found = () => Array.from(page.document.querySelectorAll(selector), (it: any) => it.localName).join();
    expect([found(), ...changes.map(change => (change(), found()))]).toEqual([
      ...["", "input", "", "p", "", "p", "", "x-a", "", "", "x-a", ""],
      ...["form,input,p,x-a", "form,p,x-a"],
    ]);
  });

  test("querySelectorAll() tries the next ancestor", () => {
    using page = open(
      "<ul class=a><li><ol><li class='b c'><a id=x></a></ol><a id=y></a></ul><ol><li><a id=z></a></ol>",
    );
    const ids = (selector: string) => Array.from(page.document.querySelectorAll(selector), (it: any) => it.id).join("");
    const selectors = [
      "ul > li a",
      "ul > li > a",
      ".a li.b.c > a",
      ".b.d a",
      "* > ol a",
      "li li [id]",
      "html > a",
      "A",
    ];
    expect(selectors.map(ids)).toEqual(["xy", "y", "x", "", "xz", "x", "", "xyz"]);
  });

  test("a new value of a data attribute counts for all that looks at it", () => {
    using page = open(`<style>[data-a="2"] { order: 2 } [data-b^="2"] { order: 3 } i::before { content: attr(data-c) }
      b { order: attr(data-d type(<integer>)) }</style><p data-a=1 data-b=1 data-e=1></p><i data-c=1></i><b data-d=1></b>`);
    const set = (target: string, name: string, value: string, pseudo?: string) => {
      page.document.body.offsetWidth;
      page.$(target).setAttribute(name, value);
      return page.computed(target, pseudo ? "width" : "order");
    };
    page.$("i").style.display = "inline-block";
    const width = page.computed("i", "width");
    expect([
      set("p", "data-a", "2"),
      set("p", "data-a", "3"),
      set("p", "DATA-B", "22"),
      set("b", "data-d", "4"),
    ]).toEqual(["2", "0", "3", "4"]);
    expect(set("i", "data-c", "", "::before")).not.toBe(width);
    set("p", "data-e", "2");
    const count = (selector: string) => page.document.querySelectorAll(selector).length;
    expect([count('[data-e="1"]'), count('[data-e="2"]'), page.$("p").dataset.e]).toEqual([0, 1, "2"]);
    page.$("style").append('[data-e="2"] { z-index: 1 }');
    expect(page.computed("p", "z-index")).toBe("1");
  });

  test("@scope follows :has()", () => {
    using page = open(`<style>@scope (div:has(.a)) { p { order: 1 } }</style><div><p></p><i></i></div>`);
    expect(page.computed("p", "order")).toBe("0");
    page.$("i").className = "a";
    expect(page.computed("p", "order")).toBe("1");
  });

  test("shadow trees", () => {
    using page = open(`<style>x-a::part(outer) { order: 1 }</style><x-a><b></b></x-a>`);
    const root = page.$("x-a").attachShadow({ mode: "open" });
    root.innerHTML = `<style>.on ::slotted(b) { order: 2 } :host:has(.on) { order: 3 } *:host { order: 4 !important }</style>
      <div><slot></slot></div><x-b exportparts="inner: outer"></x-b>`;
    const inner = root.querySelector("x-b").attachShadow({ mode: "open" });
    inner.innerHTML = "<i part=inner></i>";
    expect([inner.firstChild, "b", "x-a"].map(it => page.computed(it, "order"))).toEqual(["1", "0", "0"]);
    root.querySelector("div").className = "on";
    expect(["b", "x-a"].map(it => page.computed(it, "order"))).toEqual(["2", "3"]);
  });

  test("an ancestor in another shadow tree with the same sheet does not match", () => {
    using page = open("<div id=outer><div id=inner></div></div>");
    const sheet = new page.window.CSSStyleSheet();
    sheet.replaceSync(".a .b:first-child { order: 1 }");
    const roots = ["#outer", "#inner"].map(id => page.$(id).attachShadow({ mode: "open" }));
    roots[0].innerHTML = "<div class=a><p class=b></p><slot></slot></div>";
    roots[1].innerHTML = "<p class=b></p>";
    for (const root of roots) root.adoptedStyleSheets = [sheet];
    expect(roots.map(root => page.computed(root.querySelector(".b"), "order"))).toEqual(["1", "0"]);
  });
});

describe("animations", () => {
  test("revert and font size keywords in keyframes", () => {
    using page = open(`<style>@keyframes a { from { margin-top: revert; font-size: medium } }
      p { margin-top: 0; font-family: monospace; font-size: 20px; animation: a 9s paused }</style><p>`);
    expect([page.computed("p", "margin-top"), page.computed("p", "font-size")]).toEqual(["13px", "13px"]);
  });

  test("an animation makes a containing block during its delay", () => {
    using page = open("<div><p style='position: fixed'></div>");
    const animation = page.$("div").animate({ scale: [1, 1] }, { delay: 9000, duration: 9 });
    const during = page.$("p").offsetParent;
    animation.cancel();
    expect([during, page.$("p").offsetParent]).toEqual([page.$("div"), null]);
  });

  test("@keyframes that come later start the animation", () => {
    using page = open(`<style></style><p style="animation: a 1s paused"></p>`);
    expect(page.$("p").getAnimations()).toHaveLength(0);
    page.$("style").sheet.insertRule("@keyframes a { from { order: 5 } }");
    expect(page.computed("p", "order")).toBe("5");
  });

  test("a transition goes to what is inherited after those of the ancestors", () => {
    using page =
      open(`<style>* { transition: color 9s steps(2, start) } div { color: rgb(200, 0, 0) } p { color: rgb(0, 0, 0) }
      .on { color: rgb(0, 200, 0) } .on p { color: inherit }</style><div><p></p></div>`);
    page.computed("p", "color");
    page.$("div").className = "on";
    expect(page.computed("p", "color")).toBe("rgb(0, 100, 0)");
  });

  test("an animation keeps a transition of the same property from starting", () => {
    using page = open(`<p style="transition: opacity 9s"></p>`);
    page.computed("p", "opacity");
    page.$("p").style.opacity = "0.5";
    page.$("p").animate({ opacity: [0, 1] }, 9000);
    expect(page.$("p").getAnimations()).toHaveLength(1);
  });

  test("@starting-style", () => {
    using page = open(`<style>p { transition: opacity 9s; @starting-style { opacity: 0 } }</style>`);
    expect(page.computed(page.document.body.appendChild(page.document.createElement("p")), "opacity")).toBe("0");
  });

  test("opacity is clamped after it is composited", () => {
    using page = open("<p></p>");
    page.$("p").animate({ opacity: [-1, -1] }, 9000);
    page.$("p").animate({ opacity: [1.5, 1.5] }, { duration: 9000, composite: "add" });
    expect(page.computed("p", "opacity")).toBe("0.5");
  });

  test("an animation waits for its trigger", () => {
    using page = open(`<style>@keyframes a { from { order: 5 } }
      p { animation: a 9s; animation-trigger: --t play; timeline-trigger: --t none }</style><p></p>`);
    const [animation] = page.$("p").getAnimations();
    expect([animation.playState, page.computed("p", "order")]).toEqual(["paused", "0"]);
    page.$("p").style.timelineTriggerSource = "auto";
    expect(animation.playState).toBe("running");
  });
});

test("document.fonts has the faces of style sheets", () => {
  using page = open(`<style>@font-face { font-family: a; src: local(a); font-weight: 700 }</style>`);
  expect(Array.from(page.document.fonts, (it: any) => [it.family, it.weight, it.status])).toEqual([
    ["a", "700", "unloaded"],
  ]);
  page.$("style").remove();
  expect(page.document.fonts.size).toBe(0);
});

test("scrolling returns a promise", async () => {
  using page = open(`<div style="height: 10px; overflow: scroll"><p style="height: 100px"></p></div>`);
  expect(await page.$("div").scrollTo({ top: 5 })).toEqual({ interrupted: false });
  const smooth = page.$("div").scrollTo({ top: 50, behavior: "smooth" });
  page.$("div").scrollTop = 7;
  page.$("p").getAnimations();
  expect(page.$("div").scrollTo(1)).rejects.toThrow(page.window.TypeError);
  expect(smooth).toBeInstanceOf(page.window.Promise);
});

test.each([
  ["simp-chinese-informal", 100010, "十万零十"],
  ["korean-hangul-formal", 10001, "일만 일"],
])("counter style %s", (style, value, text) => {
  using page = open(`<style>span { font: 10px monospace } #a::before { content: counter(n, ${style}) }</style>
    <span id=a style="counter-reset: n ${value}"></span><br><span id=b>${text}</span>`);
  expect(page.$("#a").getBoundingClientRect().width).toBe(page.$("#b").getBoundingClientRect().width);
});

test("an element is replaced by the image in content", () => {
  using page = open(`<p style="content: linear-gradient(red, blue); height: auto">text</p>`);
  expect(page.$("p").offsetHeight).toBe(0);
  page.$("p").style.content = "normal";
  expect(page.$("p").offsetHeight).toBeGreaterThan(0);
});

test.each([
  ["flex", "0 0 4", false],
  ["flex", "0%", true],
  ["grid", "none / auto-flow 1px", true],
])("%s: %s", (property, value, isValid) => {
  using page = open();
  expect(page.window.CSS.supports(property, value)).toBe(isValid);
});

test("SVGLength.value keeps the unit", () => {
  using page = open(`<svg style="font-size: 10px"><rect width="2em"/></svg>`);
  const { baseVal } = page.$("rect").width;
  baseVal.value = 50;
  expect(baseVal.valueAsString).toBe("5em");
});

test("the computed size of a zoomed shape is not zoomed", () => {
  using page = open(`<svg><rect style="zoom: 2; width: 19px; height: 18px"/></svg>`);
  expect([page.computed("rect", "width"), page.computed("rect", "height")]).toEqual(["19px", "18px"]);
});

test("adoptedStyleSheets never has holes", () => {
  using page = open("<p></p>");
  const sheets = ["red", "blue"].map(color => {
    const sheet = new page.window.CSSStyleSheet();
    sheet.replaceSync(`p { color: ${color} }`);
    return sheet;
  });
  page.document.adoptedStyleSheets = sheets;
  const list = page.document.adoptedStyleSheets;
  expect(Reflect.deleteProperty(list, "0")).toBe(false);
  expect(Reflect.set(list, "length", 3)).toBe(false);
  expect(() => Reflect.defineProperty(list, "1", { value: 1 })).toThrow();
  expect(page.computed("p", "color")).toBe("rgb(0, 0, 255)");
  expect(Reflect.deleteProperty(list, "1")).toBe(true);
  expect(list.length).toBe(1);
  expect(page.computed("p", "color")).toBe("rgb(255, 0, 0)");
});

test("what is painted after a change is what a new page paints", () => {
  const style =
    "<style>p { margin: 3px; background: red } .a { float: left; opacity: 0.5 } .a + p { color: blue }</style>";
  using changed = open(style + "<p>one</p><p>two</p>");
  using fresh = open(style + "<p class=a>one</p><p>three</p>");
  const before = desktopInternals.dumpDisplayList(changed.document);
  changed.$("p").className = "a";
  changed.$("p + p").firstChild.data = "three";
  expect(desktopInternals.dumpDisplayList(changed.document)).toBe(desktopInternals.dumpDisplayList(fresh.document));
  expect(desktopInternals.dumpDisplayList(changed.document)).not.toBe(before);
});

test("the rects of a range are mapped through a 3D rendering context", () => {
  using page = open(`<body style="margin: 0; font: 10px/20px monospace">
    <div style="transform: rotateX(90deg); transform-style: preserve-3d"><div id=a style="transform: rotateX(90deg)"><span>text</span></div></div>`);
  const range = page.document.createRange();
  range.selectNodeContents(page.$("span").firstChild);
  const [ofText, ofElement] = [range, page.$("span")].map(it => it.getClientRects()[0].toJSON());
  expect(ofText.height).toBeGreaterThan(5);
  expect(ofText).toEqual(ofElement);
});

describe("interfaces are native", () => {
  test.each([
    ["CSSStyleDeclaration", "getPropertyValue"],
    ["CSSStyleSheet", "insertRule"],
    ["CSSNumericValue", "add"],
    ["DOMMatrixReadOnly", "inverse"],
    ["Animation", "play"],
    ["ResizeObserver", "observe"],
    ["IntersectionObserver", "takeRecords"],
    ["MediaQueryList", "addListener"],
    ["Highlight", "add"],
    ["ViewTransition", "skipTransition"],
    ["FontFaceSet", "check"],
  ])("%s", (name, method) => {
    using page = open();
    const { prototype } = page.window[name];
    expect(Object.prototype.toString.call(prototype)).toBe(`[object ${name}]`);
    expect(String(prototype[method])).toContain("[native code]");
    expect(() => prototype[method].call({}, {})).toThrow("Illegal invocation");
  });
});

test("the style attribute follows the declarations", () => {
  using page = open("<p style='color: red'>");
  const element = page.$("p");
  element.style.marginTop = "1px";
  const copy = element.cloneNode();
  element.style.removeProperty("color");
  expect([element.outerHTML, copy.getAttribute("style"), page.$("[style*=margin]") === element]).toEqual([
    '<p style="margin-top: 1px;"></p>',
    "color: red; margin-top: 1px;",
    true,
  ]);
});

test("fallbacks that are used many times over are cut short", () => {
  using page = open();
  const { CSSUnparsedValue, CSSVariableReferenceValue } = page.window;
  let value = new CSSUnparsedValue(["a"]);
  for (let i = 0; i < 24; i++) value = new CSSUnparsedValue(Array(2).fill(new CSSVariableReferenceValue("--a", value)));
  expect(String(value).length).toBeLessThan(1 << 25);
});

test("rules are nested up to a limit", () => {
  using page = open(`<style>${"@media all{".repeat(1000)}</style>`);
  let [rule] = page.document.styleSheets[0].cssRules;
  expect(rule.cssText.split("@").length - 1).toBe(256);
  while (rule.cssRules.length) [rule] = rule.cssRules;
  expect(() => rule.insertRule("@media all{}")).toThrow("Failed to parse the rule.");
});

test("a rule that is edited in a group leaves its siblings alone", () => {
  using page = open("<style>@media all { p { color: blue } }</style><p>");
  const [group] = page.document.styleSheets[0].cssRules;
  group.insertRule("p { color: red }", 1);
  const inserted = page.computed("p", "color");
  group.deleteRule(1);
  expect([inserted, page.computed("p", "color")]).toEqual(["rgb(255, 0, 0)", "rgb(0, 0, 255)"]);
});

test("an indexed accessor on Array.prototype does not disturb what nodes refer to", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const page = require("bun:internal-for-testing").desktopInternals.createPage({ native: null, surface: 0, fontScope: 1 });
       page.parseHTML("<!doctype html><p>");
       const { document, CSSStyleSheet, getComputedStyle } = page.window;
       const [sheets, element] = [document.adoptedStyleSheets, document.querySelector("p")];
       const { style, classList } = element;
       Object.defineProperty(Array.prototype, "1", { set() {}, configurable: true });
       delete Array.prototype[1];
       const sheet = new CSSStyleSheet();
       sheet.replaceSync("p { color: lime }");
       document.adoptedStyleSheets = [new CSSStyleSheet(), sheet];
       console.log(sheets === document.adoptedStyleSheets, style === element.style, classList === element.classList, element.dataset === element.dataset, getComputedStyle(element).color);
       process.exit(0);`,
    ],
    env: bunEnv,
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("true true true true rgb(0, 255, 0)\n");
  expect(exitCode).toBe(0);
});

test("scrollParent() follows the containing blocks", () => {
  using page = open(`<div id=outer style="overflow: auto; position: relative"><div id=inner style="overflow: hidden">
    <p id=flow></p><p id=abs style="position: absolute"></p><p id=fixed style="position: fixed"></p><p id=none hidden></p>`);
  expect(["flow", "abs", "fixed", "none", "outer"].map(it => page.$("#" + it).scrollParent()?.id)).toEqual([
    "inner",
    "outer",
    undefined,
    undefined,
    "",
  ]);
});

test("equal values of different elements are serialized with their own color and zoom", () => {
  using page = open(`<style>p { border: 4px solid; text-indent: 8px }</style>
    <p id=a style="color: red"></p><p id=b style="color: blue; zoom: 2"></p><p id=c style="color: red; zoom: 4; text-indent: 2px"></p>`);
  expect(
    ["#a", "#b", "#c"].map(it => [page.computed(it, "border-top-color"), page.computed(it, "text-indent")]),
  ).toEqual([
    ["rgb(255, 0, 0)", "8px"],
    ["rgb(0, 0, 255)", "8px"],
    ["rgb(255, 0, 0)", "2px"],
  ]);
});

test("the rules of an import that is loading can be read", () => {
  using page = open(`<style>@import "http://localhost:1/a.css";</style>`);
  expect(page.document.styleSheets[0].cssRules[0].styleSheet.cssRules.length).toBe(0);
});

test("a view transition is skipped by the next one", async () => {
  using page = open("<p>");
  const updates: string[] = [];
  const first = page.document.startViewTransition({ update: () => void updates.push("first"), types: ["a"] });
  const wasActive = [
    page.document.activeViewTransition === first,
    page.$("html").matches(":active-view-transition-type(a)"),
  ];
  const second = page.document.startViewTransition(() => void updates.push("second"));
  second.ready.catch(() => {});
  expect(await first.ready.catch(it => it.name)).toBe("AbortError");
  second.skipTransition();
  await Promise.all([first.finished, second.finished]);
  expect([wasActive, updates, page.document.activeViewTransition]).toEqual([[true, true], ["first", "second"], null]);
});

test("document.fonts follows the rules", async () => {
  using page = open(`<style>@font-face { font-family: a; src: local(x); font-weight: 700 900 }
    @font-face { font-family: a; src: local(z) }</style>`);
  const { fonts } = page.document;
  const added = new page.window.FontFace("b", "local(y)", { style: "oblique 5deg" });
  fonts.add(added);
  const list = () => Array.from(fonts, (it: any) => [it.family, it.weight, it.style]);
  const before = list();
  page.document.styleSheets[0].deleteRule(1);
  expect([before, list(), (await fonts.load("800 1px a")).map(it => it.weight), fonts.delete([...fonts][0])]).toEqual([
    [
      ["a", "700 900", "normal"],
      ["a", "normal", "normal"],
      ["b", "normal", "oblique 5deg"],
    ],
    [
      ["a", "700 900", "normal"],
      ["b", "normal", "oblique 5deg"],
    ],
    ["700 900"],
    false,
  ]);
});

test("a value that one property refuses is taken by another", () => {
  using page = open("<p>");
  const { style } = page.$("p");
  style.display = style.display = "5px";
  style.width = "5px";
  style.setProperty("height", "auto !important");
  style.setProperty("height", "auto", "important");
  expect(style.cssText).toBe("width: 5px; height: auto !important;");
});

test("items are stretched to the height that a flex container has by its ratio", () => {
  using page = open(
    `<div style="display: flex; aspect-ratio: 1; width: 30px"><p style="margin: 0"><i style="display: block; height: 100px"></i></p></div>`,
  );
  expect([page.$("div").offsetHeight, page.$("p").offsetHeight]).toEqual([30, 30]);
});

test("the scrollbars of the page take nothing from the lines of an orthogonal box", () => {
  using page = open(`<div style="width: 9000px; padding-top: 1px"></div>`);
  page.$("div").offsetHeight;
  page.$("div").innerHTML = `<p style="writing-mode: vertical-rl; margin: 0; min-height: 100%"></p>`;
  expect(page.$("p").offsetHeight).toBe(page.window.innerHeight);
});

test.each([
  [
    "a field with a percentage for a width shrinks in a flex container",
    "<div style='display: flex; width: 90px'><i style='flex: 0 0 60px'></i><input id=a style='width: 100%; box-sizing: border-box'></div>",
    [30],
  ],
  [
    "tracks repeat up to a percentage",
    "<div style='width: 100px'><div id=a style='display: inline-grid; min-width: 60%; grid-template-columns: repeat(auto-fill, 50px)'></div></div>",
    [100],
  ],
  [
    "tracks repeat up to a percentage of the height",
    "<div style='height: 100px'><div id=a style='display: inline-grid; min-height: 60%; aspect-ratio: 1; grid: 100px / repeat(auto-fill, 50px)'></div></div>",
    [100],
  ],
  [
    "columns of flex items wrap at a percentage",
    "<div id=a style='width: max-content; height: 20px'><div style='display: flex; flex-flow: column wrap; max-height: 100%'><i style='width: 5px; height: 20px'></i><i style='width: 5px; height: 20px'></i></div></div>",
    [10],
  ],
  [
    "an orthogonal box between insets has a definite width",
    "<div style='position: relative; width: 50px'><div id=a style='writing-mode: vertical-lr; position: absolute; left: 0; right: 10px'><canvas width=1 height=1 style='display: block; width: 100%'></canvas></div></div>",
    [40, 40],
  ],
  [
    "min-content is a basis for an orthogonal item",
    "<div style='display: flex; flex-flow: column; height: 75px'><div id=a style='writing-mode: vertical-rl; flex: 0 0 min-content; width: 9px'><i style='float: left; height: 50px'></i><i style='float: left; height: 50px'></i></div></div>",
    [9, 50],
  ],
  [
    "grid lines go up to 10000",
    "<div id=a style='display: inline-grid; grid-auto-columns: 1px'><i style='grid-column-end: 10000'></i></div>",
    [9999],
  ],
])("%s", (_, html, expected) => {
  using page = open(html);
  expect([page.$("#a").offsetWidth, page.$("#a").offsetHeight].slice(0, expected.length)).toEqual(expected);
});

test.each([
  [
    "the last baseline of clamped lines",
    "<div style='display: flex; align-items: last baseline; font: 10px/10px a'><p id=a style='margin: 0'>a</p><p style='margin: 0; padding-bottom: 5px; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden'>a<br>a<br>a</p></div>",
    [0, 10],
  ],
  [
    "align-content of columns with size containment",
    "<div style='columns: 2; height: 90px; contain: size; align-content: end'><p id=a style='margin: 0; height: 10px; break-inside: avoid'></p></div>",
    [0, 80],
  ],
  [
    "a sticky box without room keeps to the start of its containing block",
    "<div style='width: 100px; overflow: hidden'><div style='display: flex; width: 600px; margin-left: -300px; direction: rtl'><p id=a style='position: sticky; left: 0; right: 0; width: 200px; margin: 0'></p></div></div>",
    [-100, 0],
  ],
])("%s", (_, html, expected) => {
  using page = open(`<body style="margin: 0">${html}`);
  expect([page.$("#a").offsetLeft, page.$("#a").offsetTop]).toEqual(expected);
});

test("place-content spells out what a baseline leaves open, and flex-basis has no anchor", () => {
  using page = open("<p style='place-content: baseline; flex-basis: anchor-size(--a width)'>");
  expect([page.$("p").style.placeContent, page.$("p").style.flexBasis]).toEqual(["baseline start", ""]);
});

describe("a change gives what a new page gives", () => {
  const set = (selector: string, name: string, value: string) => (page: any) =>
    page.$(selector).setAttribute(name, value);
  const rules = (text: string) => (page: any) => (page.$("#rules").textContent = text);
  const items = "<li>a</li>".repeat(9);
  const [grid, fill] = [
    "display: grid; grid-template-columns: auto 1fr auto",
    "display: grid; grid-template-columns: repeat(auto-fill, 50px)",
  ];
  const other = "<b style='position: absolute'>a</b>";
  const held = (html: string) =>
    `<div style='position: relative; overflow: auto; width: 100px; height: 99px'><div style='overflow: clip; overflow-clip-margin: 0; height: 50px'>${html}</div></div>`;
  const [cells, floats] = ["<p>a</p>".repeat(9), "<i style='float: left; width: 9px; height: 9px'></i>".repeat(9)];
  test.each([
    ["::first-line by a class", "<style>.on::first-line { font-size: 40px }</style><p>a</p>", set("p", "class", "on")],
    [
      "::first-letter of a nested block",
      "<style>.on::first-letter { font-size: 40px }</style><div class=on><p>a</p></div>",
      set("div", "class", ""),
    ],
    [
      "the first ::first-line rule",
      "<style id=rules></style><div><p>a</p></div>",
      rules("div::first-line { font-size: 40px }"),
    ],
    [
      "the last ::first-line rule",
      "<style id=rules>div::first-line { font-size: 40px }</style><div><p>a</p></div>",
      rules(""),
    ],
    [
      "percentage margins of an inline element",
      "<div style='width: 200px'><b style='margin: 10%'>a</b></div>",
      set("div", "style", "width: 100px"),
    ],
    [
      "a width that is inherited",
      "<div style='width: 200px'><p></p><p style='width: inherit; padding: 5px'></p></div>",
      set("div", "style", "width: 100px"),
    ],
    [
      "an absolute box that moves",
      "<div style='position: relative; overflow: auto; height: 50px'><p style='position: absolute; left: 0; top: 0'>a</p></div>",
      set("p", "style", "position: absolute; left: 10%; top: 90px"),
    ],
    [
      "an absolute box after a block that grows",
      held("<p>a</p><i style='position: absolute'>b</i>"),
      set("p", "style", "height: 40px"),
    ],
    [
      "an absolute box that goes",
      held(`<i style='position: absolute; top: 200px'>b</i>${other}`),
      (page: any) => page.$("i").remove(),
    ],
    [
      "an absolute box that comes",
      held(`<p></p>${other}`),
      (page: any) => (page.$("p").innerHTML = "<i style='position: absolute; top: 200px'>b</i>"),
    ],
    [
      "an absolute box that becomes fixed",
      held(`<i style='position: absolute; right: 0'>b</i>${other}<u style='position: fixed'>c</u>`),
      set("i", "style", "position: fixed; right: 0"),
    ],
    [
      "a fixed box that becomes absolute",
      held(`<i style='position: fixed; right: 0'>b</i>${other}<u style='position: fixed'>c</u>`),
      set("i", "style", "position: absolute; right: 0"),
    ],
    [
      "an absolute box that gets a nearer container",
      held(`<p style='width: 20px'><i style='position: absolute; left: 150px'>b</i></p>${other}`),
      set("p", "style", "width: 20px; position: relative; overflow: hidden"),
    ],
    [
      "an absolute box that loses its container",
      held(`<p style='width: 20px; position: relative'><i style='position: absolute; right: 0'>b</i></p>${other}`),
      set("p", "style", "width: 20px"),
    ],
    [
      "a transform in a scroller while another box is resized",
      "<div style='overflow: auto; width: 50px; height: 50px'><p style='margin: 0; height: 9px; translate: 0 1px'></p></div><nav style='height: 9px'><p></p></nav>",
      (page: any) => ((page.$("p").style.translate = "0 90px"), (page.$("nav p").style.height = "5px")),
    ],
    [
      "what overflows a box that keeps its size",
      "<div style='overflow: auto; width: 50px; height: 50px'><nav style='position: relative; z-index: 0; height: 9px'><p style='margin: 0'></p></nav></div>",
      set("p", "style", "margin: 0; height: 90px"),
    ],
    [
      "what overflows an absolute box that keeps its size",
      "<div style='position: relative; overflow: auto; width: 50px; height: 50px'><nav style='position: absolute; inset: 0 0 auto; height: 9px'><p style='margin: 0'></p></nav></div>",
      set("p", "style", "margin: 0; height: 90px"),
    ],
    [
      "an absolute box in a relative inline element with a block that grows",
      "<div><b style='position: relative'><p style='height: 9px'></p><i style='position: absolute; display: block'>a</i></b></div>",
      set("p", "style", "height: 20px"),
    ],
    [
      "a subgrid that gets containment",
      "<div style='display: grid; width: max-content'><p style='display: grid; grid-template-columns: subgrid'>a</p></div>",
      (page: any) => (page.$("p").style.cssText += "contain: paint; margin: 0"),
    ],
    [
      "a box that was measured for another width before",
      "<div style='display: grid'><div style='justify-self: baseline; display: grid'><div style='display: grid; grid-auto-flow: column'><p style='margin: 0'>a</p>a a a a a a a a</div></div></div>",
      (page: any) => {
        page.$("div").style.width = "30px";
        page.$("div").offsetHeight;
        page.$("p").append(page.document.createElement("br"), "a");
        page.$("div").style.width = "400px";
      },
    ],
    [
      "an item that gets another number",
      `<ol style='list-style-position: inside'>${items}<li><b>a</b></li></ol>`,
      (page: any) => page.$("li").remove(),
    ],
    [
      "text-indent of text that gets a block before it",
      "<div style='text-indent: 9px'><b>a</b><p></p></div>",
      (page: any) => page.$("div").prepend(page.document.createElement("p")),
    ],
    [
      "text-indent of text that loses the block before it",
      "<div style='text-indent: 9px'><p style='margin: 0'></p><b>a</b></div>",
      (page: any) => page.$("p").remove(),
    ],
    [
      "a grid that is resized",
      `<div style='${grid}; width: 300px'>${cells}</div>`,
      set("div", "style", `${grid}; width: 200px`),
    ],
    ["a grid item that moves", `<div style='${grid}'>${cells}</div>`, set("p", "style", "grid-column: 3")],
    [
      "a grid item that is aligned differently",
      `<div style='${grid}'>${cells}</div>`,
      set("p", "style", "justify-self: end; width: 5px"),
    ],
    [
      "a grid item that grows",
      `<div style='${grid}'>${cells}</div>`,
      (page: any) => (page.$("p").textContent = "aaa aaa"),
    ],
    [
      "a grid item that becomes a subgrid",
      `<div style='${grid}'><p style='display: grid; grid-column: span 2'><i>a</i><i>bb</i></p>${cells}</div>`,
      (page: any) => (page.$("p").style.gridTemplateColumns = "subgrid"),
    ],
    [
      "an item of a subgrid that moves",
      `<div style='${grid}'><p style='display: grid; grid: auto / subgrid; grid-column: span 3'><i>aaaa</i></p>${cells}</div>`,
      set("i", "style", "grid-column: 3"),
    ],
    [
      "tracks that repeat automatically",
      `<div style='${fill}; width: 300px'>${cells}</div>`,
      set("div", "style", `${fill}; width: 100px`),
    ],
    [
      "a float that grows",
      `<div>${floats}<p style='clear: left'></p>${floats}</div>`,
      set("i", "style", "float: left; width: 9px; height: 30px"),
    ],
    [
      "an empty block beside floats that gets text",
      `<div>${floats}<p><b></b></p></div>`,
      (page: any) => (page.$("b").textContent = "a"),
    ],
    [
      "an empty block beside floats that starts to clear",
      `<div>${floats}<nav><p></p></nav></div>`,
      set("p", "style", "clear: left"),
    ],
    [
      "visibility: collapse that an anonymous row inherits",
      "<div style='display: table'>a</div>",
      set("div", "style", "display: table; visibility: collapse"),
    ],
    [
      "inline blocks that wrap",
      `<div style='width: 200px'>${"<i style='display: inline-block; vertical-align: top; width: 60px'>a</i> ".repeat(5)}</div>`,
      set("div", "style", "width: 130px"),
    ],
  ])("%s", (_, html, change) => {
    const measure = (page: any) =>
      [...page.document.body.querySelectorAll("*")].map(it => [it.getBoundingClientRect().toJSON(), it.scrollHeight]);
    using page = open("<body>" + html);
    const before = measure(page);
    change(page);
    using fresh = open("<body>" + page.document.body.innerHTML);
    expect(measure(page)).toEqual(measure(fresh));
    expect(measure(page)).not.toEqual(before);
  });
});

test.each([
  ["a word that is too long", "overflow-wrap: break-word", "aa <b>bbbbbbb</b> c", "0,0,20 0,10,50 0,20,20 20,20,20"],
  ["line-break: anywhere", "line-break: anywhere", "aaa bbbb cc", "0,0,50 0,10,50 0,20,10"],
  ["a soft hyphen", "", "aa bb&shy;cccc", "0,0,20 0,10,20 0,20,40"],
  ["text without a width", "", "aaaa&#x200b;bbbb", "0,0,40 0,10,40"],
  ["justification", "text-align: justify", "a b ccc d", "0,0,50 0,10,50"],
  ["text-indent", "text-indent: 20px", "aa bb cc", "20,0,20 0,10,50"],
  [
    "from right to left",
    "direction: rtl",
    "aa <b style='padding-left: 10px'>b</b> cccc",
    "20,0,10 30,0,20 10,0,10 10,10,40",
  ],
  ["tabs", "white-space: pre-wrap; tab-size: 2", "a\tb\tcc\td", "0,0,40 0,10,50"],
  ["break-spaces", "white-space: break-spaces", "aa    bbb", "0,0,50 0,10,40"],
  [
    "elements that are moved",
    "",
    "a <b style='vertical-align: 5px'>b</b> <i style='position: relative; left: 3px; top: 2px'>c dd</i>",
    "0,5,20 20,0,10 30,5,10 43,7,10 3,17,20",
  ],
  ["text-wrap: balance", "text-wrap: balance", "a b c d", "0,0,30 0,10,30"],
  ["text-wrap: pretty", "text-wrap: pretty", "a b c d e f g", "0,0,50 0,10,30 0,20,30"],
])("lines: %s", (_, style, html, expected) => {
  using page = open(
    `<body style="margin: 0"><p style="margin: 0; font: 10px/10px a; width: 90px; ${style}">${html}</p>`,
  );
  const texts = page.document.createTreeWalker(page.$("p"), 4);
  const range = page.document.createRange();
  for (const width of ["50px", "70px", "50px"]) {
    page.$("p").style.width = width;
    page.$("p").offsetHeight;
  }
  const rects: string[] = [];
  while (texts.nextNode()) {
    range.selectNodeContents(texts.currentNode);
    for (const it of range.getClientRects()) if (it.width > 0) rects.push([it.x, it.y, it.width].join());
  }
  expect(rects.join(" ")).toBe(expected);
});

test("a break is forced once before a box that a float pushes down", () => {
  using page = open(
    `<div style="width: 60px; columns: 2"><i style="float: left; width: 40px; height: 10px"></i><p style="columns: 2; break-before: column"></p></div>`,
  );
  expect(page.$("div").scrollWidth).toBeLessThan(200);
});

test("offsets in text count UTF-16", () => {
  using page = open(
    `<body style="margin: 0; font: 10px/10px a; white-space: pre"><p style="margin: 0">${"é😀a".repeat(40)}</p>`,
  );
  const range = page.document.createRange();
  const left = (offset: number) => (
    range.setStart(page.$("p").firstChild, offset),
    range.setEnd(page.$("p").firstChild, 160),
    range.getBoundingClientRect().x
  );
  expect([0, 1, 2, 3, 36, 37, 38, 39, 157, 158, 159].map(left)).toEqual([
    0, 10, 10, 20, 270, 280, 280, 290, 1180, 1180, 1190,
  ]);
});

test("many inline elements on a line take time that is linear in their number", () => {
  using page = open(
    `<p style="white-space: nowrap; direction: rtl">${"<i>a</i>".repeat(30_000)}</p><p>${"<output></output>".repeat(30_000)}<ruby>a<rt>b</ruby></p>`,
  );
  expect([...page.document.querySelectorAll("i")].at(-1).getClientRects().length).toBe(1);
});

test("lines go around a float before their block", () => {
  using page = open(
    `<body style="margin: 0; font: 10px/10px a; width: 50px"><i style="float: left; width: 20px; height: 15px"></i><p style="margin: 0">aa bb cc dd</p>`,
  );
  const range = page.document.createRange();
  range.selectNodeContents(page.$("p").firstChild);
  expect([...range.getClientRects()].map(it => [it.x, it.y, it.width].join())).toEqual([
    "20,0,20",
    "20,10,20",
    "0,20,50",
  ]);
});

test("a fixed box is laid out next to an absolute one with vertical text", () => {
  using page = open(
    `<div style="position: relative"><div><p style="position: absolute"><b style="display: inline-block; writing-mode: vertical-rl">a</b></p><p id=fixed style="position: fixed">a</p></div></div>`,
  );
  expect(page.$("#fixed").offsetHeight).toBeGreaterThan(0);
});

test("a scroll offset outlasts display: none and overflow: visible, but not removal", () => {
  using page = open(
    "<main><section><div style='overflow: scroll; height: 100px'><p style='height: 500px; margin: 0'></p></div></section></main>",
  );
  const [main, section, scroller] = ["main", "section", "div"].map(page.$);
  const after = (change: () => void, undo: () => void) => {
    scroller.scrollTop = 100;
    change();
    const meanwhile = scroller.scrollTop;
    undo();
    return [meanwhile, scroller.scrollTop];
  };
  for (const { style } of [main, scroller])
    expect(
      after(
        () => (style.display = "none"),
        () => (style.display = ""),
      ),
    ).toEqual([0, 100]);
  expect(
    after(
      () => (scroller.style.overflow = "visible"),
      () => (scroller.style.overflow = "scroll"),
    ),
  ).toEqual([0, 100]);
  expect(
    after(
      () => (main.style.display = "none"),
      () => (main.append(section), (main.style.display = "")),
    ),
  ).toEqual([0, 0]);
});

test("declarations may end with a block", () => {
  using page = open(
    `<style>@property --x { syntax: "*"; inherits: false; initial-value: {a} }</style><p style="color: green; {color: red}">`,
  );
  expect([page.computed("p", "color"), page.computed("p", "--x")]).toEqual(["rgb(0, 128, 0)", "{a}"]);
});

test("a scrollbar goes away once container units are known", () => {
  using page = open(
    `<div style="container-type: size; width: 100px; height: 100px; overflow: auto scroll"><p style="margin: 0; width: 100cqw; height: 200px">`,
  );
  expect(page.$("div").clientHeight).toBe(100);
});

test("the last element in the scope of a name has the timeline", () => {
  const scroller = (id: string, name: string) =>
    `<div id=${id} style="scroll-timeline: ${name}; overflow: scroll; height: 10px"><p style="height: 50px"></p></div>`;
  const follower = (name: string) => `<i style="animation: a 1s; animation-timeline: ${name}"></i>`;
  using page = open(`<style>@keyframes a { to { opacity: 0 } }</style>
    <section style="timeline-scope: --a">${follower("--a")}${scroller("a", "--a")}${scroller("b", "--a")}<nav style="timeline-scope: --a">${scroller("c", "--a")}${follower("--a")}</nav></section>
    <section style="timeline-scope: --a, --b">${scroller("e", "--b")}${follower("--a")}${follower("--b")}</section>`);
  const sources = () =>
    [...page.document.querySelectorAll("i")].map(it => it.getAnimations()[0].timeline?.source?.id ?? "-").join("");
  const changes = [
    () => {},
    () => (page.$("#b").style.scrollTimelineName = "none"),
    () => (page.$("nav").style.timelineScope = "none"),
    () => (page.$("#e").style.scrollTimelineName = "--a"),
    () => page.$("section").append(page.$("#a")),
  ];
  expect(changes.map(change => (change(), sources()))).toEqual(["bc-e", "ac-e", "cc-e", "cce-", "aae-"]);
});

describe("selectors", () => {
  test("a language with a subtag that is too long is none", () => {
    using page = open(`<p lang="fr-standard"></p><p lang="fr-ninechars"></p>`);
    expect([...page.document.querySelectorAll(":lang(fr)")].map(it => it.lang)).toEqual(["fr-standard"]);
  });

  test(":has() notices that the language has changed further up", () => {
    using page = open(
      `<style>div:has(:lang(en)) { width: 1px }</style><section lang="fr"><div><i></i></div></section>`,
    );
    expect(page.computed("div", "width")).not.toBe("1px");
    page.$("section").lang = "en";
    expect(page.computed("div", "width")).toBe("1px");
  });

  test.each([
    [":host", "1"],
    [":is(:host)", ""],
    [":where(:host)", ""],
  ])("%s with a default namespace", (selector, expected) => {
    using page = open("<p></p>");
    page.$("p").attachShadow({ mode: "open" }).innerHTML =
      `<style>@namespace url(http://www.w3.org/1999/xhtml); ${selector} { --a: 1 }</style>`;
    expect(page.computed("p", "--a")).toBe(expected);
  });

  test.each([":-internal-html", ":-internal-native", "::-internal-editor"])("%s is not for pages", selector => {
    using page = open(`<style>${selector}, p { width: 1px }</style><p></p>`);
    expect(() => page.document.querySelector(selector)).toThrow();
    expect(page.computed("p", "width")).not.toBe("1px");
  });

  test("the name of an unknown pseudo-element is escaped", () => {
    using page = open(`<style>::-webkit-\\ a {}</style>`);
    expect(page.$("style").sheet.cssRules[0].selectorText).toBe("::-webkit-\\ a");
  });

  test.each([3, 11, 12, 13, 40])("count among %d siblings", count => {
    using page = open(`<div>${"<p></p><i></i>".repeat(count)}</div>`);
    const all = [...page.$("div").children];
    const found = (selector: string) => all.flatMap((it, index) => (it.matches(selector) ? [index] : []));
    const where = (test: (index: number) => boolean) => [...all.keys()].filter(test);
    expect(found(":nth-child(3n + 1)")).toEqual(where(it => it % 3 == 0));
    expect(found(":nth-last-child(3n + 1)")).toEqual(where(it => (all.length - 1 - it) % 3 == 0));
    expect(found("p:nth-of-type(2n)")).toEqual(where(it => it % 4 == 2));
    expect(found("i:nth-last-of-type(-n + 2)")).toEqual(where(it => it % 2 == 1 && it >= all.length - 3));
  });
});

test("markers follow the rules that come and go", () => {
  using page = open(`<style>.a li { color: red }</style><ul><li></li></ul>`);
  const color = () => page.computed("li", "color", "::marker");
  page.$("ul").className = "a";
  expect(color()).toBe("rgb(255, 0, 0)");
  const style = page.document.head.appendChild(page.document.createElement("style"));
  style.textContent = ".b ::marker { color: blue }";
  page.$("ul").className = "a b";
  expect(color()).toBe("rgb(0, 0, 255)");
  style.remove();
  expect(color()).toBe("rgb(255, 0, 0)");
  page.$("ul").className = "";
  expect(color()).toBe("rgb(0, 0, 0)");
});

test("computed styles list some shorthands and aliases", () => {
  using page = open("<p></p>");
  const names = [...page.window.getComputedStyle(page.$("p"))];
  expect(names).toContainValues(["background-position", "font-variant", "text-decoration", "-webkit-writing-mode"]);
  expect(names).not.toContain("background-position-x");
  expect([...page.$("p").computedStyleMap().keys()]).toEqual(names);
});

test("style sheets are in tree order wherever they are inserted", () => {
  using page = open("<div></div>");
  for (const at of [0, 0, 1, 3, 2, 0, 5, 3, 8]) {
    const style = page.document.createElement("style");
    page.$("div").insertBefore(style, page.$("div").children[at] ?? null);
    expect([...page.document.styleSheets].map(it => it.ownerNode)).toEqual([
      ...page.document.querySelectorAll("style"),
    ]);
  }
});

test.each(["class", "style", "data-a", "title"])("attr(%s) follows the attribute", name => {
  using page = open(`<style>p::before { content: attr(${name}) }</style><p></p>`);
  for (const value of ["top: 1px;", "top: 2px;"]) {
    page.$("p").setAttribute(name, value);
    expect(page.computed("p", "content", "::before")).toBe(`"${value}"`);
  }
  page.$("p").style.top = "3px";
  if (name == "style") expect(page.computed("p", "content", "::before")).toBe('"top: 3px;"');
});

describe("values that scripts keep writing", () => {
  const sheet = `<style>.a { top: 1px; width: 5px } .b { width: 9px !important } p { position: relative; margin: 0 } p::before, i { content: ""; display: block; width: inherit; left: inherit; opacity: inherit; height: 3px }</style>`;
  const properties = [
    "left",
    "top",
    "width",
    "height",
    "opacity",
    "transform",
    "margin-left",
    "background-color",
    "inline-size",
    "z-index",
  ];
  const measure = (page: any) =>
    [...page.document.querySelectorAll("p, i")].map(it => [
      it.getAttribute("style"),
      it.getBoundingClientRect().toJSON(),
      properties.map(name => [page.computed(it, name), page.computed(it, name, "::before")]),
    ]);

  test.each<[string, (p: any, round: number, page: any) => void]>([
    ["new lengths", (p, i) => Object.assign(p.style, { left: i + "px", width: i * 1.5 + "px" })],
    [
      "the same property twice",
      (p, i) => (Object.assign(p.style, { left: "1px" }), Object.assign(p.style, { left: -i + "%" })),
    ],
    [
      "another property afterwards",
      (p, i) => Object.assign(p.style, { left: i + "px", [i % 2 ? "zIndex" : "color"]: i % 2 ? i : "red" }),
    ],
    [
      "a removal afterwards",
      (p, i) => (Object.assign(p.style, { left: i + "px", top: i + "px" }), i % 2 && p.style.removeProperty("left")),
    ],
    [
      "a class in between",
      (p, i) => ((p.style.left = i + "px"), p.classList.toggle(i % 3 ? "a" : "b"), (p.style.width = i + "px")),
    ],
    [
      "the attribute afterwards",
      (p, i) => ((p.style.left = i + "px"), i % 2 && p.setAttribute("style", p.getAttribute("style") + " top: 4px")),
    ],
    ["a clone", (p, i) => ((p.style.left = i + "px"), p.after(p.cloneNode(true)), (p.style.left = i + 0.5 + "px"))],
    ["a move", (p, i) => ((p.style.width = i + "px"), p.parentNode.append(p), (p.style.height = i + "px"))],
    ["the parent changes", (p, i) => ((p.style.width = i + "em"), (p.parentNode.style.fontSize = 10 + i + "px"))],
    ["a logical rival", (p, i) => Object.assign(p.style, { [i % 2 ? "width" : "inlineSize"]: i + "px" })],
    ["a shorthand", (p, i) => Object.assign(p.style, { [i % 2 ? "marginLeft" : "margin"]: i + "px" })],
    [
      "keywords and variables",
      (p, i) => (p.style.width = ["1px", "inherit", "2px", "var(--w, 7px)", "auto", "calc(1px + 2%)"][i % 6]),
    ],
    [
      "invalid values",
      (p, i) => (p.style.width = ["1px", "-1px", "2.px", "3", "4px ", "0", "-0px", ".5px", "1e1px"][i % 9]),
    ],
    ["opacity", (p, i) => (p.style.opacity = [0.5, 0.25, 1, 0.75, 0, 2, "50%"][i % 7])],
    [
      "transforms",
      (p, i) =>
        (p.style.transform = [
          `translate(${i}px, 2%)`,
          `scale(${i}) rotate(${i}deg)`,
          "none",
          `translate3d(0, ${i}px, 1px)`,
          "perspective(9px)",
          `translateX(${i}px)`,
        ][i % 6]),
    ],
    ["colors", (p, i) => (p.style.backgroundColor = `rgb(${i}, 0, 0)`)],
    ["without a box", (p, i) => ((p.style.left = i + "px"), (p.parentNode.style.display = i % 3 ? "" : "none"))],
    ["zoom", (p, i) => ((p.style.width = i + "px"), i == 3 && (p.parentNode.style.zoom = 2))],
  ])("%s", (_, change) => {
    using page = open(
      `${sheet}<div><p style="left: 0; width: 20px; opacity: 0.5; --x: 1"><i></i></p><p style="left: 0; width: 20px; opacity: 0.5; --x: 1"><i></i></p></div>`,
    );
    for (let round = 1; round <= 12; round++) {
      change(page.$("p"), round, page);
      page.document.body.offsetWidth;
      if (round % 4) continue;
      using fresh = open(sheet + page.document.body.innerHTML);
      expect(measure(page)).toEqual(measure(fresh));
    }
  });

  test.each([
    "width: var(--w, 12px)",
    "width: calc(var(--w) + var(--v))",
    "margin: var(--w) 1px; margin-left: 2px",
    "inline-size: var(--w)",
    "writing-mode: vertical-rl; inline-size: var(--w); height: 4px; block-size: var(--w)",
    "position: absolute; top: 0; left: var(--w); width: 5px",
    "transform: translateX(var(--w))",
    "font-size: var(--w); width: 1em",
    "border: var(--w) solid",
    "--w: 3px; width: var(--w)",
    "--w: inherit; width: var(--w)",
    "--v: calc(var(--w) * 2); width: var(--v)",
    "--u: 1px; width: var(--w)",
    "width: var(--back)",
    "width: if(style(--w: 3px): 8px; else: 9px)",
    "width: var(--w) !important",
    "display: none",
    "display: contents",
    "display: inline; padding-left: var(--w)",
    "display: list-item",
    "content-visibility: hidden",
    "zoom: 2; width: var(--w)",
    "animation: a 1s -0.5s paused linear",
    "container-name: c",
  ])("reach what has %s", declarations => {
    const sheet = `<style>
      @property --g { syntax: "<length>"; inherits: true; initial-value: 0px }
      @keyframes a { to { width: var(--w) } }
      @layer low { p { width: var(--w) } }
      @container c style(--w: 3px) { i { height: 9px } }
      body { --w: 3px; --v: 1px; --back: revert-layer }
      p { ${declarations} }
      i, .g::before { display: block; width: inherit; padding-top: var(--w); margin-left: var(--g) }
      .g::before, ::marker { content: var(--t) }
      rect { width: var(--w) }
    </style>`;
    const names = [
      "--w",
      "--v",
      "--g",
      "width",
      "height",
      "left",
      "margin-top",
      "margin-left",
      "padding-top",
      "padding-left",
      "transform",
      "font-size",
      "content",
    ];
    const measure = (page: any) =>
      [...page.document.body.querySelectorAll("*")].map(it => [
        it.getBoundingClientRect().toJSON(),
        names.map(name => [page.computed(it, name), page.computed(it, name, "::before")]),
      ]);
    const inside = `<p>a<i></i><i></i><b>b</b></p><p class="g">c<svg><rect height="1" /></svg></p>`;
    for (const own of ["", declarations]) {
      const given: Record<string, string> = { "--w": "0px", "--g": "0px", "--t": "none" };
      const source = () =>
        `${sheet}<div style="${own}; ${Object.entries(given)
          .map(it => it.join(":"))
          .join(";")}">${inside}</div><div>${inside}</div>`;
      using page = open(source());
      const values = [
        "1px",
        "2px",
        "3px",
        "4.5px",
        "-1px",
        "5px",
        "50%",
        "initial",
        "6px",
        "7px",
        "var(--v)",
        "8px",
        "9px",
        "1em",
        "#000",
        "10px",
      ];
      for (const [round, value] of values.entries()) {
        const set = (name: string, value: string) => page.$("div").style.setProperty(name, (given[name] = value));
        set("--w", value);
        if (round % 5 == 4) set("--v", round + "px");
        if (round % 6 == 5) set("--g", round + "em");
        if (round % 7 == 6) set("--t", `'${round}'`);
        page.document.body.offsetWidth;
        if (round % 4 == 0) continue;
        using fresh = open(source());
        // Nothing is generated in skipped contents until something else in them is asked for.
        for (const it of [page, fresh])
          for (const svg of it.document.querySelectorAll("svg")) svg.getBoundingClientRect();
        expect(measure(page)).toEqual(measure(fresh));
      }
    }
  });

  test("reach what is generated in skipped contents", () => {
    using page = open(
      `<style>p { content-visibility: hidden } p::before { content: ""; display: block; width: var(--w) }</style><p style="--w: 1px"><i></i></p>`,
    );
    page.$("i").getBoundingClientRect();
    page.$("p").style.setProperty("--w", "2px");
    page.document.body.offsetWidth;
    expect(page.computed("p", "width", "::before")).toBe("2px");
    page.$("p").style.setProperty("--content", "1");
    page.$("style").textContent += "p::before { content: normal }";
    expect(page.computed("p", "content", "::before")).toBe("none");
  });

  test("start discrete transitions of custom properties further down", () => {
    using page = open(`<div style="--w: 0"><p><i style="transition: --w 9s allow-discrete"></i></p></div>`);
    for (const value of ["1", "2", "3"]) {
      page.computed(page.$("i"), "--w");
      page.$("div").style.setProperty("--w", value);
      expect(
        page
          .$("i")
          .getAnimations()
          .map((it: any) => it.transitionProperty),
      ).toEqual(["--w"]);
      page.$("i").getAnimations()[0].finish();
      expect(page.computed(page.$("i"), "--w")).toBe(value);
    }
  });

  test("reach the document from its root", () => {
    using page = open(
      `<style>:root { --a: var(--b); padding-left: var(--c) } p { width: var(--a); height: var(--w); margin-left: var(--c) }</style><p></p>`,
    );
    const { style } = page.document.documentElement;
    for (let round = 1; round <= 9; round++) {
      style.setProperty(["--w", "--b", "--c"][round % 3], round + "px");
      style.setProperty("--w", round + "px");
      const { left, width, height } = page.$("p").getBoundingClientRect();
      expect([left, height]).toEqual([8 + (round < 2 ? 0 : 2 * (round - ((round + 1) % 3))), round]);
      expect(width).toBe(round - ((round + 2) % 3));
    }
  });

  test.each([
    "position: absolute; width: 20px",
    "position: absolute; width: 50%; margin: 3px auto 0 4%",
    "position: absolute; width: fit-content",
    "position: absolute; width: 20px; height: stretch",
    "position: absolute; width: 20px; max-width: stretch; right: 0",
    "position: absolute; width: 20px; direction: rtl; overflow: hidden",
    "position: fixed; width: 20px",
    "position: relative; width: 20px",
  ])("move a box with %s", declarations => {
    const measure = (page: any) =>
      [...page.document.body.querySelectorAll("*")].map(it => [
        it.getBoundingClientRect().toJSON(),
        it.scrollWidth,
        it.scrollHeight,
        it.clientWidth,
      ]);
    for (const around of [
      "position: relative; border: 2px solid",
      "position: relative; overflow: auto",
      "display: flex; transform: scale(2)",
      "display: grid; position: relative",
      "",
    ]) {
      const box = `<p style="left: 0; top: 0; ${declarations}">a b c <b style="position: absolute; top: 1px">d</b></p>`;
      using page = open(`<div style="width: 100px; height: 100px; ${around}">${box}<span>e ${box}</span>${box}</div>`);
      for (let round = 1; round <= 6; round++) {
        for (const { style } of page.document.querySelectorAll("p"))
          Object.assign(style, { left: round * 23.3 + "px", top: round ** 3 - 9 + "px" });
        if (round == 3) page.$("div").style.width = "150px";
        if (round == 4) page.$("p").append("f");
        using fresh = open(page.document.body.innerHTML);
        expect(measure(page)).toEqual(measure(fresh));
      }
    }
  });

  test("start transitions", () => {
    using page = open(`<p style="width: 1px; transition: width 9s">`);
    const widths = [2, 3].map(
      it => (
        page.document.body.offsetWidth,
        (page.$("p").style.width = it + "px"),
        page.$("p").getAnimations()[0].effect.getKeyframes()[1].width
      ),
    );
    expect(widths).toEqual(["2px", "3px"]);
  });

  test("are read like any other", () => {
    using page = open("<p></p><i></i>");
    for (const number of [
      "0.1",
      "123456789.123456",
      "0.000000000000001",
      "1234567890123456789",
      "-.5",
      "00.50",
      "33.333333333333336",
    ]) {
      page.$("p").style.cssText =
        `display: none; margin-left: ${number}px; transform: translate(${number}px) scale(${number})`;
      page.$("i").style.cssText =
        `display: none; margin-left: ${number}PX; transform: Translate(${number}px) Scale(${number})`;
      for (const property of ["margin-left", "transform"])
        expect(page.computed("p", property)).toBe(page.computed("i", property));
    }
  });
});

test("searches that follow each other see the new ancestors of a tree", () => {
  using page = open("<section></section>");
  const root = page.document.createElement("div");
  root.innerHTML = "<p></p>".repeat(50);
  for (let i = 0; i < 40; i++) root.querySelectorAll(`:not(.a${i})`);
  page.$("section").append(root);
  expect(root.querySelectorAll("section p").length).toBe(50);
});

test("searches that follow each other see what changes in between", () => {
  const item = (i: number) =>
    `<li class="a n${i % 7}">t<b id=b${i} title=${i % 3}>x</b><i class=c><svg><foreignObject><b class=a></b></foreignObject></svg></i></li>`;
  const items = Array.from({ length: 40 }, (_, i) => item(i)).join("");
  using page = open(`<ul>${items}</ul>text<ol>${items}</ol><div></div><template>${items}</template>`);
  const { document } = page;
  const [shadow, detached] = [page.$("div").attachShadow({ mode: "open" }), page.$("ul").cloneNode(true)];
  shadow.innerHTML = items;
  const roots = [
    document,
    page.$("ul"),
    page.$("ol li:last-child"),
    page.$("i"),
    page.$("div"),
    shadow,
    detached,
    detached.lastChild,
    page.$("template").content,
  ];
  const selectors = [
    "b",
    ".a",
    ".on",
    "li.n3 > b",
    "ul .c b",
    "[title='1']",
    "[data-on]",
    "#b5",
    ".n1 b, .on, i",
    ":is(.on, .n2) > *",
    "*",
    "b:first-child",
    "li + li.n0",
    "foreignObject",
    ":not(.a)",
  ];
  const below = (root: any): any[] => [...root.children].flatMap(it => [it, ...below(it)]);
  const changes = [
    (it: any) => it.classList.toggle("on"),
    (it: any) => it.toggleAttribute("data-on"),
    (it: any) => it.setAttribute("title", "1"),
    (it: any) => (it.id = "b5"),
    (it: any) => it.removeAttribute("class"),
    (it: any) => it.append("text"),
    (it: any) => it.append(document.createElement("b")),
    (it: any) => it.parentNode.prepend(it),
    (it: any) => (it.innerHTML = item(3)),
    (it: any) => (it.textContent = ""),
    (it: any) => it.remove(),
  ];
  for (const root of roots) {
    for (const [index, change] of changes.entries()) {
      for (let round = 0; round < 40; round++) (document.head.toggleAttribute("x"), root.querySelectorAll("*"));
      const before = below(root);
      if (before.length) change(before[(index * 5) % before.length]);
      const all = below(root);
      for (const selector of selectors) {
        const expected = all.filter(it => it.matches(selector)).map(it => all.indexOf(it));
        expect([...root.querySelectorAll(selector)].map(it => all.indexOf(it))).toEqual(expected);
        expect(all.indexOf(root.querySelector(selector))).toBe(expected[0] ?? -1);
      }
    }
  }
});
