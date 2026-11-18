import { desktopInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows } from "harness";

let nextFontScope = 5000;

/** They take up room on every platform. */
const scrollbars = "<style>::-webkit-scrollbar { width: 15px; height: 15px }</style>";

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
  ["-electron-corner-smoothing", "system-ui", null, null],
  ["-electron-corner-smoothing", "150%", null, null],
  ["-electron-corner-smoothing", "calc(10% + 20%)", "calc(30%)", "30%"],
  ["-electron-corner-smoothing", "initial", null, "none"],
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
  ["-electron-corner-smoothing", "none"],
  ["-electron-corner-smoothing", "-1%"],
  ["-electron-corner-smoothing", "0.5"],
])("%s: %s is invalid", (property, value) => {
  using page = open();
  expect(page.window.CSS.supports(property, value)).toBe(false);
});

test("-electron-corner-smoothing is not inherited, and only has its dashed name", () => {
  using page = open(
    "<div style='-electron-corner-smoothing: 60%'><p></p><i style='-electron-corner-smoothing: inherit'></i></div>",
  );
  expect(["div", "p", "i"].map(it => page.computed(it, "-electron-corner-smoothing"))).toEqual(["60%", "none", "60%"]);
  expect(
    ["-electron-corner-smoothing", "electronCornerSmoothing", "ElectronCornerSmoothing"].map(
      it => it in page.$("p").style,
    ),
  ).toEqual([true, false, false]);
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
            [
              isWindows ? "rgb(0, 120, 212)" : "rgba(0, 65, 198, 0.8)",
              "rgb(255, 255, 255)",
              "rgb(25, 103, 210)",
              "rgb(255, 255, 255)",
            ],
            [
              isWindows ? "rgb(25, 103, 210)" : "rgba(0, 65, 198, 0.8)",
              "rgb(255, 255, 255)",
              "rgb(153, 200, 255)",
              "rgb(59, 59, 59)",
            ],
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
      scrollbars +
        "<div style='container-type: inline-size; width: 400px; height: 9px; overflow-y: auto'><p style='width: 100cqi; height: 99px'>",
    );
    expect(page.computed("p", "width")).toBe("400px");
  });

  test("a scrollbar that makes itself unnecessary stays, and starts no transition", () => {
    using page =
      open(`${scrollbars}<style>p { height: 200px; margin: 0; order: 1 } @container (max-width: 99px) { p { height: 9px; order: 5; transition: order 9s } }</style>
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

test("very many counters are kept apart", () => {
  const names = Array.from({ length: 40_000 }, (_, i) => `c${i} ${i}`).join(" ");
  using page =
    open(`<style>* { counter-reset: ${names} } span { font: 10px monospace } #a::before { counter-reset: none; content: counter(c39999) }</style>
    ${"<i></i>".repeat(20)}<span id=a></span><br><span id=b>39999</span>`);
  const width = (id: string) => page.document.getElementById(id).getBoundingClientRect().width;
  expect(width("a")).toBe(width("b"));
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

test("a transition ends at the limit of lengths", () => {
  using page = open(`<p style="transition: 100s -50s linear; x: 0px; r: 0px; width: 0px">`);
  const [{ style }, computed] = [page.$("p"), page.window.getComputedStyle(page.$("p"))];
  computed.x;
  style.x = style.r = style.width = "4294967296px";
  expect([computed.x, computed.r, computed.width]).toEqual(Array(3).fill("1.67772e+07px"));
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
  using page = open(`${scrollbars}<div style="width: 9000px; padding-top: 1px"></div>`);
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

test.each<[string, string, (a: any) => unknown, unknown]>([
  [
    "a percentage in the width of a control counts for nothing in its least width",
    "<div id=a style='width: min-content'><input style='width: calc(10% + 40px); padding: 0; border: 0; display: block'></div>",
    a => a.offsetWidth,
    40,
  ],
  [
    "offsets are around the pieces of a box",
    "<div style='columns: 2; gap: 0; width: 100px; height: 30px; column-fill: auto'><div id=a style='height: 50px'></div></div>",
    a => [a.offsetWidth, a.offsetHeight],
    [100, 30],
  ],
  [
    "margins that collapse through the last box count once for scrolling",
    "<div id=a style='overflow: hidden; height: 10px'><div style='height: 50px; margin-bottom: 20px'></div><div style='margin: 10px 0 5px'></div></div>",
    a => a.scrollHeight,
    70,
  ],
  [
    "an absolute box in a spanner",
    "<div style='position: relative; columns: 2; gap: 0; width: 100px'><div style='height: 20px'></div><div><div style='column-span: all; height: 10px'><div id=a style='position: absolute; width: 50%; height: 5px'></div></div></div></div>",
    a => [a.offsetLeft, a.offsetTop, a.offsetWidth],
    [0, 10, 50],
  ],
  [
    "a legend in display: contents",
    "<fieldset style='margin: 0; padding: 0; border: 10px solid'><div style='display: contents'><legend id=a style='height: 20px'></legend></div></fieldset>",
    a => [a.offsetTop, a.parentNode.parentNode.offsetHeight],
    [0, 30],
  ],
  [
    "the baseline of a clamped inline box is that of the last line that is shown",
    "<div style='font: 10px/10px a'><i id=a style='display: inline-block; width: 5px; height: 5px'></i><div style='display: -webkit-inline-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2'>a<br>b<br>c</div></div>",
    a => a.offsetTop,
    13,
  ],
  [
    "an orthogonal grid item with a ratio makes room in its row",
    "<div id=a style='display: grid; grid-template-columns: 40px'><div style='aspect-ratio: 2; writing-mode: vertical-lr'></div></div>",
    a => [a.offsetHeight, a.firstChild.offsetWidth, a.firstChild.offsetHeight],
    [20, 40, 20],
  ],
  [
    "nested columns that start at the end of a column",
    "<div style='columns: 2; gap: 0; width: 120px; font: 10px/18px a'><div>a</div><div id=a style='columns: 3; gap: 0; break-inside: avoid'><div>a</div><div><div style='float: right'>bb</div></div><div style='padding: 1px'><div style='border: 1px solid'>c</div></div></div></div>",
    a => [...a.getClientRects()].map(it => [it.x, it.y, it.height].join()),
    ["60,0,20"],
  ],
  [
    "the rectangles of an inline element around a block are in order",
    "<span id=a style='font: 10px/10px a'>a<div style='height: 5px'></div>b</span>",
    a => [...a.getClientRects()].map(it => it.height),
    [10, 5, 10],
  ],
  [
    "percentages in the padding of a table add to its width",
    "<div style='width: 200px'><div id=a style='display: table; padding: 5%'><div style='width: 10px'></div></div></div>",
    a => a.offsetWidth,
    30,
  ],
  [
    "a replaced element is no table cell",
    "<canvas id=a width=20 height=10 style='display: table-cell'></canvas>",
    a => [a.offsetWidth, a.offsetHeight],
    [20, 10],
  ],
  [
    "a replaced element is no table row",
    "<div style='display: table'><canvas id=a width=20 height=10 style='display: table-row'></canvas></div>",
    a => [a.offsetWidth, a.offsetHeight],
    [20, 10],
  ],
  [
    "a fieldset is no table cell",
    "<div style='width: 50px'><fieldset id=a style='display: table-cell; margin: 0'></fieldset></div>",
    a => a.offsetWidth,
    50,
  ],
  [
    "a row group has the writing mode of its table",
    "<div id=a style='display: table-row-group; writing-mode: vertical-rl'></div>",
    a => a.ownerDocument.defaultView.getComputedStyle(a).writingMode,
    "horizontal-tb",
  ],
  [
    "the last baseline of clamped vertical lines",
    "<div style='writing-mode: vertical-lr; font: 10px/10px a; height: 90px'><i id=a style='display: inline-block; width: 10px; height: 5px'></i><div style='baseline-source: last; overflow: hidden; display: -webkit-inline-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3'>a<br>b<br>c<br>d</div></div>",
    a => a.offsetLeft,
    20,
  ],
  [
    "blocks next to each other in an inline element have one rectangle",
    "<span id=a><div style='height: 5px'></div><div style='height: 5px; margin-top: 1px'></div></span>",
    a => [...a.getClientRects()].map(it => it.height),
    [0, 11, 0],
  ],
  [
    "an absolute block after text from the right",
    "<div dir=rtl style='font: 10px/10px a'>a<div id=a style='position: absolute'></div></div>",
    a => a.offsetTop,
    10,
  ],
  [
    "a float in the middle of a word leaves the line where it is",
    "<div id=a style='font: 10px/10px a; width: 50px'>aa<div style='float: right; width: 30px; height: 10px'></div>aa</div>",
    a => a.offsetHeight,
    10,
  ],
  [
    "a float goes down with its line",
    "<div style='font: 10px/10px a; width: 50px'><div style='float: left; width: 50px; height: 10px'></div>a<div id=a style='float: left'></div></div>",
    a => a.offsetTop,
    10,
  ],
  [
    "a float without a width excludes nothing",
    "<div style='margin-left: 50px'><div style='float: left; height: 50px'></div></div><div id=a style='display: flow-root; height: 5px'></div>",
    a => a.offsetLeft,
    0,
  ],
  [
    "negative margins do not count beside a float",
    "<div style='width: 100px'><div style='float: left; width: 10px; height: 10px'></div><div id=a style='display: flow-root; margin: 0 -3px; height: 5px'></div></div>",
    a => [a.offsetLeft, a.offsetTop, a.offsetWidth],
    [10, 0, 90],
  ],
  [
    "the last margin is no part of the least height of a box with a ratio",
    "<div id=a style='width: 10px; aspect-ratio: 2'><div style='height: 10px; margin-bottom: 5px'></div></div>",
    a => a.offsetHeight,
    10,
  ],
  [
    "an empty list item is as tall as a line",
    "<div id=a style='display: list-item; font: 20px/5px a'></div>",
    a => a.offsetHeight,
    5,
  ],
  [
    "a button without a baseline stands on its content edge",
    "<div style='font: 10px/10px a'><button id=a style='contain: layout; padding: 0 0 5px; border: 0'></button></div>",
    a => [a.offsetTop, a.parentNode.offsetHeight],
    [8, 13],
  ],
  [
    "an empty button is aligned by its border in a flex container",
    "<div style='display: flex; align-items: baseline'><button id=a style='padding: 0 0 5px; border: 0'></button><i style='height: 9px'></i></div>",
    a => a.offsetTop,
    4,
  ],
  [
    "an absolute cell leaves a cell behind",
    "<table><td style='padding: 5px'><td id=a style='position: absolute'><td></table>",
    a => [a.offsetLeft, a.closest("table").offsetWidth],
    [14, 20],
  ],
  [
    "a table without columns has spacing in its least width only",
    "<div id=a style='width: max-content'><table><tr></table></div>",
    a => [a.offsetWidth, a.firstChild.offsetWidth, a.querySelector("tr").offsetLeft],
    [4, 0, 0],
  ],
  [
    "a table without cells has no collapsed borders",
    "<table id=a style='border: 4px solid; border-collapse: collapse'></table>",
    a => a.offsetWidth,
    0,
  ],
  [
    "a group of collapsed rows keeps its spacing",
    "<table id=a><tbody style='visibility: collapse'><tr><td><tbody><tr><td></table>",
    a => a.offsetHeight,
    8,
  ],
  [
    "a collapsed row does not overflow",
    "<div id=a style='overflow: hidden'><table><tr><td><tr style='visibility: collapse'><td style='font: 50px/50px a'>a</table></div>",
    a => a.scrollHeight,
    6,
  ],
  [
    "emphasis marks are above a replaced element",
    "<div style='font: 10px/10px a; text-emphasis: circle'><canvas id=a width=9 height=9></canvas></div>",
    a => a.offsetTop,
    5,
  ],
  [
    "an empty annotation takes no room",
    "<div id=a style='font: 10px/10px a'><ruby>a<rt></rt></ruby></div>",
    a => a.offsetHeight,
    10,
  ],
  [
    "a plain inline element makes its line higher",
    "<div id=a style='font: 10px/10px a'>a <span style='line-height: 30px'>b</span> <span style='font-size: 20px'>c</span></div>",
    a => a.offsetHeight,
    30,
  ],
  [
    "a plain inline element is hit",
    "<div style='font: 10px/10px a'>a <span id=a>b</span> c</div>",
    a => [15, 25, 35].map(x => a.ownerDocument.elementFromPoint(x, 5).localName),
    ["div", "span", "div"],
  ],
  [
    "a plain inline element in kept white space",
    "<div style='font: 10px/10px a; white-space: pre'>a<span id=a>b&#10;&#10;c&#9;d&#10;</span>e</div>",
    a => [...a.getClientRects()].map(it => [it.x, it.y, it.width, it.height].join()),
    ["10,0,10,10", "20,0,0,10", "0,10,0,10", "0,20,10,10", "10,20,70,10", "80,20,10,10", "90,20,0,10"],
  ],
  [
    "kept spaces hang at the end of a line",
    "<div id=a style='font: 10px/10px a; width: 40px; white-space: pre-wrap; text-align: right; overflow: hidden'>aa    bb      &#10;c  &#10;&#10;d&#9;e</div>",
    a =>
      (it => (
        it.selectNodeContents(a),
        [a.offsetHeight, a.scrollWidth, ...[...it.getClientRects()].map(it => [it.x, it.y, it.width].join())]
      ))(a.ownerDocument.createRange()),
    [
      60,
      40,
      "20,0,20",
      "40,0,40",
      "0,10,20",
      "20,10,60",
      "80,10,0",
      "10,20,30",
      "40,20,0",
      "40,30,0",
      "30,40,10",
      "40,40,70",
      "30,50,10",
    ],
  ],
  [
    "kept text breaks inside a word that is too long",
    "<div id=a style='font: 10px/10px a; width: 30px; white-space: pre-wrap; overflow-wrap: break-word'>aaaaaaa b&#10;cccc</div>",
    a =>
      (it => (it.selectNodeContents(a), [...it.getClientRects()].map(it => [it.x, it.y, it.width].join())))(
        a.ownerDocument.createRange(),
      ),
    ["0,0,30", "0,10,30", "0,20,30", "30,20,0", "0,30,30", "0,40,10"],
  ],
  [
    "a table has no scrollbars",
    scrollbars + "<div id=a style='display: table; overflow: scroll'></div>",
    a => a.offsetWidth,
    0,
  ],
  [
    "an empty table keeps its ratio",
    "<div id=a style='display: table; height: 32px; aspect-ratio: 1 / 2'></div>",
    a => a.offsetWidth,
    16,
  ],
  [
    "clamped vertical lines in nested blocks",
    "<div id=a style='writing-mode: vertical-rl; font: 10px/10px a; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden'>a<div><div style='padding: 1px'>a<br>a<br>a<br>a</div></div></div>",
    a => [a.offsetWidth, ...[...a.querySelectorAll("div, br")].map(it => it.getBoundingClientRect().x)],
    [32, 0, 0, 11, 1, -9],
  ],
  ["a line break has no offsets", "<div>a<br id=a>b</div>", a => [a.offsetLeft, a.offsetHeight], [0, 0]],
  [
    "an outside marker is beside a float",
    "<div style='float: left; width: 100px; height: 50px'></div><ul id=a style='font: 20px/20px a; margin: 0; padding: 0 0 0 40px; list-style-type: \"aa\"'><li>a</ul>",
    a => [10, 70].map(x => a.ownerDocument.elementFromPoint(x, 10).localName),
    ["div", "li"],
  ],
  [
    "a list item without lines is as high as its marker",
    "<ul id=a style='font: 20px/20px a; margin: 0; padding: 0 0 0 40px; list-style-type: \"aa\"'><li style='padding: 5px'><div style='height: 3px'></div><li style='height: 4px'><div style='height: 3px'></div></ul>",
    a => [...a.children].map(it => it.offsetHeight),
    [20, 20],
  ],
  [
    "an outside marker pushes the first line down and no more",
    "<ul style='font: 20px/20px a; margin: 0; padding: 0 0 0 40px; list-style-type: \"aa\"'><li id=a><div style='margin-top: 20px; font-size: 10px; line-height: 10px'>a</div></ul>",
    a => [a.offsetHeight, a.firstChild.offsetTop],
    [18, 28],
  ],
  [
    "margins do not collapse through a marker",
    "<div id=a style='overflow: hidden'><div style='margin-bottom: 9px'></div><div style='display: list-item; height: 0'></div><div style='margin-top: 9px'></div></div>",
    a => a.clientHeight,
    18,
  ],
  [
    "an inside bullet has its line height",
    "<div id=a style='display: list-item; list-style-position: inside; font: 0/1 a'><style>#a::marker { font-size: 10px; line-height: 30px }</style></div>",
    a => a.offsetHeight,
    30,
  ],
  [
    "an inside marker wraps",
    "<div id=a style='display: list-item; list-style: inside \"aa\"; font: 10px/10px a; width: 0; word-break: break-all'></div>",
    a => a.offsetHeight,
    20,
  ],
  [
    "-webkit-box-pack, -webkit-box-direction and -webkit-box-ordinal-group",
    "<div id=a style='display: -webkit-box; width: 100px; -webkit-box-pack: end; -webkit-box-direction: reverse'><div style='width: 10px; -webkit-box-ordinal-group: 2'></div><div style='width: 20px; order: 5'></div></div>",
    a => [...a.children].map(it => it.offsetLeft),
    [0, 10],
  ],
  [
    "-webkit-box makes no flex container of a fieldset",
    "<fieldset style='display: -webkit-box; width: 50px'><div id=a></div></fieldset>",
    a => a.offsetWidth,
    50,
  ],
  [
    "margin-trim trims spanners",
    "<div id=a style='columns: 2; margin-trim: block'><div style='column-span: all; margin: 20px 0; height: 10px'></div></div>",
    a => [a.offsetHeight, a.firstChild.offsetTop],
    [10, 0],
  ],
  [
    "margin-trim reaches empty boxes in the last box",
    "<div style='margin-trim: block'><div><div style='height: 10px'></div><div id=a style='margin: 50px 0'></div></div></div>",
    a => a.offsetTop,
    10,
  ],
  [
    "a range that ends in a surrogate pair has all of it",
    "<div id=a style='font: 10px/10px a'>a&#x1d7d8;</div>",
    a =>
      (it => (it.setStart(a.firstChild, 0), it.setEnd(a.firstChild, 2), it.getBoundingClientRect().width > 10))(
        a.ownerDocument.createRange(),
      ),
    true,
  ],
  [
    "a space that collapses at the end of a line has no rectangle",
    "<div style='font: 10px/10px a; width: 30px'>aa<b id=a> </b>bb<wbr></div>",
    a =>
      (it => (it.selectNodeContents(a), [it.getClientRects().length, a.parentNode.lastChild.getClientRects().length]))(
        a.ownerDocument.createRange(),
      ),
    [0, 0],
  ],
  [
    "a space after an inside marker collapses",
    "<div style='display: list-item; list-style: inside decimal; font: 10px/10px a'> <b id=a>a</b></div>",
    a => a.offsetLeft,
    30,
  ],
  [
    "spaces of several elements hang",
    "<div id=a style='font: 10px/10px a; width: 20px; white-space: pre-wrap; overflow: hidden'>aa <i style='font: inherit'> </i><i style='font: inherit'></i>a</div>",
    a => a.scrollWidth,
    20,
  ],
  [
    "spaces of several elements hang beside a padded one",
    "<div id=a style='font: 10px/10px a; width: 20px; white-space: pre-wrap; overflow: hidden'>aa <i style='font: inherit'> </i><i style='font: inherit'></i><i style='padding-top: 1px'>a</i></div>",
    a => a.scrollWidth,
    20,
  ],
  [
    "spaces of several elements hang to the left",
    "<div id=a dir=rtl style='font: 10px/10px a; width: 20px; white-space: pre-wrap; overflow: hidden'>aa <i style='font: inherit'> </i><i style='font: inherit'></i>a</div>",
    a => a.scrollWidth,
    20,
  ],
  [
    "elements in kept white space",
    "<div id=a style='font: 10px/10px a; width: 50px; white-space: pre-wrap'><i style='font: inherit'>aa <i style='font: inherit'>bbb&#10;</i></i><i style='font: inherit'></i><i style='font: inherit'>&#9;c&#10;&#10;</i>d</div>",
    a =>
      [...a.querySelectorAll("i")].map((it, index) =>
        [...(index ? it.getClientRects() : [it.getBoundingClientRect()])]
          .map(it => [it.x, it.y, it.width, it.height].join())
          .join(" "),
      ),
    ["0,0,30,20", "0,10,30,10 30,10,0,10", "0,20,0,10", "0,20,80,10 0,30,10,10 10,30,0,10 0,40,0,10"],
  ],
  [
    "spaces collapse in an inside marker",
    "<div style='display: list-item; list-style: inside \"  a   b  \"; font: 10px/10px a'><b id=a>a</b></div>",
    a => [a.offsetLeft, a.offsetTop],
    [40, 0],
  ],
  [
    "an inside marker keeps white space if its list item does",
    "<div style='display: list-item; list-style: inside \"a  \"; font: 10px/10px a; white-space: pre; width: 0'> <b id=a>a</b></div>",
    a => [a.offsetLeft, a.offsetTop],
    [40, 0],
  ],
  [
    "a line may break between elements that do not wrap",
    "<div id=a style='font: 10px/10px a; width: 10px'><span style='white-space: pre'>a-</span><span style='white-space: pre'>a</span></div>",
    a => a.offsetHeight,
    20,
  ],
  [
    "a negative margin makes a box too wide for the side of a float",
    "<div style='width: 50px; margin-left: 50px'><div style='float: right; width: 25px; height: 50px'></div><div id=a style='overflow: hidden; margin-left: -50px'></div></div>",
    a => [a.offsetLeft, a.offsetTop, a.offsetWidth],
    [0, 50, 100],
  ],
  [
    "boxes of the same style differ by their tags",
    "<style>#a > * { all: unset; display: block; font: 10px/10px a }</style><div id=a style='width: 90px'><p>a</p><button>a</button><p>a</p><fieldset><legend>a</legend>a</fieldset></div>",
    a => [...a.querySelectorAll("*")].map(it => it.offsetWidth),
    [90, 10, 90, 90, 14],
  ],
  [
    "boxes of the same style differ by the writing mode of their parents",
    "<style>p { writing-mode: horizontal-tb; margin: 5px 0; height: 5px; width: 5px } i { display: block; margin: 9px 0; height: 1px }</style><div id=a style='overflow: hidden'><div><p><i></i></p></div><div style='writing-mode: vertical-lr'><p><i></i></p></div></div>",
    a => [...a.querySelectorAll("i")].map(it => it.offsetTop - it.parentNode.offsetTop),
    [0, 9],
  ],
  [
    "a cell that gets a span",
    "<table style='border-spacing: 0'><tr><td id=a style='padding: 0'><tr><td style='padding: 5px'><td style='padding: 5px'></table>",
    a => [a.offsetWidth, ((a.colSpan = 2), a.offsetWidth)],
    [10, 20],
  ],
  [
    "what sticks out of a cell is scrolled to",
    "<div id=a style='overflow: hidden; width: 20px; height: 20px'><table style='border-spacing: 0; table-layout: fixed; width: 10px'><tr><td style='padding: 0'><div style='width: 50px; height: 1px'></div></table></div>",
    a => [a.scrollWidth, ((a.querySelector("td div").style.width = "70px"), a.scrollWidth)],
    [50, 70],
  ],
  [
    "the space at the end of the only text collapses",
    "<div id=a style='font: 10px/10px a; float: left'>a a </div>",
    a =>
      (it => (
        it.setStart(a.firstChild, 2),
        it.setEnd(a.firstChild, 4),
        [a.offsetWidth, it.getBoundingClientRect().x, it.getBoundingClientRect().width]
      ))(a.ownerDocument.createRange()),
    [30, 20, 10],
  ],
  [
    "a positioned table has no more room than its containing block",
    "<div style='position: relative; width: 50px; margin-left: 50px'><table id=a style='position: absolute; left: -50px; border-spacing: 0; font: 10px/10px a'><td style='padding: 0'>a a a a a a</table></div>",
    a => [a.offsetLeft, a.offsetWidth],
    [-50, 50],
  ],
  [
    "percentages of what is replaced are of the height that a cell is given",
    "<table style='border-spacing: 0'><td style='padding: 0; height: 20px; line-height: 0'><canvas id=a width=1 height=1 style='height: 200%'></canvas><td style='padding: 0'><div style='height: 60px'></div></table>",
    a => [
      a.offsetWidth,
      a.parentNode.offsetWidth,
      ((a.parentNode.style.height = "10px"), a.offsetWidth),
      a.parentNode.offsetWidth,
    ],
    [40, 40, 20, 20],
  ],
  [
    "a cell without a line has its baseline at the end of its content",
    "<table style='border-spacing: 0; font: 10px/10px a'><tr style='vertical-align: baseline'><td style='padding: 0 0 7px'><div id=a style='height: 3px'></div><td style='padding: 0'>a</table>",
    a => [a.getBoundingClientRect().y, a.parentNode.offsetHeight],
    [5, 15],
  ],
  [
    "the baseline of a row does not move what is only positioned",
    "<table style='border-spacing: 0; font: 10px/10px a'><tr style='vertical-align: baseline'><td style='padding: 0'><div id=a style='position: absolute'></div><td style='padding: 0'>a</table>",
    a => a.getBoundingClientRect().y,
    0,
  ],
  [
    "the baseline of a row follows percentages of its height",
    "<table style='border-spacing: 0; height: 100px'><tr style='vertical-align: baseline'><td style='padding: 0'><div id=a style='height: 50%'></div><td style='padding: 0'><div style='height: 80%'></div></table>",
    a => a.getBoundingClientRect().y,
    30,
  ],
  [
    "a row without cells has its baseline at the top",
    "<div style='font: 10px/10px a'>a<table id=a style='display: inline-table; border-spacing: 0'><tr style='height: 20px'></table></div>",
    a => a.offsetTop,
    8,
  ],
  [
    "a button that is higher than what is in it centers that",
    "<button style='all: unset; display: block; height: 30px; font: 10px/10px a'><div id=a>a</div></button>",
    a => [a.offsetTop, a.parentNode.offsetWidth, ((a.parentNode.style.height = "50px"), a.offsetTop)],
    [10, 10, 20],
  ],
  [
    "a button in a row is stretched around what is in it",
    "<div style='display: flex; height: 30px'><button style='all: unset; font: 10px/10px a'><b id=a style='font: inherit'>a</b></button></div>",
    a => [a.offsetTop, ((a.parentNode.parentNode.style.height = "50px"), a.offsetTop)],
    [10, 20],
  ],
  [
    "a box that shrinks takes its offset along",
    "<div id=a style='overflow: hidden; height: 10px'><div style='height: 50px'></div></div>",
    a => [((a.scrollTop = 40), a.scrollTop), ((a.style.height = "30px"), a.offsetHeight, a.scrollTop)],
    [40, 20],
  ],
  [
    "a text field measures as itself and scrolls as its text",
    "<input id=a value=aaaaaaaa style='font: 10px/10px a; border: 1px solid; padding: 5px 7px; width: 50px; height: 20px'>",
    a => [a.clientWidth, a.clientHeight, a.scrollWidth, a.scrollHeight],
    [64, 30, 94, 30],
  ],
  [
    "an empty grid that can be edited has a line",
    "<div id=a contenteditable style='display: grid; font: 10px/10px a'></div>",
    a => a.offsetHeight,
    10,
  ],
  [
    "align-content does not push anything out at the start of what scrolls",
    "<div style='overflow: hidden; height: 10px; align-content: end'><div id=a style='height: 30px'></div></div>",
    a => a.offsetTop,
    0,
  ],
  [
    "a line that overflows ends before an inline block with a negative margin",
    "<div id=a style='width: min-content; font-size: 0'><i style='display: inline-block; width: 20px'></i> <i style='display: inline-block; margin-right: -10px'></i></div>",
    a => a.offsetWidth,
    20,
  ],
  [
    "text is beside the floats before one that clears",
    "<div id=a style='width: max-content; font: 10px/10px a'><div style='float: left; width: 50px; height: 5px'></div><div style='float: left; clear: left; width: 30px; height: 5px'></div>aa</div>",
    a => a.offsetWidth,
    70,
  ],
  [
    "a vertical table is as wide as its rows",
    "<div style='position: relative; width: 50px; height: 20px'><table id=a style='position: absolute; right: 0; width: 10px; writing-mode: vertical-lr; border-spacing: 0'><td style='padding: 0'><div style='width: 30px'></div></table></div>",
    a => [a.offsetLeft, a.offsetWidth],
    [20, 30],
  ],
  [
    "a vertical table is split between columns",
    "<div style='writing-mode: vertical-lr; columns: 2; gap: 0; column-fill: auto; width: 20px; height: 40px'><table style='border-spacing: 0; height: 100%'><td id=a style='padding: 0'><div style='width: 30px'></div></table></div>",
    a => [...a.getClientRects()].map(it => [it.x, it.y, it.width, it.height]),
    [
      [0, 0, 20, 20],
      [0, 20, 10, 20],
    ],
  ],
  [
    "align-content takes a cell off the baseline",
    "<table style='border-spacing: 0; font: 10px/10px a'><tr style='vertical-align: baseline'><td style='padding: 0; align-content: start'><div id=a>a</div><td style='padding: 20px 0 0'>a</table>",
    a => a.getBoundingClientRect().y,
    0,
  ],
  [
    "punctuation is only a first letter if a letter follows",
    "<style>p { float: left; clear: left; margin: 0; font: 10px/10px a } p::first-letter { font-size: 20px }</style><div id=a><p>.<p>.<i>a</i><p>.<br>a<p><wbr>a<p>.<i style='float: left'></i>a<p>.<i style='display: inline-block'>a</i><p><q></q></div>",
    a => [...a.children].map(it => it.offsetWidth),
    [10, 30, 10, 10, 30, 20, 20],
  ],
  [
    "an annotation is as high as what is in it",
    "<div id=a style='font: 10px/10px a'><ruby>a<rt><i style='display: inline-block; width: 5px; height: 30px'></i></rt></ruby></div>",
    a => [a.offsetHeight, a.querySelector("i").offsetTop, a.querySelector("rt").getBoundingClientRect().height],
    [40, 0, 5],
  ],
  [
    "the annotations of a line share their baseline",
    "<div id=a style='font: 10px/10px a'><ruby>a<rt>a</rt><b style='font: 20px/20px a'>a</b><rt>a</rt></ruby></div>",
    a => [...a.querySelectorAll("rt")].map(it => it.getBoundingClientRect().y),
    [0, 0],
  ],
  [
    "an annotation has margins",
    "<div id=a style='font: 10px/10px a'><ruby>a<rt style='margin: 10px'>a</rt></ruby></div>",
    a => (it => [a.offsetHeight, it.x, it.y, it.width])(a.querySelector("rt").getBoundingClientRect()),
    [35, 10, 10, 5],
  ],
  [
    "text-box-trim of columns applies to each",
    "<div style='columns: 2; gap: 0; column-fill: auto; width: 40px; height: 32px; font: 10px/20px a; text-box-trim: trim-both; orphans: 1; widows: 1'>a<br>a<br><b id=a>a</b></div>",
    a => [a.offsetLeft, a.offsetTop],
    [20, 0],
  ],
  [
    "a vertical cell is not on the baseline of its row",
    "<table style='border-collapse: collapse; font: 10px/10px a'><tr id=a style='vertical-align: baseline'><td style='padding: 0 0 4px; writing-mode: vertical-rl'><div style='width: 5px; height: 30px'></div><td style='padding: 0 0 9px'>a</table>",
    a => a.offsetHeight,
    34,
  ],
  [
    "percentages of flex items",
    "<div id=a style='display: flex; width: 100px; height: 40px'><div style='width: 50%; height: 50%; max-width: 40%'></div><div style='display: flex; flex-direction: column; flex: 1; min-height: 25%'><div style='height: 100%; width: 30%'></div><div style='flex: 1 0 25%; align-self: end; min-width: 10%'></div></div><div style='position: absolute; width: 1px; height: 1px'></div></div>",
    a => [...a.querySelectorAll("*")].map(it => [it.offsetLeft, it.offsetTop, it.offsetWidth, it.offsetHeight]),
    [
      [0, 0, 40, 20],
      [40, 0, 60, 40],
      [40, 0, 18, 30],
      [94, 30, 6, 10],
      [0, 0, 1, 1],
    ],
  ],
  [
    "text-fit scales all lines alike",
    "<div id=a style='font: 10px/1 a; width: 120px; white-space: pre; text-fit: grow'><b>aaaaaa</b>\n<b>aaa</b></div>",
    a => [...a.children].map(it => (it => [it.x, it.y, it.width, it.height])(it.getBoundingClientRect())),
    [
      [0, 0, 120, 20],
      [0, 20, 60, 20],
    ],
  ],
  [
    "text-fit scales each line",
    "<div id=a style='font: 10px/1 a; width: 120px; white-space: pre; text-fit: grow per-line-all'><b>aaaa</b>\n<b>aaa</b></div>",
    a => [...a.children].map(it => (it => [it.x, it.y, it.width, it.height])(it.getBoundingClientRect())),
    [
      [0, 0, 120, 30],
      [0, 30, 120, 40],
    ],
  ],
  [
    "text-fit spares the last line",
    "<div id=a style='font: 10px/1 a; width: 60px; text-fit: grow per-line'><b>aaa</b> <b>aaaa</b></div>",
    a => [...a.children].map(it => (it => [it.x, it.y, it.width, it.height])(it.getBoundingClientRect())),
    [
      [0, 0, 60, 20],
      [0, 20, 40, 10],
    ],
  ],
  [
    "text-fit has a limit and leaves lengths alone",
    "<div id=a style='font: 10px/1 a'><div style='width: 50px; white-space: pre; text-fit: shrink 80%'>aaaaaaaaaa</div><div style='width: 110px; letter-spacing: 5px; text-fit: grow'>aa</div><div style='width: 60px; line-height: 12px; text-fit: grow'>aa</div><div style='width: 60px; text-fit: grow'><i style='float: left; width: 1px; height: 1px'></i>aa</div><div style='width: 21px; text-fit: grow'>aa</div></div>",
    a => [...a.children].map(it => it.offsetHeight),
    [8, 50, 12, 10, 10],
  ],
  [
    "text-fit follows the width and the style",
    "<div id=a style='font: 10px/1 a; width: 40px'>aa</div>",
    a => ["text-fit: grow", "width: 60px", "text-fit: none"].map(it => ((a.style.cssText += it), a.offsetHeight)),
    [20, 30, 10],
  ],
  [
    "balancing breaks no word",
    "<div id=a style='font: 10px/1 a; width: 150px; overflow-wrap: break-word; text-wrap: balance'><b>aaaaaaaaaaa</b> <b>aaaa aa</b></div>",
    a => [...a.children].map(it => it.getClientRects().length),
    [1, 1],
  ],
  [
    "what overflows is not balanced",
    "<div id=a style='font: 10px/1 a; width: 50px; text-wrap: balance'><b>a</b> <b>a</b> <b>a</b> <b>a</b> aaaaaa</div>",
    a => [...a.children].map(it => it.offsetTop),
    [0, 0, 0, 10],
  ],
  [
    "only the lines that the clamp leaves are balanced",
    "<div id=a style='font: 10px/1 a; width: 70px; text-wrap: balance; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden'><b>a</b> <b>a</b> <b>a</b> <b>a</b> <b>a</b> <b>a</b> <b>a</b> <b>a</b> <b>a</b></div>",
    a => [...a.children].map(it => it.offsetTop),
    [0, 0, 0, 0, 10, 10, 10, 10, 20],
  ],
  [
    "a vertical annotation touches its base",
    "<div style='font: 20px/1 a; writing-mode: vertical-rl'><ruby id=a>aa<rt>a</rt></ruby></div>",
    a => a.lastChild.getBoundingClientRect().x - a.getBoundingClientRect().right,
    0,
  ],
  [
    "an annotation does not cover a box at the top of the line before",
    "<div id=a style='font: 10px/1 a; width: 20px'><i style='display: inline-block; vertical-align: top; width: 20px; height: 30px'></i><br><ruby>a<rt>a</rt></ruby></div>",
    a => a.offsetHeight,
    45,
  ],
  [
    "combined text has its own white space and breaks as its letters do",
    "<div id=a style='font: 10px/1 a; writing-mode: vertical-rl; height: 30px'><p style='margin: 0'>aa<b style='text-combine-upright: all; letter-spacing: 3px'>a a</b>aa<p style='margin: 0; height: max-content'>a<b style='text-combine-upright: all'> </b></div>",
    a => [...a.children].map(it => [it.offsetWidth, it.scrollHeight]),
    [
      [10, 50],
      [10, 20],
    ],
  ],
  [
    "middle is half an x above a central baseline",
    "<div style='font: 20px/1 a; writing-mode: vertical-rl'><i id=a style='display: inline-block; vertical-align: middle; width: 40px; height: 5px'></i><b>a</b></div>",
    a => a.nextSibling.getBoundingClientRect().x - a.getBoundingClientRect().x,
    2,
  ],
  [
    "a fieldset that contains its size ignores its legend",
    "<fieldset id=a style='font: 10px/1 a; contain: size; border: 0; padding: 0'><legend>a</legend></fieldset>",
    a => a.offsetHeight,
    0,
  ],
  [
    "the margin of a flex item comes after its forced break",
    "<div style='columns: 5; gap: 0; column-fill: auto; width: 100px; height: 100px'><div style='display: flex; flex-flow: column'><div style='height: 95px'></div><div id=a style='height: 50px; margin-top: 10px; break-before: column'></div></div></div>",
    a => [a.offsetLeft, a.offsetTop],
    [20, 10],
  ],
  [
    "what a flex item sticks out of its column is not added to the next",
    "<div style='columns: 2; gap: 0; column-fill: auto; width: 100px; height: 60px'><div style='display: flex; flex-flow: column'><div style='contain: size; height: 100px'></div><div id=a style='contain: size; height: 100px'></div></div></div>",
    a => [a.offsetLeft, a.offsetTop],
    [50, 0],
  ],
  [
    "each fragment of a box is transformed by itself",
    "<div id=a style='overflow: auto; width: 100px; height: 100px'><div style='columns: 5; gap: 0; column-fill: auto; height: 100px'><div style='transform: rotate(180deg); height: 500px'></div></div></div>",
    a => [a.scrollWidth, a.scrollHeight],
    [100, 100],
  ],
  [
    "a box that has left its columns is whole",
    "<div id=a style='columns: 2; writing-mode: vertical-rl; font: 10px/1 a'>a<p style='min-width: 200px; margin: 0'>a</div>",
    a => (
      a.offsetHeight,
      (a.style.cssText = "display: inline-block; font: 10px/1 a"),
      [...a.lastChild.getClientRects()].map(it => [it.width, it.height])
    ),
    [[200, 10]],
  ],
  [
    "quotes are no longer nested when those around them are gone",
    "<style>.q::before { content: open-quote } .q::after { content: close-quote } .s::before, .s::after { content: '' }</style><div id=a style='font: 10px/1 a; quotes: &quot;a&quot; &quot;a&quot; &quot;aa&quot; &quot;aa&quot;'><b class=q></b></div>",
    a => ["q", "", "q", "q s"].map(it => ((a.className = it), a.firstChild.offsetWidth)),
    [40, 20, 40, 20],
  ],
  [
    "transformed boxes in one another over very many columns can be scrolled to",
    "<div id=a style='columns: 1px; gap: 0; width: 1px; height: 1px; column-fill: auto'>" +
      "<div style='transform: scale(1)'>".repeat(59) +
      "<div style='transform: scale(1, 2); height: 1500px'>",
    a => a.scrollWidth,
    1500,
  ],
  [
    "many transformed boxes in one another overflow column by column",
    "<div id=a style='columns: 1px; gap: 0; width: 1px; height: 2px; column-fill: auto'>" +
      "<div style='transform: scale(1)'><i style='position: absolute'></i>".repeat(99) +
      "<div style='transform: scale(1, 2); height: 120px'>",
    a => [a.scrollWidth, a.scrollHeight],
    [60, 3],
  ],
  [
    "the transform of a box in vertical columns starts from its first fragment",
    "<div style='writing-mode: vertical-rl; columns: 2; gap: 0; width: 100px; height: 200px; column-fill: auto'><div id=a style='width: 200px; transform: scale(.5); transform-origin: 0 0'></div></div>",
    a => [...a.getClientRects()].map(it => [it.x - a.parentNode.getBoundingClientRect().x, it.width]),
    [
      [0, 50],
      [0, 50],
    ],
  ],
])("%s", (_, html, measure, expected) => {
  using page = open(`<body style="margin: 0">${html}`);
  expect(measure(page.$("#a"))).toEqual(expected);
});

test("place-content spells out what a baseline leaves open, and flex-basis has no anchor", () => {
  using page = open("<p style='place-content: baseline; flex-basis: anchor-size(--a width)'>");
  expect([page.$("p").style.placeContent, page.$("p").style.flexBasis]).toEqual(["baseline start", ""]);
});

describe.each([0, 40])("among %d other rules for the element", count => {
  const others = Array.from({ length: count }, (_, i) => `u${i % 2 ? "" : ":not(a)"} { outline-offset: ${i}px }`).join(
    "",
  );
  const set = (selector: string, name: string, value: string) => (page: any) =>
    page.$(selector).setAttribute(name, value);
  const remove = (selector: string) => (page: any) => page.$(selector).remove();
  const prepend = (selector: string, html: string) => (page: any) =>
    page.$(selector).insertAdjacentHTML("afterbegin", html);
  test.each([
    ["an ancestor gets a class", ".a u", "<p><b><u></u></b></p>", set("p", "class", "a"), "01"],
    ["an ancestor loses a class", ".a u", "<p class=a><b><u></u></b></p>", set("p", "class", ""), "10"],
    [
      "a class moves from the parent up",
      ".a > u",
      "<p><b class=a><u></u></b></p>",
      (page: any) => (set("p", "class", "a")(page), set("b", "class", "")(page)),
      "10",
    ],
    ["a class in :not()", "b:not(.a) u", "<b class=a><u></u></b>", set("b", "class", ""), "01"],
    [
      "a class left of a combinator in :is()",
      "nav b:is(.a i > *) u",
      "<nav><p><i><b><u></u></b></i></p></nav>",
      set("p", "class", "a"),
      "01",
    ],
    ["a class of a sibling in :not()", "nav u:not(.a ~ *)", "<nav><b></b><u></u></nav>", set("b", "class", "a"), "10"],
    ["the value of an attribute", "[title=a] u", "<p title=b><u></u></p>", set("p", "title", "a"), "01"],
    ["an earlier sibling comes", ".a ~ u", "<p><b></b><u></u></p>", prepend("p", "<i class=a></i>"), "01"],
    ["an earlier sibling goes", ".a ~ u", "<p><i class=a></i><b></b><u></u></p>", remove("i"), "10"],
    [
      "an earlier sibling loses a class and goes",
      ".a ~ u",
      "<p><i class=a></i><b></b><u></u></p>",
      (page: any) => (set("i", "class", "")(page), remove("i")(page)),
      "10",
    ],
    [
      "an earlier sibling of an ancestor comes",
      ".a ~ b u",
      "<p><b><u></u></b></p>",
      prepend("p", "<i class=a></i>"),
      "01",
    ],
    ["an earlier sibling of an ancestor goes", ".a ~ b u", "<p><i class=a></i><b><u></u></b></p>", remove("i"), "10"],
    ["what is in between goes", ".a + u", "<p><i class=a></i><b></b><u></u></p>", remove("b"), "01"],
    [
      "something comes in between",
      ".a + b + u",
      "<p><i class=a></i><b></b><u></u></p>",
      (page: any) => page.$("i").after(page.document.createElement("s")),
      "10",
    ],
    ["the index changes", "u:nth-child(2)", "<p><u></u></p>", prepend("p", "<i></i>"), "01"],
    [
      "the index of an ancestor changes",
      "b:nth-of-type(odd) u",
      "<p><b><u></u></b></p>",
      prepend("p", "<b></b>"),
      "10",
    ],
    ["the index from the end changes", "u:nth-last-child(2)", "<p><u></u><i></i></p>", remove("i"), "10"],
    ["it becomes the first", "u:first-child", "<p><i></i><u></u></p>", remove("i"), "01"],
    ["it becomes the last", "u:last-child", "<p><u></u><i></i></p>", remove("i"), "01"],
    ["it is left alone by an earlier one", "u:only-child", "<p><i></i><u></u></p>", remove("i"), "01"],
    ["it is left alone by a later one", "u:only-child", "<p><u></u><i></i></p>", remove("i"), "01"],
    [
      "a later one of its type goes",
      "b:only-of-type u",
      "<p><b><u></u></b><i></i><b id=a></b></p>",
      remove("#a"),
      "01",
    ],
    [
      "an earlier one of its type goes, then what is in between",
      "b:first-of-type u",
      "<p><b id=a></b><i></i><b><u></u></b></p>",
      (page: any) => (remove("#a")(page), remove("i")(page)),
      "01",
    ],
    [
      "a later one of its type goes, then what is in between",
      "b:last-of-type u",
      "<p><b><u></u></b><i></i><b id=a></b></p>",
      (page: any) => (remove("#a")(page), remove("i")(page)),
      "01",
    ],
    [
      "one of its type comes, then what is in between moves",
      "b:first-of-type u",
      "<p><i></i><b><u></u></b></p>",
      (page: any) => (prepend("p", "<b id=a></b>")(page), page.$("p").append(page.$("i"))),
      "10",
    ],
    [
      "an earlier sibling among many comes",
      ".a ~ u",
      `<p>${"<b></b>".repeat(60)}<u></u></p>`,
      prepend("p", "<i class=a></i>"),
      "01",
    ],
    ["the index among many changes", "u:nth-child(odd)", `<p>${"<b></b>".repeat(60)}<u></u></p>`, remove("b"), "10"],
    ["it stops being empty", "u:empty", "<u></u>", prepend("u", "a"), "10"],
    [":has() of an ancestor", "p:has(> .a) u", "<p><i></i><u></u></p>", set("i", "class", "a"), "01"],
    [
      ":has() of what is moved",
      "u:has(+ .a)",
      "<p><u></u><i class=a></i></p><nav></nav>",
      (page: any) => page.$("nav").moveBefore(page.$("u"), null),
      "10",
    ],
    [
      ":has() of what has changed elsewhere",
      "b:has(.a) + u",
      "<p><b hidden></b><u></u></p>",
      (page: any) => {
        const b = page.$("b");
        b.remove();
        b.innerHTML = "<i class=a></i>";
        page.$("p").prepend(b);
      },
      "01",
    ],
    [
      "the rule that wins stops matching",
      "p u { z-index: 1 } .a p u { z-index: 0 } x",
      "<nav class=a><p><u></u></p></nav>",
      set("nav", "class", ""),
      "01",
    ],
    [
      "a rule starts to match while another wins, which then stops",
      ".b u { z-index: 1 } nav.a p u { z-index: 0 } x",
      "<nav class=a><p><u></u></p></nav>",
      (page: any) => {
        set("p", "class", "b")(page);
        page.computed("u", "z-index");
        set("nav", "class", "")(page);
      },
      "01",
    ],
    [
      "a media query",
      "x {} @media (max-width: 300px) { p u { z-index: 1 } } x",
      "<p><u></u></p>",
      (page: any) => page.resize(200, 200, 1),
      "01",
    ],
    [
      "a media query of the rule that wins",
      "p u { z-index: 1 } @media (min-width: 300px) { p > u { z-index: 0 } } x",
      "<p><u></u></p>",
      (page: any) => page.resize(200, 200, 1),
      "01",
    ],
  ])("%s", (_, selector, html, change, expected) => {
    for (const pseudo of [undefined, "::before"]) {
      const rules = `u { z-index: 0 } ${others} ${selector} { z-index: 1 }`.replace(
        / \{(?= z-index| outline)/g,
        `${pseudo ?? ""} { content: "";`,
      );
      using page = open(`<style>${rules}</style>${html}`);
      page.resize(400, 200, 1);
      page.$("u").offsetWidth;
      const before = page.computed("u", "z-index", pseudo);
      change(page);
      page.$("u").offsetWidth;
      expect(before + page.computed("u", "z-index", pseudo)).toBe(expected);
    }
  });

  test.each([
    ["revert-rule", "u { z-index: 1 } p u { z-index: revert-rule }"],
    ["revert-rule from a variable", "u { z-index: 1 } p u { z-index: var(--a, revert-rule) }"],
    ["revert-rule after a value", "u { z-index: 1 } p u { z-index: 2; z-index: var(--a, revert-rule) }"],
    ["revert-rule for all", "u { z-index: 1 } p u { z-index: 2; all: revert-rule }"],
    ["revert-layer", "@layer a { u { z-index: 1 } } u { z-index: 2 } p u { z-index: revert-layer }"],
    ["!important", "u { z-index: 1 !important } p u { z-index: 2 }"],
    ["another property", "u { z-index: 1; order: 1 } p u { order: 2 }"],
    ["a custom property", "u { --a: 1; order: 1 } p u { order: 2; z-index: var(--a) }"],
    ["a nearer scope", "@scope (p) { u { z-index: 1 } } @scope (body) { u { z-index: 2 } }"],
  ])("a rule counts because of %s", (_, rules) => {
    using page = open(`<style>${others} ${rules}</style><p><u></u></p>`);
    expect(page.computed("u", "z-index")).toBe("1");
  });

  test("content comes and goes", () => {
    using page = open(
      `<style>${others} .a u::before { content: ""; display: inline-block; width: 9px } .a.b u::before { content: none }</style><p><u></u></p>`,
    );
    expect(["", "a", "a b", "a", ""].map(it => ((page.$("p").className = it), page.$("u").offsetWidth))).toEqual([
      0, 9, 0, 9, 0,
    ]);
  });
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
    [
      "a plain inline element that gets padding",
      "<p>a <span>b</span> <i>c</i></p>",
      set("span", "style", "padding: 5px"),
    ],
    [
      "an inline element that loses its padding",
      "<p>a <span style='padding: 5px'>b</span> <i>c</i></p>",
      set("span", "style", "color: red"),
    ],
    [
      "a plain inline element that gets a child",
      "<p>a <span>b</span> <i>c</i></p>",
      (page: any) => page.$("span").append(Object.assign(page.document.createElement("b"), { textContent: "d" })),
    ],
    [
      "a plain inline element that loses its text",
      "<p>a <span>b</span> <i>c</i></p>",
      (page: any) => page.$("span").firstChild.remove(),
    ],
    [
      "a plain inline element whose text becomes a space",
      "<p>a <span>b</span> <i>c</i></p>",
      (page: any) => (page.$("span").firstChild.data = " "),
    ],
    [
      "a plain inline element that gets a higher line",
      "<p>a <span>b</span> <i>c</i></p>",
      set("span", "style", "line-height: 50px"),
    ],
    [
      "a plain inline element that gets generated text",
      "<style>.on::after { content: 'dd' }</style><p>a <span>b</span> <i>c</i></p>",
      set("span", "class", "on"),
    ],
    [
      "a plain inline element after many others",
      `<pre>${"<span>a</span> <span>b</span>\n".repeat(200)}</pre>`,
      (page: any) => page.$("pre").lastElementChild.append("cc"),
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
  ["a soft hyphen", "", "aa bb&shy;cccc", "0,0,20 0,10,20 20,10,10 0,20,40"],
  ["text without a width", "", "aaaa&#x200b;bbbb", "0,0,40 0,10,40"],
  ["justification", "text-align: justify", "a b ccc d", "0,0,50 0,10,50"],
  ["text-indent", "text-indent: 20px", "aa bb cc", "20,0,20 0,10,50"],
  [
    "from right to left",
    "direction: rtl",
    "aa <b style='padding-left: 10px'>b</b> cccc",
    "20,0,10 30,0,20 10,0,10 10,10,40",
  ],
  [
    "tabs",
    "white-space: pre-wrap; tab-size: 2",
    "a\tb\tcc\td",
    "0,0,10 10,0,10 20,0,10 30,0,10 0,10,20 20,10,20 40,10,10",
  ],
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

test("the custom properties of a computed style are listed in linear time, and follow changes", () => {
  const names = Array.from({ length: 20_000 }, (_, i) => "--" + String(i).padStart(5, "0"));
  using page = open(`<style>html { ${names.map(it => it + ": 1").join(";")} } i { --a: 1 }</style><p></p><i></i>`);
  const customs = (selector: string) =>
    [...page.window.getComputedStyle(page.$(selector))].filter(it => it.startsWith("--"));
  expect(customs("p")).toEqual(names);
  page.window.CSS.registerProperty({ name: "--b", syntax: "<number>", inherits: false, initialValue: "1" });
  expect(customs("p").slice(-2)).toEqual([names.at(-1), "--b"]);
  expect(customs("i").slice(-2)).toEqual(["--a", "--b"]);
  page.$("i").style.setProperty("--a", "initial");
  expect(customs("i").slice(-2)).toEqual([names.at(-1), "--b"]);
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
    `${scrollbars}<div style="container-type: size; width: 100px; height: 100px; overflow: auto scroll"><p style="margin: 0; width: 100cqw; height: 200px">`,
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
    "color",
    "outline-color",
    "lighting-color",
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
      "numbers with many digits",
      (p, i) => (p.style.opacity = [0.5, 0.11905790492892265, 0.25, 1.1905790492892265e-7][i % 4]),
    ],
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
    [
      "the color of the text",
      (p, i) =>
        (p.style.color = [`rgb(${i}, 0, 0)`, `#00${i % 10}`, `hsl(${i}, 50%, 50%)`, "currentcolor", `rgb(0, ${i}, 0)`][
          i % 5
        ]),
    ],
    [
      "a color that others are made of",
      (p, i) => (
        i == 1 && (p.style.cssText += "lighting-color: color-mix(in srgb, currentcolor, red); caret-color: var(--no)"),
        (p.style.color = `rgb(${i}, 0, 0)`)
      ),
    ],
    [
      "a color and a move",
      (p, i) => Object.assign(p.style, { backgroundColor: `#${i % 10}00`, transform: `rotate(${i}deg)` }),
    ],
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
    [
      "color",
      "rgb(1, 2, 3)|rgba(1,2,3,.5)|rgb(300, -1, 127.5)|rgb(1, 2, 3, 2)|rgba(0, 0, 0)|rgb(1 2 3)|rgb(1%, 2%, 3%)|rgb(1, 2)|rgb(1, 2, 3,)|rgb(1, 2, 3) 4|#abc|#abcd|#a1b2c3|#a1b2c3d4|#ab|#ggg|#",
    ],
    [
      "background-color",
      "hsl(120, 100%, 25%)|hsla(-30.5,100%,49.99%,0.01)|hsl(720, 150%, 50%)|hsl(10, -5%, 50%)|hsl(10, 50, 50)|hsl(10deg, 50%, 50%)|hsla(1e-7,1e-7%,50%,1e-7)|hsl(0, 0%, 50%, 50%)",
    ],
    [
      "transform",
      "rotatez(1rad)|rotateZ(1rad)|rotate(.25turn)|rotate(1e-7deg)|rotate(90deg)translate(1px, 2px)|translate(1px,2px)rotateZ(-2rad) scale(2)|translateZ(5px) rotateZ(90deg)|rotate(1)|rotate(1deg)x|scale(1e-30)",
    ],
    ["width", "1e-2px|1e-10px|1e-px|1e-123px|1em|1e2px"],
  ])("%s means the same in capitals", (property, values) => {
    using page = open(
      "<p style='color: #010101; background-color: #010101; transform: scale(3); width: 7px'></p>".repeat(2),
    );
    const [first, second] = page.document.querySelectorAll("p");
    for (const value of values.split("|")) {
      first.style.setProperty(property, value);
      second.style.setProperty(property, value.toUpperCase());
      expect([
        value,
        first.style.cssText,
        page.computed(first, property),
        first.getBoundingClientRect().toJSON().width,
      ]).toEqual([
        value,
        second.style.cssText,
        page.computed(second, property),
        second.getBoundingClientRect().toJSON().width,
      ]);
    }
  });

  test("a scroller that hides what sticks out knows how far it goes", () => {
    using page = open(
      "<div style='overflow: hidden; width: 50px; height: 50px'><p style='margin: 0; height: 10px; transform: translateY(1px)'></p></div>",
    );
    const seen = [];
    for (const y of [2, 90, 60, 0]) {
      page.$("p").style.transform = `translateY(${y}px)`;
      seen.push([page.$("div").scrollTop, page.$("div").scrollHeight]);
      page.$("div").scrollTop = 1000;
    }
    expect(seen).toEqual([
      [0, 50],
      [0, 100],
      [20, 70],
      [0, 50],
    ]);
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

test.each([
  ["a string that is not closed keeps its spaces", `<p style='--a: "b  '>`, "p", "--a", `"b  `],
  [
    "named-feature()",
    "<style>@supports named-feature(anchor-position-follows-transforms) { p { order: 1 } }</style><p>",
    "p",
    "order",
    "1",
  ],
  [
    "unitless lengths are not supported",
    "<style>@supports (width: 1) { p { order: 1 } }</style><p>",
    "p",
    "order",
    "0",
  ],
  [
    "an argument has no initial value",
    "<style>@function --f(--x) { result: if(style(--x): 1; else: 2) } p { order: --f(a) }</style><p>",
    "p",
    "order",
    "1",
  ],
  [
    "invalid values are equal in @container",
    "<style>@container style(--a: var(--b)) { p { order: 1 } }</style><p>",
    "p",
    "order",
    "1",
  ],
  [
    "invalid values are not equal in if()",
    "<p style='order: if(style(--a: var(--b)): 1; else: 2)'>",
    "p",
    "order",
    "2",
  ],
  [
    "a default refers to a later argument",
    "<style>@function --f(--x: var(--y, 1), --y: 2) { result: var(--x) } p { --y: 3; order: --f() }</style><p>",
    "p",
    "order",
    "1",
  ],
  [
    "the type of a parameter is valid",
    "<style>@function --f(--x type(!)) { result: 1 } p { order: --f(1) }</style><p>",
    "p",
    "order",
    "0",
  ],
  [
    "negative padding",
    "<p style='width: 10px; padding-left: calc(10% - 1000px); display: inline-block; box-sizing: border-box'>",
    "p",
    "padding-left",
    "0px",
  ],
  [
    "font-size depends on a length in em",
    "<style>@property --a { syntax: '<length>'; inherits: false; initial-value: 1px } p { --a: 2em; font-size: var(--a, 42px) }</style><p>",
    "p",
    "font-size",
    "16px",
  ],
  [
    "a length in em depends on font-size",
    "<style>@property --a { syntax: '<length>'; inherits: false; initial-value: 1px } p { --b: 2em; --a: var(--b); font-size: var(--a) }</style><p>",
    "p",
    "--a",
    "1px",
  ],
  [
    "line-height depends on a length in lh",
    "<style>@property --a { syntax: '<length>'; inherits: false; initial-value: 1px } p { --a: 2lh; line-height: var(--a) }</style><p>",
    "p",
    "line-height",
    "normal",
  ],
  [
    "the font-size of the root depends on a length in rem",
    "<style>@property --a { syntax: '<length>'; inherits: false; initial-value: 1px } html { --a: 2rem; font-size: var(--a) }</style>",
    "html",
    "font-size",
    "16px",
  ],
  [
    "font-size takes an inherited length in em",
    "<style>@property --a { syntax: '<length>'; inherits: true; initial-value: 1px } body { --a: 2em } p { font-size: var(--a) }</style><p>",
    "p",
    "font-size",
    "32px",
  ],
  [
    "font-size takes a length in rem",
    "<style>@property --a { syntax: '<length>'; inherits: false; initial-value: 1px } p { --a: 2rem; font-size: var(--a) }</style><p>",
    "p",
    "font-size",
    "32px",
  ],
])("%s", (_, html, target, property, value) => {
  using page = open(html);
  expect(page.computed(target, property)).toBe(value);
});

test("@supports takes unitless lengths in quirks mode", () => {
  using page = open("<style>@supports (width: 1) { p { order: 1 } }</style><p>", "");
  expect(page.computed("p", "order")).toBe("1");
});

test.each([
  ["width", "calc(1px * progress(1px * 1px, 1px * 1px, 2px * 1px))"],
  ["cursor", "light-dark(linear-gradient(red, blue), none), auto"],
])("%s: %s is refused", (property, value) => {
  using page = open();
  expect(page.window.CSS.supports(property, value)).toBe(false);
});

test("the basis of calc-size() is a sum", () => {
  using page = open("<p style='width: calc-size(10px + 20px, size * 2)'>");
  expect(page.computed("p", "width")).toBe("60px");
});

test(":root is an element of any name", () => {
  using page = open();
  const { document, window } = page;
  const root = document.createElementNS("urn:a", "a");
  document.replaceChild(root, document.documentElement);
  root.append(
    Object.assign(document.createElement("style"), { textContent: ":root { order: 1 } :root > * { order: 2 }" }),
  );
  expect([root, root.firstChild].map(it => page.computed(it, "order"))).toEqual(["1", "2"]);
  expect(document.querySelector(":root")).toBe(root);
  const other = new window.DOMParser().parseFromString("<a><b/></a>", "application/xml");
  expect(other.querySelector(":root")).toBe(other.documentElement);
  expect(other.querySelector(":root > b")).toBe(other.documentElement.firstChild);
});

test("@scope in an adopted sheet has the document for its root", () => {
  using page = open("<p>");
  const sheet = new page.window.CSSStyleSheet();
  sheet.replaceSync("@scope { p, html { order: 1 } :scope { z-index: 1 } }");
  page.document.adoptedStyleSheets = [sheet];
  expect(["p", "html"].map(it => page.computed(it, "order"))).toEqual(["1", "1"]);
  expect(page.computed("html", "z-index")).toBe("auto");
});

test.each(["(width = calc(10px * sibling-index()))", "style(--a: calc(10px * sibling-index()))"])(
  "@container %s follows the siblings of the container",
  query => {
    using page = open(`<style>
    @property --a { syntax: "<length>"; inherits: false; initial-value: 0px }
    div { container-type: inline-size; width: 10px; --a: 10px }
    @container ${query} { p { order: 1 } }
  </style><section><i></i><div><p>`);
    expect(page.computed("p", "order")).toBe("0");
    page.$("i").remove();
    expect(page.computed("p", "order")).toBe("1");
  },
);

test("the weight of an additive symbol is not negative", () => {
  using page = open(`<style>
    @counter-style a { system: additive; additive-symbols: 1 a, calc(-1) bbbbbbbb; range: infinite infinite }
    b::before { content: counter(a, a) }
  b { font-weight: normal }
  </style><b></b><span>bbbbbbbb</span>`);
  expect(page.$("b").offsetWidth).toBe(page.$("span").offsetWidth);
});

test("commitStyles() resolves percentages that are interpolated as a matrix", () => {
  using page = open("<p style='width: 200px; height: 200px'>");
  const animation = page.$("p").animate({ transform: ["translate(100%, 0%)", "scale(3)"] }, 1000);
  animation.currentTime = 500;
  animation.commitStyles();
  animation.cancel();
  expect(page.computed("p", "transform")).toBe("matrix(2, 0, 0, 2, 100, 0)");
});

test("a shape is the subject of a timeline in the scroll container around the svg", () => {
  using page = open("<svg height=3000><path d='M 50 0 V 3000'/></svg>");
  expect(new page.window.ViewTimeline({ subject: page.$("path") }).source).toBe(page.document.documentElement);
});

test.each([
  ["-webkit-perspective", "1000", "1000px", "1000px"],
  ["cx", "99999999999px", null, "3.35544e+07px"],
  ["width", "calc(2 * 3px * sibling-index())", "calc(6px * sibling-index())", "6px"],
  ["text-shadow", "red 1px 1px calc(-2px)", null, "rgb(255, 0, 0) 1px 1px 0px"],
  [
    "background-image",
    'image-set(light-dark(url("data:,a"), url("data:,b")) 1x)',
    null,
    'image-set(url("data:,a") 1dppx)',
  ],
  [
    "clip-path",
    "shape(from 0px 0px, hline to right, vline to center)",
    null,
    "shape(from 0px 0px, hline to 100%, vline to 50%)",
  ],
  ["border-shape", "circle() border-box circle() border-box", null, "circle() border-box"],
  ["timeline-trigger-active-range", "entry calc(0%) entry calc(100%)", "entry", "entry"],
  ["color", "color-mix(in hwb, lch(none none 180), hwb(0 20 40))", null, "color(srgb 0.6 0.2 0.2)"],
  ["color", "color-mix(in lch, hwb(0 none none) 0%, lch(11 33 44))", null, "lch(11 33 44)"],
  [
    "background",
    "border-area padding-box",
    "padding-box border-area",
    "rgba(0, 0, 0, 0) none repeat scroll 0% 0% / auto padding-box border-area",
  ],
  ["--a", "a\\", "a�", "a�"],
  ["--a", '"a\\', '"a"', '"a"'],
  ["--a", "url(a\\", "url(a�)", "url(a�)"],
])("%s: %s", (property, value, specified, computed) => {
  using page = open("<p style='display: none'></p>");
  const { style } = page.$("p");
  style.setProperty(property, value);
  expect([style.getPropertyValue(property), page.computed("p", property)]).toEqual([
    specified ?? expect.any(String),
    computed,
  ]);
});

test.each([
  ["border-area is the origin too", "<p style='background: border-area'>", "background-origin", "border-box"],
  ["attr() as a string is in a cycle", "<p a='attr(a)' style='--a: attr(a type(*), b)'>", "--a", "b"],
  [
    "a media query knows no siblings",
    "<style>@media (width > calc(1px * sibling-index())) { p { order: 1 } }</style><p>",
    "order",
    "0",
  ],
])("%s", (_, html, property, value) => {
  using page = open(html);
  expect(page.computed("p", property)).toBe(value);
});

test.each([
  ["clip-path", "polygon(0px 0px)", "polygon(round 20px, 0px 0px)", "polygon(round 10px, 0px 0px)", "replace"],
  ["aspect-ratio", "1 / 1", "1 / 1", "2 / 1", "add"],
])("%s from %s to %s", (property, from, to, halfway, composite) => {
  using page = open("<p style='aspect-ratio: 2'>");
  const name = property.replace(/-./, it => it[1].toUpperCase());
  page.$("p").animate({ [name]: [from, to] }, { duration: 2, delay: -1, composite });
  expect(page.computed("p", property)).toBe(halfway);
});

test("::slotted() calls the functions of its tree", () => {
  using page = open("<div><p>");
  page.$("div").attachShadow({ mode: "open" }).innerHTML =
    "<style>@function --f() { result: 1 } ::slotted(p) { order: --f() }</style><slot>";
  expect(page.computed("p", "order")).toBe("1");
});

test("rules are serialized without what is not valid, and in lowercase", () => {
  using page = open("<style>@font-feature-values a { @styleset { 1a: 1 } } ::picker(SELECT) {}</style>");
  const [values, picker] = page.document.styleSheets[0].cssRules;
  expect([values.styleset.size, picker.selectorText]).toEqual([0, "::picker(select)"]);
});

test.each([
  ["width: 300px", (it: HTMLElement) => it.offsetWidth],
  ["display: none", (it: HTMLElement) => it.offsetWidth],
  ["font-size: 40px", (it: HTMLElement) => (it.firstChild as HTMLElement).offsetHeight],
])("what two styles differ in is not taken for what two others do: %s", (declaration, measure) => {
  using page = open("");
  const rounds = Array.from({ length: 16 }, (_, round) => {
    const rules = [..."abcdef"].map((it, i) => `.${it} { background: rgb(${i} ${round} 0) }`);
    page.document.body.innerHTML = `<style>${rules.join("")} .d { ${declaration} }</style><div><p>a</p></div>`;
    const sizes = [...("ef".slice(0, round % 3) + "abacdcda")].map(
      it => ((page.$("div").className = it), measure(page.$("div"))),
    );
    return sizes.at(-1) === sizes[0];
  });
  expect(rounds).not.toContain(false);
});

test.each([1, 2, 3, 4])("elements that keep coming back to the same styles are like new ones (%d)", seed => {
  const below = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) >> 8) % n;
  const declarations =
    `width: 90px; height: 30px; min-width: 200px; display: none; display: flex; display: inline-block; display: contents; display: grid;
    float: left; position: absolute; position: relative; top: 7px; margin: 5px; padding: 3px; border: 2px solid; font-size: 30px; line-height: 3;
    white-space: nowrap; writing-mode: vertical-rl; direction: rtl; zoom: 2; overflow: scroll; transform: scale(2); transform: rotate(9deg); translate: 4px;
    opacity: 0.5; opacity: 0.7; color: red; color: blue; background: red; background: blue; visibility: hidden; --a: 9px; margin-left: var(--a, 1px);
    text-indent: 1em; container-type: inline-size; list-style: inside; display: list-item; columns: 2; box-shadow: 0 0 9px; z-index: 1`.split(
      ";",
    );
  const rules = Array.from(
    { length: 6 },
    (_, i) =>
      `.c${i} { ${Array.from({ length: below(3) + 1 }, () => declarations[below(declarations.length)]).join(";")} }`,
  );
  using page =
    open(`<style>main { position: absolute; inset: 0 auto auto 0; width: 400px; height: 400px; contain: strict } ${rules.join("")}</style>
    <main><div>a <span>b <i>c</i></span><p>d <b>e</b></p></div><div><p>f</p></div></main>`);
  const main = page.$("main");
  const measure = (root: Element) =>
    [...root.querySelectorAll("*")].map(it => {
      const [{ x, y, width, height }, { color, fontSize }] = [
        it.getBoundingClientRect(),
        page.window.getComputedStyle(it),
      ];
      return [it.className, ...[x, y, width, height].map(it => Math.round(it * 10)), color, fontSize].join();
    });
  const all = [...main.querySelectorAll("*")];
  for (let step = 0; step < 150; step++) {
    all[below(all.length)].className = "c" + below(7);
    const actual = measure(main);
    if (step % 3) continue;
    const copy = page.document.body.appendChild(main.cloneNode(true) as Element);
    expect(actual).toEqual(measure(copy));
    copy.remove();
  }
});

