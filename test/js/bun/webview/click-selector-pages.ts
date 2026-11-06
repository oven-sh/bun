// Pages for the tests of click(selector) in webview-chrome.test.ts and webview.test.ts: what makes an element stable.
//
// click() looks for its element with document.querySelector: once when it is called, then once in every frame. A page
// that replaces that function acts at exact looks, so no case depends on how soon a frame comes.

export const slideLeft = "from { left: 0; } to { left: 100px; }";
const slideTransform = "from { transform: translateX(0); } to { transform: translateX(100px); }";

/** An animation of 80 ms that begins again at each of the first `times` looks, so it has yet to start at each. */
export const beginsAtLooks = (animated: "mover" | "box", keyframes: string, times: number) => `
  <style>
    @keyframes slide { ${keyframes} }
    #box { position: fixed; left: 0; top: 50px; }
    #mover { position: relative; width: 60px; height: 60px; }
    .go { animation: slide 80ms linear forwards; }
  </style>
  <div id=box><button id=mover onclick="window.__hit=this.getBoundingClientRect().left">mv</button></div>
  <script>
    const { querySelector } = document;
    let looks = 0;
    document.querySelector = function (selector) {
      if (looks++ < ${times}) {
        ${animated}.className = "";
        ${animated}.offsetWidth;
        ${animated}.className = "go";
      }
      return querySelector.call(this, selector);
    };
  </script>`;

/** From the first look on, the page moves the button by a step per frame. `frames` replaces requestAnimationFrame. */
const movesByFrame = (frames: string) => `
  <style>#mover { position: fixed; left: 0; top: 50px; width: 60px; height: 60px; }</style>
  <button id=mover onclick="window.__hit=this.getBoundingClientRect().left">mv</button>
  <script>
    const { querySelector } = document;
    const nextFrame = requestAnimationFrame;
    document.querySelector = function (selector) {
      document.querySelector = querySelector;
      let left = 0;
      (function step() {
        mover.style.left = (left += 20) + "px";
        if (left < 100) nextFrame(step);
      })();
      let asked = 0, time;
      ${frames}
      return querySelector.call(this, selector);
    };
  </script>`;

const still = `<button id=b onclick="window.__hit=1">b</button>`;

/** A still button on a page that counts the looks. Every frame carries `time`. */
const countsLooks = (time: string, head = "") => `
  ${head}${still}
  <script>
    window.__looks = 0;
    const { querySelector } = document;
    document.querySelector = function (selector) {
      __looks++;
      return querySelector.call(this, selector);
    };
    const nextFrame = requestAnimationFrame;
    let frame = 0;
    window.requestAnimationFrame = callback => nextFrame(() => callback(${time}));
  </script>`;
const clickAndLooks = `window.__hit + " click, " + __looks + " looks"`;
// 16 ms more in every frame, so that a busy machine cannot make two frames look like one.
const clock = "++frame * 16";

export interface ClickSelectorPage {
  name: string;
  page: string;
  selector: string;
  /** Evaluated in the page and awaited before the click. */
  settle?: string;
  timeout?: number;
  /** Evaluated in the page after the click. */
  report: string;
  want: string;
}

