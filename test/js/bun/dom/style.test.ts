import {
  CSS,
  CSSStyleSheet,
  Element,
  Event,
  EventTarget,
  HTMLElement,
  MediaQueryList,
  MutationObserver,
  SVGElement,
  Window,
} from "bun:dom";
import { describe, expect, test } from "bun:test";

const window = new Window();
const { document } = window;
const create = (tag = "div") => document.createElement(tag);
// Puts the markup into the body, runs the function, and empties the body again.
function withBody<T>(html: string, run: () => T): T {
  document.body.innerHTML = html;
  try {
    return run();
  } finally {
    document.body.innerHTML = "";
  }
}
const computed = (selector: string, pseudo?: string) =>
  window.getComputedStyle(document.querySelector(selector), pseudo);

describe("element.style", () => {
  test("is the same object every time", () => {
    const div = create();
    expect(div.style).toBe(div.style);
    expect(Object.prototype.toString.call(div.style)).toBe("[object CSSStyleProperties]");
  });

  test("has every property as an attribute of its prototype", () => {
    const { style } = create();
    for (const name of [
      "animation",
      "WebkitAnimation",
      "webkitAnimation",
      "backgroundColor",
      "background-color",
      "cssFloat",
      "float",
      "viewTransitionName",
    ])
      expect([name, name in style]).toEqual([name, true]);
    for (const name of ["bogus", "Color", "background-Color", "--x"])
      expect([name, name in style]).toEqual([name, false]);
    expect(style.hasOwnProperty("color")).toBe(false);
    expect(Object.keys(style)).toEqual([]);
    expect(style.color).toBe("");

    const prototype = Object.getPrototypeOf(style);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "color");
    expect(typeof descriptor.get).toBe("function");
    expect(typeof descriptor.set).toBe("function");
    expect(descriptor.enumerable).toBe(true);
    expect(descriptor.configurable).toBe(true);
    const names = Object.getOwnPropertyNames(prototype);
    for (const name of ["color", "backgroundColor", "background-color", "WebkitMask", "webkitMask", "-webkit-mask"])
      expect(names).toContain(name);
    const seen: string[] = [];
    for (const name in style) seen.push(name);
    expect(seen).toContain("backgroundColor");
    expect(seen).toContain("cssText");
  });

  test("a store as the first thing ever done with a name reaches the setter", () => {
    const div = create();
    div.style.outlineOffset = "3px";
    expect(div.style.hasOwnProperty("outlineOffset")).toBe(false);
    expect(div.getAttribute("style")).toBe("outline-offset: 3px;");
  });

  test("goes to the attribute and back", () => {
    const div = create();
    div.style.color = "red";
    expect(div.style.color).toBe("red");
    expect(div.style.cssText).toBe("color: red;");
    expect(div.getAttribute("style")).toBe("color: red;");
    expect(div.outerHTML).toBe(`<div style="color: red;"></div>`);
    expect(div.style.length).toBe(1);
    expect(div.style[0]).toBe("color");
    expect(div.style.item(0)).toBe("color");
    expect(div.style[1]).toBeUndefined();
    expect(div.style.item(1)).toBe("");
    expect(Object.keys(div.style)).toEqual(["0"]);

    div.setAttribute("style", "color: blue; bogus: 1; width: 5px");
    expect(div.style.color).toBe("blue");
    expect(div.style.width).toBe("5px");
    expect(div.style.length).toBe(2);
    expect(div.getAttribute("style")).toBe("color: blue; bogus: 1; width: 5px");
    expect(div.style.cssText).toBe("color: blue; width: 5px;");

    div.removeAttribute("style");
    expect(div.style.length).toBe(0);
  });

  test("every way to look at the attribute sees what the CSSOM wrote", () => {
    const styled = () => {
      const div = create();
      div.style.top = "1px";
      return div;
    };
    expect(styled().matches(`[style="top: 1px;"]`)).toBe(true);
    expect(styled().getAttributeNames()).toEqual(["style"]);
    expect(styled().attributes.length).toBe(1);
    expect(styled().hasAttributes()).toBe(true);
    expect(styled().hasAttribute("style")).toBe(true);
    expect(styled().getAttributeNode("style").value).toBe("top: 1px;");
    expect(styled().cloneNode().outerHTML).toBe(`<div style="top: 1px;"></div>`);
    expect(styled().toggleAttribute("style")).toBe(false);
    const other = create();
    other.setAttribute("style", "top: 1px;");
    expect(styled().isEqualNode(other)).toBe(true);
  });

  test("the attribute stands where it was when the CSSOM first wrote to it", () => {
    let div = create();
    div.style.color = "red";
    div.className = "x";
    div.id = "i";
    expect(div.outerHTML).toBe(`<div style="color: red;" class="x" id="i"></div>`);

    div = create();
    div.id = "i";
    div.style.color = "red";
    div.className = "x";
    expect(div.outerHTML).toBe(`<div id="i" style="color: red;" class="x"></div>`);
    div.style.color = "";
    expect(div.outerHTML).toBe(`<div id="i" style="" class="x"></div>`);

    div = create();
    div.style.setProperty("--a", "1");
    div.setAttribute("data-x", "1");
    expect(div.getAttributeNames()).toEqual(["style", "data-x"]);

    div = create();
    div.style.cssText = "color: red";
    div.className = "x";
    expect(div.outerHTML).toBe(`<div style="color: red;" class="x"></div>`);

    div = create();
    div.style.color = "red";
    div.className = "x";
    div.removeAttribute("style");
    div.title = "t";
    div.style.color = "blue";
    expect(div.outerHTML).toBe(`<div class="x" title="t" style="color: blue;"></div>`);
  });

  test("reading the style, or a value that is not valid, makes no attribute", () => {
    const div = create();
    void div.style.color;
    div.style.color = "notacolor";
    div.style.removeProperty("top");
    div.className = "x";
    expect(div.hasAttribute("style")).toBe(false);
    expect(div.outerHTML).toBe(`<div class="x"></div>`);
  });

  test("removeAttribute takes away a style that was never written to the attribute", async () => {
    for (const remove of [
      (e: Element) => e.removeAttribute("style"),
      (e: Element) => e.removeAttributeNS(null, "style"),
    ]) {
      const div = create();
      const records: (string | null)[] = [];
      const observer = new MutationObserver(list => records.push(...list.map(record => record.oldValue)));
      div.style.top = "1px";
      observer.observe(div, { attributes: true, attributeOldValue: true });
      remove(div);
      expect(div.hasAttribute("style")).toBe(false);
      expect(div.outerHTML).toBe("<div></div>");
      expect(div.style.length).toBe(0);
      await Promise.resolve();
      observer.disconnect();
      expect(records).toEqual(["top: 1px;"]);
    }
  });

  test("elements that came from the same markup do not share a style", () => {
    const div = create();
    div.innerHTML = `<i style="color: red"></i><i style="color: red"></i>`;
    div.firstChild.style.color = "blue";
    expect(div.innerHTML).toBe(`<i style="color: blue;"></i><i style="color: red"></i>`);
  });

  test("SVG elements have a style", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    expect(svg).toBeInstanceOf(SVGElement);
    expect(svg).toBeInstanceOf(Element);
    expect(svg).not.toBeInstanceOf(HTMLElement);
    svg.style.fill = "red";
    svg.style.strokeWidth = "2";
    expect(svg.getAttribute("style")).toBe("fill: red; stroke-width: 2;");
    expect(svg.style).toBe(svg.style);

    const div = create();
    div.innerHTML = `<svg style="width: 16px" data-a="1" tabindex="0"><g><path style="fill: blue"></path></g><title>t</title></svg>`;
    const [outer, path] = [div.firstChild, div.querySelector("path")];
    expect(path).toBeInstanceOf(SVGElement);
    expect(path.style.fill).toBe("blue");
    expect(outer.style.width).toBe("16px");
    expect(outer.dataset.a).toBe("1");
    expect(outer.tabIndex).toBe(0);
    expect(outer.ownerSVGElement).toBeNull();
    expect(path.ownerSVGElement).toBe(outer);
    expect(path.viewportElement).toBe(outer);
    expect(path.cloneNode()).toBeInstanceOf(SVGElement);
    expect(window.getComputedStyle(path).fill).toBe("rgb(0, 0, 255)");
    expect(window.getComputedStyle(outer).display).toBe("inline");
    expect(document.createElementNS("http://www.w3.org/1998/Math/MathML", "math")).not.toBeInstanceOf(SVGElement);
  });

  test("element.style = text sets cssText", () => {
    const div = create();
    div.style = "top: 1px";
    expect(div.style.top).toBe("1px");
  });

  test("an invalid value changes nothing", () => {
    const div = create();
    div.style.color = "notacolor";
    div.style.width = "10";
    div.style.paddingTop = "-1px";
    div.style.display = "bogus";
    div.style.cursor = "bogus";
    div.style.content = "bogus";
    div.style.clip = "rect(0 0 0)";
    div.style.fontWeight = "1001";
    div.style.fontWeight = "0";
    expect(div.hasAttribute("style")).toBe(false);
    div.style.color = "red";
    div.style.color = "notacolor";
    expect(div.style.color).toBe("red");
  });

  test("an unknown name is an ordinary property of the object", () => {
    const div = create();
    div.style.bogus = "1";
    expect(div.style.bogus).toBe("1");
    expect(div.hasAttribute("style")).toBe(false);
  });

  test("values are serialized as the CSSOM says", () => {
    const { style } = create();
    const cases: [string, string, string][] = [
      ["width", "0", "0px"],
      ["width", "10PX", "10px"],
      ["width", ".5em", "0.5em"],
      ["width", "calc(1px + 2px)", "calc(3px)"],
      ["width", "calc(0% + 0px)", "calc(0% + 0px)"],
      ["width", "calc(50% - 0px)", "calc(50% - 0px)"],
      ["opacity", ".5", "0.5"],
      ["color", "RED", "red"],
      ["color", "#FF0000", "rgb(255, 0, 0)"],
      ["color", "#f00", "rgb(255, 0, 0)"],
      ["color", "rgba(0,0,0,.5)", "rgba(0, 0, 0, 0.5)"],
      ["color", "transparent", "transparent"],
      ["color", "currentColor", "currentcolor"],
      ["display", "BLOCK", "block"],
      ["display", "INHERIT", "inherit"],
      ["zIndex", "3", "3"],
      ["fontWeight", "bold", "bold"],
      ["transform", "translateX(10px) rotate(5deg)", "translateX(10px) rotate(5deg)"],
      ["transformOrigin", "top left", "top left"],
      ["boxShadow", "none", "none"],
      ["boxShadow", "NONE", "none"],
      ["textShadow", "none", "none"],
      ["flexBasis", "content", "content"],
      ["fontFamily", "Helvetica Neue, 'Arial', sans-serif", `"Helvetica Neue", Arial, sans-serif`],
      ["fontFamily", `"a\\"b"`, `"a\\"b"`],
      ["backgroundPosition", "0 0", "0px 0px"],
      ["backgroundPosition", "center", "center center"],
      ["backgroundPosition", "0 0, center", "0 0, center"],
      ["background", "red url(a.png) repeat-x 0 0", `url("a.png") 0px 0px repeat-x red`],
      ["background", "url('a.png') no-repeat center / cover", `url("a.png") center center / cover no-repeat`],
      ["background", "none", "none"],
      ["background", "transparent", "transparent"],
      ["background", "transparent url(a.png)", `url("a.png") transparent`],
      ["backgroundSize", "10px", "10px auto"],
      ["backgroundSize", "100% auto", "100% auto"],
      ["backgroundSize", "auto", "auto"],
      ["backgroundSize", "cover", "cover"],
      ["aspectRatio", "1", "1 / 1"],
      ["aspectRatio", "16 / 9", "16 / 9"],
      ["cursor", "POINTER", "pointer"],
      ["cursor", "url(a.png), auto", `url("a.png"), auto`],
      ["content", "NONE", "none"],
      ["maskImage", "url(a.svg)", `url("a.svg")`],
      ["fill", "url(#a)", `url("#a")`],
      ["clip", "rect(0 0 0 0)", "rect(0px, 0px, 0px, 0px)"],
      ["clip", "rect(0, auto, 1px, 0)", "rect(0px, auto, 1px, 0px)"],
      ["clip", "AUTO", "auto"],
      ["color", "lab(50% 40 59.5)", "lab(50 40 59.5)"],
      ["color", "oklch(60% 0.15 50)", "oklch(0.6 0.15 50)"],
      ["color", "color-mix(in srgb, red, blue)", "color-mix(in srgb, red, blue)"],
      ["fontWeight", "1000", "1000"],
      ["WebkitBorderRadius", "1px", "1px"],
      ["WebkitBorderImage", "none", "none"],
      ["marginLeft", "-0px", "0px"],
      ["backgroundPosition", "5% -0px", "5% 0px"],
      ["width", "-0px", "0px"],
    ];
    for (const [name, value, expected] of cases) {
      style.cssText = "";
      style[name] = value;
      expect([name, value, style[name]]).toEqual([name, value, expected]);
    }
  });

  test("shorthands are stored as longhands", () => {
    const { style } = create();
    style.margin = "1px 2px";
    expect(style.length).toBe(4);
    expect([style.marginTop, style.marginRight, style.marginBottom, style.marginLeft]).toEqual([
      "1px",
      "2px",
      "1px",
      "2px",
    ]);
    expect(style.margin).toBe("1px 2px");
    expect(style.cssText).toBe("margin: 1px 2px;");
    style.marginLeft = "3px";
    expect(style.margin).toBe("1px 2px 1px 3px");
    style.removeProperty("margin-top");
    expect(style.margin).toBe("");
    expect(style.cssText).toBe("margin-right: 2px; margin-bottom: 1px; margin-left: 3px;");

    style.cssText = "border: 1px solid red";
    expect(style.borderTopWidth).toBe("1px");
    expect(style.borderLeftStyle).toBe("solid");
    expect(style.borderBottomColor).toBe("red");
    expect(style.border).toBe("1px solid red");
    expect(style.cssText).toBe("border: 1px solid red;");

    style.cssText = "flex: 1";
    expect([style.flexGrow, style.flexShrink, style.flexBasis]).toEqual(["1", "1", "0%"]);

    style.cssText = "background: url(a.png)";
    style.backgroundColor = "red";
    expect(style.background).toBe(`url("a.png") red`);
    expect(style.cssText).toBe(`background: url("a.png") red;`);

    style.cssText = "-webkit-border-radius: 1px";
    expect(style.cssText).toBe("border-radius: 1px;");

    style.cssText = "color: red; all: unset";
    expect(style.cssText).toBe("all: unset;");
    expect(style.color).toBe("unset");
  });

  test("shorthands that keep the author's text", () => {
    const { style } = create();
    style.textDecoration = "underline  dotted #f00";
    expect(style.textDecoration).toBe("underline  dotted #f00");
    expect(style.cssText).toBe("text-decoration: underline  dotted #f00;");
    expect([
      style.textDecorationLine,
      style.textDecorationStyle,
      style.textDecorationColor,
      style.textDecorationThickness,
    ]).toEqual(["underline", "dotted", "rgb(255, 0, 0)", "auto"]);
    expect(style.length).toBe(4);
    style.textDecorationColor = "blue";
    expect(style.textDecoration).toBe("underline dotted blue");
    style.textDecoration = "line-through underline";
    expect(style.textDecorationLine).toBe("underline line-through");
    style.textDecoration = "none";
    expect(style.textDecorationLine).toBe("none");
    style.textDecorationStyle = "solid";
    expect(style.textDecoration).toBe("none");
    for (const invalid of [
      "underline underline",
      "none underline",
      "bogus",
      "solid dotted",
      "red blue",
      "underline inherit",
    ]) {
      style.cssText = "";
      style.textDecoration = invalid;
      expect([invalid, style.length]).toEqual([invalid, 0]);
    }

    style.cssText = "list-style: none";
    expect([style.listStylePosition, style.listStyleImage, style.listStyleType]).toEqual(["outside", "none", "none"]);
    style.cssText = "list-style: square inside";
    expect(style.listStyle).toBe("square inside");
    expect([style.listStylePosition, style.listStyleImage, style.listStyleType]).toEqual(["inside", "none", "square"]);
    style.listStyleType = "circle";
    expect(style.listStyle).toBe("inside circle");
    style.cssText = "list-style: url(a.png) none";
    expect([style.listStyleImage, style.listStyleType]).toEqual([`url("a.png")`, "none"]);
    style.cssText = "list-style: none none none";
    expect(style.length).toBe(0);
    style.cssText = "list-style: inherit";
    expect([style.listStyle, style.listStyleType, style.length]).toEqual(["inherit", "inherit", 3]);
    style.cssText = "list-style: var(--l)";
    expect([style.listStyle, style.listStyleType, style.cssText]).toEqual(["var(--l)", "", "list-style: var(--l);"]);

    style.cssText = "grid-area: 1 / 2 / 3 / 4";
    expect([style.gridRowStart, style.gridColumnStart, style.gridRowEnd, style.gridColumnEnd]).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    expect([style.gridRow, style.gridColumn, style.gridArea]).toEqual(["1 / 3", "2 / 4", "1 / 2 / 3 / 4"]);
    expect(style.cssText).toBe("grid-area: 1 / 2 / 3 / 4;");
    style.cssText = "grid-area: main";
    expect([style.gridRowStart, style.gridColumnStart, style.gridRowEnd, style.gridColumnEnd]).toEqual([
      "main",
      "main",
      "main",
      "main",
    ]);
    style.cssText = "grid-row: span 2";
    expect([style.gridRowStart, style.gridRowEnd]).toEqual(["span 2", "auto"]);
    style.gridRowEnd = "5";
    expect(style.gridRow).toBe("span 2 / 5");
    style.gridRowEnd = "auto";
    expect(style.gridRow).toBe("span 2");
    style.cssText = "grid-row: 1 / 2 / 3";
    expect(style.length).toBe(0);
  });

  test("all", () => {
    const { style } = create();
    const all = () => style.getPropertyValue("all");
    style.cssText = "width: 50px";
    expect(all()).toBe("");
    style.cssText = "all: revert; width: 50px";
    expect([all(), style.width, style.height]).toEqual(["", "50px", "revert"]);
    expect(style.cssText).toBe("all: revert; width: 50px;");
    style.cssText = "width: 50px; margin: initial; all: revert";
    expect([all(), style.width, style.margin]).toEqual(["revert", "revert", "revert"]);
    style.cssText = "all: unset; margin-top: 1px";
    expect([all(), style.margin, style.marginLeft]).toEqual(["", "", "unset"]);
    style.cssText = "--a: a; all: inherit; --b: b; height: inherit";
    expect(all()).toBe("inherit");
    expect(style.cssText).toBe("--a: a; all: inherit; --b: b;");
    style.cssText = "all: inherit; height: inherit !important";
    expect(style.cssText).toBe("all: inherit; height: inherit !important;");

    style.cssText = "width: 50px; color: green; direction: rtl; --x: 1";
    expect(style.removeProperty("all")).toBe("");
    expect(style.cssText).toBe("direction: rtl; --x: 1;");
    style.cssText = "all: revert";
    expect(style.removeProperty("all")).toBe("revert");
    expect(style.length).toBe(0);

    for (const name of window.getComputedStyle(document.body)) style.setProperty(name, "inherit");
    expect(all()).toBe("inherit");
    expect(style.cssText).toBe("all: inherit; direction: inherit; unicode-bidi: inherit;");
    style.width = "1px";
    expect(all()).toBe("");
  });

  test("setProperty, getPropertyValue, getPropertyPriority, removeProperty", () => {
    const div = create();
    const { style } = div;
    style.setProperty("display", "none", "important");
    expect(style.getPropertyValue("display")).toBe("none");
    expect(style.getPropertyPriority("display")).toBe("important");
    expect(style.cssText).toBe("display: none !important;");
    style.setProperty("DISPLAY", "block");
    expect(style.getPropertyPriority("display")).toBe("");
    style.setProperty("display", "flex", "bogus");
    expect(style.display).toBe("block");
    expect(style.removeProperty("display")).toBe("block");
    expect(style.removeProperty("display")).toBe("");
    expect(style.getPropertyValue("bogus")).toBe("");
    expect(div.getAttribute("style")).toBe("");
    expect(style.parentRule).toBeNull();
  });

  test("the empty string and null remove a property", () => {
    const { style } = create();
    style.cssText = "color: red; top: 1px";
    style.color = "";
    style.top = null;
    expect(style.length).toBe(0);
  });

  test("custom properties", () => {
    const { style } = create();
    style.setProperty("--x", " 1px ");
    style.setProperty("--Y", "{a: b}");
    expect(style.getPropertyValue("--x")).toBe("1px");
    expect(style.getPropertyValue("--X")).toBe("");
    expect(style.cssText).toBe("--x: 1px; --Y: {a: b};");
    expect(style[0]).toBe("--x");
    style.width = "var(--x)";
    expect(style.width).toBe("var(--x)");
    style.margin = "var(--x) 2px";
    expect(style.margin).toBe("var(--x) 2px");
    expect(style.marginTop).toBe("");

    // A name is written so that it can be read again.
    style.cssText = "--a\u005c;b: 1; --\u005c30 : 2";
    expect([style.length, style[0], style[1], style.getPropertyValue("--a;b")]).toEqual([2, "--a;b", "--0", "1"]);
    expect(style.cssText).toBe("--a\u005c;b: 1; --0: 2;");
    style.cssText = style.cssText;
    expect([style.length, style[0]]).toEqual([2, "--a;b"]);
  });

  test("cssFloat is float", () => {
    const { style } = create();
    style.cssFloat = "left";
    expect(style.float).toBe("left");
    expect(style.cssText).toBe("float: left;");
  });

  test("setting a property again keeps its place, a parsed list moves it to the end", () => {
    const { style } = create();
    style.cssText = "color: red; top: 1px";
    style.color = "blue";
    expect(style.cssText).toBe("color: blue; top: 1px;");
    style.cssText = "color: red; top: 1px; color: blue";
    expect(style.cssText).toBe("top: 1px; color: blue;");
    style.cssText = "color: red !important; color: blue";
    expect(style.cssText).toBe("color: red !important;");
  });

  test("a clone has its own style", () => {
    const div = create();
    div.style.color = "red";
    const clone = div.cloneNode();
    clone.style.color = "blue";
    expect(div.style.color).toBe("red");
    expect(clone.getAttribute("style")).toBe("color: blue;");
  });

  test("mutation records", async () => {
    const div = create();
    const records: [string, string | null][] = [];
    const observer = new MutationObserver(list => {
      for (const record of list) records.push([record.attributeName, record.oldValue]);
    });
    observer.observe(div, { attributes: true, attributeOldValue: true });
    div.style.color = "red";
    div.style.color = "red";
    div.style.color = "bogus";
    div.style.color = "blue";
    await Promise.resolve();
    observer.disconnect();
    expect(records).toEqual([
      ["style", null],
      ["style", "color: red;"],
    ]);
  });
});