test("what is in the top layer has no offsetParent", () => {
  using page = open(
    "<div style='position: relative; margin: 20px'><p popover style='position: absolute; inset: 50px; margin: 0'>",
  );
  page.$("p").showPopover();
  expect([page.$("p").offsetParent, page.$("p").offsetTop]).toEqual([null, 50]);
});

describe("anchor positioning", () => {
  const anchored = (css: string, html = "<i></i><p></p>") =>
    open(`<style>
      body, p { margin: 0 }
      i { display: block; height: 100px; anchor-name: --a }
      p { position: absolute; width: 10px; height: 10px; position-anchor: --a }
      ${css}
    </style>${html}`);

  test("a box stays where it is while it fades out", () => {
    using page = anchored("i { margin-top: 20px } p { position-area: top; transition: display 100s allow-discrete }");
    expect(page.$("p").offsetTop).toBe(10);
    page.$("p").style.display = "none";
    expect(page.$("p").offsetTop).toBe(10);
  });

  test.each(["top: anchor(bottom)", "position-area: top"])("keyframes hide a box with %s", declaration => {
    using page = anchored(`p { ${declaration}; animation: a 100s both } @keyframes a { from, to { display: none } }`);
    expect([page.$("p").offsetTop, page.computed("p", "display")]).toEqual([0, "none"]);
  });

  test("keyframes have anchor functions", () => {
    using page = anchored(
      "p { position-anchor: none; animation: a 100s steps(2, start) } @keyframes a { from { top: anchor(--a top) } to { top: anchor(--a bottom) } }",
    );
    expect(page.$("p").offsetTop).toBe(50);
  });

  test("an anchor is in the inline containing block", () => {
    using page = anchored(
      "span { position: relative } i { display: inline-block; width: 20px } p { width: anchor-size(width) }",
      "<span><i></i><p></p></span><span><i style='width: 30px'></i></span>".replaceAll("<p></p>", "<b></b>") +
        "<style>b { position: absolute; width: anchor-size(--a width) }</style>",
    );
    expect(page.$("b").offsetWidth).toBe(20);
  });

  test("a box is shown with its anchor", () => {
    using page = anchored("i { visibility: hidden } p { top: anchor(bottom) }");
    expect(page.document.elementFromPoint(5, 105)).not.toBe(page.$("p"));
    page.$("i").style.visibility = "visible";
    expect(page.document.elementFromPoint(5, 105)).toBe(page.$("p"));
  });

  test("the viewport does not clip a fixed anchor", () => {
    using page = anchored(
      "i { position: fixed; top: -200px; width: 10px } p { position: fixed; top: 0; left: anchor(left) }",
    );
    expect(page.document.elementFromPoint(5, 5)).toBe(page.$("p"));
  });

  test("a fixed box is scrolled into view along with its anchor", () => {
    using page = anchored("i { margin-top: 5000px } p { position: fixed; top: anchor(top) }");
    page.$("p").scrollIntoView();
    expect(page.window.scrollY).toBeGreaterThan(4000);
  });

  test.each([
    ["flip-block", "1"],
    ["flip-y", "0"],
    ["any", "0"],
  ])("anchored(fallback: %s)", (fallback, order) => {
    using page = anchored(
      `p { position-area: top; position-try-fallbacks: flip-block; container-type: anchored } @container anchored(fallback: ${fallback}) { b { order: 1 } }`,
      "<i></i><p><b>",
    );
    expect(page.computed("b", "order")).toBe(order);
  });

  test("anchored(fallback: span-end any)", () => {
    using page = anchored(
      "p { position-area: top; position-try-fallbacks: span-bottom; container-type: anchored } @container anchored(fallback: span-end any) { b { order: 1 } }",
      "<i></i><p><b>",
    );
    expect(page.computed("b", "order")).toBe("1");
  });
});

