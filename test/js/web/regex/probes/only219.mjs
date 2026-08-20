import { executeCase, canonicalJson } from "/Users/dylanc/code/bun-regex-tests/test/js/web/regex/differential/execute.mjs";
const c = JSON.parse(read("/Users/dylanc/.claude/jobs/e1b02ffe/tmp/case219.json"));
print(canonicalJson(executeCase(c)).slice(0, 200));
