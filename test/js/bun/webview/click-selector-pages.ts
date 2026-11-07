// Pages for the tests of click(selector) in webview-chrome.test.ts and webview.test.ts: what makes an element stable.
//
// click() looks for its element with document.querySelector: once when it is called, then once in every frame. A page
// that replaces that function acts at exact looks and can count them, so no case depends on how soon a frame comes.

/** `act` runs in the page at each of the first `times` looks. */
const atFirstLooks = (times: number, act: string) => `
  <script>
    const { querySelector } = document;
    let looks = 0;
    document.querySelector = function (selector) {
      if (looks++ < ${times}) {
        ${act}
      }
      return querySelector.call(this, selector);
    };
  </script>`;

/** Begins the animation of 80 ms of `.go` again, so that it has yet to start. */
const beginAgain = (animated: string) => `${animated}.className = ""; ${animated}.offsetWidth; ${animated}.className = "go";`;

const button = `<button id=mover onclick="window.__hit=this.getBoundingClientRect().left">mv</button>`;
export const slideLeft = "from { left: 0; } to { left: 100px; }";
const slideTransform = "from { transform: translateX(0); } to { transform: translateX(100px); }";

/** The button, or the box around it, slides 100px to the right. The slide begins again at the first `times` looks. */
export const slidesAtLooks = (animated: "mover" | "box", keyframes: string, times: number) => `
  <style>
    @keyframes slide { ${keyframes} }
    #box { position: fixed; left: 0; top: 50px; }
    #mover { position: relative; width: 60px; height: 60px; }
    .go { animation: slide 80ms linear forwards; }
  </style>
  <div id=box>${button}</div>
  ${atFirstLooks(times, beginAgain(animated))}`;