describe("getComputedStyle", () => {
  test("knows the display of the elements of HTML", () => {
    withBody(
      `<div></div><span></span><p hidden></p><li></li><table><tbody><tr><td></td></tr></tbody></table><script></script>
       <input><input type=hidden id=h><button></button><dialog></dialog><dialog open id=o></dialog><unknown-tag></unknown-tag>`,
      () => {
        const display = (selector: string) => computed(selector).display;
        expect(display("div")).toBe("block");
        expect(display("span")).toBe("inline");
        expect(display("p")).toBe("none");
        expect(display("li")).toBe("list-item");
        expect(display("table")).toBe("table");
        expect(display("tr")).toBe("table-row");
        expect(display("td")).toBe("table-cell");
        expect(display("script")).toBe("none");
        expect(display("input")).toBe("inline-block");
        expect(display("#h")).toBe("none");
        expect(display("button")).toBe("inline-block");
        expect(display("dialog")).toBe("none");
        expect(display("#o")).toBe("block");
        expect(display("unknown-tag")).toBe("inline");
        expect(window.getComputedStyle(document.head).display).toBe("none");
        expect(window.getComputedStyle(document.body).display).toBe("block");
      },
    );
  });

  test("initial values", () => {
    withBody(`<div></div>`, () => {
      const style = computed("div");
      expect(style.visibility).toBe("visible");
      expect(style.opacity).toBe("1");
      expect(style.pointerEvents).toBe("auto");
      expect(style.color).toBe("rgb(0, 0, 0)");
      expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(style.position).toBe("static");
      expect(style.marginTop).toBe("0px");
      expect(style.fontWeight).toBe("400");
      expect(style.getPropertyValue("display")).toBe("block");
      expect(style.getPropertyValue("visibility")).toBe("visible");
      expect(style.getPropertyValue("bogus")).toBe("");
      expect(style.getPropertyValue("--x")).toBe("");
      expect(style.getPropertyPriority("display")).toBe("");
      expect(style.cssText).toBe("");
      expect(style.parentRule).toBeNull();
      expect(style.length).toBeGreaterThan(300);
      expect(Array.from(style)).toContain("display");
    });
  });

  test("the style attribute, inheritance and the keywords", () => {
    withBody(
      `<div style="visibility: hidden; color: red; display: flex; pointer-events: none"><p><b id=a style="color: inherit; display: initial"></b><i id=b style="visibility: visible; color: currentcolor; border-top-color: initial"></i></p></div>`,
      () => {
        expect(computed("div").display).toBe("flex");
        expect(computed("p").display).toBe("block");
        expect(computed("p").visibility).toBe("hidden");
        expect(computed("p").color).toBe("rgb(255, 0, 0)");
        expect(computed("p").pointerEvents).toBe("none");
        expect(computed("#a").color).toBe("rgb(255, 0, 0)");
        expect(computed("#a").display).toBe("inline");
        expect(computed("#a").fontWeight).toBe("bold");
        expect(computed("#b").visibility).toBe("visible");
        expect(computed("#b").color).toBe("rgb(255, 0, 0)");
        expect(computed("#b").borderTopColor).toBe("rgb(255, 0, 0)");
        expect(computed("#b").fontStyle).toBe("italic");
      },
    );
  });

  test("a shorthand is the declared text if one declaration wins for all its longhands", () => {
    withBody(
      `<style>p { border: 1px solid red; text-decoration: underline wavy; margin: 0 auto } #b { border-top-color: blue; margin-left: 1px }</style><p id=a></p><p id=b></p><a href="#">x</a>`,
      () => {
        expect(computed("#a").border).toBe("1px solid red");
        expect(computed("#a").borderTopColor).toBe("rgb(255, 0, 0)");
        expect(computed("#a").textDecoration).toBe("underline wavy");
        expect(computed("#a").textDecorationLine).toBe("underline");
        expect(computed("#a").margin).toBe("0px auto");
        expect(computed("#b").border).toBe("");
        expect(computed("#b").borderRight).toBe("1px solid rgb(255, 0, 0)");
        expect(computed("#b").margin).toBe("0px auto 0px 1px");
        expect(computed("a").textDecorationLine).toBe("underline");
        expect(computed("a").textDecoration).toBe("underline");
      },
    );
    // What jest-dom's toHaveStyle compares: the value as an inline style writes it, and the computed one.
    for (const [name, value] of [
      ["border", "1px solid red"],
      ["border", "0"],
      ["border", "none"],
      ["border-color", "red"],
      ["border-top", "2px dashed #00f"],
      ["background", "red"],
      ["background", "#fff url(a.png) no-repeat"],
      ["outline", "2px dotted blue"],
      ["font", "bold 12px/1.5 Arial"],
      ["flex", "1"],
      ["text-decoration", "underline red"],
      ["list-style", "none"],
      ["grid-area", "1 / 2"],
    ]) {
      withBody(
        `<style>#s { ${name}: ${value} }</style><div id=s></div><div id=i style="${name}: ${value}"></div>`,
        () => {
          const expected = create();
          expected.style.setProperty(name, value);
          const written = expected.style.getPropertyValue(name);
          expect(written).not.toBe("");
          expect([name, value, computed("#s").getPropertyValue(name), computed("#i").getPropertyValue(name)]).toEqual([
            name,
            value,
            written,
            written,
          ]);
        },
      );
    }
  });

  test("what the user agent says about dir, focus and dialogs", () => {
    withBody(
      `<div id=a dir=auto>\u05d0<span id=b></span></div><div id=c dir=auto>a</div><bdi id=d>\u05d0</bdi><div dir=rtl><input id=e type=tel><input id=f></div>
       <button id=g></button><input id=h readonly><dialog id=i></dialog>`,
      () => {
        expect(["#a", "#b", "#c", "#d", "#e", "#f"].map(selector => computed(selector).direction)).toEqual([
          "rtl",
          "rtl",
          "ltr",
          "rtl",
          "ltr",
          "rtl",
        ]);

        expect(computed("#g").outlineStyle).toBe("none");
        document.querySelector("#g").focus();
        expect(computed("#g").outlineStyle).toBe("auto");
        document.querySelector("#h").focus();
        expect([computed("#g").outlineStyle, computed("#h").outlineStyle]).toEqual(["none", "none"]);

        expect(computed("#i").position).toBe("absolute");
        document.querySelector("#i").showModal();
        expect(computed("#i").position).toBe("fixed");
        expect(computed("#a").position).toBe("static");
      },
    );
  });

  test("is live and cannot be written to", () => {
    withBody(`<div></div>`, () => {
      const div = document.querySelector("div");
      const style = window.getComputedStyle(div);
      expect(window.getComputedStyle(div)).not.toBe(style);
      div.style.display = "none";
      expect(style.display).toBe("none");
      expect(() => (style.display = "block")).toThrow(expect.objectContaining({ name: "NoModificationAllowedError" }));
      expect(() => style.setProperty("display", "block")).toThrow(
        expect.objectContaining({ name: "NoModificationAllowedError" }),
      );
      expect(() => style.removeProperty("display")).toThrow(
        expect.objectContaining({ name: "NoModificationAllowedError" }),
      );
    });
  });

  test("style sheets: specificity, order, !important", () => {
    withBody(
      `<style>
         #a { color: green }
         .x { color: red; top: 1px; left: 1px !important; margin: 1px 2px }
         div { color: blue; top: 2px }
         .x { top: 3px }
         div, p { z-index: 1 }
         section > .x { bottom: 9px }
       </style><div id=a class=x style="left: 5px; right: 6px"></div><div id=b></div>`,
      () => {
        const style = computed("#a");
        expect(style.color).toBe("rgb(0, 128, 0)");
        expect(style.top).toBe("3px");
        expect(style.left).toBe("1px");
        expect(style.right).toBe("6px");
        expect(style.marginLeft).toBe("2px");
        expect(style.margin).toBe("1px 2px");
        expect(style.zIndex).toBe("1");
        expect(style.bottom).toBe("auto");
        expect(computed("#b").color).toBe("rgb(0, 0, 255)");
      },
    );
  });

  test("style sheets come and go", () => {
    withBody(`<div></div>`, () => {
      const style = computed("div");
      const sheet = create("style");
      sheet.textContent = "div { display: none }";
      expect(style.display).toBe("block");
      document.head.append(sheet);
      expect(style.display).toBe("none");
      sheet.textContent = "div { display: grid }";
      expect(style.display).toBe("grid");
      sheet.append("div { display: flex }");
      expect(style.display).toBe("flex");
      sheet.media = "print";
      expect(style.display).toBe("block");
      sheet.media = "screen";
      expect(style.display).toBe("flex");
      sheet.disabled = true;
      expect(style.display).toBe("block");
      sheet.disabled = false;
      sheet.remove();
      expect(style.display).toBe("block");
    });
  });

  test("var()", () => {
    withBody(
      `<style>:root { --a: 1px; --c: var(--a); --d: none; --word: red } div { --b: var(--c); width: var(--b); height: var(--none, 2px); top: var(--word); margin: var(--a) 3px; --loop: var(--loop); left: var(--loop, 4px); display: var(--d) }</style><div style="color: var(--color, red)"></div>`,
      () => {
        const style = computed("div");
        expect(style.getPropertyValue("--a")).toBe("1px");
        expect(style.getPropertyValue("--b")).toBe("1px");
        expect(style.width).toBe("1px");
        expect(style.height).toBe("2px");
        // `red` is no length, so the declaration counts for nothing.
        expect(style.top).toBe("auto");
        expect(style.marginTop).toBe("1px");
        expect(style.marginRight).toBe("3px");
        expect(style.left).toBe("4px");
        expect(style.display).toBe("none");
        expect(style.color).toBe("rgb(255, 0, 0)");
      },
    );
  });

  // In a test the sheet with the theme's variables is often not loaded: toHaveStyle("color: var(--brand)") has to pass.
  test("a var() that refers to nothing stays as it was declared", () => {
    withBody(
      `<style>div {
         width: var(--none); height: calc(100% - var(--none)); top: var(--none, var(--nothing));
         color: var(--none); background-color: var(--none); display: var(--none);
         --a: 1px; margin: var(--none) 3px; padding: var(--a) var(--none);
         --loop: var(--loop); left: var(--loop);
         --one: var(--two); --two: var(--one); right: var(--one);
         --chain: var(--none); bottom: var(--chain);
       }</style><div><p></p></div>`,
      () => {
        const style = computed("div");
        const declared = {
          "width": "var(--none)",
          "height": "calc(100% - var(--none))",
          "top": "var(--none, var(--nothing))",
          "color": "var(--none)",
          "display": "var(--none)",
          "margin": "var(--none) 3px",
          "padding": "var(--a) var(--none)",
          "left": "var(--loop)",
          "right": "var(--one)",
          "bottom": "var(--chain)",
          "--loop": "var(--loop)",
          "--one": "var(--two)",
          "--chain": "var(--none)",
        };
        for (const [name, text] of Object.entries(declared))
          expect([name, style.getPropertyValue(name)]).toEqual([name, text]);
        expect([style.width, style.margin, style.backgroundColor, style["background-color"]]).toEqual([
          "var(--none)",
          "var(--none) 3px",
          "var(--none)",
          "var(--none)",
        ]);
        // The declaration of a shorthand has no text for one longhand.
        expect([style.marginTop, style.marginRight, style.paddingTop]).toEqual(["0px", "0px", "0px"]);

        const inherited = computed("p");
        expect([inherited.color, inherited.getPropertyValue("--chain")]).toEqual(["var(--none)", "var(--none)"]);
      },
    );
  });

  test("@media, @supports, @layer", () => {
    withBody(
      `<style>
         @media screen { div { top: 1px } }
         @media print { div { top: 2px } }
         @media not print { div { left: 1px } }
         @supports (display: grid) { div { right: 1px } }
         @supports (display: bogus) { div { right: 2px } }
         @supports not (display: bogus) { div { bottom: 1px } }
         @layer base { div { z-index: 5 } }
       </style><div></div>`,
      () => {
        const style = computed("div");
        expect([style.top, style.left, style.right, style.bottom, style.zIndex]).toEqual([
          "1px",
          "1px",
          "1px",
          "1px",
          "5",
        ]);
      },
    );
  });

  test("what a shadow tree says about its host", () => {
    withBody(
      `<style>#b { left: 9px } #c { top: 9px !important }</style><x-a id=a></x-a><x-a id=b class=on></x-a><x-a id=c hidden></x-a>`,
      () => {
        for (const host of document.querySelectorAll("x-a"))
          host.attachShadow({ mode: "open" }).innerHTML =
            `<style>:host { display: block; left: 1px; top: 1px; --x: 1 } :host(.on) { right: 2px } :host([hidden]) { display: none; top: 2px !important } :host p, p:host { bottom: 3px } :not(:not(:host)) { z-index: 4 } :where(:host(.on)) { order: 5 } :not(.never) { opacity: 0.5 }</style><p></p>`;
        expect(computed("#a").display).toBe("block");
        expect(computed("#a").left).toBe("1px");
        expect(computed("#a").right).toBe("auto");
        expect(computed("#a").bottom).toBe("auto");
        expect(computed("#a").getPropertyValue("--x")).toBe("1");
        // :host does not have to stand in the subject compound itself. Without it, nothing matches the host.
        expect([computed("#a").zIndex, computed("#a").order, computed("#b").order, computed("#a").opacity]).toEqual([
          "4",
          "0",
          "5",
          "1",
        ]);
        // The host's own tree wins, whatever the specificity.
        expect(computed("#b").left).toBe("9px");
        expect(computed("#b").right).toBe("2px");
        expect(computed("#c").display).toBe("none");
        // Among important declarations the shadow tree wins.
        expect(computed("#c").top).toBe("2px");
        const p = document.querySelector("#a").shadowRoot.querySelector("p");
        expect(window.getComputedStyle(p).bottom).toBe("3px");
        expect([window.getComputedStyle(p).zIndex, window.getComputedStyle(p).opacity]).toEqual(["auto", "0.5"]);
        expect(window.getComputedStyle(p).getPropertyValue("--x")).toBe("1");
        // A sheet of the document does not reach into the shadow tree.
        expect(window.getComputedStyle(p).left).toBe("auto");
      },
    );
  });

  test("nested rules", () => {
    withBody(
      `<style>
         .a, #x {
           color: red;
           .b { color: blue }
           &.c { top: 1px }
           > i { left: 2px }
           .d & { right: 3px }
           @media screen { bottom: 4px; .b { right: 5px } }
           @media print { top: 9px }
           @supports (display: grid) { & .b { left: 6px } }
           :is(&, .z) + p { z-index: 7 }
           .b { .e { top: 8px } }
           &::before { content: "n" }
           margin-top: 1px;
         }
       </style><section class=d><div class="a c"><p class=b><u class=e></u></p><i></i></div><p class=b id=out></p></section>`,
      () => {
        expect(computed(".a").color).toBe("rgb(255, 0, 0)");
        expect(computed(".a").top).toBe("1px");
        expect(computed(".a").right).toBe("3px");
        expect(computed(".a").bottom).toBe("4px");
        expect(computed(".a").marginTop).toBe("1px");
        expect(computed(".a", "::before").content).toBe(`"n"`);
        expect(computed(".a .b").color).toBe("rgb(0, 0, 255)");
        expect(computed(".a .b").right).toBe("5px");
        expect(computed(".a .b").left).toBe("6px");
        expect(computed("i").left).toBe("2px");
        expect(computed(".e").top).toBe("8px");
        expect(computed("#out").color).toBe("rgb(0, 0, 0)");
        expect(computed("#out").zIndex).toBe("7");

        const [rule] = document.styleSheets[0].cssRules;
        expect(document.styleSheets[0].cssRules.length).toBe(1);
        expect(rule.cssRules).toBe(rule.cssRules);
        expect(Array.from(rule.cssRules, nested => nested.selectorText ?? nested.conditionText)).toEqual([
          "& .b",
          "&.c",
          "& > i",
          ".d &",
          "screen",
          "print",
          "(display: grid)",
          ":is(&, .z) + p",
          "& .b",
          "&::before",
        ]);
        expect(rule.style.cssText).toBe("color: red; margin-top: 1px;");
        expect(rule.cssRules[0].parentRule).toBe(rule);
        expect(rule.cssRules[0].parentStyleSheet).toBe(document.styleSheets[0]);
        expect(rule.cssRules[0].cssText).toBe("& .b { color: blue; }");
        expect(Array.from(rule.cssRules[4].cssRules, nested => nested.cssText)).toEqual([
          "& { bottom: 4px; }",
          "& .b { right: 5px; }",
        ]);
        expect(rule.cssRules[8].cssText).toBe("& .b {\n  & .e { top: 8px; }\n}");
        // The specificity of `&` is that of the most specific selector of the parent's list, here #x.
        document.head.append(Object.assign(create("style"), { textContent: ".a.c.c.c { top: 2px }" }));
        expect(computed(".a").top).toBe("1px");
        document.head.lastChild.remove();
        rule.cssRules[0].style.color = "green";
        expect(computed(".a .b").color).toBe("rgb(0, 128, 0)");
      },
    );
  });

  test("cascade layers", () => {
    withBody(
      `<style>
         @layer reset, theme;
         @layer theme { #a { color: blue; top: 1px !important; left: 1px } }
         @layer reset { #a#a { color: red; top: 2px !important; left: 2px; right: 2px } }
         @layer theme.dark { #a#a#a { left: 3px; bottom: 3px } }
         @layer theme { div { bottom: 4px } }
         @layer { #a { z-index: 1 } }
         @layer { div { z-index: 2 } }
         div { right: 5px; margin-top: 5px }
         @layer late { #a { margin-top: 6px } }
       </style><div id=a></div>`,
      () => {
        const style = computed("#a");
        // A later layer wins, whatever the specificity.
        expect(style.color).toBe("rgb(0, 0, 255)");
        // Among important declarations the earlier layer wins.
        expect(style.top).toBe("2px");
        // What is in a layer itself comes after the layers inside it.
        expect(style.left).toBe("1px");
        expect(style.bottom).toBe("4px");
        // Two layers without a name are two layers.
        expect(style.zIndex).toBe("2");
        // Rules in no layer win against all layers.
        expect(style.right).toBe("5px");
        expect(style.marginTop).toBe("5px");
      },
    );
  });

  test("what a shadow tree says about what is assigned to its slots", () => {
    withBody(
      `<style>#c { left: 9px }</style><x-b><i id=a>a</i><i id=b slot=named class=on>b</i><i id=c>c</i><b><i id=d>d</i></b></x-b>`,
      () => {
        const root = document.querySelector("x-b").attachShadow({ mode: "open" });
        root.innerHTML = `<style>::slotted(i) { top: 1px; left: 1px; --s: 1 } slot[name]::slotted(.on) { right: 2px } .never ::slotted(i) { bottom: 3px } ::slotted(b), p { z-index: 4 }</style><slot></slot><slot name=named></slot><p></p>`;
        expect(computed("#a").top).toBe("1px");
        expect(computed("#a").right).toBe("auto");
        expect(computed("#a").bottom).toBe("auto");
        expect(computed("#a").getPropertyValue("--s")).toBe("1");
        expect(computed("#b").top).toBe("1px");
        expect(computed("#b").right).toBe("2px");
        // The element's own tree wins.
        expect(computed("#c").left).toBe("9px");
        // Only what is assigned itself, not what is inside it.
        expect(computed("#d").top).toBe("auto");
        expect(computed("x-b > b").zIndex).toBe("4");
        expect(window.getComputedStyle(root.querySelector("p")).zIndex).toBe("4");
        expect(Array.from(root.styleSheets[0].cssRules, rule => rule.selectorText)).toEqual([
          "::slotted(i)",
          "slot[name]::slotted(.on)",
          ".never ::slotted(i)",
          "::slotted(b), p",
        ]);
      },
    );
  });

  test("pseudo-elements", () => {
    withBody(
      `<style>div::before { content: "x"; color: red } div { color: blue } div:after { content: "y" }</style><div></div>`,
      () => {
        expect(computed("div", "::before").content).toBe(`"x"`);
        expect(computed("div", ":before").color).toBe("rgb(255, 0, 0)");
        expect(computed("div", "::after").content).toBe(`"y"`);
        expect(computed("div", "::after").color).toBe("rgb(0, 0, 255)");
        expect(computed("div", "::marker").content).toBe("normal");
        expect(computed("div").content).toBe("normal");
        expect(computed("div", "::bogus").length).toBe(0);
        expect(computed("div", "::bogus").display).toBe("");
        expect(computed("div", "before").color).toBe("rgb(0, 0, 255)");
      },
    );
    withBody(
      `<style>section > ::before { content: "c" } section ::after, p { top: 1px }</style><section><div></div></section>`,
      () => {
        expect(computed("div", "::before").content).toBe(`"c"`);
        expect(computed("div", "::after").top).toBe("1px");
        expect(computed("section", "::before").content).toBe("none");
        expect(Array.from(document.styleSheets[0].cssRules, rule => rule.selectorText)).toEqual([
          "section > ::before",
          "section ::after, p",
        ]);
      },
    );
  });

  test("an element that is not in a document", () => {
    const div = create();
    div.style.color = "red";
    expect(window.getComputedStyle(div).display).toBe("block");
    expect(window.getComputedStyle(div).color).toBe("rgb(255, 0, 0)");
  });
});