describe("shapes that differ in their geometry alone", () => {
  const all = (page: ReturnType<typeof open>, property: string) =>
    [...page.document.querySelectorAll("rect")].map(it => page.window.getComputedStyle(it).getPropertyValue(property));
  const rects = (css = "", around = "") =>
    open(
      `<style>${css}</style><svg ${around}><rect x=1 width=4 /><rect x=2 width=4 /><rect x=2 width=5 /><rect x=-3.5 width=0 /></svg>`,
    );

  test.each([
    ["", "x", ["1px", "2px", "2px", "-3.5px"]],
    ["", "width", ["4px", "4px", "5px", "0px"]],
    ["rect { x: 9px }", "x", ["9px", "9px", "9px", "9px"]],
    ["rect { inline-size: 9px }", "width", ["9px", "9px", "9px", "9px"]],
    ["rect { x: revert-layer }", "x", ["1px", "2px", "2px", "-3.5px"]],
    ["rect { x: var(--a, revert-layer) }", "x", ["1px", "2px", "2px", "-3.5px"]],
    ["rect { x: revert }", "x", ["0px", "0px", "0px", "0px"]],
    ["svg { zoom: 2 }", "x", ["1px", "2px", "2px", "-3.5px"]],
  ])("%s %s", (css, property, values) => {
    using page = rects(css);
    expect(all(page, property)).toEqual(values);
  });

  test.each(["", "display=none"])("follow their attributes in <svg %s>", around => {
    using page = rects("", around);
    const rect = page.$("rect");
    const after = (...values: string[]) => (
      values.forEach(it => rect.setAttribute("x", it)),
      all(page, "x").slice(0, 2)
    );
    expect([
      after("1"),
      after("2"),
      after("7"),
      after("1em"),
      after("8"),
      after("1em", "9"),
      after("a"),
      after("\x01"),
      after("5."),
    ]).toEqual(["1px", "2px", "7px", "16px", "8px", "9px", "0px", "0px", "0px"].map(it => [it, "2px"]));
  });

  test("follow what has changed while they were away", () => {
    using page = rects();
    const rect = page.$("rect");
    all(page, "x");
    rect.remove();
    rect.setAttribute("x", "6");
    page.$("svg").append(rect);
    expect(all(page, "x")).toEqual(["2px", "2px", "-3.5px", "6px"]);
  });

  test("keep it when they are painted in another color", () => {
    using page = open(`<style>.a rect { opacity: 0.5 }</style><svg>${"<rect x=1 />".repeat(20)}</svg>`);
    all(page, "x");
    page.$("rect").setAttribute("x", "2");
    page.$("svg").classList.add("a");
    expect(new Set(all(page, "x").slice(1))).toEqual(new Set(["1px"]));
  });

  test("pass it on to what inherits it, and start transitions", () => {
    using page = open(
      "<style>g { transition: transform 100s } rect { transform: inherit }</style><svg><g transform='translate(1)'><rect/></g><g transform='translate(2)'><rect/></g></svg>",
    );
    expect(all(page, "transform")).toEqual(["matrix(1, 0, 0, 1, 1, 0)", "matrix(1, 0, 0, 1, 2, 0)"]);
    page.$("g").setAttribute("transform", "translate(3)");
    expect(page.$("g").getAnimations()).toHaveLength(1);
  });

  test("a gradient follows its own transform", () => {
    using page = open("<svg><linearGradient gradientTransform='scale(2)'/></svg>");
    const gradient = page.$("linearGradient");
    page.computed("linearGradient", "transform");
    gradient.setAttribute("transform", "scale(9)");
    page.computed("linearGradient", "transform");
    gradient.setAttribute("gradientTransform", "scale(3)");
    expect(page.computed("linearGradient", "transform")).toBe("matrix(3, 0, 0, 3, 0, 0)");
  });
});

