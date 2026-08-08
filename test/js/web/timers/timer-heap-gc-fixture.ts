const TICKS = 30;

let garbage: unknown[] = [];
let ticks = 0;

function tick() {
  garbage = [];
  for (let i = 0; i < 6000; i++) garbage.push({ i, s: "x" + (i & 255) });
  Bun.gc(true);
  if (++ticks < TICKS) {
    setTimeout(tick, 16);
  } else {
    console.log("ok " + ticks);
  }
}

tick();