/** From the first look on, the page moves the button by a step per frame. `frames` replaces requestAnimationFrame. */
const movesByFrame = (frames: string) => `
  <style>#mover { position: fixed; left: 0; top: 50px; width: 60px; height: 60px; }</style>
  ${button}
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

/** A still button on a page that counts the looks. Every frame carries `time`. `rest` is the rest of the page. */
const countsLooks = (time: string, rest = "") => `
  <button id=b onclick="window.__hit=1">b</button>
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
  </script>
  ${rest}`;
// 16 ms more in every frame, so that a busy machine cannot make two frames look like one.
const clock = "++frame * 16";
const clickAndLooks = `window.__hit + " click, " + __looks + " looks"`;
// One look before the first frame, one that takes the box, one that finds it equal.
const still = "1 click, 3 looks";

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
    page: slidesAtLooks(animated, keyframes, 3),
    selector: "#mover",
    report: "String(window.__hit)",
    want: "100",
  })),
  {
    // The animation is not of the button or of an ancestor: the element before it in the row gets wider.
    name: "waits for an animation that has yet to start and will push the element",
    page: `
      <style>
        @keyframes widen { from { width: 0; } to { width: 100px; } }
        #row { position: fixed; left: 0; top: 50px; display: flex; }
        #mover { width: 60px; height: 60px; }
        .go { animation: widen 80ms linear forwards; }
      </style>
      <div id=row><div id=pusher></div>${button}</div>
      ${atFirstLooks(3, beginAgain("pusher"))}`,
    selector: "#mover",
    report: "String(window.__hit)",
    want: "100",
  },
  {
    // The button is in a slot of a component. The box that slides is in the shadow tree, where document.getAnimations()
    // does not look.
    name: "waits for an animation in a shadow tree that has yet to start",
    page: `
      <x-panel>${button}</x-panel>
      <script>
        const shadow = document.getElementsByTagName("x-panel")[0].attachShadow({ mode: "open" });
        shadow.innerHTML = \`
          <style>
            @keyframes slide { ${slideTransform} }
            #box { position: fixed; left: 0; top: 50px; }
            .go { animation: slide 80ms linear forwards; }
          </style>
          <div id=box><slot></slot></div>\`;
        const box = shadow.getElementById("box");
      </script>
      ${atFirstLooks(3, beginAgain("box"))}`,
    selector: "#mover",
    report: "String(window.__hit)",
    want: "100",
  },
  {
    // Safari before 26 starts an animation at once, at time 0: in the next frame it is not pending and has not moved.
    // The page sets the start time to get the same in every browser.
    name: "waits for an animation that has started in this frame",
    page: `
      <style>#mover { position: fixed; left: 0; top: 50px; width: 60px; height: 60px; }</style>
      ${button}
      <script>let animation;</script>
      ${atFirstLooks(
        3,
        `animation?.cancel();
        animation = mover.animate([{ left: "0px" }, { left: "100px" }], { duration: 80, fill: "forwards" });
        animation.startTime = document.timeline.currentTime;`,
      )}`,
    selector: "#mover",
    report: "String(window.__hit)",
    want: "100",
  },
  {
    // Nothing overflows, so the timeline is not active and the animation is pending for as long as the page is.
    name: "does not wait for an animation on a timeline that is not active",
    page: countsLooks(
      clock,
      `<style>
        @keyframes fade { from { opacity: 0.5; } to { opacity: 1; } }
        body { animation: fade linear; animation-timeline: scroll(); }
      </style>`,
    ),
    selector: "#b",
    report: clickAndLooks,
    want: still,
  },
  {
    name: "does not wait for an animation without a timeline",
    page: countsLooks(
      clock,
      `<script>
        new Animation(new KeyframeEffect(document.body, [{ opacity: 0.5 }, { opacity: 1 }], 1000), null).play();
      </script>`,
    ),
    selector: "#b",
    report: clickAndLooks,
    want: still,
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
    // The second callback that click() asks for runs in the frame of the first, with a time 0.002 ms later. Chrome
    // does that after a long task.
    name: "does not take two callbacks of one frame for two frames",
    page: movesByFrame(`
      window.requestAnimationFrame = callback => {
        if (asked++ === 1) {
          window.requestAnimationFrame = nextFrame;
          return (queueMicrotask(() => callback(time + 0.002)), 0);
        }
        return nextFrame(now => callback((time = now)));
      };`),
    selector: "#mover",
    report: "String(window.__hit)",
    want: "100",
  },
  {
    // A transition of body has yet to start at every look. click() waits until the one that it found is gone, and for
    // one more frame. It does not look for the later ones.
    name: "waits for the animations that it found, not for later ones",
    page: countsLooks(
      clock,
      `<style>body { transition: background-color 1s linear; }</style>
      <script>
        let hue = 0;
        (function again() {
          document.body.style.backgroundColor = "hsl(" + (hue = (hue + 3) % 360) + " 60% 60%)";
          requestAnimationFrame(again);
        })();
      </script>`,
    ),
    selector: "#b",
    report: clickAndLooks,
    want: "1 click, 5 looks",
  },
  {
    // A pause or a play takes effect in the next frame. An animation that gets one in every frame is pending in every
    // frame and never starts. click() takes the three looks of a still element, waits eight frames, and one more.
    name: "waits eight frames for an animation that never starts",
    page: countsLooks(
      clock,
      `<i id=other></i>
      <script>
        const animation = other.animate([{ opacity: 0.9 }, { opacity: 1 }], 1000);
        let frames = 0;
        (function again() {
          frames++ % 2 ? animation.play() : animation.pause();
          requestAnimationFrame(again);
        })();
      </script>`,
    ),
    selector: "#b",
    report: clickAndLooks,
    want: "1 click, 12 looks",
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
    want: still,
  },
  {
    name: "looks three times at a still element at 120 frames a second",
    page: countsLooks("++frame * 8.34"),
    selector: "#b",
    report: clickAndLooks,
    want: still,
  },
  {
    name: "looks three times at a still element while an animation runs",
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
    want: still,
  },
  {
    // document.host is the image. The walk from the element to the shadow trees around it ends there.
    name: "looks three times at a still element on a page with an image named host",
    page: countsLooks(clock, `<img name=host>`),
    selector: "#b",
    report: clickAndLooks,
    want: still,
  },
  {
    name: "looks three times at a still element when frames carry no time",
    page: countsLooks("undefined"),
    selector: "#b",
    report: clickAndLooks,
    want: still,
  },
];

// The page makes its frames with a timer, so click(selector) runs to the click on a machine without a display, where
// the real requestAnimationFrame never calls back. The first frame lets click() take the box, the second finds it
// equal.
export const timerFrames = {
  page: `
    <script>
      window.__frames = 0;
      window.requestAnimationFrame = callback => setTimeout(() => callback(++__frames * 16), 16);
      window.__clicks = [];
      document.addEventListener(
        "click",
        event => __clicks.push({ trusted: event.isTrusted, x: event.clientX, y: event.clientY, target: event.target.id }),
        true,
      );
    </script>
    <button id=btn style="position:fixed;left:40px;top:60px;width:100px;height:80px">btn</button>`,
  report: "JSON.stringify({ clicks: __clicks, frames: __frames })",
  want: { clicks: [{ trusted: true, x: 90, y: 100, target: "btn" }], frames: 2 },
};