test("a generated image inherits what changes", () => {
  using page = open(
    "<style>li { list-style: inside linear-gradient(red, red); font: 20px/0 serif; width: fit-content }</style><li>",
  );
  const before = page.$("li").getBoundingClientRect().width;
  page.$("li").style.fontSize = "40px";
  expect(page.$("li").getBoundingClientRect().width).toBe(2 * before);
  page.$("li").style.visibility = "hidden";
  expect(page.document.elementFromPoint(12, 5)).not.toBe(page.$("li"));
});

describe("transitions", () => {
  const started = (page: ReturnType<typeof open>) =>
    page.document.getAnimations().map(it => (it as CSSTransition).transitionProperty);

  test("of an inherited font size start none of what is relative to it", () => {
    using page = open(
      "<style>div { transition: font-size 9s } p { width: 1em; transition: width 9s } .a { font-size: 30px }</style><div><p>",
    );
    started(page);
    page.$("div").className = "a";
    expect(started(page)).toEqual(["font-size"]);
  });

  test("start when a box gets its first fallback", () => {
    using page = open(`<style>
      div { position: relative; width: 300px; height: 9px } p { position: absolute; left: 300px; width: 50px; margin: 0 }
      .a { position-try-fallbacks: --a; transition: left 100s steps(2, start) } @position-try --a { left: 200px }
    </style><div><p>`);
    expect(page.$("p").offsetLeft).toBe(300);
    page.$("p").className = "a";
    expect(page.$("p").offsetLeft).toBe(250);
  });

  test("with other keyframes are reversed from what these give", () => {
    using page = open("<p style='left: 0; transition: left 100s linear'>");
    const p = page.$("p");
    started(page);
    p.style.left = "100px";
    const [transition] = p.getAnimations();
    transition.currentTime = 50000;
    (transition.effect as KeyframeEffect).setKeyframes({});
    p.style.left = "0px";
    expect((p.getAnimations()[0].effect as KeyframeEffect).getKeyframes()[0].left).toBe("100px");
  });

  test("to no value have an empty one in the keyframe", () => {
    using page = open("<p style='--a: a; transition: --a 9s allow-discrete'>");
    started(page);
    page.$("p").style.removeProperty("--a");
    expect((page.$("p").getAnimations()[0].effect as KeyframeEffect).getKeyframes().map(it => it["--a"])).toEqual([
      "a",
      "",
    ]);
  });
});

