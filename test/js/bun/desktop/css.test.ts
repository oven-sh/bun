import { desktopInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";

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

describe("selectors", () => {
  test(":nth-last-child(of) follows the later siblings", () => {
    using page = open(`<style>:nth-last-child(1 of .a) { order: 1 }</style><p class=a></p><p id=last class=a></p>`);
    expect(page.computed("p", "order")).toBe("0");
    page.$("#last").className = "";
    expect(page.computed("p", "order")).toBe("1");
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
});

describe("animations", () => {
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
