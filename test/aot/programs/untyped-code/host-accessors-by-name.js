// Getters and setters of Bun's host classes reached by name from untyped code: Buffer's typed array properties, URL, Blob.
const lines = [];
const show = (label, value) => lines.push(label + ": " + String(value));

function readRepeatedly(read, receiver) {
  let last;
  for (let i = 0; i < 1000; i++) last = read(receiver);
  return last;
}

function errorOf(action) {
  try {
    return "no error: " + String(action());
  } catch (error) {
    return error.name + ": " + error.message;
  }
}

const readByteLength = o => o.byteLength;
const readByteOffset = o => o.byteOffset;
const readLength = o => o.length;
const readHref = o => o.href;
const readSize = o => o.size;
const writeHash = (o, value) => {
  o.hash = value;
};

const buffer = Buffer.from(new ArrayBuffer(16), 2, 5);
show("Buffer", [readRepeatedly(readByteLength, buffer), readRepeatedly(readByteOffset, buffer), readRepeatedly(readLength, buffer)].join(" "));

const url = new URL("https://example.com/path?query#start");
show("host getter", readRepeatedly(readHref, url));
show("host getter of Blob", readRepeatedly(readSize, new Blob([])));
for (let i = 0; i < 1000; i++) writeHash(url, "#a");
show("host setter", url.href);

show("host getter on another class", errorOf(() => Reflect.get(URL.prototype, "href", {})));
show("host getter on an object inheriting its class", errorOf(() => readHref(Object.create(URL.prototype))));

console.log(lines.join("\n"));
