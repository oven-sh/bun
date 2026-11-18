/** @jsxImportSource bun:desktop */
import { hasLibrary } from "./library";

import {
  act,
  app,
  Children,
  clipboard,
  cloneElement,
  Component,
  createContext,
  createElement,
  createPortal,
  createRef,
  dialog,
  flushSync,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  Menu,
  PureComponent,
  Suspense,
  use,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  useWindow,
  Window,
} from "bun:desktop";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
import { join } from "node:path";

app.on("window-all-closed", () => {});

function open(content: any) {
  const window = new Window({ width: 400, height: 300 });
  act(() => {
    if (typeof content === "string") window.document.body.innerHTML = content;
    else window.render(content);
  });
  const $ = (selector: string) => window.document.querySelector(selector);
  const center = (selector: string) => {
    const { x, y, width, height } = $(selector).getBoundingClientRect();
    return { x: x + width / 2, y: y + height / 2 };
  };
  const mouse = (type: any, at: { x: number; y: number }, more?: object) =>
    act(() => window.sendInputEvent({ type, ...at, ...more }));
  return {
    window,
    $,
    center,
    mouse,
    click(selector: string, more?: object) {
      for (const type of ["mouseMove", "mouseDown", "mouseUp"]) mouse(type, center(selector), more);
    },
    press(...keys: string[]) {
      for (const keyCode of keys) {
        act(() => window.sendInputEvent({ type: "keyDown", keyCode }));
        act(() => window.sendInputEvent({ type: "keyUp", keyCode }));
      }
    },
    // `act` handles no input while the event that began the frame is being handled.
    frame: () => new Promise(resolve => window.window.requestAnimationFrame(() => setImmediate(resolve))),
    [Symbol.dispose]: () => window.destroy(),
  };
}

function record(target: any, types: string, describe = (event: any) => event.type + " " + event.target.id) {
  const log: string[] = [];
  for (const type of types.split(" ")) target.addEventListener(type, (event: any) => log.push(describe(event)), true);
  return log;
}

const shortcut = process.platform === "darwin" ? "Cmd" : "Ctrl";

