// JSON.stringify is handed an object that holds a text of 358 million characters: an instance of a class that the function around it declares, where the length of the result is read and where nothing is read, and an object that also holds a date. Each function runs three times.
// The executable writes the text every time, as Node.js does. Plain Bun throws a RangeError beside the date. For the instances it writes the text at first and throws later, and how much later depends on what its interpreter and its JIT have seen by then. So the output is stored.
const long = "x".repeat(358_000_000);
const forms = {
  "an instance, read": text => {
    class Holder {
      constructor(held) {
        this.held = held;
      }
    }
    return JSON.stringify(new Holder(text)).length;
  },
  "an instance, not read": text => {
    class Holder {
      constructor(held) {
        this.held = held;
      }
    }
    JSON.stringify(new Holder(text));
    return "no error";
  },
  "beside a date": text => JSON.stringify({ when: new Date(0), text }).length,
};
for (const name in forms) {
  let seen = name + ":";
  for (let turn = 0; turn < 3; turn++) {
    try {
      seen += " " + forms[name](long);
    } catch (error) {
      seen += " " + error.constructor.name;
    }
  }
  console.log(seen);
}