describe("style sheets", () => {
  test("document.styleSheets and the rules", () => {
    withBody(
      `<style>.a , .b>c { color : RED; margin:0 } @media screen { p { top: 1px } } @font-face { font-family: x }</style><style media=print></style>`,
      () => {
        expect(document.styleSheets).toBe(document.styleSheets);
        expect(document.styleSheets.length).toBe(2);
        const sheet = document.styleSheets[0];
        expect(sheet).toBe(document.querySelector("style").sheet);
        expect(sheet.ownerNode).toBe(document.querySelector("style"));
        expect(sheet.type).toBe("text/css");
        expect(sheet.href).toBeNull();
        expect(sheet.disabled).toBe(false);
        expect(document.styleSheets[1].media.mediaText).toBe("print");

        expect(sheet.cssRules.length).toBe(3);
        const [rule, media, fontFace] = sheet.cssRules;
        expect(rule).toBe(sheet.cssRules[0]);
        expect(rule.type).toBe(1);
        expect(rule.selectorText).toBe(".a, .b > c");
        expect(rule.style.color).toBe("red");
        expect(rule.cssText).toBe(".a, .b > c { color: red; margin: 0px; }");
        expect(rule.parentStyleSheet).toBe(sheet);
        expect(rule.style.parentRule).toBe(rule);
        expect(media.type).toBe(4);
        expect(media.conditionText).toBe("screen");
        expect(media.media.mediaText).toBe("screen");
        expect(media.cssRules.length).toBe(1);
        expect(media.cssRules[0].parentRule).toBe(media);
        expect(fontFace.type).toBe(5);
        expect(fontFace.cssText).toContain("font-family: x");
      },
    );
  });

  test("insertRule, deleteRule and rule.style take effect", () => {
    withBody(`<style></style><div></div>`, () => {
      const { sheet } = document.querySelector("style");
      const style = computed("div");
      expect(sheet.insertRule("div { top: 1px }")).toBe(0);
      expect(sheet.insertRule("div { top: 2px }", 1)).toBe(1);
      expect(style.top).toBe("2px");
      sheet.deleteRule(1);
      expect(style.top).toBe("1px");
      sheet.cssRules[0].style.top = "3px";
      expect(style.top).toBe("3px");
      sheet.cssRules[0].selectorText = "p";
      expect(style.top).toBe("auto");
      expect(() => sheet.insertRule("div {")).not.toThrow();
      expect(() => sheet.insertRule("}{")).toThrow(expect.objectContaining({ name: "SyntaxError" }));
      expect(() => sheet.insertRule("p { color: red } garbage")).toThrow(
        expect.objectContaining({ name: "SyntaxError" }),
      );
      expect(() => sheet.insertRule("p { } i { }")).toThrow(expect.objectContaining({ name: "SyntaxError" }));
      expect(() => sheet.insertRule("@media screen { garbage } ")).not.toThrow();
      expect(() => sheet.insertRule("a {}", 99)).toThrow(expect.objectContaining({ name: "IndexSizeError" }));
      expect(() => sheet.deleteRule(99)).toThrow(expect.objectContaining({ name: "IndexSizeError" }));
    });
  });

  test("@layer rules have their classes", () => {
    withBody(
      `<style>@layer reset , theme.dark;@layer one; @layer theme.dark { p { top: 1px } @layer inner { } } @layer { }</style>`,
      () => {
        const { CSSLayerStatementRule, CSSLayerBlockRule, CSSGroupingRule, CSSRule } = window;
        const [statement, single, block, anonymous] = document.styleSheets[0].cssRules;
        for (const rule of [statement, single]) {
          expect(Object.getPrototypeOf(rule)).toBe(CSSLayerStatementRule.prototype);
          expect(rule).toBeInstanceOf(CSSRule);
          expect(rule).not.toBeInstanceOf(CSSGroupingRule);
          expect(Object.isFrozen(rule.nameList)).toBe(true);
          expect(rule.type).toBe(0);
        }
        expect(statement.nameList).toEqual(["reset", "theme.dark"]);
        expect(single.nameList).toEqual(["one"]);
        for (const rule of [block, anonymous, block.cssRules[1]]) {
          expect(Object.getPrototypeOf(rule)).toBe(CSSLayerBlockRule.prototype);
          expect(rule).toBeInstanceOf(CSSGroupingRule);
        }
        expect([block.name, anonymous.name, block.cssRules[1].name]).toEqual(["theme.dark", "", "inner"]);
        expect(block.cssRules[0].selectorText).toBe("p");
        expect(block.insertRule("a { }", 2)).toBe(2);
        expect(block.cssRules).toHaveLength(3);
        expect(() => new CSSLayerBlockRule()).toThrow(TypeError);
        expect(() => new CSSLayerStatementRule()).toThrow(TypeError);
      },
    );
  });

  test("@import and @namespace only count at the top", () => {
    withBody(
      `<style>@layer a, b; @import url(a.css); @namespace svg url(http://www.w3.org/2000/svg); p {} @import url(b.css); @namespace x url(y); @media screen { @import url(c.css); }</style>`,
      () => {
        expect(Array.from(document.styleSheets[0].cssRules, rule => rule.cssText.split(" ")[0])).toEqual([
          "@layer",
          "@import",
          "@namespace",
          "p",
          "@media",
        ]);
        expect(document.styleSheets[0].cssRules[4].cssRules.length).toBe(0);
      },
    );
  });

  test("insertRule and deleteRule keep @import and @namespace at the top", () => {
    withBody(
      `<style>@import url(a.css); @namespace svg url(http://www.w3.org/2000/svg); p { }</style><style>@import url(a.css);</style>`,
      () => {
        const [sheet, importsOnly] = document.styleSheets;
        const nameOf = (run: () => unknown) => {
          try {
            return run();
          } catch (error) {
            return error.name;
          }
        };
        expect(nameOf(() => sheet.insertRule("i { }", 0))).toBe("HierarchyRequestError");
        expect(nameOf(() => sheet.insertRule("i { }", 1))).toBe("HierarchyRequestError");
        expect(nameOf(() => sheet.insertRule("@import url(b.css);", 2))).toBe("HierarchyRequestError");
        expect(nameOf(() => sheet.insertRule("@namespace x url(y);", 1))).toBe("InvalidStateError");
        expect(nameOf(() => sheet.deleteRule(1))).toBe("InvalidStateError");
        expect(sheet.cssRules.length).toBe(3);
        expect(nameOf(() => sheet.insertRule("@import url(b.css);", 1))).toBe(1);
        expect(nameOf(() => sheet.insertRule("i { }", 3))).toBe(3);
        expect(nameOf(() => sheet.insertRule("@layer a, b;", 0))).toBe(0);
        expect(sheet.cssRules.length).toBe(6);

        expect(nameOf(() => importsOnly.insertRule("@namespace x url(y);", 1))).toBe(1);
        expect(nameOf(() => importsOnly.insertRule("@namespace x url(y);", 0))).toBe("InvalidStateError");
        expect(nameOf(() => importsOnly.deleteRule(1))).toBeUndefined();
      },
    );
  });

  test("selectors are written as the CSSOM says", () => {
    withBody(`<style></style>`, () => {
      const style = document.querySelector("style");
      for (const [written, expected] of [
        [":nth-child( odd )", ":nth-child(2n+1)"],
        [":nth-child(even)", ":nth-child(2n)"],
        [":nth-last-of-type( 1n + 5 )", ":nth-last-of-type(n+5)"],
        [":nth-child(1)", ":nth-child(1)"],
        [":first-child", ":first-child"],
        ["*|e", "e"],
        ["*|*", "*"],
        ["*|*.c", ".c"],
        ["a > *|b", "a > b"],
        ["[*|x]", "[*|x]"],
        ["*|*:has(*)", ":has(*)"],
        [":is(#a)", ":is(#a)"],
        ["a:is(:not(:hover))", "a:is(:not(:hover))"],
        [":is(:is(div))", ":is(:is(div))"],
      ]) {
        style.textContent = `${written} { }`;
        expect([written, style.sheet.cssRules[0]?.selectorText]).toEqual([written, expected]);
      }
      style.textContent = "@media { }";
      expect(style.sheet.cssRules[0].cssText).toBe("@media  {\n}");
      style.textContent = "@layer { }";
      expect(style.sheet.cssRules[0].cssText).toBe("@layer {\n}");
    });
  });

  test("appendMedium takes one query", () => {
    withBody(`<style></style>`, () => {
      const { media } = document.querySelector("style").sheet;
      media.appendMedium("screen, print");
      expect(media.mediaText).toBe("");
      media.appendMedium("all");
      media.appendMedium("screen, print");
      media.appendMedium("all");
      expect([media.length, media.mediaText]).toEqual([1, "all"]);
    });
  });

  test("a media query with a feature stays as it was written", () => {
    withBody(`<style>@media SCREEN  and (min-width: 100px) { p {} } @media  PRINT , screen { p {} }</style>`, () => {
      const [a, b] = document.styleSheets[0].cssRules;
      expect(a.conditionText).toBe("SCREEN  and (min-width: 100px)");
      expect(a.matches).toBe(false);
      expect(b.conditionText).toBe("print, screen");
      expect(b.matches).toBe(true);
    });
  });

  test("new CSSStyleSheet()", () => {
    const sheet = new CSSStyleSheet({ media: "print", disabled: true });
    expect(sheet.media.mediaText).toBe("print");
    expect(sheet.disabled).toBe(true);
    expect(sheet.ownerNode).toBeNull();
    sheet.replaceSync("a { top: 1px } b { top: 2px }");
    expect(sheet.cssRules.length).toBe(2);
    sheet.replaceSync("a { top: 1px }");
    expect(sheet.cssRules.length).toBe(1);
  });

  test("a style element that is not connected has no sheet", () => {
    const style = create("style");
    style.textContent = "a {}";
    expect(style.sheet).toBeNull();
    document.head.append(style);
    const { sheet } = style;
    expect(sheet.cssRules.length).toBe(1);
    style.remove();
    expect(style.sheet).toBeNull();
    expect(sheet.ownerNode).toBeNull();
  });
});

