class Message {
  constructor() {
    this.headers = {};
  }
  setHeader(name, value) {
    this.headers[name] = "message:" + value;
  }
  getHeader(name) {
    return this.headers[name];
  }
}

class Upload extends Message {
  constructor() {
    super();
    this.path = "/";
  }
}

class Reply extends Message {
  constructor() {
    super();
    this.statusCode = 200;
  }
  setHeader(name, value) {
    this.headers[name] = "reply:" + value;
  }
}

const contextPrototype = {
  finish() {
    const res = this.res;
    res.statusCode = 404;
    return res.getHeader("a");
  },
};
const answerPrototype = {
  set(name, value) {
    this.res.setHeader(name, value);
  },
  get status() {
    return this.res.statusCode;
  },
  get first() {
    return this.res.getHeader("a");
  },
};

function createContext(res) {
  const context = Object.create(contextPrototype);
  const answer = (context.answer = Object.create(answerPrototype));
  context.res = answer.res = res;
  return context;
}

function run(res) {
  const context = createContext(res);
  context.answer.set("a", 1);
  const before = context.answer.status;
  return [before, context.finish(), context.answer.status, context.answer.first].join(" ");
}

let last = "";
for (let i = 0; i < 1000; i++) last = run(new Reply());
console.log(last);
console.log(run(new Upload()));
console.log(run(new Message()));
console.log(run({ setHeader(name, value) { this[name] = value; }, getHeader(name) { return this[name]; }, statusCode: "plain" }));
const late = new Upload();
late.statusCode = 1;
console.log(run(late));
const context = createContext(new Reply());
context.answer.res = new Map();
try {
  context.answer.set("a", 1);
} catch (error) {
  console.log(error instanceof TypeError, context.answer.status);
}
context.answer = context;
console.log(context.answer.finish(), context.res.statusCode);