test("the effect that a script gives to an animation keeps its composite operation", () => {
  using page = open("<style>@keyframes a { to { left: 1px } }</style><p style='animation: a 9s'>");
  const [animation] = page.$("p").getAnimations();
  animation.effect = new page.window.KeyframeEffect(page.$("p"), { left: "2px" }, 9000);
  page.$("p").style.animationComposition = "add";
  page.computed("p", "left");
  expect((animation.effect as KeyframeEffect).composite).toBe("replace");
});

test.each([
  [
    "a container without a box answers nothing",
    "<style>i { container-type: size; display: block; width: 9px } @container (width: 9px) { p { order: 1 } }</style><i><b hidden><i><p>",
    "p",
    null,
    "order",
    "0",
  ],
  [
    "a foreignObject is no size container",
    "<style>@container (width >= 0) { p { order: 1 } }</style><svg><foreignObject width=9 height=9 style='container-type: size'><p>",
    "p",
    null,
    "order",
    "0",
  ],
  [
    "a placeholder has the direction of its field",
    "<style>::placeholder { direction: rtl }</style><input placeholder=a>",
    "input",
    "::placeholder",
    "direction",
    "ltr",
  ],
])("%s", (_, html, selector, pseudo, property, value) => {
  using page = open(html);
  expect(page.window.getComputedStyle(page.$(selector), pseudo).getPropertyValue(property)).toBe(value);
});