describe("matchMedia", () => {
  test("knows the type of the medium and no feature of it", () => {
    for (const [query, media, matches] of [
      ["screen", "screen", true],
      ["ALL", "all", true],
      ["", "", true],
      ["print", "print", false],
      ["not print", "not print", true],
      ["print, screen", "print, screen", true],
      ["(min-width: 100px)", "(min-width: 100px)", false],
      ["(prefers-color-scheme: dark)", "(prefers-color-scheme: dark)", false],
      ["(prefers-reduced-motion: reduce)", "(prefers-reduced-motion: reduce)", false],
      ["bogus(", "not all", false],
    ] as const) {
      const list = window.matchMedia(query);
      expect([query, list.media, list.matches]).toEqual([query, media, matches]);
    }
    expect(() => window.matchMedia()).toThrow(TypeError);
  });

  test("returns an event target", () => {
    const { matchMedia } = window;
    const list = matchMedia("screen");
    expect(list).toBeInstanceOf(MediaQueryList);
    expect(list).toBeInstanceOf(EventTarget);
    expect(matchMedia("screen")).not.toBe(list);
    const seen: string[] = [];
    const listener = (event: Event) => seen.push("listener " + (event.target === list));
    list.addListener(listener);
    list.addListener(null);
    list.addEventListener("change", () => seen.push("addEventListener"));
    expect(list.onchange).toBeNull();
    list.onchange = () => seen.push("onchange");
    list.dispatchEvent(new Event("change"));
    expect(seen).toEqual(["listener true", "addEventListener", "onchange"]);
    list.removeListener(listener);
    list.dispatchEvent(new Event("change"));
    expect(seen.length).toBe(5);
  });
});