describe.skipIf(!hasLibrary)("bun:desktop", () => {
  describe("rendering JSX", () => {
    test("state, events and effects", () => {
      const log: string[] = [];
      function Counter() {
        const [count, setCount] = useState(0);
        useEffect(() => {
          log.push("effect " + count);
          return () => log.push("cleanup " + count);
        }, [count]);
        return <button onClick={() => setCount(count + 1)}>{count}</button>;
      }
      {
        using it = open(<Counter />);
        it.click("button");
        it.click("button");
        expect(it.$("button").textContent).toBe("2");
      }
      expect(log).toEqual(["effect 0", "cleanup 0", "effect 1", "cleanup 1", "effect 2", "cleanup 2"]);
    });

    test("keyed children keep their elements", () => {
      const list = (keys: string) => [...keys].map(key => <i key={key} id={key} />);
      using it = open(list("abc"));
      const [a, c] = [it.$("#a"), it.$("#c")];
      act(() => it.window.render(list("cda")));
      expect(it.window.document.body.innerHTML).toBe('<i id="c"></i><i id="d"></i><i id="a"></i>');
      expect([it.$("#a") === a, it.$("#c") === c]).toEqual([true, true]);
    });

    test("a controlled input only shows what the state says", () => {
      function Digits() {
        const [text, setText] = useState("");
        return <input value={text} onChange={event => setText(event.currentTarget.value.replace(/\D/g, ""))} />;
      }
      using it = open(<Digits />);
      it.click("input");
      it.press("1", "a", "2");
      expect(it.$("input").value).toBe("12");
    });

    test("hooks", async () => {
      const log: unknown[] = [];
      let listener = () => {};
      let outside = 1;
      const subscribe = (it: () => void) => ((listener = it), () => log.push("unsubscribed"));
      const Handle = forwardRef((props: any, ref: any) => {
        useImperativeHandle(ref, () => props.name, [props.name]);
        return null;
      });
      const api: any = {};
      function Hooks() {
        const [sum, add] = useReducer(
          (a: number, b: number) => a + b,
          1,
          (it: number) => it * 10,
        );
        const [lazily, set] = useState(() => "lazy");
        const memoized = useMemo(() => (log.push("memo"), sum % 2), [sum % 2]);
        const event = useEffectEvent((it: number) => it + sum);
        const [isPending, start] = useTransition();
        const handle = useRef(null);
        Object.assign(api, { add, set, event, start, handle, callback: useCallback(() => {}, []), id: useId() });
        useLayoutEffect(() => void log.push("layout " + handle.current));
        const shown = [
          sum,
          lazily,
          memoized,
          isPending,
          useDeferredValue(sum),
          useSyncExternalStore(subscribe, () => outside),
        ];
        return [shown.join(), <Handle key="handle" ref={handle} name={lazily} />];
      }
      {
        using it = open(<Hooks />);
        const text = () => it.window.document.body.textContent;
        const { add, callback, id, event } = api;
        expect(text()).toBe("10,lazy,0,false,10,1");
        act(() => add.call(null, 2));
        act(() => api.set((it: string) => it + "!"));
        act(() => ((outside = 2), listener()));
        expect(text()).toBe("12,lazy!,0,false,12,2");
        expect([api.add === add, api.callback === callback, api.id === id, event(1), api.handle.current]).toEqual([
          true,
          true,
          true,
          13,
          "lazy!",
        ]);
        const { promise, resolve } = Promise.withResolvers<void>();
        act(() => api.start(() => promise));
        expect(text()).toBe("12,lazy!,0,true,12,2");
        await act(async () => (resolve(), await promise, await 0, await 0));
        expect(text()).toBe("12,lazy!,0,false,12,2");
      }
      expect(log.filter(it => !String(it).startsWith("layout"))).toEqual(["memo", "unsubscribed"]);
      expect(() => useState()).toThrow("Hooks can only be called");
    });

    test("the life cycle of a class", () => {
      const log: string[] = [];
      const Theme = createContext("light");
      class Pure extends PureComponent<{ n: number }> {
        render() {
          log.push("pure " + this.props.n);
          return this.props.n;
        }
      }
      class Life extends Component<{ n: number }, any> {
        static contextType = Theme;
        static getDerivedStateFromProps = (props: any) => ({ twice: props.n * 2 });
        state = { own: 0 } as any;
        componentDidMount = () => log.push("mount");
        componentDidUpdate = (props: any, state: any) => log.push(`update ${props.n} ${state.own}`);
        componentWillUnmount = () => log.push("unmount");
        shouldComponentUpdate = (props: any) => props.n !== 3;
        render() {
          return [this.context, this.state.own, this.state.twice, <Pure key="pure" n={this.props.n} />];
        }
      }
      const ref = createRef<any>();
      using it = open(<Life ref={ref} n={1} />);
      act(() =>
        ref.current.setState(
          (state: any, props: any) => ({ own: state.own + props.n }),
          () => log.push("set"),
        ),
      );
      act(() => it.window.render(<Life ref={ref} n={3} />));
      expect(it.window.document.body.textContent).toBe("light121");
      act(() => ref.current.forceUpdate());
      expect(it.window.document.body.textContent).toBe("light163");
      act(() => it.window.render(null));
      expect([ref.current, ...log]).toEqual([
        null,
        "pure 1",
        "mount",
        "update 1 0",
        "set",
        "pure 3",
        "update 3 1",
        "unmount",
      ]);
    });

    test("props", () => {
      const log: string[] = [];
      const view = (on: boolean) => (
        <div
          className={on ? "a" : undefined}
          hidden={on}
          aria-busy={on}
          style={on ? { width: 10, opacity: 0.5, "--x": 1 } : { width: "5%" }}
          onClickCapture={on ? () => log.push("capture") : undefined}
          onClick={() => log.push("click " + on)}
        >
          <svg viewBox="0 0 1 1" strokeWidth={2} clipPathUnits="x" tabIndex={0}>
            <foreignObject>
              <p dangerouslySetInnerHTML={{ __html: on ? "<b></b>" : "<i></i>" }} />
            </foreignObject>
          </svg>
          <select multiple value={on ? ["a", "c"] : ["b"]}>
            {new Set("abc").values().map(it => (
              <option key={it}>{it}</option>
            ))}
          </select>
          <input defaultValue="d" autoFocus />
          <input type="checkbox" checked={on} />
        </div>
      );
      const inside = (html: string) =>
        `<svg viewBox="0 0 1 1" stroke-width="2" clipPathUnits="x" tabindex="0"><foreignObject><p>${html}</p></foreignObject></svg>` +
        `<select multiple=""><option>a</option><option>b</option><option>c</option></select><input value="d"><input type="checkbox"></div>`;
      using it = open(view(true));
      const state = () => {
        it.$("div").click();
        const selected = Array.from(it.$("select").selectedOptions, (it: any) => it.value).join();
        return [
          it.window.document.body.innerHTML,
          selected,
          it.$("[type]").checked,
          it.window.document.activeElement === it.$("input"),
        ];
      };
      const first = `<div class="a" hidden="" aria-busy="true" style="width: 10px; opacity: 0.5; --x: 1;">`;
      expect(state()).toEqual([first + inside("<b></b>"), "a,c", true, false]);
      act(() => it.window.render(view(false)));
      expect(state()).toEqual([`<div aria-busy="false" style="width: 5%;">` + inside("<i></i>"), "b", false, false]);
      expect([it.$("p").namespaceURI, ...log]).toEqual([
        "http://www.w3.org/1999/xhtml",
        "capture",
        "click true",
        "click false",
      ]);
    });

    test("memo, lazy, and what waits keeps its state", async () => {
      const Value = createContext(0);
      const log: string[] = [];
      const Reader = () => <Value.Consumer>{(it: number) => <b>{it}</b>}</Value.Consumer>;
      const Wall = memo(() => (log.push("wall"), (<Reader />)));
      const Late = lazy(async () => (await null, { default: ({ text }: any) => <u>{text}</u> }));
      let setPromise: any;
      function Waiting() {
        const [promise, set] = useState<any>(null);
        setPromise = set;
        useEffect(() => () => log.push("gone"), []);
        return <i>{promise ? use<string>(promise) : "now"}</i>;
      }
      const view = (value: number) => (
        <Value value={value}>
          <Wall />
          <Suspense fallback={<s />}>
            <Late text="late" />
            <Waiting />
          </Suspense>
        </Value>
      );
      using it = open(view(1));
      const { body } = it.window.document;
      expect(body.innerHTML).toBe("<b>1</b><s></s>");
      body.append(it.window.document.createElement("hr"));
      await act(async () => await new Promise(setImmediate));
      act(() => it.window.render(view(2)));
      expect(body.querySelector("hr")).not.toBeNull();
      body.querySelector("hr").remove();
      expect(body.innerHTML).toBe("<b>2</b><u>late</u><i>now</i>");
      const element = it.$("i");
      const { promise, resolve } = Promise.withResolvers<string>();
      act(() => setPromise(promise));
      expect(body.innerHTML).toBe("<b>2</b><s></s>");
      await act(async () => (resolve("then"), await new Promise(setImmediate)));
      expect([body.innerHTML, it.$("i") === element, ...log]).toEqual(["<b>2</b><u>late</u><i>then</i>", true, "wall"]);
    });

    test("elements and children", () => {
      const element = createElement("a", { key: 1, href: "x" }, "b", "c");
      expect(element).toEqual({
        $$typeof: Symbol.for("react.transitional.element"),
        type: "a",
        key: "1",
        props: { href: "x", children: ["b", "c"] },
      });
      expect(cloneElement(element, { id: "y" }, "d")).toMatchObject({
        key: "1",
        props: { href: "x", id: "y", children: "d" },
      });
      expect([isValidElement(element), isValidElement({}), isValidElement(null)]).toEqual([true, false, false]);
      const children = ["a", [null, "b", new Set(["c"])], false, 0];
      expect([Children.toArray(children), Children.count(children)]).toEqual([["a", "b", "c", 0], 4]);
      expect(Children.map(children, (it: any, index: number) => (index ? [it, index] : null))).toEqual([
        "b",
        1,
        "c",
        2,
        0,
        3,
      ]);
      expect(() => Children.only([element])).toThrow(TypeError);
    });

    test("an error in an effect reaches the boundary, and a render loop ends", () => {
      const log: string[] = [];
      class Boundary extends Component<any, any> {
        componentDidCatch(error: Error) {
          log.push(error.message);
          this.setState({ failed: true });
        }
        render() {
          return this.state?.failed ? "failed" : this.props.children;
        }
      }
      function Broken() {
        useEffect(() => {
          throw new Error("effect");
        }, []);
        return <b />;
      }
      using it = open(
        <Boundary>
          <Broken />
        </Boundary>,
      );
      expect([it.window.document.body.innerHTML, ...log]).toEqual(["failed", "effect"]);
      function Loop() {
        const [count, set] = useState(0);
        useLayoutEffect(() => set(count + 1));
        return count;
      }
      expect(() => flushSync(() => it.window.render(<Loop />))).toThrow("Too many re-renders");
      act(() => it.window.render(null));
    });

    test("context, portals, Suspense and error boundaries", async () => {
      const Name = createContext("none");
      const { promise, resolve } = Promise.withResolvers<string>();
      const Reader = () => <b>{useContext(Name) + useWindow().getSize()[0]}</b>;
      const Late = () => <u>{use(promise)}</u>;
      const Broken = () => {
        throw new Error("broken");
      };
      class Boundary extends Component<{ children: any }, { error?: Error }> {
        static getDerivedStateFromError = (error: Error) => ({ error });
        state: { error?: Error } = {};
        render() {
          return this.state.error?.message ?? this.props.children;
        }
      }
      using other = open("");
      using it = open(
        <Name value="name">
          {createPortal(<Reader />, other.window.document.body)}
          <Suspense fallback="waiting ">
            <Late />
          </Suspense>
          <Boundary>
            <Broken />
          </Boundary>
        </Name>,
      );
      expect(other.window.document.body.innerHTML).toBe("<b>name400</b>");
      expect(it.window.document.body.textContent).toBe("waiting broken");
      await act(async () => resolve("late "));
      expect(it.window.document.body.textContent).toBe("late broken");
    });
  });

  test("a window is like a global object", async () => {
    using it = open("<p id=named>");
    using other = open("");
    const [first, second] = [it.window.window, other.window.window];
    expect([first.self, first.globalThis, first.document.defaultView].map(it => it === first)).toEqual([
      true,
      true,
      true,
    ]);
    expect([first.Array, first.Node, first.named]).toEqual([Array, second.Node, it.$("p")]);
    expect([first instanceof first.Window, "named" in second, first.screen === second.screen]).toEqual([
      true,
      false,
      false,
    ]);
    expect(Object.keys(first)).toContain("innerWidth");
    first.innerWidth = first.setTimeout = 1;
    expect([first.innerWidth, second.innerWidth, second.setTimeout]).toEqual([1, 400, setTimeout]);

    const log: unknown[] = [];
    first.cancelAnimationFrame(first.requestAnimationFrame(() => log.push("canceled")));
    first.requestAnimationFrame(() => {
      first.cancelAnimationFrame(later);
      first.requestAnimationFrame(() => log.push("next frame"));
      log.push("this frame");
    });
    const later = first.requestAnimationFrame(() => log.push("canceled in the frame"));
    await new Promise(resolve => first.requestAnimationFrame(resolve));
    expect(log).toEqual(["this frame"]);
    const deadline: any = await new Promise(resolve => first.requestIdleCallback(resolve));
    expect([deadline instanceof first.IdleDeadline, deadline.didTimeout]).toEqual([true, false]);
  });

  test("CSS animations in skipped contents keep their events until they are shown", async () => {
    using it = open("<style>@keyframes a { to { order: 9 } } p { animation: a 9s 2 }</style><div><p></div>");
    const [animation] = it.$("p").getAnimations();
    await animation.ready;
    await it.frame();
    await it.frame();
    const log = record(it.$("p"), "animationiteration animationend", event => event.type);
    it.$("div").style.contentVisibility = "hidden";
    animation.currentTime = 9500;
    await it.frame();
    await it.frame();
    const hidden = [...log];
    it.$("div").style.contentVisibility = "";
    await new Promise(resolve => (it.$("p").onanimationiteration = resolve));
    expect([hidden, log]).toEqual([[], ["animationiteration"]]);
  });

  describe("mouse", () => {
    test("the events of moving and of clicking", () => {
      using it = open("<div id=a style='height:50px'></div><div id=b style='height:50px'></div>");
      it.mouse("mouseMove", it.center("#a"));
      const log = record(
        it.window.document.body,
        "pointerout pointerover mouseout mouseover pointerdown mousedown click",
      );
      it.click("#b");
      expect(log).toEqual([
        "pointerout a",
        "pointerover b",
        "mouseout a",
        "mouseover b",
        "pointerdown b",
        "mousedown b",
        "click b",
      ]);
      expect(it.$("#b").matches(":hover")).toBe(true);
    });

    test("pointer capture", () => {
      using it = open("<div id=a style='height:50px'></div><div id=b style='height:50px'></div>");
      it.$("#a").onpointerdown = (event: any) => event.target.setPointerCapture(event.pointerId);
      const log = record(it.window.document, "gotpointercapture pointermove pointerup lostpointercapture");
      it.mouse("mouseDown", it.center("#a"));
      it.mouse("mouseMove", it.center("#b"));
      it.mouse("mouseUp", it.center("#b"));
      expect(log.slice(-4)).toEqual(["gotpointercapture a", "pointermove a", "pointerup a", "lostpointercapture a"]);
    });

    test("the wheel scrolls, unless it is canceled", async () => {
      using it = open("<div id=a style='height:100px;overflow:auto'><p style='height:500px'></div>");
      const scrolled = new Promise(resolve => (it.$("#a").onscroll = resolve));
      it.mouse("mouseWheel", { x: 50, y: 50 }, { deltaY: 40 });
      await scrolled;
      expect(it.$("#a").scrollTop).toBe(40);
      it.$("#a").onwheel = (event: Event) => event.preventDefault();
      it.mouse("mouseWheel", { x: 50, y: 50 }, { deltaY: 40 });
      expect(it.$("#a").scrollTop).toBe(40);
    });

    test("a double click selects a word", () => {
      using it = open("<p style='user-select:text'>one <span>two</span> three</p>");
      it.click("span", { clickCount: 2 });
      expect(it.window.getSelectedText().trim()).toBe("two");
    });

    test("what a word is", () => {
      using it = open("<pre>a.b c:d 1,000.5 it's</pre>");
      const text = it.$("pre").firstChild;
      const words = new Set<string>();
      for (let at = 0; at < text.length; at++) {
        const range = it.window.document.createRange();
        range.setStart(text, at);
        range.expand("word");
        words.add(range.toString());
      }
      expect([...words]).toEqual(["a", ".", "b", " ", "c", ":", "d", "1,000.5", "it's"]);
    });

    test("a right click selects what is under the pointer on macOS", () => {
      using it = open(`<pre style="user-select:text;padding:20px"><span id=a>call</span>(<span id=b>it</span>);
<a id=c href=#>a link</a></pre>`);
      const selectedBy = (at: { x: number; y: number }) => {
        for (const type of ["mouseMove", "mouseDown", "mouseUp"]) it.mouse(type, at, { button: "right" });
        return it.window.getSelectedText();
      };
      const { y } = it.center("#a");
      const places = [
        it.center("#a"),
        { x: it.$("#a").getBoundingClientRect().right - 1, y },
        { x: 300, y },
        it.center("#c"),
      ];
      const selected = places.map(at => (it.window.window.getSelection().empty(), selectedBy(at)));
      expect(selected).toEqual(isMacOS ? ["call", "call", "", "a link"] : ["", "", "", ""]);
      it.window.window.getSelection().setBaseAndExtent(it.$("#a").firstChild, 1, it.$("#b").firstChild, 1);
      expect(selectedBy(it.center("#a"))).toBe("all(i");
    });

    test("an element that is removed once it has the capture loses it first", () => {
      using it = open("<div id=a style='height:50px'></div><div id=b style='height:50px'></div>");
      const b = it.$("#b");
      it.$("#a").onpointerdown = (event: any) => b.setPointerCapture(event.pointerId);
      b.ongotpointercapture = () => b.remove();
      it.mouse("mouseDown", it.center("#a"));
      const log = record(it.window.document, "lostpointercapture pointermove", event => event.type);
      it.mouse("mouseMove", { x: 20, y: 20 });
      expect(log).toEqual(["lostpointercapture", "pointermove"]);
    });

    test("what is at a point", () => {
      using it = open("<div id=a style='user-select:none'>abc</div><div id=b>def</div><canvas></canvas>");
      const { document } = it.window;
      const shadow = it.$("#b").attachShadow({ mode: "open" });
      shadow.innerHTML = "<slot></slot><i>ghi</i>";
      const left = (node: any) =>
        [node.getBoundingClientRect().left + 1, node.getBoundingClientRect().top + 5] as const;
      const caret = (node: any, options?: object) => {
        const { offsetNode, offset } = document.caretPositionFromPoint(...left(node), options);
        return offsetNode.nodeName + offset;
      };
      expect([caret(it.$("#a")), caret(it.$("canvas"))]).toEqual(["#text0", "CANVAS0"]);
      expect([caret(shadow.lastChild), caret(shadow.lastChild, { shadowRoots: [shadow] })]).toEqual([
        "BODY1",
        "#text0",
      ]);
      expect(shadow.elementFromPoint(...left(it.$("#b"))).id).toBe("b");
      expect(document.elementsFromPoint(...left(shadow.lastChild)).map((it: any) => it.localName)).toEqual([
        "div",
        "body",
        "html",
      ]);
      expect(document.elementFromPoint(-1, 0)).toBeNull();
    });

    test("drag and drop", () => {
      using it = open("<div id=a draggable=true style='height:50px'></div><div id=b style='height:50px'></div>");
      it.$("#a").ondragstart = (event: any) => event.dataTransfer.setData("text/plain", "x");
      it.$("#b").ondragover = (event: Event) => event.preventDefault();
      const log = record(it.window.document, "drop dragend click", it => it.type + it.dataTransfer?.getData("text"));
      it.mouse("mouseDown", it.center("#a"));
      it.mouse("mouseMove", { x: 10, y: 60 });
      it.mouse("mouseMove", it.center("#b"));
      it.mouse("mouseUp", it.center("#b"));
      expect(log).toEqual(["dropx", "dragend"]);
    });

    test.each([
      ["copy", "", "two"],
      ["move", "contenteditable", ""],
    ])("dragging a selection: %s", (effect, attribute, left) => {
      using it = open(`<p id=a ${attribute} style='user-select:text'><span>two</span></p><textarea id=b></textarea>`);
      const log = record(it.window.document, "drop", it => it.dataTransfer.dropEffect);
      it.click("span", { clickCount: 2 });
      it.mouse("mouseDown", it.center("span"));
      it.mouse("mouseMove", it.center("#b"));
      it.mouse("mouseUp", it.center("#b"));
      expect([log, it.$("#a").textContent, it.$("#b").value]).toEqual([[effect], left, "two"]);
    });

    describe("after a triple click", () => {
      const page = (after: string) => `<div style='user-select:text'><p id=a>first one</p><p id=b>last one</p>
        <div style='position:fixed;inset:0;pointer-events:none'></div>${after}</div>`;
      const near = (it: any, selector: string, x: number) => ({
        x: it.$(selector).getBoundingClientRect().x + x,
        y: it.center(selector).y,
      });

      test("a drag elsewhere selects", () => {
        using it = open(page("<p>more</p>"));
        it.mouse("mouseDown", near(it, "#b", 10), { clickCount: 3 });
        it.mouse("mouseUp", near(it, "#b", 10), { clickCount: 3 });
        expect(it.window.getSelectedText().trim()).toBe("last one");
        it.mouse("mouseDown", near(it, "#a", 1));
        it.mouse("mouseMove", near(it, "#a", 200));
        it.mouse("mouseUp", near(it, "#a", 200));
        expect(it.window.getSelectedText()).toBe("first one");
      });

      test("the selection does not end in an editor", () => {
        using it = open(page("<p contenteditable>more</p>"));
        it.mouse("mouseDown", near(it, "#b", 10), { clickCount: 3 });
        expect(it.window.document.getSelection().focusNode.data).toBe("last one");
      });
    });

    test.each([
      ["<ul><li id=a>one<li>two</ul>", "<ul><li>one</li></ul>"],
      ["<ul><li id=a><b>one</b></ul><div>\n<p><i>two</i></div>", "<ul><li><b>one</b></li></ul>"],
    ])("a dragged line comes without the block after it: %s", (source, dropped) => {
      using it = open(`<div style='user-select:text'>${source}</div><div id=e contenteditable><br></div>`);
      const log = record(it.window.document, "dragstart", it =>
        it.dataTransfer.getData("text/html").replace(' id="a"', ""),
      );
      const at = { x: it.$("#a").getBoundingClientRect().x + 8, y: it.center("#a").y };
      it.mouse("mouseDown", at, { clickCount: 3 });
      it.mouse("mouseUp", at, { clickCount: 3 });
      it.mouse("mouseDown", at);
      it.mouse("mouseMove", it.center("#e"));
      it.mouse("mouseUp", it.center("#e"));
      expect([...log, it.$("#e").innerHTML.replace(' id="a"', "")]).toEqual([
        dropped + '<br class="Apple-interchange-newline">',
        dropped,
      ]);
    });

    test("text that has become selectable can be dragged", async () => {
      using it = open("<textarea></textarea> <a>link</a><span>one</span><p>more</p>");
      await it.frame();
      it.$("span").style.userSelect = "text";
      it.window.document.getSelection().selectAllChildren(it.$("span"));
      const released = new Promise(
        resolve => ((it.window.document.ondragend = resolve), (it.window.document.onmouseup = resolve)),
      );
      it.mouse("mouseDown", it.center("span"));
      it.mouse("mouseMove", it.center("textarea"));
      it.mouse("mouseUp", it.center("textarea"));
      await released;
      expect(it.$("textarea").value).toBe("one");
    });

    test("a click elsewhere closes the calendar of a date", () => {
      using it = open("<input type=date>");
      const { right, y } = it.$("input").getBoundingClientRect();
      it.mouse("mouseDown", { x: right - 8, y: y + 10 });
      it.mouse("mouseUp", { x: right - 8, y: y + 10 });
      const wasOpen = it.$("input").matches(":open");
      it.mouse("mouseDown", { x: 390, y: 5 });
      expect([wasOpen, it.$("input").matches(":open")]).toEqual([true, false]);
    });

    test("the picker of a customizable select has no room for scrollbars that it does not need", () => {
      using it =
        open(`<style>select, ::picker(select) { appearance: base-select } option { width: 100px; height: 30px }</style>
        <select><option>a<option>b</select>`);
      it.click("select");
      const { right, bottom } = it.$("option:last-child").getBoundingClientRect();
      const isPicker = (x: number, y: number) => !!it.window.document.elementFromPoint(x, y).closest("select");
      expect([
        isPicker(right - 5, bottom - 5),
        isPicker(right + 5, bottom - 5),
        isPicker(right - 5, bottom + 5),
      ]).toEqual([true, false, false]);
    });

    describe("interestfor", () => {
      const openWith = (target = "popover") => {
        const it =
          open(`<style>button { position: fixed; inset: 0 auto auto 0; width: 50px; height: 50px; interest-delay: 0s } #b { left: 100px }
          p { position: fixed; inset: 100px auto auto 0; margin: 0 }</style><button id=a interestfor=t></button><button id=b interestfor=t></button><p id=t ${target}>t</p>`);
        const states = () =>
          ["#a:interest-source", "#b:interest-source", ":interest-target", ":popover-open"]
            .map(state => +!!it.$(state))
            .join("");
        const log = record(it.$("p"), "interest loseinterest", event =>
          [event.type, event.source.id, event.cancelable, states()].join(),
        );
        // What follows from the event is done after its listeners, in the same task.
        const next = (type: string) =>
          new Promise(resolve => it.$("p").addEventListener(type, () => setImmediate(resolve), { once: true }));
        return Object.assign(it, { states, log, next });
      };

      test("comes and goes with the mouse, and from one source to another", async () => {
        using it = openWith();
        const seen = [];
        for (const [x, y, type] of [
          [10, 10, "interest"],
          [110, 10, "interest"],
          [300, 250, "loseinterest"],
        ] as const) {
          const event = it.next(type);
          it.mouse("mouseMove", { x, y });
          await event;
          seen.push(it.states());
        }
        expect(seen).toEqual(["1011", "0111", "0000"]);
        expect(it.log).toEqual([
          "interest,a,true,0000",
          "loseinterest,a,true,1011",
          "interest,b,true,0000",
          "loseinterest,b,true,0111",
        ]);
      });

      test("comes with the focus, and goes with Escape, the popover, the attribute, the id or the source", async () => {
        const ends = [
          (it: any) => it.press("Escape"),
          (it: any) => it.$("p").hidePopover(),
          (it: any) => it.$("#a").removeAttribute("interestfor"),
          (it: any) => it.$("#a").remove(),
          (it: any) => (it.$("p").id = "other"),
          (it: any) => (it.$("#a").disabled = true),
        ];
        const seen = [];
        for (const end of ends) {
          using it = openWith();
          const event = it.next("interest");
          it.$("#a").focus();
          await event;
          end(it);
          seen.push([it.states(), ...it.log.slice(1)]);
        }
        expect(seen).toEqual([
          ["0000", "loseinterest,a,false,1011"],
          ["0000", "loseinterest,a,true,1011"],
          ["0001"],
          ["0001"],
          ["0001"],
          ["0001"],
        ]);
      });
    });

    describe("<input type=color>", () => {
      test("the mouse picks, and `change` follows when it closes", () => {
        using it = open("<input type=color id=c value=#ff0000 style='position:fixed;inset:0 auto auto 0'>");
        const log = record(it.$("input"), "input change", event => event.type + it.$("input").value);
        it.click("input");
        expect(it.$("input").matches(":open")).toBe(true);
        it.mouse("mouseDown", { x: 100, y: 100 });
        it.mouse("mouseMove", { x: -10, y: 0 });
        it.mouse("mouseMove", { x: 300, y: 290 });
        it.mouse("mouseUp", { x: 300, y: 290 });
        it.mouse("mouseDown", { x: 390, y: 290 });
        expect([it.$("input").matches(":open"), ...log.slice(1)]).toEqual([
          false,
          "input#ffffff",
          "input#000000",
          "change#000000",
        ]);
      });

      test("it goes away with the input", () => {
        using it = open("<input type=color><button id=b style='position:fixed;inset:auto 0 0 auto'>b</button>");
        const [input, log] = [it.$("input"), record(it.$("button"), "click")];
        it.$("button").addEventListener("click", () => input.showPicker(), { once: true });
        it.click("button");
        const wasOpen = input.matches(":open");
        input.remove();
        it.click("button");
        expect([wasOpen, input.matches(":open"), log.length]).toEqual([true, false, 2]);
      });

      test("keys", () => {
        using it = open("<input type=color id=c value=#ff0000><button>");
        const log = record(it.$("input"), "change");
        it.click("input");
        it.press("Down");
        expect(it.$("input").value).toBe("#fc0000");
        it.press(..."12ab3c");
        expect(it.$("input").value).toBe("#12ab3c");
        it.press("Escape");
        expect([it.$("input").value, it.$("input").matches(":open")]).toEqual(["#ff0000", true]);
        it.press("Escape");
        expect([it.$("input").matches(":open"), ...log]).toEqual([false]);
      });
    });

    describe("<datalist>", () => {
      const page = `<form><input id=i list=l style='position:fixed;inset:0 auto auto 0;height:20px;box-sizing:border-box'></form>
        <datalist id=l><option value=apple><option value=banana disabled><option value=cherry label=Red><option value=grape></datalist>
        <button id=b style='position:fixed;inset:auto 0 0 auto'>b</button>`;

      test("typing narrows it down, and Enter does not submit", () => {
        using it = open(page);
        const log = record(it.window.document, "input change submit");
        it.$("input").focus();
        it.press("r");
        it.press("Down", "Down", "Enter");
        expect([it.$("input").value, ...log]).toEqual(["grape", "input i", "input i", "change i"]);
      });

      test("the mouse opens it and picks", () => {
        using it = open(page);
        it.click("input");
        it.mouse("mouseDown", { x: 20, y: 65 });
        it.mouse("mouseUp", { x: 20, y: 65 });
        expect([it.$("input").value, it.window.document.activeElement.id]).toEqual(["cherry", "i"]);
      });

      test("a click elsewhere goes through", () => {
        using it = open(page);
        const log = record(it.$("button"), "click");
        it.click("input");
        it.click("button");
        it.mouse("mouseDown", { x: 20, y: 65 });
        expect([it.$("input").value, ...log]).toEqual(["", "click b"]);
      });

      test("options may come later", async () => {
        using it = open(page);
        it.$("input").focus();
        it.press("z");
        it.$("datalist").insertAdjacentHTML("beforeend", "<option value=zebra>");
        await it.frame();
        it.press("Up", "Tab");
        expect(it.$("input").value).toBe("zebra");
      });
    });

    test("<select> opens a list", () => {
      using it = open("<select id=s><option>a<option>b</select>");
      const log = record(it.$("select"), "input change");
      it.click("select");
      it.press("Down", "Enter");
      expect([it.$("select").value, ...log]).toEqual(["b", "input s", "change s"]);
    });

    test("white space between options takes no room in the list", () => {
      using it = open("<select>\n<option>a</option>\n<option>b</option>\n</select>");
      it.click("select");
      const [a, b] = Array.from(it.$("select").options, (option: any) => option.getBoundingClientRect());
      expect([a.height > 0, b.top - a.bottom]).toEqual([true, 0]);
    });
  });

  describe("keyboard", () => {
    test("Tab follows tabindex, and skips what cannot be focused", () => {
      using it = open(`<a id=a href=#>a</a><button disabled>x</button><div inert><input></div><input hidden>
        <input id=b><button id=c tabindex=1>c</button>`);
      const order = Array.from("1234", () => (it.press("Tab"), it.window.document.activeElement.id));
      expect(order.slice(0, 3)).toEqual(["c", "a", "b"]);
    });

    test("the summary that <details> makes up can be used", async () => {
      using it = open("<details>x</details>");
      const toggled = new Promise<any>(resolve => (it.$("details").ontoggle = resolve));
      it.press("Tab", "Enter");
      expect((await toggled).newState).toBe("open");
      for (const type of ["mouseDown", "mouseUp"]) it.mouse(type, { x: 40, y: 15 });
      expect(it.$("details").open).toBe(false);
    });

    test("a selection that starts in inert content is not edited", () => {
      using it = open("<div contenteditable><span inert>ab</span>cd</div>");
      it.$("div").focus();
      it.window.window.getSelection().setBaseAndExtent(it.$("span").firstChild, 1, it.$("div").lastChild, 1);
      it.press("Backspace");
      expect(it.$("div").textContent).toBe("abcd");
    });

    test("editing a textarea", () => {
      using it = open("<textarea id=t></textarea>");
      const log = record(it.$("#t"), "beforeinput", event => event.inputType);
      it.click("#t");
      it.press("a", "Enter", "b", "c", "Left", "Backspace");
      expect(it.$("#t").value).toBe("a\nc");
      expect(log).toEqual(["insertText", "insertLineBreak", "insertText", "insertText", "deleteContentBackward"]);
      it.press(shortcut + "+Z");
      expect(it.$("#t").value).toBe("a\nbc");
    });

    test("a field is invalid for the user who has typed and taken it back", () => {
      using it = open("<input required><input required>");
      it.$("input").focus();
      it.press("a", "Backspace", "Tab", "Tab");
      expect([...it.window.document.querySelectorAll("input")].map(it => it.matches(":user-invalid"))).toEqual([
        true,
        false,
      ]);
    });

    test("focus() goes to the first field of a date", () => {
      using it = open("<input type=time value=01:02><input>");
      it.$("input").focus();
      it.press("Tab");
      it.$("input").blur();
      it.$("input").focus();
      it.press("Up");
      expect(it.$("input").value).toBe("02:02");
    });

    test("editing contenteditable", () => {
      using it = open("<div contenteditable><p>ab</p></div>");
      it.$("div").focus();
      it.press("Right", "Enter", "x");
      expect(it.$("div").innerHTML).toBe("<p>a</p><p>xb</p>");
      it.press("Backspace", "Backspace");
      expect(it.$("div").innerHTML).toBe("<p>ab</p>");
    });

    test("copy and paste", () => {
      using it = open("<input id=a value=hello><input id=b>");
      it.$("#a").focus();
      it.$("#a").select();
      it.window.copy();
      expect(clipboard.readText()).toBe("hello");
      it.$("#b").focus();
      it.$("#b").onpaste = (event: any) => expect(event.clipboardData.getData("text/plain")).toBe("hello");
      it.window.paste();
      expect(it.$("#b").value).toBe("hello");
    });

    test.skipIf(process.platform === "darwin")("an accelerator gets the keys that the document leaves", () => {
      using it = open("<input>");
      let clicks = 0;
      it.window.setMenu(Menu.buildFromTemplate([{ label: "A", accelerator: "Ctrl+J", click: () => clicks++ }]));
      it.press("Ctrl+J");
      it.window.document.onkeydown = (event: Event) => event.preventDefault();
      it.press("Ctrl+J");
      expect(clicks).toBe(1);
    });
  });

  test("ResizeObserver and IntersectionObserver", async () => {
    using it = open("<div style='width:10px;height:10px'></div>");
    const log: unknown[] = [];
    new it.window.window.ResizeObserver(([entry]: any) => log.push(entry.contentRect.width)).observe(it.$("div"));
    new it.window.window.IntersectionObserver(([entry]: any) => log.push(entry.isIntersecting)).observe(it.$("div"));
    while (log.length < 2) await it.frame();
    it.$("div").style.cssText = "width:20px;height:10px;margin-top:900px";
    while (log.length < 4) await it.frame();
    expect(log).toEqual([10, true, 20, false]);
  });

  test("a resize is not reported to media queries that still match", async () => {
    using it = open("");
    const log: string[] = [];
    for (const query of ["(min-width: 1px)", "(max-width: 1px)", "(min-width: 350px)"]) {
      it.window.window.matchMedia(query).addEventListener("change", (event: any) => log.push(event.media));
    }
    it.window.setSize(300, 300);
    while (!log.includes("(min-width: 350px)")) await it.frame();
    expect(log).toEqual(["(min-width: 350px)"]);
  });

  test("a media query listener that makes another list is called once", async () => {
    using it = open("");
    let calls = 0;
    const listen = () =>
      it.window.window
        .matchMedia("(min-width: 350px)")
        .addEventListener("change", () => ++calls < 10 && listen(), { once: true });
    listen();
    await it.frame();
    expect(calls).toBe(0);
    it.window.setSize(300, 300);
    while (calls === 0) await it.frame();
    expect(calls).toBe(1);
  });

  test("sizes stay within the minimum and the maximum", () => {
    using it = open("");
    it.window.setMinimumSize(300, 200);
    it.window.setMaximumSize(500, 400);
    it.window.setBounds({ width: 100, height: 100 });
    const small = it.window.getSize();
    it.window.setSize(900, 900);
    expect([small, it.window.getSize()]).toEqual([
      [300, 200],
      [500, 400],
    ]);
  });

  test("scroll events and early callbacks do without a frame of their own", async () => {
    using it = open(`<div id=a style="height:50px;overflow:auto"><p style="height:500px"></div>`);
    const view = it.window.document.defaultView!;
    const frame = (...more: unknown[]) => new Promise(done => (view.requestAnimationFrame as any)(done, ...more));
    const sizes: number[] = [];
    await frame();
    await frame();
    const scrolled = new Promise(done => it.$("#a").addEventListener("scrollend", done));
    const order: string[] = [];
    view.requestAnimationFrame(() => {
      it.$("#a").scrollTop = 10;
      view.setTimeout(() => view.setTimeout(() => order.push("later")));
    });
    await scrolled;
    order.push("scrolled");
    // What an early callback leaves to a task is in the frame.
    new view.ResizeObserver(([entry]: any) => sizes.push(entry.contentRect.height)).observe(it.$("#a"));
    await new Promise(done => view.setTimeout(done, 40));
    sizes.length = 0;
    it.$("#a").style.height = "60px";
    await frame("before-events");
    const { port1, port2 } = new view.MessageChannel();
    port1.onmessage = () => (port1.close(), (it.$("#a").style.height = "70px"));
    port2.postMessage(0);
    await frame();
    await frame();
    expect([order, sizes]).toEqual([["scrolled", "later"], [70]]);
  });

  test("transitions fire events", async () => {
    using it = open("<div id=a style='transition:width 1ms;width:10px'></div>");
    const log = record(it.$("div"), "transitionrun transitionstart transitionend");
    it.$("div").offsetWidth;
    it.$("div").style.width = "20px";
    while (log.length < 3) await it.frame();
    expect(log).toEqual(["transitionrun a", "transitionstart a", "transitionend a"]);
  });

  test("capturePage has a horizontal gradient in a box with round corners", async () => {
    using it = open(
      "<div style='width:70px;height:50px;border-radius:12px;background:linear-gradient(90deg,red,blue)'>",
    );
    const bitmap = await it.window.window.createImageBitmap(new Blob([it.window.capturePage().toPNG()]));
    const reader = it.window.document.createElement("canvas").getContext("2d");
    reader.drawImage(bitmap, 0, 0);
    const { x, y } = it.$("div").getBoundingClientRect();
    const pixel = (left: number, top: number) => reader.getImageData(x + left, y + top, 1, 1).data.join();
    expect([pixel(20, 0), pixel(20, 49)]).toEqual([pixel(20, 25), pixel(20, 25)]);
    expect(pixel(0, 0)).not.toBe(pixel(0, 25));
  });

  test("::selection may change together with the window", async () => {
    using it = open(`<style>body{margin:0}p{margin:0;line-height:40px;user-select:text}
      p::selection{background:#0f0}.a::selection{background:transparent}</style><p class=a>one two</p>`);
    it.window.document.getSelection().selectAllChildren(it.$("p"));
    await it.frame();
    const resized = new Promise(resolve =>
      it.window.window.addEventListener("resize", () => resolve(it.$("p").removeAttribute("class"))),
    );
    it.window.setSize(400, 280);
    await resized;
    await it.frame();
    await it.frame();
    const bitmap = await it.window.window.createImageBitmap(new Blob([it.window.capturePage().toPNG()]));
    const reader = it.window.document.createElement("canvas").getContext("2d");
    reader.drawImage(bitmap, 0, 0);
    expect(Array.from(reader.getImageData(10, 2, 1, 1).data)).toEqual([0, 255, 0, 255]);
  });

  test("capturePage has what a canvas and CSS draw", async () => {
    using it = open(
      "<style>body{margin:0;background:#00f}canvas{display:block}</style><canvas width=10 height=10></canvas>",
    );
    const context = it.$("canvas").getContext("2d");
    context.fillStyle = "#f00";
    context.fillRect(0, 0, 10, 10);
    const bitmap = await it.window.window.createImageBitmap(new Blob([it.window.capturePage().toPNG()]));
    const reader = it.window.document.createElement("canvas").getContext("2d");
    reader.drawImage(bitmap, 0, 0);
    const pixel = (x: number, y: number) => Array.from(reader.getImageData(x, y, 1, 1).data);
    expect([pixel(5, 5), pixel(50, 50)]).toEqual([
      [255, 0, 0, 255],
      [0, 0, 255, 255],
    ]);
  });

  test("loadFile loads style sheets and images", async () => {
    using dir = tempDir("desktop-load", {
      "index.html": `<title>Loaded</title><link rel=stylesheet href=a.css><img src=a.svg>`,
      "a.css": `@import "b.css";`,
      "b.css": `img { order: 7 }`,
      "a.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="34"/>`,
    });
    using it = open("");
    await it.window.loadFile(join(String(dir), "index.html"));
    const image = it.$("img");
    expect([it.window.title, image.naturalWidth, image.height]).toEqual(["Loaded", 12, 34]);
    expect(it.window.window.getComputedStyle(image).order).toBe("7");
  });

  test("a link emits will-navigate", () => {
    using it = open("<a href='https://example.invalid/x'>link</a>");
    const urls: string[] = [];
    it.window.on("will-navigate", (event, url) => {
      event.preventDefault();
      urls.push(url);
    });
    it.click("a");
    expect(urls).toEqual(["https://example.invalid/x"]);
  });

  test("close can be canceled by the document and by a listener", () => {
    using it = open("");
    it.window.window.onbeforeunload = (event: Event) => event.preventDefault();
    it.window.close();
    it.window.window.onbeforeunload = null;
    it.window.once("close", event => event.preventDefault());
    it.window.close();
    expect(it.window.isDestroyed()).toBe(false);
    it.window.close();
    expect(it.window.isDestroyed()).toBe(true);
  });

  test("findInPage", () => {
    using it = open("<p>One two <b>o</b>ne</p>");
    expect(it.window.findInPage("one")).toMatchObject({ matches: 2, active: 1 });
    expect(it.window.findInPage("one", { findNext: false })).toMatchObject({ matches: 2, active: 2 });
    expect(it.window.findInPage("one", { matchCase: true })).toMatchObject({ matches: 1 });
  });

  test("a message box can be aborted", async () => {
    using it = open("");
    const controller = new AbortController();
    const result = dialog.showMessageBox(it.window, {
      message: "Sure?",
      buttons: ["Yes", "No"],
      signal: controller.signal,
    });
    expect(it.window.getChildWindows()[0].document.querySelector("h1").textContent).toBe("Sure?");
    controller.abort();
    expect(await result).toEqual({ response: 1, checkboxChecked: false });
  });

  test("a message box has buttons, a checkbox and text that is not markup", async () => {
    using it = open("");
    const options = {
      message: "<b>&amp;",
      detail: '"d"',
      buttons: ["&Yes", "A && B", "No"],
      defaultId: 1,
      checkboxLabel: "<i>",
    };
    const show = () => [dialog.showMessageBox(it.window, options), it.window.getChildWindows()[0]] as const;
    const press = (window: Window, keyCode: string) => {
      for (const type of ["keyDown", "keyUp"] as const)
        act(() => window.isDestroyed() || window.sendInputEvent({ type, keyCode }));
    };
    const [chosen, first] = show();
    const texts = Array.from(first.document.querySelectorAll("h1,p,label,button"), (it: any) => it.textContent.trim());
    expect(texts).toEqual(["<b>&amp;", '"d"', "<i>", "Yes", "A & B", "No"]);
    expect(first.document.querySelector("main").ariaLabel).toBe("<b>&amp;");
    expect(first.document.activeElement.textContent).toBe("A & B");
    first.document.querySelector("input").click();
    first.document.querySelector("button").click();
    expect(await chosen).toEqual({ response: 0, checkboxChecked: true });
    const [cancelled, second] = show();
    second.focus();
    press(second, "Escape");
    expect(await cancelled).toEqual({ response: 2, checkboxChecked: false });
  });

  function menus(log: string[]) {
    const item = (label: string, more?: object) => ({ label, click: () => log.push(label), ...more });
    const observed = (name: string, template: object[]) => {
      const menu = Menu.buildFromTemplate(template as any);
      menu.on("menu-will-show", () => log.push("+" + name));
      menu.on("menu-will-close", () => log.push("-" + name));
      return menu;
    };
    return { item, observed };
  }

  test("a menu that pops up is operated with keys", () => {
    using it = open("<input autofocus>");
    const log: string[] = [];
    const { item, observed } = menus(log);
    const menu = observed("menu", [
      item("<One>"),
      { type: "separator" },
      item("Off", { enabled: false }),
      item("Check", { type: "checkbox" }),
      { label: "&More", submenu: [item("Inner"), item("In&most")] },
      item("Last"),
    ]);
    const run = (...keys: string[]) => {
      menu.popup({ window: it.window, x: 10, y: 10, callback: () => log.push("closed") });
      it.press(...keys);
      menu.closePopup();
      return log.splice(0).join();
    };
    expect({
      first: run("Down", "Enter"),
      skips: run("Down", "Down", "Space"),
      wraps: run("Up", "Enter"),
      ends: run("End", "Home", "Enter"),
      enters: run("m", "Down", "Enter"),
      mnemonic: run("m", "m"),
      leaves: run("End", "Up", "Right", "Left", "Down", "Enter"),
      escapes: run("m", "Escape", "Escape", "Enter"),
      disabled: run("o", "Enter"),
    }).toEqual({
      first: "+menu,-menu,closed,<One>",
      skips: "+menu,-menu,closed,Check",
      wraps: "+menu,-menu,closed,Last",
      ends: "+menu,-menu,closed,<One>",
      enters: "+menu,-menu,closed,In&most",
      mnemonic: "+menu,-menu,closed,In&most",
      leaves: "+menu,-menu,closed,Last",
      escapes: "+menu,-menu,closed",
      disabled: "+menu,-menu,closed",
    });
    expect([menu.items[3].checked, it.$("input").value]).toEqual([true, ""]);
  });

  test("a menu that pops up is operated with the mouse", () => {
    using it = open("");
    const log: string[] = [];
    const { item, observed } = menus(log);
    const menu = observed("menu", [{ label: "More", submenu: [item("Inner")] }, item("Other")]);
    const click = (x: number, y: number) =>
      ["mouseMove", "mouseDown", "mouseUp"].forEach(type => it.mouse(type, { x, y }));
    menu.popup({ window: it.window, x: 10, y: 10 });
    click(30, 25);
    it.press("Down", "Enter");
    menu.popup({ window: it.window, x: 10, y: 10 });
    click(30, 55);
    menu.popup({ window: it.window, x: 10, y: 10 });
    click(390, 290);
    menu.popup({ window: it.window, x: 400, y: 300 });
    click(380, 285);
    menu.popup({ window: it.window, x: 10, y: 10 });
    it.window.destroy();
    expect(log.join()).toBe("+menu,-menu,Inner,+menu,-menu,Other,+menu,-menu,+menu,-menu,Other,+menu,-menu");
  });

  test.skipIf(isMacOS)("the menu bar", async () => {
    using it = open("");
    const log: string[] = [];
    const { item, observed } = menus(log);
    const titles = ["File", "Edit"].map(label => ({ label, submenu: observed(label, [item(label + " item")]) }));
    const { innerHeight } = it.window.window;
    act(() => it.window.setMenu(Menu.buildFromTemplate(titles)));
    while (it.window.window.innerHeight === innerHeight) await new Promise(resolve => setImmediate(resolve));
    expect(innerHeight - it.window.window.innerHeight).toBe(28);
    const click = (x: number, y: number) =>
      ["mouseMove", "mouseDown", "mouseUp"].forEach(type => it.mouse(type, { x, y }));
    click(20, 14);
    click(20, 14);
    click(20, 14);
    it.mouse("mouseMove", { x: 60, y: 14 });
    it.press("Right", "Left", "Down", "Enter");
    expect(log.join()).toBe("+File,-File,+File,-File,+Edit,-Edit,+File,-File,+Edit,-Edit,Edit item");
  });

  test("a page opens, moves, names and closes its window", async () => {
    using it = open("");
    const created = new Promise<Window>(resolve => app.once("window-created", (_, window) => resolve(window)));
    const popup = it.window.window.open("about:blank", "", "width=210, height=120,left=5,top=0");
    const window = await created;
    expect(window.window === popup).toBe(true);
    expect(window.getBounds()).toMatchObject({ width: 210, height: 120 });
    popup.document.title = "Named";
    popup.resizeTo(300, 200);
    while (window.getBounds().width !== 300 || window.title !== "Named") await it.frame();
    const closed = new Promise(resolve => window.once("closed", resolve));
    popup.close();
    await closed;
    expect(() => it.window.window.prompt("?")).toThrow("prompt() is not supported.");
  });

  test("a message box is as tall as its contents", () => {
    using it = open("");
    act(() => void dialog.showMessageBox(it.window, { message: "m", detail: Buffer.alloc(600, "long ").toString() }));
    const [box] = it.window.getChildWindows();
    expect(box.getContentSize()[1]).toBe(box.document.documentElement.scrollHeight);
    expect(box.getContentSize()[1]).toBeGreaterThan(200);
  });

  test("a window of the app has no audio service", () => {
    using it = open("");
    const context = new it.window.window.AudioContext();
    act(() => context.createOscillator().connect(context.destination).context.resume());
    expect(it.window.document.createElement("audio").play()).rejects.toHaveProperty("name", "NotSupportedError");
  });

  test("react-dom", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--preload=bun:desktop/dom", join(import.meta.dir, "react-dom.fixture.tsx")],
      env: { ...bunEnv, BUN_DESKTOP_HEADLESS: "1" },
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe('<input value="AB"><button>AB 1</button>\n');
    expect(exitCode).toBe(0);
  });
});

