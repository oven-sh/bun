// A line is joined from what the last turn of a loop left behind: a text, a number, an object that is converted, or the
// note of a catch. Each part is converted where it stands, and an error leaves at the part that throws it.
let count = 0;
let trail = "";
function note(text) {
  count++;
  trail += text;
}

const long = "ab".repeat(40);
const makers = {
  nothing: () => undefined,
  text: i => "t" + i,
  joined: i => long + i + long,
  number: i => i * 1.5,
  negativeZero: () => -0,
  big: i => BigInt(i) * 10n,
  none: () => null,
  flag: i => i === 2,
  list: i => [i, [i + 1]],
  converted: i => ({
    toString() {
      note("s" + i);
      return "object " + i;
    },
  }),
  valued: i => ({
    valueOf() {
      note("v" + i);
      return i;
    },
    toString() {
      note("never");
      return "never";
    },
  }),
  refuses: i => ({
    toString() {
      note("r" + i);
      throw new RangeError("no text " + i);
    },
  }),
  symbol: i => Symbol("s" + i),
  throwsAtOnce: () => {
    throw new TypeError("at once");
  },
  throwsLater: i => {
    if (i >= 2) throw new SyntaxError("later " + i);
    return "early " + i;
  },
};

function run(name) {
  const str = makers[name];
  const o = { k: 0 };
  let seen, before, line;
  for (let i = 0; i < 4; i++) {
    before = count;
    if (i & 1) {
      try {
        note("odd");
      } catch (e) {
        note("no");
      }
    }
    try {
      line = seen + " | " + (count - before) + " " + trail;
      console.log("round " + i + ": " + line);
    } catch (e) {
      console.log("round " + i + " threw " + e.name + ": " + e.message + " after " + (count - before) + " " + trail);
    }
    o.k = i;
    try {
      seen = str(o.k);
    } catch (e) {
      seen = "threw " + e.name;
    }
  }
  return line;
}

for (const name of Object.keys(makers)) {
  count = 0;
  trail = "";
  console.log(name + " => " + run(name));
}

// The same line outside any try of its own: the error leaves the function at the part that throws it.
function joinOnce(seen, before) {
  const line = seen + " | " + (count - before) + " " + trail;
  return "round " + before + ": " + line + " " + missingName;
}
for (const seen of ["text", 1, makers.refuses(7), makers.symbol(8), makers.converted(9)]) {
  try {
    console.log(joinOnce(seen, 1));
  } catch (e) {
    console.log(e.name + ": " + e.message + " | " + trail);
  }
}

// A text too long to be made: that error comes before the one of a name that is read behind it, and after one that is read in front.
function joinTooLong(a, b) {
  const whole = a + b + a + b;
  return "round " + a.length + ": " + whole + missingName;
}
function readThenJoinTooLong(a, b) {
  return missingName + ": " + (a + b + a + b);
}
let half = "x";
for (let doubled = 0; doubled < 29; doubled++) half += half;
for (const join of [joinTooLong, readThenJoinTooLong]) {
  try {
    console.log(join(half, half).length);
  } catch (e) {
    console.log(join.name + ": " + e.name);
  }
}
