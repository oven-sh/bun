class Incoming {
  constructor(method, url) {
    this.method = method;
    this.url = url;
    this.headers = { host: "a" };
    this.version = 1;
  }
}
class Other {
  constructor() {
    this.method = "OTHER";
    this.kind = 1;
  }
}
const requestPrototype = {
  get method() {
    return this.req.method;
  },
  get url() {
    return this.req.url;
  },
  get host() {
    return this.req.headers.host;
  },
  get version() {
    return this.req.version;
  },
};
const hidden = process.argv.length > 99 ? process.argv[9] : "hidden";
function wrap(incoming) {
  const request = Object.create(requestPrototype);
  request.req = incoming;
  return request;
}
function through(value) {
  globalThis[hidden] = value;
  return globalThis.hidden;
}
let sum = 0;
for (let i = 0; i < 200000; i++) {
  const request = wrap(through(new Incoming("GET", "/" + (i & 7))));
  sum += request.method.length + request.url.length + request.host.length + request.version;
}
console.log(sum);
const odd = wrap(through(new Other()));
console.log(odd.method, odd.url, odd.version);
const plain = wrap(through({ method: "PLAIN", url: "/p", headers: { host: "b" }, version: 2 }));
console.log(plain.method, plain.url, plain.host, plain.version);
const none = wrap(through(undefined));
try {
  console.log(none.method);
} catch (error) {
  console.log(error.constructor.name);
}
const number = wrap(through(7));
console.log(number.method, number.url);
