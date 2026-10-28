const responsePrototype = {
  get status() {
    return this.code;
  },
  get message() {
    return this.text;
  },
};

const holderPrototype = {
  get status() {
    return this.response.status;
  },
  get message() {
    return this.response.message;
  },
};

function createHolder(code, text) {
  const holder = Object.create(holderPrototype);
  const response = (holder.response = Object.create(responsePrototype));
  response.code = code;
  response.text = text;
  return holder;
}

let sum = 0;
let lastMessage = "";
for (let i = 0; i < 1000; i++) {
  const holder = createHolder(200 + (i % 3), i % 2 ? "odd" : "even");
  sum += holder.status;
  lastMessage = holder.message;
}
console.log(sum, lastMessage);

const outer = Object.create(holderPrototype);
outer.response = createHolder(1, "inner");
console.log(outer.status, outer.message);
outer.response = { status: "plain", message: 7 };
console.log(outer.status, outer.message);
outer.response = new Error("boom");
console.log(outer.status, outer.message);
outer.response = "text";
console.log(outer.status, outer.message);
