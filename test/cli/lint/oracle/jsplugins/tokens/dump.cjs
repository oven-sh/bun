"use strict";
// Calls every token and comment method of `sourceCode` at every node, token and comment, and reports one message per file: a line
// per section with how many calls it has and a hash of their results. With FULL=1 it's every result.
// A method gets every form of options at one node or token of each file. Everywhere else it gets one form, another one each time:
// all forms everywhere take minutes in a debug build.
// The first letter of a section says what it's about:
//   L  the layout of the objects: own keys, their order and flags, prototypes, names and lengths of functions
//   B  the tokens and comments themselves
//   D  calls with nodes, tokens and comments
//   N  the same with a negative count or padding
//   E  calls with locations where no token or comment starts or ends
//   X  methods that ESLint 10 doesn't have any more
const crypto = require("node:crypto");
const FULL = Boolean(process.env.FULL);

const flagsOf = d =>
  `${"value" in d ? "v" : `${d.get ? "g" : ""}${d.set ? "s" : ""}`}${d.writable ? "w" : ""}${d.enumerable ? "e" : ""}${d.configurable ? "c" : ""}`;
const keysOf = o =>
  Reflect.ownKeys(o)
    .map(k => `${String(k)}:${flagsOf(Object.getOwnPropertyDescriptor(o, k))}`)
    .join(",");
const chainOf = o => {
  const parts = [];
  for (let p = Object.getPrototypeOf(o); p !== null; p = Object.getPrototypeOf(p)) {
    if (p === Object.prototype) {
      parts.push("Object");
      break;
    }
    if (p === Array.prototype) {
      parts.push("Array");
      break;
    }
    parts.push(`${p.constructor && p.constructor.name}/${p.constructor && p.constructor.length}{${keysOf(p)}}`);
  }
  return parts.join("<");
};
const layoutOf = o =>
  o === null || typeof o !== "object"
    ? String(o)
    : `${chainOf(o)} {${keysOf(o)}}${Object.isFrozen(o) ? " frozen" : ""}`;

const SKIP = ["getFirstToken", "getLastToken", "getTokenBefore", "getTokenAfter"];
const COUNT = ["getFirstTokens", "getLastTokens", "getTokensBefore", "getTokensAfter"];
const SKIP2 = ["getFirstTokenBetween", "getLastTokenBetween"];
const COUNT2 = ["getFirstTokensBetween", "getLastTokensBetween"];
const COMMENTS = ["getCommentsBefore", "getCommentsAfter", "getCommentsInside"];