describe("CSS", () => {
  test("is a namespace object", () => {
    expect(Object.prototype.toString.call(CSS)).toBe("[object CSS]");
    expect(Object.getPrototypeOf(CSS)).toBe(Object.prototype);
    expect(Object.keys(CSS).sort()).toEqual(["escape", "supports"]);
  });

  test("escape", () => {
    expect(CSS.escape("a.b:c")).toBe("a\\.b\\:c");
    expect(CSS.escape("1a")).toBe("\\31 a");
    expect(CSS.escape("-1a")).toBe("-\\31 a");
    expect(CSS.escape("-")).toBe("\\-");
    expect(CSS.escape("--a")).toBe("--a");
    expect(CSS.escape("a b")).toBe("a\\ b");
    expect(CSS.escape("\0")).toBe("\uFFFD");
    expect(CSS.escape("é_1-")).toBe("é_1-");
    expect(CSS.escape(":r1:")).toBe("\\:r1\\:");
    expect(CSS.escape(5)).toBe("\\35 ");
    expect(() => CSS.escape()).toThrow(TypeError);
  });

  test("supports", () => {
    expect(CSS.supports("display", "grid")).toBe(true);
    expect(CSS.supports("display", "bogus")).toBe(false);
    expect(CSS.supports("bogus", "1")).toBe(false);
    expect(CSS.supports("--x", "1")).toBe(true);
    expect(CSS.supports("color", "red !important")).toBe(false);
    expect(CSS.supports("display: flex")).toBe(true);
    expect(CSS.supports("(display: flex)")).toBe(true);
    expect(CSS.supports("(display: flex) and (not (display: bogus))")).toBe(true);
    expect(CSS.supports("(display: bogus) or (color: red)")).toBe(true);
    expect(CSS.supports("not (display: flex)")).toBe(false);
    expect(CSS.supports("selector(:has(a))")).toBe(true);
    expect(CSS.supports("bogus")).toBe(false);
  });
});
