// Run by setTimeout.test.js. Prints one JSON object: what each case below saw.
//
// A timer id comes from one counter per thread. setTimeout, setInterval,
// setImmediate and Bun.sleep share it. timerInternals.setNextTimerId moves the
// counter forward, as if that many timers were created, so this file reaches
// ids past 2^31 and 2^32 in one process. The counter never moves back.
import { timerInternals } from "bun:internal-for-testing";
import jsc from "bun:jsc";

const result = {};
const nextImmediate = () => new Promise(resolve => setImmediate(resolve));

// Past 2^31. A 32-bit signed counter gives negative ids from here on.
{
  timerInternals.setNextTimerId(2 ** 31 - 1);
  const fired = [];
  const { promise: keptFired, resolve } = Promise.withResolvers();
  const byKey = setTimeout(() => fired.push("byKey"), 1);
  const byKeyPastInt32 = setTimeout(() => fired.push("byKeyPastInt32"), 1);
  const byNumber = setTimeout(() => fired.push("byNumber"), 1);
  const byObject = setTimeout(() => fired.push("byObject"), 1);
  const kept = setTimeout(() => {
    fired.push("kept");
    resolve();
  }, 1);
  const ids = [byKey, byKeyPastInt32, byNumber, byObject, kept].map(Number);

  // A program that keeps its timers in an object clears them by key. The key is a string.
  const timers = {};
  timers[byKey] = true;
  timers[byKeyPastInt32] = true;
  for (const key in timers) clearTimeout(key);
  clearTimeout(+byNumber);
  clearTimeout(byObject);
  // `kept` has the latest deadline of the five.
  await keptFired;

  const ran = [];
  const immediate = setImmediate(() => ran.push("immediate"));
  const clearedImmediate = setImmediate(() => ran.push("clearedImmediate"));
  const sleep = Bun.sleep(0); // takes the id between the two immediates around it
  const lastImmediate = setImmediate(() => ran.push("lastImmediate"));
  clearImmediate(clearedImmediate);
  await sleep;
  await nextImmediate();

  result.pastInt32 = {
    ids,
    keys: Object.keys(timers),
    fired,
    inspect: Bun.inspect(kept),
    immediateIds: [immediate, clearedImmediate, lastImmediate].map(Number),
    inspectImmediate: Bun.inspect(lastImmediate),
    ran,
  };
}

// Past 2^32. A 32-bit counter gives -1, then 0, then the ids of the first timers again.
{
  timerInternals.setNextTimerId(2 ** 32 - 1);
  const fires = [0, 0];
  const firstFires = [Promise.withResolvers(), Promise.withResolvers()];
  const timers = [0, 1].map(i =>
    setTimeout(() => {
      fires[i]++;
      firstFires[i].resolve();
    }, 1),
  );
  const ids = timers.map(Number);
  await Promise.all(firstFires.map(f => f.promise));

  // -1 was the "not initialized" id, and refresh() ignored the timer that had it.
  for (const timer of timers) timer.refresh();
  // Same delay, scheduled after the two refreshed timers: it fires after them.
  await new Promise(resolve => setTimeout(resolve, 1));

  result.pastUint32 = { ids, fires };
}

// 2^32 timers between two intervals. A 32-bit counter gives the second one the id of the first.
{
  let firstTicks = 0;
  let secondTicks = 0;
  let onTick = () => {};
  const first = setInterval(() => {
    firstTicks++;
    onTick();
  }, 1);
  const id = +first;
  timerInternals.setNextTimerId(2 ** 32 + id);
  const second = setInterval(() => {
    secondTicks++;
    onTick();
  }, 1);
  const secondId = +second;

  clearInterval(id);
  const firstTicksAtClear = firstTicks;
  const secondTicksAtClear = secondTicks;
  await new Promise(resolve => {
    onTick = () => {
      if (firstTicks - firstTicksAtClear >= 3 || secondTicks - secondTicksAtClear >= 3) resolve();
    };
  });
  clearInterval(first);
  clearInterval(second);

  result.intervalAfter2To32Timers = {
    idDistance: secondId - id,
    firstStopped: firstTicks === firstTicksAtClear,
    secondStillTicks: secondTicks - secondTicksAtClear >= 3,
  };
}

// A timeout that `_repeat` turned into an interval keeps its entry in the id map of timeouts.
// With its id given out again, freeing it removed the entry of the other timer and left its own
// behind, pointing at freed memory.
{
  let other, weak;
  const id = await (async () => {
    let fires = 0;
    const { promise: secondFire, resolve } = Promise.withResolvers();
    const timer = setTimeout(() => {
      if (++fires === 2) resolve();
    }, 1);
    const id = +timer; // registers the id while the timer is a timeout
    timer._repeat = 1; // the timer is an interval after its first fire
    await secondFire;

    timerInternals.setNextTimerId(2 ** 32 + id);
    other = setInterval(() => {}, 1e6);
    +other; // registers the id of `other`

    clearInterval(timer);
    weak = new WeakRef(timer);
    return id;
  })();
  for (let i = 0; i < 20 && weak.deref(); i++) {
    Bun.gc(true);
    await nextImmediate();
  }
  const collected = weak.deref() === undefined;

  // `id` names no timer now.
  clearTimeout(id);
  clearInterval(id);
  const otherAliveAfterClearOfFreedId = !other._destroyed;
  clearInterval(+other);

  result.freedPromotedTimeout = {
    collected,
    idDistance: +other - id,
    otherAliveAfterClearOfFreedId,
    otherClearedByItsId: other._destroyed,
  };
}

// What clearTimeout and clearInterval take as an id past 2^32, and what they do not.
{
  const utf16 = string => {
    const codeUnits = new DataView(new ArrayBuffer(2 * string.length));
    for (let i = 0; i < string.length; i++) codeUnits.setUint16(2 * i, string.charCodeAt(i), true);
    return new TextDecoder("utf-16le").decode(codeUnits);
  };

  timerInternals.setNextTimerId(2 ** 40);
  const kept = setTimeout(() => {}, 1e6);
  const id = +kept;
  // None of these is the id. Some are the id in a form that Node.js does not use as a key.
  const notTheId = [
    id + 2 ** 32,
    id - 2 ** 32,
    id + 0.5,
    -id,
    2 ** 53,
    2 ** 63,
    2 ** 64,
    -0,
    NaN,
    Infinity,
    (2 ** 64).toString(),
    "18446744073709551615",
    "0" + id,
    " " + id,
    id + " ",
    "+" + id,
    "-" + id,
    id + ".0",
    id.toExponential(),
    BigInt(id),
    new Number(id),
    new String(id),
  ];
  for (const value of notTheId) {
    clearTimeout(value);
    clearInterval(value);
  }
  const keptIsAlive = !kept._destroyed;

  const byNumber = setTimeout(() => {}, 1e6);
  clearInterval(+byNumber);
  const byString = setInterval(() => {}, 1e6);
  clearTimeout(String(+byString));
  const byUtf16String = setTimeout(() => {}, 1e6);
  const utf16Id = utf16(String(+byUtf16String));
  clearTimeout(utf16Id);
  clearTimeout(kept);

  result.clearByIdPastUint32 = {
    id,
    keptIsAlive,
    isUtf16: jsc.jscDescribe(utf16Id).includes("8Bit:(0)"),
    destroyed: [byNumber._destroyed, byString._destroyed, byUtf16String._destroyed],
  };
}

console.log(JSON.stringify(result));
