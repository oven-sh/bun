// Classes reach an array one a round, and many functions read through values taken from it under declared interfaces, so
// that each site's set of receivers grows through as many versions as there are rounds. A statement that ran for every
// version left nodes and edges behind for each: sites times rounds. The program below needs about a tenth of the bound
// when reads wait.
import { expect } from "bun:test";
import { describe, test } from "./harness/declare";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
import { readBuildReport } from "./harness/build-report";
import { unsupported } from "./harness/compiler";
import { withReport } from "./harness/flags";
import { run } from "./harness/run";
import { sharedBuilds } from "./harness/shared-builds";

const classes = 300;
const interfaces = 150;
const tagOf = (index: number) => (index * 7919) % 75;

const lines: string[] = [];
for (let i = 0; i < interfaces; i++)
  lines.push(
    `interface I${i} { id: number; name: string; kind: number; t${tagOf(i)}: number; owner: I${(i * 7 + 1) % interfaces} | null; next: I${(i * 11 + 3) % interfaces} | null }`,
  );
for (let c = 0; c < classes; c++) {
  const tags = new Set(Array.from({ length: 12 }, (_, k) => tagOf(c * 13 + k * 17)));
  lines.push(
    `class K${c} { id = ${c}; name = "k${c}"; kind = ${c % 7}; owner: any = null; next: any = null; ${[...tags].map(tag => `t${tag} = ${tag};`).join(" ")} }`,
  );
}
for (let i = 0; i < interfaces; i++)
  for (const s of [0, 1])
    lines.push(
      `function use${i}_${s}(x: I${i}): number { const o = x.owner; const n = x.next; return x.id + x.kind + x.name.length + (o ? o.id + (o.owner ? o.owner.kind : 0) : 0) + (n ? n.kind + (n.next ? n.next.id : 0) : 0); }`,
    );
lines.push(`const hub: any[] = [];`, `function take(index: number): any { return hub[index % hub.length]; }`);
for (let c = 0; c < classes; c++)
  lines.push(
    `function step${c}(n: number): void { hub.push(new K${c}()); const made = hub[hub.length - 1]; if (made && made.id === ${c}) { made.owner = take(${c * 13}); made.next = take(${c * 17}); ${c + 1 < classes ? `step${c + 1}(n);` : ""} } }`,
  );
lines.push(`step0(0);`, `let sum = 0;`);
for (let i = 0; i < interfaces; i++)
  for (const s of [0, 1])
    lines.push(
      `{ const v = take(${i * 31 + s}); if (v.t${tagOf(i)} !== undefined) sum = (sum + use${i}_${s}(v)) | 0; }`,
    );
lines.push(`console.log(sum);`);

describe.skipIf(!!unsupported)("receivers that grow a member a round", () => {
  const { folder, build } = sharedBuilds("receivers-that-grow-a-member-a-round", {
    "main.ts": lines.join("\n") + "\n",
  });

  test("log few edges and print what plain Bun prints", async () => {
    const report = join(folder, "report.json");
    const built = await build("main.ts", "--aot", ...withReport(report, "summary"));
    expect(readBuildReport(report).statistics.FlowEdgesLogged).toBeLessThan(1000000);
    const printedBy = async (cmd: string[]) => {
      const { stdout, exitCode } = await run(cmd, folder, bunEnv);
      return { stdout, exitCode };
    };
    expect(await printedBy([built.executable])).toEqual(await printedBy([bunExe(), "main.ts"]));
  });
});