test("a backdrop measures its dialog", () => {
  using page = open(
    "<style>::backdrop { font-size: 10cqw }</style><dialog style='container-type: inline-size; width: 100px'>",
  );
  page.$("dialog").showModal();
  expect(page.window.getComputedStyle(page.$("dialog"), "::backdrop").fontSize).toBe("10px");
});

test("font: stretch in calc(), no slant in any unit, settings stay finite", () => {
  using page = open("<p style='font: medium serif'>");
  const { style } = page.$("p");
  style.fontStretch = "calc(50%)";
  expect(style.font).toBe("ultra-condensed medium serif");
  expect(new page.window.FontFace("a", "url(a)", { style: "oblique 0rad" }).style).toBe("normal");
  page
    .$("p")
    .animate(
      { fontVariationSettings: ["'aaaa' 0", "'aaaa' 9"] },
      { duration: 2, delay: -1, fill: "both", easing: "linear(3e38, 3e38)" },
    )
    .pause();
  expect(page.computed("p", "font-variation-settings")).toBe('"aaaa" 3.40282e+38');
});

test.each([
  "video",
  "video, audio",
  "audio, [data-a]",
  "video[data-a], i",
  ":is(audio, video):not(b *)",
  ":is(audio, section > video)",
  "section video",
  "nav video, section i",
  "i + video",
  "foreignObject",
])("querySelector(%s) follows what comes and goes", selector => {
  using page = open("<main></main>");
  const main = page.$("main");
  const html = "<section><i></i><video data-a></video><video></video><svg><foreignObject/></svg></section>";
  const expected = Object.assign(page.document.createElement("main"), { innerHTML: html }).querySelectorAll(
    selector,
  ).length;
  const count = () => page.document.querySelectorAll(selector).length;
  const ways = [
    () => (main.innerHTML = html),
    () => main.append(page.document.createRange().createContextualFragment(html)),
    () =>
      main.append(
        page.document.adoptNode(new page.window.DOMParser().parseFromString(html, "text/html").body.firstChild!),
      ),
    () => main.insertAdjacentHTML("afterbegin", html),
  ];
  const away = [
    () => (main.textContent = ""),
    () => main.firstChild!.remove(),
    () => main.replaceChildren(),
    () => page.document.createElement("p").append(main.firstChild!),
  ];
  expect(ways.flatMap((add, i) => [count(), (add(), count()), (away[i](), count())])).toEqual(
    ways.flatMap(() => [0, expected, 0]),
  );
  expect(expected).toBeGreaterThan(0);
});

test("lists of the same media query are on their own", () => {
  using page = open("");
  const [a, b, c] = ["(MIN-WIDTH: 0px)", "(MIN-WIDTH: 0px)", "(max-width: 0px)"].map(it => page.window.matchMedia(it));
  expect([a === b, a.media, b.media, c.media, a.matches, b.matches, c.matches]).toEqual([
    false,
    "(min-width: 0px)",
    "(min-width: 0px)",
    "(max-width: 0px)",
    true,
    true,
    false,
  ]);
});

test.each(["disc", "decimal"])("a broken image of a marker gives way to %s", async type => {
  using page = open(
    `<style>li { list-style: inside ${type}; width: fit-content }</style><li><li style="list-style-image: url('data:image/png,')">`,
  );
  const [usual, broken] = page.document.querySelectorAll("li");
  for (const end = performance.now() + 4000; broken.offsetWidth !== usual.offsetWidth && performance.now() < end;) {
    await new Promise(resolve => page.window.requestAnimationFrame(resolve));
  }
  expect(broken.offsetWidth).toBe(usual.offsetWidth);
  expect(usual.offsetWidth).toBeGreaterThan(5);
});