function dump(context, program) {
  const s = context.sourceCode;
  const sections = new Map();
  const put = (name, line) => {
    let lines = sections.get(name);
    if (lines === undefined) sections.set(name, (lines = []));
    lines.push(line);
  };

  // Layout first, before anything has touched a lazy property.
  put(
    "L:program",
    `tokens:${flagsOf(Object.getOwnPropertyDescriptor(program, "tokens") || {})} comments:${flagsOf(Object.getOwnPropertyDescriptor(program, "comments") || {})}`,
  );
  for (let p = Object.getPrototypeOf(s); p !== null && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    if (p.constructor.name !== "TokenStore") continue;
    put(
      "L:store",
      `${p.constructor.name}/${p.constructor.length} ${typeof p.constructor} ${Reflect.ownKeys(p)
        .map(
          k =>
            `${String(k)}:${flagsOf(Object.getOwnPropertyDescriptor(p, k))}:${typeof p[k] === "function" ? `${p[k].name}/${p[k].length}` : ""}`,
        )
        .join(" ")}`,
    );
  }
  for (const name of [
    ...SKIP,
    ...COUNT,
    ...SKIP2,
    ...COUNT2,
    ...COMMENTS,
    "getTokenByRangeStart",
    "getTokens",
    "getTokensBetween",
    "commentsExistBetween",
    "isSpaceBetween",
    "isSpaceBetweenTokens",
    "getTokenOrCommentBefore",
    "getTokenOrCommentAfter",
    "getAllComments",
  ]) {
    put(
      "L:methods",
      `${name} ${typeof s[name]} ${typeof s[name] === "function" ? `${s[name].name}/${s[name].length}` : ""}`,
    );
  }

  const tokens = program.tokens;
  const comments = program.comments;
  const ids = new Map();
  tokens.forEach((t, i) => ids.set(t, `T${i}`));
  comments.forEach((t, i) => ids.set(t, `C${i}`));
  const one = v =>
    v === null
      ? "null"
      : v === undefined
        ? "undefined"
        : typeof v !== "object"
          ? String(v)
          : (ids.get(v) ?? `?${JSON.stringify(v)}`);
  const show = v => (Array.isArray(v) ? `[${v.map(one).join(" ")}]` : one(v));
  const attempt = f => {
    try {
      return show(f());
    } catch (e) {
      return `!${e && e.constructor && e.constructor.name}:${e && e.message}`;
    }
  };

  for (const [list, name] of [
    [tokens, "T"],
    [comments, "C"],
  ]) {
    put("L:lists", `${name} ${chainOf(list)} ${Object.isFrozen(list)}`);
    list.forEach((t, i) => {
      put("L:shape", `${name}${i} ${t.type} ${layoutOf(t)}`);
      put(
        "B:values",
        `${name}${i} ${JSON.stringify([t.type, t.value, t.range, t.loc.start.line, t.loc.start.column, t.loc.end.line, t.loc.end.column, t.regex && [t.regex.pattern, t.regex.flags]])}`,
      );
      put(
        "L:parts",
        `${name}${i} start=${t.start} end=${t.end} loc=${layoutOf(t.loc)} start=${layoutOf(t.loc.start)} end=${layoutOf(t.loc.end)} range=${layoutOf(t.range)} regex=${layoutOf(t.regex)} after=${layoutOf(t)} json=${JSON.stringify(t)}`,
      );
      put("B:same", `${name}${i} ${t.loc === t.loc} ${t.range === t.range} ${t.regex === t.regex}`);
    });
  }
  put(
    "B:identity",
    [
      program.tokens === tokens,
      program.comments === comments,
      s.getAllComments() === comments,
      s.tokensAndComments === s.tokensAndComments,
      s.ast === program,
      show(s.tokensAndComments),
      s.getTokens(program) !== s.getTokens(program),
      s.getTokens(program) !== tokens,
      Object.isFrozen(s.tokensAndComments),
    ].join(" "),
  );

  // A filter that notes what it's called with.
  let calls = [];
  const noting = test =>
    function (...args) {
      calls.push(`${one(args[0])}/${args.length}${this === undefined ? "" : "/this"}`);
      return test(args[0]);
    };
  const isPunctuator = t => t.type === "Punctuator";
  const filters = [
    noting(isPunctuator),
    noting(t => (t.type === "Identifier" ? 1 : 0)),
    noting(t => (t.type === "Line" || t.type === "Block" ? "yes" : "")),
    noting(() => null),
    noting(() => ({})),
  ];
  const [f0, f1, f2, f3, f4] = filters;
  const shared = [
    undefined,
    null,
    false,
    true,
    "1",
    0,
    1,
    2,
    7,
    1.9,
    -0,
    NaN,
    4294967297,
    f0,
    f1,
    f2,
    f3,
    f4,
    {},
    { includeComments: true },
    { includeComments: 1 },
    { includeComments: 0 },
    { includeComments: "" },
    { filter: f0 },
    { filter: f1 },
    { filter: null },
    { filter: undefined },
    { filter: 0 },
    { filter: f2, includeComments: true },
    { filter: f0, includeComments: true },
    -1,
    -1.5,
    { filter: 1 },
    { filter: "x" },
    { filter: {} },
    { filter: true, includeComments: true },
  ];
  const named = key => [
    { [key]: 0 },
    { [key]: 1 },
    { [key]: 2 },
    { [key]: 3 },
    { [key]: 1.9 },
    { [key]: "2" },
    { [key]: null },
    { [key]: undefined },
    { [key]: NaN },
    { [key]: true },
    { [key]: 4294967298 },
    { [key]: 1, includeComments: true },
    { [key]: 2, includeComments: true },
    { [key]: 0, includeComments: true },
    { [key]: 1, filter: f0 },
    { [key]: 2, filter: f1 },
    { [key]: 1, filter: f2, includeComments: true },
    { [key]: 2, filter: f0, includeComments: true },
    { [key]: 0, filter: f0 },
    { [key]: -1 },
    { [key]: -1, filter: 1 },
    { [key]: "-1" },
    { [key]: -0.5 },
  ];
  const skipForms = [...shared, ...named("skip"), { count: 1 }];
  const countForms = [...shared, ...named("count"), { skip: 1 }];
  const padForms = [
    [],
    [0],
    [1],
    [2],
    [0, 1],
    [1, 0],
    [2, 2],
    [undefined, 1],
    [undefined, 2],
    [null, 1],
    [1.9, 1.9],
    [1, "1"],
    ["1", 1],
    [100, 100],
    [-1],
    [0, -1],
    [-1, -1],
    [-2, -3],
    [0, -100],
    [NaN, NaN],
    [f0],
    [f0, 1],
    [{ includeComments: true }],
    [{ includeComments: true }, 1],
    [{ count: 1 }],
    [{ count: 2, includeComments: true }],
    [{ filter: f1 }],
    [{ filter: f2, includeComments: true, count: 1 }],
    [{ count: -1 }],
    [{ filter: 1 }],
    [true],
    [false, 1],
    [{}],
  ];
  const call = (section, label, name, args) => {
    calls = [];
    const result = typeof s[name] === "function" ? attempt(() => s[name](...args)) : "missing";
    put(section, `${label} ${result}${calls.length > 0 ? ` <${calls.join(" ")}>` : ""}`);
  };

  let isThorough = false;
  let turn = 0;
  // Calls `visit` with each of `forms`, or with the one whose turn it is.
  const each = (forms, visit) => {
    if (isThorough) return forms.forEach(visit);
    const i = turn++ % forms.length;
    visit(forms[i], i);
  };

  // Sections that start with "N": a negative number as the count or the padding.
  const negative = form => typeof form === "number" && form < 0;
  function atOne(prefix, label, target) {
    each(SKIP, name => each(skipForms, (form, i) => call(`${prefix}:${name}`, `${label} #${i}`, name, [target, form])));
    each(COUNT, name =>
      each(countForms, (form, i) =>
        call(`${negative(form) ? "N" : prefix}:${name}`, `${label} #${i}`, name, [target, form]),
      ),
    );
    each(padForms, (form, i) =>
      call(`${form.some(negative) ? "N" : prefix}:getTokens`, `${label} #${i}`, "getTokens", [target, ...form]),
    );
    each(COMMENTS, name => call(`${prefix}:${name}`, label, name, [target]));
    each([undefined, 0, 1, 2], skip => {
      call("X:getTokenOrCommentBefore", `${label} ${skip}`, "getTokenOrCommentBefore", [target, skip]);
      call("X:getTokenOrCommentAfter", `${label} ${skip}`, "getTokenOrCommentAfter", [target, skip]);
    });
  }
  function atTwo(prefix, label, left, right) {
    each(SKIP2, name =>
      each(skipForms, (form, i) => call(`${prefix}:${name}`, `${label} #${i}`, name, [left, right, form])),
    );
    each(COUNT2, name =>
      each(countForms, (form, i) =>
        call(`${negative(form) ? "N" : prefix}:${name}`, `${label} #${i}`, name, [left, right, form]),
      ),
    );
    each(
      padForms.filter(form => form.length < 2),
      (form, i) =>
        call(`${form.some(negative) ? "N" : prefix}:getTokensBetween`, `${label} #${i}`, "getTokensBetween", [
          left,
          right,
          ...form,
        ]),
    );
    call(`${prefix}:commentsExistBetween`, label, "commentsExistBetween", [left, right]);
    call(`${prefix}:isSpaceBetween`, label, "isSpaceBetween", [left, right]);
    call("X:isSpaceBetweenTokens", label, "isSpaceBetweenTokens", [left, right]);
  }

  const nodes = [];
  (function visit(node) {
    nodes.push(node);
    for (const key of s.visitorKeys[node.type] ?? []) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(it => it && typeof it.type === "string" && visit(it));
      else if (child && typeof child.type === "string") visit(child);
    }
  })(program);
  const at = n => `${n.type}[${n.range}]`;
  nodes.forEach((node, i) => {
    isThorough = i === nodes.length >> 1 && nodes.length % 2 === 0;
    atOne("D", at(node), node);
    const next = nodes[i + 1];
    const far = nodes[i + 3];
    if (isThorough && next) atTwo("D", `${at(node)}..${at(next)}`, node, next);
    isThorough = false;
    each([0, 1, 2], which => {
      if (which === 0 && next) atTwo("D", `${at(node)}..${at(next)}`, node, next);
      if (which === 1 && next) atTwo("D", `${at(next)}..${at(node)}`, next, node);
      if (which === 2 && far) atTwo("D", `${at(node)}..${at(far)}`, node, far);
    });
  });
  const all = s.tokensAndComments;
  all.forEach((token, i) => {
    isThorough = i === all.length >> 1 && nodes.length % 2 === 1;
    atOne("D", one(token), token);
    if (isThorough && all[i + 1]) atTwo("D", `${one(token)}..${one(all[i + 1])}`, token, all[i + 1]);
    isThorough = false;
    each([1, 2, 5, -1], step => {
      const other = all[i + Math.abs(step)];
      if (other && step > 0) atTwo("D", `${one(token)}..${one(other)}`, token, other);
      if (other && step < 0) atTwo("D", `${one(other)}..${one(token)}`, other, token);
    });
    each([[], [{ includeComments: true }], [{ includeComments: 0 }], [true], [null]], form =>
      call("D:getTokenByRangeStart", one(token), "getTokenByRangeStart", [token.range[0], ...form]),
    );
  });

  // The indices of the text, and a few beside it.
  const few = [undefined, 1, { includeComments: true }, { includeComments: true, skip: 1 }, f0];
  const fewCounts = [undefined, 1, { includeComments: true }, { includeComments: true, count: 2 }, f0];
  const length = s.text.length;
  const middle = length >> 1;
  for (let o = -3; o <= length + 3; o += length > 40 && o !== middle - 1 ? 2 : 1) {
    isThorough = o === middle;
    each([undefined, { includeComments: true }], options =>
      call("E:getTokenByRangeStart", `${o}`, "getTokenByRangeStart", [o, options]),
    );
    each([0, 1, 4], width => {
      const target = { range: [o, o + width] };
      const label = `${o}+${width}`;
      each(SKIP, name => each(few, (form, i) => call(`E:${name}`, `${label} #${i}`, name, [target, form])));
      each(COUNT, name => each(fewCounts, (form, i) => call(`E:${name}`, `${label} #${i}`, name, [target, form])));
      each([[], [1, 1], [{ includeComments: true }]], form =>
        call("E:getTokens", label, "getTokens", [target, ...form]),
      );
      each(COMMENTS, name => call(`E:${name}`, label, name, [target]));
      const right = { range: [o + width + 3, o + width + 4] };
      each(SKIP2, name => each(few, (form, i) => call(`E:${name}`, `${label} #${i}`, name, [target, right, form])));
      each(COUNT2, name =>
        each(fewCounts, (form, i) => call(`E:${name}`, `${label} #${i}`, name, [target, right, form])),
      );
      each([[], [1]], form => call("E:getTokensBetween", label, "getTokensBetween", [target, right, ...form]));
      call("E:commentsExistBetween", label, "commentsExistBetween", [target, right]);
    });
  }
  isThorough = false;
  for (const o of [0.5, 1.5, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 32, 2 ** 32 + 1, -1, -0]) {
    const target = { range: [o, o] };
    call("E:odd", `${o}`, "getTokenByRangeStart", [o]);
    each([...SKIP, ...COUNT, "getTokens", ...COMMENTS], name => {
      call("E:odd", `${o} ${name}`, name, [target]);
      call("E:odd", `${o} ${name} c`, name, [target, { includeComments: true }]);
    });
    call("E:odd", `${o} between`, "getTokensBetween", [target, { range: [length, length] }]);
    call("E:odd", `${o} between`, "getFirstTokenBetween", [{ range: [0, 0] }, target]);
    call("E:odd", `${o} exist`, "commentsExistBetween", [target, { range: [length, length] }]);
    call("E:odd", `${o} exist`, "commentsExistBetween", [{ range: [0, 0] }, target]);
  }

  const out = [];
  for (const [name, lines] of sections) {
    if (FULL) for (const line of lines) out.push(`${name} ${line}`);
    else out.push(`${name} ${lines.length} ${crypto.createHash("sha1").update(lines.join("\n")).digest("hex")}`);
  }
  context.report({ node: program, message: out.join("\n") });
}

module.exports = {
  meta: { name: "tokens" },
  rules: {
    all: {
      create(context) {
        return {
          Program(node) {
            dump(context, node);
          },
        };
      },
    },
  },
};
