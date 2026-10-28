// The counter of a loop stays below an integer that may lie past int32. In the loop it is only reckoned with; behind the loop it is returned, stored, handed on and printed.
const words = new Uint32Array([4294967295, 2147483647, 2147483648, 40, 0]);
const bytes = new Uint8Array(300);
bytes[77] = 255;
bytes[299] = 254;
const kept = [];
const holder = { last: 0, text: "" };
function note(value) {
  kept.push(value);
  return value;
}

function findInView(view, wanted) {
  for (let i = 0; i < view.length; i++)
    if (view[i] === wanted)
      return i;
  return -1;
}

function returnedPastInt32(from, a, b, mask, wanted) {
  const limit = words[a] + words[b];
  for (let i = from; i < limit; i++)
    if ((i & mask) === wanted)
      return i;
  return -1;
}

function brokenOutOf(from, a, b, mask, wanted) {
  const limit = words[a] + words[b];
  let i = from;
  for (; i < limit; i++)
    if ((i & mask) === wanted)
      break;
  holder.last = i;
  holder.text = "at " + i;
  note(i);
  return [i, i + 1, i | 0, i >>> 0, i / 2].join(",");
}

function ranToTheEnd(from, a, b) {
  const limit = words[a] + words[b];
  let i = from, s = 0;
  for (; i < limit; i++)
    s = (s + (i & 7)) | 0;
  return s + ":" + i + ":" + note(i);
}

function downwards(from, a) {
  const limit = -words[a];
  for (let i = from; i > limit; i--)
    if ((i & 31) === 5)
      return i;
  return 1;
}

function twoExits(from, a, b) {
  const limit = words[a] + words[b];
  for (let i = from; i < limit; i += 3) {
    if ((i & 63) === 1)
      return "first " + i;
    if ((i & 127) === 2)
      return note(i) + 0.5;
  }
  return "none";
}

const lines = [];
for (let round = 0; round < 4; round++) {
  lines.push(findInView(bytes, 255), findInView(bytes, 254), findInView(bytes, 253), findInView(words, 40), findInView(words, 2147483648));
  lines.push(returnedPastInt32(2147483600, 1, 3, 255, 9), returnedPastInt32(2147483600, 0, 1, 255, 9), returnedPastInt32(4294967290, 0, 3, 15, 3), returnedPastInt32(0, 4, 4, 1, 0), returnedPastInt32(6442450930, 0, 1, 255, 300));
  lines.push(brokenOutOf(2147483640, 0, 3, 15, 2), brokenOutOf(2147483640, 1, 4, 15, 2), brokenOutOf(4294967280, 0, 3, 1023, 7), holder.last, holder.text);
  lines.push(ranToTheEnd(2147483600, 2, 3), ranToTheEnd(4294967200, 0, 3), ranToTheEnd(50, 3, 4));
  lines.push(downwards(-2147483600, 2), downwards(-2147483640, 0), downwards(-4294967290, 0), downwards(3, 4));
  lines.push(twoExits(2147483500, 0, 4), twoExits(4294967100, 0, 3), twoExits(2147483645, 2, 4));
}
console.log(lines.join("\n"));
console.log(kept.join(" "));
