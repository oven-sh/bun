function sumOfCodes(text) {
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum += text.charCodeAt(i);
  return sum;
}

function codesAround(text, from, to) {
  const codes = [];
  for (let i = from; i <= to; i++) codes.push(text.charCodeAt(i));
  return codes.join();
}

function firstSlash(text) {
  for (let i = 1; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 47 || (code === 37 && text.charCodeAt(i + 1) === 50)) return i;
  }
  return -1;
}

function readAnything(value, count) {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += value.charCodeAt(i);
  return sum;
}

const url = "http://localhost:3000/users/42/posts?limit=10&name=%20x";
const wide = "préfixe ‑ Ωμέγα / 漢字 / end";
const lines = [];
for (let round = 0; round < 3; ++round) {
  const path = url.slice(url.indexOf("/", 8));
  const joined = "/a" + round + "/" + path + "/" + wide;
  const partOfJoined = joined.slice(3, joined.length - 2);
  const partOfPart = path.slice(1).slice(2, 12);
  lines.push(sumOfCodes(path), sumOfCodes(joined), sumOfCodes(partOfJoined), sumOfCodes(partOfPart), sumOfCodes(wide.slice(3)), sumOfCodes(""), sumOfCodes(url.slice(5, 6)));
  lines.push(codesAround(url.slice(7), -2, 2), codesAround(("x" + round).concat("yz"), 1, 5), codesAround(wide.substring(8, 14), 0, 6));
  lines.push(firstSlash(path), firstSlash(path.slice(6)), firstSlash("/" + path.slice(30)), path.length, path, partOfPart);
  lines.push(readAnything(url.slice(12), 4), readAnything({ charCodeAt: i => i * 2 }, 4), readAnything(new String(url.slice(12)), 4));
  lines.push(path === url.slice(21), path.slice(0, 6) === "/users", joined.includes(path), { [path.slice(1, 6)]: 1 }.users);
}
for (const bad of [undefined, null, 3]) {
  try {
    readAnything(bad, 1);
    lines.push("read");
  } catch (error) {
    lines.push(error instanceof TypeError);
  }
}
console.log(lines.join("\n"));