describe.skipIf(!hasLibrary).concurrent("the document of a program", () => {
  async function run(files: Record<string, string>, ...flags: string[]) {
    using dir = tempDir("desktop-program", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...flags, "main.js"],
      cwd: String(dir),
      env: { ...bunEnv, BUN_DESKTOP_HEADLESS: "1" },
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { stdout, exitCode };
  }

  test("gets messages with the ports and the events of the runtime", async () => {
    const main = `
      import { app, Window } from "bun:desktop";
      const { window } = new Window();
      const next = target => new Promise(resolve => target.addEventListener("message", resolve, { once: true }));
      const [outer, inner] = [new MessageChannel(), new MessageChannel()];
      const buffer = new ArrayBuffer(4);
      window.postMessage({ port: outer.port2, buffer }, "*", [outer.port2, buffer]);
      outer.port1.postMessage("early", [inner.port2]);
      const event = await next(window), [port] = event.ports;
      console.log(event instanceof MessageEvent, event.source === window, event.target === window);
      console.log(port instanceof MessagePort, event.data.port === port, buffer.byteLength, event.data.buffer.byteLength);
      try { window.postMessage(0, "*", [outer.port2]); } catch (error) { console.log(error.name); }
      try { window.postMessage(inner.port1, "*"); } catch (error) { console.log(error.name); }
      const early = await next(port);
      early.ports[0].postMessage(new Map([[1, 2]]));
      console.log(early.data, (await next(inner.port1)).data.get(1));
      const closed = new Promise(resolve => outer.port1.addEventListener("close", resolve));
      port.close();
      console.log((await closed).type);
      app.exit(0);`;
    expect(await run({ "main.js": main })).toEqual({
      stdout: "true true true\ntrue true 0 4\nDataCloneError\nDataCloneError\nearly 2\nclose\n",
      exitCode: 0,
    });
  });

  test("makes requests with XMLHttpRequest, EventSource and sendBeacon", async () => {
    const main = `
      import { app, Window } from "bun:desktop";
      const { window } = new Window(), beacon = Promise.withResolvers();
      using server = Bun.serve({
        port: 0,
        routes: {
          "/text": new Response("text"),
          "/never": () => new Promise(() => {}),
          "/events": new Response("data: event\\n\\n", { headers: { "content-type": "text/event-stream" } }),
          "/beacon": async request => (beacon.resolve(await request.text()), new Response()),
        },
      });
      const ask = (path, timeout) => new Promise(done => {
        const request = Object.assign(new window.XMLHttpRequest(), { timeout });
        request.onload = request.onerror = request.ontimeout = event => done(event.type + " " + request.responseText);
        request.open("GET", server.url + path);
        request.send();
      });
      console.log(await ask("text", 60_000), await ask("never", 1));
      const events = new window.EventSource(server.url + "events");
      console.log((await new Promise(done => (events.onmessage = events.onerror = done))).data);
      console.log(window.navigator.sendBeacon(server.url + "beacon", "sent"), await beacon.promise);
      app.exit(0);`;
    expect(await run({ "main.js": main })).toEqual({ stdout: "load text timeout \nevent\ntrue sent\n", exitCode: 0 });
  });

  test.each([
    [["--preload=bun:desktop/dom"], "inline,thrown,classic,string,string,module,refused"],
    [[], "none"],
  ])("runs the scripts of the app if it has the global object: %j", async (flags, seen) => {
    const inline = `<script type=module>import { sep } from "node:path"; seen.push(typeof sep); done()</script>`;
    const files = {
      "index.html": `
        <script>var seen = ["inline"]; addEventListener("error", e => (e.preventDefault(), seen.push(e.error.message)))</script>
        <script>throw new Error("thrown")</script>
        <script src=classic.js></script>${inline}${inline}<script type=module src=module.js></script>`,
      "classic.js": `seen.push("classic")`,
      "module.js": `done("module")`,
      "main.js": `
        import { app, Window } from "bun:desktop";
        const it = new Window(), modules = Promise.withResolvers(), late = [];
        let left = 3;
        globalThis.done = name => (name && late.push(name), --left || modules.resolve());
        await it.loadFile("index.html");
        if (globalThis.seen) {
          await modules.promise;
          location.href = "javascript:seen.push('injected')";
          await new Promise(onerror => document.body.append(Object.assign(document.createElement("script"), { type: "module", src: "https://example.invalid/a.js", onerror })));
          seen.push(...late, "refused");
        }
        console.log(String(globalThis.seen ?? "none"));
        app.exit(0);`,
    };
    expect(await run(files, ...flags)).toEqual({ stdout: seen + "\n", exitCode: 0 });
  });
});

