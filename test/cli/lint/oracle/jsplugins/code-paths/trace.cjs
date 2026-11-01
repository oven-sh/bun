// A plugin that records what a rule can observe about code paths and reports it as one message per file.
// `trace/all` lists every listener call in order (nodes and code path events) and adds the graph when a code path ends. In a
// file named `*.traverse.*` it also adds the order of `traverseSegments` with each option.
// `trace/layout` describes the properties of the objects.
"use strict";

const at = node => `${node.type}[${node.range}]`;
const ids = list => `[${list.map(it => it.id).join(" ")}]`;

function properties(object) {
  return Reflect.ownKeys(object).map(key => {
    const it = Object.getOwnPropertyDescriptor(object, key);
    const flags = ["writable", "enumerable", "configurable"].filter(flag => it[flag]).map(flag => flag[0]);
    return `${String(key)}:${"value" in it ? "value" : "getter"}:${flags.join("")}`;
  });
}

function layout(object) {
  const prototype = Object.getPrototypeOf(object);
  return `${prototype.constructor.name} own(${properties(object)}) prototype(${properties(prototype)}) keys(${Object.keys(object)})`;
}

// Every segment that can be reached from the public members of `codePath`, by number.
function segmentsOf(codePath) {
  const found = new Map();
  const todo = [
    codePath.initialSegment,
    ...codePath.finalSegments,
    ...codePath.returnedSegments,
    ...codePath.thrownSegments,
  ];
  while (todo.length > 0) {
    const segment = todo.pop();
    if (found.has(segment.id)) {
      if (found.get(segment.id) !== segment) throw new Error(`Two objects for ${segment.id}`);
      continue;
    }
    found.set(segment.id, segment);
    todo.push(...segment.nextSegments, ...segment.prevSegments, ...segment.allNextSegments, ...segment.allPrevSegments);
  }
  const number = segment => Number(segment.id.slice(segment.id.indexOf("_") + 1));
  return [...found.values()].sort((a, b) => number(a) - number(b));
}

function graph(codePath) {
  const segments = segmentsOf(codePath);
  return [
    `  ${codePath.id} ${codePath.origin} upper=${codePath.upper?.id ?? null} children=${ids(codePath.childCodePaths)} initial=${codePath.initialSegment.id} final=${ids(codePath.finalSegments)} returned=${ids(codePath.returnedSegments)} thrown=${ids(codePath.thrownSegments)}`,
    ...segments.map(it => {
      const looped = segments.filter(prev => it.isLoopedPrevSegment(prev));
      const all = `${ids(it.allNextSegments)} ${ids(it.allPrevSegments)}`;
      const reachable = `${ids(it.nextSegments)} ${ids(it.prevSegments)}`;
      return `  ${it.id}${it.reachable ? "" : " unreachable"} next, prev: ${reachable}${all === reachable ? "" : ` all: ${all}`}${looped.length > 0 ? ` looped: ${ids(looped)}` : ""}`;
    }),
  ];
}

function traversals(codePath) {
  const lines = [];
  const run = (label, visit, ...options) => {
    const order = [];
    codePath.traverseSegments(...options, function (segment, controller) {
      order.push(this === codePath ? segment.id : `${segment.id}(this)`);
      visit(segment, controller);
    });
    lines.push(`  ${label}: ${order.join(" ")}`);
  };
  run("all", () => {});
  const segments = segmentsOf(codePath);
  for (const segment of segments) {
    run(`first ${segment.id}`, () => {}, { first: segment });
    run(`last ${segment.id}`, () => {}, { last: segment });
    run(`skip ${segment.id}`, (it, controller) => it === segment && controller.skip());
    run(`break ${segment.id}`, (it, controller) => it === segment && controller.break());
  }
  if (segments.length > 6) return lines;
  for (const first of segments)
    for (const last of segments) run(`${first.id} to ${last.id}`, () => {}, { first, last });
  return lines;
}

// The listeners of `trace/all`. `done(lines)` is called when the code path of the program ends.
function listeners(traverses, done) {
  const lines = [];
  const objects = new Map();
  const graphs = new Map();
  const name = object => {
    if (objects.has(object.id) && objects.get(object.id) !== object) throw new Error(`Two objects for ${object.id}`);
    objects.set(object.id, object);
    return object.id;
  };
  const check = (self, args, count) =>
    self === undefined && args.length === count ? "" : ` this or ${args.length} arguments`;
  const segmentEvent = event =>
    function (segment, node) {
      lines.push(`${event} ${name(segment)} ${at(node)}${check(this, arguments, 2)}`);
    };
  return {
    "*": node => lines.push(`> ${at(node)}`),
    "*:exit"(node) {
      // One line for a node without children.
      if (lines.at(-1) === `> ${at(node)}`) lines[lines.length - 1] = `= ${at(node)}`;
      else lines.push(`< ${at(node)}`);
    },
    onCodePathStart(codePath, node) {
      lines.push(`onCodePathStart ${name(codePath)} ${at(node)}${check(this, arguments, 2)}`);
      graphs.set(codePath, graph(codePath).join("\n"));
    },
    onCodePathEnd(codePath, node) {
      lines.push(`onCodePathEnd ${name(codePath)} ${at(node)}${check(this, arguments, 2)}`);
      const finished = graph(codePath);
      lines.push(...finished, ...(traverses ? traversals(codePath) : []));
      if (graphs.get(codePath) !== finished.join("\n")) lines.push("  The graph has changed since onCodePathStart.");
      if (codePath.upper === null) done(lines, node);
    },
    onCodePathSegmentStart: segmentEvent("onCodePathSegmentStart"),
    onCodePathSegmentEnd: segmentEvent("onCodePathSegmentEnd"),
    onUnreachableCodePathSegmentStart: segmentEvent("onUnreachableCodePathSegmentStart"),
    onUnreachableCodePathSegmentEnd: segmentEvent("onUnreachableCodePathSegmentEnd"),
    onCodePathSegmentLoop(from, to, node) {
      lines.push(`onCodePathSegmentLoop ${name(from)} ${name(to)} ${at(node)}${check(this, arguments, 3)}`);
    },
  };
}

const report = context => lines => context.report({ loc: { line: 1, column: 0 }, message: lines.join("\n") });

module.exports = {
  meta: { name: "trace" },
  rules: {
    all: { create: context => listeners(/\.traverse\.\w+$/.test(context.filename), report(context)) },
    layout: {
      create: context => ({
        onCodePathEnd(codePath) {
          const order = [];
          const visit = segment => order.push(segment.id);
          for (const options of [undefined, null, {}]) codePath.traverseSegments(options, visit);
          let controller;
          codePath.traverseSegments((_, it) => (controller = it));
          report(context)([
            layout(codePath),
            layout(codePath.initialSegment),
            `in: ${["initialSegment", "traverseSegments", "currentSegments", "internal"].filter(key => key in codePath)}`,
            `JSON: ${JSON.stringify(codePath)} ${JSON.stringify(codePath.initialSegment)}`,
            `the same array each time: ${["childCodePaths", "finalSegments", "returnedSegments", "thrownSegments"].every(key => Array.isArray(codePath[key]) && codePath[key] === codePath[key])}`,
            `without options: ${order}`,
            `controller: ${Object.keys(controller)}`,
          ]);
        },
      }),
    },
  },
};
