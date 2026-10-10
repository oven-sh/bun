// What the analysis costs: the time of `bun-lint js_plugin batch --plugin=cost-plugin.mjs --rules='{"<rule>":[]}' cases.jsonl` with
// `events`, less that with `nodes`, which makes the same walk without it.
export default {
  meta: { name: "cost" },
  rules: {
    program: { create: () => ({ Program() {} }) },
    nodes: { create: () => ({ "*"() {}, "*:exit"() {} }) },
    events: { create: () => ({ "*"() {}, "*:exit"() {}, onCodePathStart() {} }) },
  },
};