describe.skipIf(!hasLibrary)("garbage collection", () => {
  async function run(script: string, env?: object) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `import { app, Window } from "bun:desktop"; const window = new Window({});\n${script}`],
      env: { ...bunEnv, BUN_DESKTOP_HEADLESS: "1", BUN_GC_TIMER_DISABLE: undefined, ...env },
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { stdout, exitCode };
  }
  const garbage = `
    let collected = 0;
    const registry = new FinalizationRegistry(() => collected++ || globalThis.onCollected?.());
    const litter = () => { for (let i = 0; i < 100; i++) registry.register({ i }, i); };
  `;

  test.concurrent("does not run on a timer between frames", async () => {
    const script = `${garbage}
      const frame = () => new Promise(resolve => window.window.requestAnimationFrame(resolve));
      await frame();
      Bun.gc(true);
      litter();
      for (let i = 0; i < 10; i++) await frame();
      console.log(collected);
      app.exit(0);
    `;
    expect(await run(script, { BUN_GC_TIMER_INTERVAL: "1" })).toEqual({ stdout: "0\n", exitCode: 0 });
  });

  test.concurrent("runs once the program has gone quiet", async () => {
    const script = `${garbage}
      globalThis.onCollected = () => { console.log("collected"); app.exit(0); };
      litter();
      for (let i = 0; i < 6; i++) globalThis.last = new Array(131072).fill(i);
    `;
    const env = { BUN_GC_TIMER_INTERVAL: "1000000", BUN_JSC_largeHeapSize: "1000000000" };
    expect(await run(script, env)).toEqual({ stdout: "collected\n", exitCode: 0 });
  });
});