export const clickSelectorPages: ClickSelectorPage[] = [
  // An animation that has yet to start holds its element at the first keyframe. One that the compositor runs can stay
  // so for several frames.
  ...(
    [
      ["left", "mover", slideLeft],
      ["transform", "mover", slideTransform],
      ["transform of an ancestor", "box", slideTransform],
    ] as const
  ).map(([property, animated, keyframes]) => ({
    name: `waits for an animation of ${property} that has yet to start`,
    page: beginsAtLooks(animated, keyframes, 3),
    selector: "#mover",
    report: "String(window.__hit)",
    want: "100",
  })),
  {
    // A pause or a play takes effect in the next frame, so this animation is pending in every frame and never starts.
    name: "does not wait for an animation of another element",
    page: `${still}<i id=other></i>
      <script>
        const animation = other.animate([{ opacity: 0 }, { opacity: 1 }], 1000);
        let frames = 0;
        (function again() {
          frames++ % 2 ? animation.play() : animation.pause();
          requestAnimationFrame(again);
        })();
      </script>`,
    selector: "#b",
    timeout: 2000,
    report: "String(window.__hit)",
    want: "1",
  },
  {
    // Nothing overflows, so the timeline is not active and the animation is pending for as long as the page is.
    name: "does not wait for an animation on a timeline that is not active",
    page: `${still}
      <style>
        @keyframes fade { from { opacity: 0.5; } to { opacity: 1; } }
        body { animation: fade linear; animation-timeline: scroll(); }
      </style>`,
    selector: "#b",
    timeout: 2000,
    report: "String(window.__hit)",
    want: "1",
  },
  {
    name: "does not wait for an animation without a timeline",
    page: `${still}
      <script>
        new Animation(new KeyframeEffect(document.body, [{ opacity: 0.5 }, { opacity: 1 }], 1000), null).play();
      </script>`,
    selector: "#b",
    timeout: 2000,
    report: "String(window.__hit)",
    want: "1",
  },
  {
    // The first callback that click() asks for runs in the frame that asked: nothing has moved by then. The second
    // skips a frame, so that it cannot be in that frame too.
    name: "does not take the position before the first frame for a frame's",
    page: movesByFrame(`
      window.requestAnimationFrame = callback => {
        if (asked++ === 0) return (queueMicrotask(() => callback(performance.now())), 0);
        window.requestAnimationFrame = nextFrame;
        return nextFrame(() => nextFrame(callback));
      };`),
    selector: "#mover",
    report: "String(window.__hit)",
    want: "100",
  },
  {
    // The second callback that click() asks for runs in the frame of the first, with its time. A browser does that
    // after a long task.
    name: "does not take two callbacks of one frame for two frames",
    page: movesByFrame(`
      window.requestAnimationFrame = callback => {
        if (asked++ === 1) {
          window.requestAnimationFrame = nextFrame;
          return (queueMicrotask(() => callback(time)), 0);
        }
        return nextFrame(now => callback((time = now)));
      };`),
    selector: "#mover",
    report: "String(window.__hit)",
    want: "100",
  },
  {
    // A transition of body has yet to start at every look. click() waits for those that it found, not for later ones.
    name: "clicks below an ancestor that begins a transition in every frame",
    page: `<style>body { transition: background-color 1s linear; }</style>${still}
      <script>
        let hue = 0;
        (function again() {
          document.body.style.backgroundColor = "hsl(" + (hue = (hue + 3) % 360) + " 60% 60%)";
          requestAnimationFrame(again);
        })();
      </script>`,
    selector: "#b",
    timeout: 2000,
    report: "String(window.__hit)",
    want: "1",
  },
  {
    name: "clicks when every frame carries the same time",
    page: countsLooks("1000"),
    selector: "#b",
    timeout: 2000,
    report: "String(window.__hit)",
    want: "1",
  },
  {
    name: "looks three times at a still element",
    page: countsLooks(clock),
    selector: "#b",
    report: clickAndLooks,
    want: "1 click, 3 looks",
  },
  {
    name: "looks three times at a still element below an animation that runs",
    page: countsLooks(
      clock,
      `<style>
        @keyframes pulse { from { opacity: 0.8; } to { opacity: 1; } }
        body { animation: pulse 1s linear infinite alternate; }
      </style>`,
    ),
    selector: "#b",
    settle: "Promise.all(document.getAnimations().map(animation => animation.ready)).then(() => 1)",
    report: clickAndLooks,
    want: "1 click, 3 looks",
  },
  {
    name: "looks three times at a still element when frames carry no time",
    page: countsLooks("undefined"),
    selector: "#b",
    timeout: 2000,
    report: clickAndLooks,
    want: "1 click, 3 looks",
  },
];
