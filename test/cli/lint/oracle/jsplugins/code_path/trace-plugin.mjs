// Reports all that a rule can see of the code path analysis, as one message: every event and every node that is entered and left,
// in order, and with each event the graph as it is at that time.
//
//   bun ../cases.ts --fixtures <fixtures> | sed 's/^{/{"allowInlineConfig":false,/' > cases.jsonl        (or --files <directories>)
//   bun ../run-eslint.ts --plugin=trace-plugin.mjs cases.jsonl > expected.jsonl
//   bun-lint js_plugin batch --plugin=trace-plugin.mjs cases.jsonl > actual.jsonl
//   bun ../compare.ts cases.jsonl expected.jsonl actual.jsonl --json
const at = node => `${node.type}@${node.range}`;
const ids = segments => segments.map(it => it.id).join();
const segment = it =>
  `${it.id}${it.reachable ? "" : "!"} next=${ids(it.nextSegments)} prev=${ids(it.prevSegments)} allNext=${ids(it.allNextSegments)} allPrev=${ids(it.allPrevSegments)}` +
  ` looped=${it.allPrevSegments.filter(prev => it.isLoopedPrevSegment(prev)).map(prev => prev.id)}`;

function traversal(codePath, options) {
  const order = [];
  codePath.traverseSegments(options, (it, controller) => {
    order.push(it.id);
    // Both ways to steer it, where the id tells which.
    if (options?.steers && it.id.endsWith("3")) controller.skip();
    if (options?.steers && it.id.endsWith("7")) controller.break();
  });
  return order.join();
}

const path = it =>
  `${it.id} ${it.origin} upper=${it.upper?.id} children=${it.childCodePaths.map(child => child.id)} initial=${it.initialSegment.id}` +
  ` final=${ids(it.finalSegments)} returned=${ids(it.returnedSegments)} thrown=${ids(it.thrownSegments)}` +
  ` current=${it.currentSegments ? ids(it.currentSegments) : it.currentSegments}`;

export default {
  meta: { name: "trace" },
  rules: {
    "code-path": {
      create(context) {
        const trace = [];
        const ofSegment = name => (it, node) => trace.push(`${name} ${segment(it)} ${at(node)}`);
        return {
          "*": node => trace.push(`> ${at(node)}`),
          "*:exit": node => trace.push(`< ${at(node)}`),
          onCodePathStart: (codePath, node) => trace.push(`onCodePathStart ${path(codePath)} ${at(node)}`),
          onCodePathSegmentStart: ofSegment("onCodePathSegmentStart"),
          onCodePathSegmentEnd: ofSegment("onCodePathSegmentEnd"),
          onUnreachableCodePathSegmentStart: ofSegment("onUnreachableCodePathSegmentStart"),
          onUnreachableCodePathSegmentEnd: ofSegment("onUnreachableCodePathSegmentEnd"),
          onCodePathSegmentLoop: (from, to, node) => trace.push(`onCodePathSegmentLoop ${segment(from)} | ${segment(to)} ${at(node)}`),
          onCodePathEnd(codePath, node) {
            const last = codePath.finalSegments.at(-1);
            trace.push(
              `onCodePathEnd ${path(codePath)} ${at(node)} order=${traversal(codePath)} steered=${traversal(codePath, { steers: true })}` +
                ` between=${traversal(codePath, { first: codePath.initialSegment.nextSegments[0] ?? codePath.initialSegment, last })}`,
            );
            if (!codePath.upper) context.report({ loc: { line: 1, column: 0 }, message: JSON.stringify(trace) });
          },
        };
      },
    },
  },
};