describe.skipIf(!hasLibrary || isWindows)("node:fs lookups", () => {
  async function run(script: string) {
    using dir = tempDir("desktop-fs", { "file.txt": "12345" });
    const before = `import { app, Window } from "bun:desktop"; import fs from "node:fs";
      const window = new Window({});
      const frame = () => new Promise(resolve => window.window.requestAnimationFrame(resolve));
      const here = name => process.cwd() + "/" + name;
      await frame();`;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `${before}\n${script}\napp.exit(0);`],
      env: { ...bunEnv, BUN_DESKTOP_HEADLESS: "1" },
      cwd: String(dir),
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { stdout, exitCode };
  }

  test.concurrent("settle in a later task with the usual results", async () => {
    const script = `
      fs.symlinkSync("file.txt", here("link"));
      const order = [];
      const code = promise => promise.then(() => "ok", error => error.code);
      const size = fs.promises.stat(here("link")).then(it => (order.push("stat"), it.size));
      fs.access(here("file.txt"), () => order.push("access"));
      for (let i = 0; i < 5; i++) await null;
      order.push("microtasks");
      console.log(await size, order[0], await fs.promises.readlink(here("link")), (await fs.promises.lstat(here("link"))).isSymbolicLink());
      for (const name of ["stat", "lstat", "access", "readlink", "readFile", "readdir", "realpath"])
        console.log(await code(fs.promises[name](here("missing"))));
      console.log(await fs.promises.readFile(here("link"), "utf8"));
    `;
    const { stdout, exitCode } = await run(script);
    expect(stdout.trim().split("\n")).toEqual(["5 microtasks file.txt true", ...Array(7).fill("ENOENT"), "12345"]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("do not keep frames from being drawn", async () => {
    const script = `
      let isDrawn = false;
      frame().then(() => (isDrawn = true));
      while (!isDrawn) await fs.promises.stat(here("file.txt"));
      console.log("drawn");
    `;
    expect(await run(script)).toEqual({ stdout: "drawn\n", exitCode: 0 });
  });
});
