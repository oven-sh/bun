import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { beforeAll, test } from "./supported-with-counted-calls";

// A program that draws, waits and draws again makes the same short-lived objects in every turn, and none of them is alive when a full
// collection comes in between. What the run time has learned about their layouts (the Structure of each, the record of each allocation
// site, the plans of the copies between them, the answers in the property caches) is still good in the next turn, so none of it is made
// again: the counters do not grow with the number of turns.
const program = `
  declare const process: { argv: string[] };
  declare const console: { log(...values: any[]): void };
  declare const Bun: { gc(full: boolean): void };
  type Styles = {
    flexWrap?: string; flexDirection?: string; flexGrow?: number; flexShrink?: number; gap?: number; margin?: number; marginTop?: number; marginLeft?: number;
    paddingX?: number; paddingY?: number; width?: number | string; height?: number | string; minWidth?: number | string; borderStyle?: string; borderColor?: string;
    overflow?: string; justifyContent?: string; alignItems?: string; display?: string;
  };
  type Props = Styles & { children?: unknown; tabIndex?: number };
  type Element = { type: unknown; props: { tabIndex: number | undefined; style: Styles; children: unknown } };
  function Box({ children, flexWrap = "nowrap", flexDirection = "row", flexGrow = 0, flexShrink = 1, tabIndex, ...style }: Props): Element {
    return { type: "box", props: { tabIndex, style: { flexWrap, flexDirection, flexGrow, flexShrink, ...style }, children } };
  }
  let applied = 0;
  function apply(style: Styles): void {
    if ("flexGrow" in style) applied += style.flexGrow ?? 0;
    if ("flexDirection" in style) applied += style.flexDirection === "row" ? 1 : 0;
    if ("gap" in style) applied += style.gap ?? 0;
    if ("marginTop" in style) applied += style.marginTop ?? 0;
    if ("paddingX" in style) applied += style.paddingX ?? 0;
    if ("width" in style) applied += typeof style.width === "number" ? style.width : 1;
    if ("height" in style) applied += typeof style.height === "number" ? style.height : 1;
    if ("borderStyle" in style) applied += style.borderStyle ? 1 : 0;
    if ("display" in style) applied += style.display === "none" ? 1 : 0;
  }
  const render = (component: (props: any) => Element, props: unknown): Element => component(props);
  const sites: (() => Element)[] = [
    () => render(Box, { flexDirection: "column", children: 1 }),
    () => render(Box, { flexDirection: "column", marginTop: 1, children: 2 }),
    () => render(Box, { marginLeft: 2, children: 3 }),
    () => render(Box, { flexDirection: "row", gap: 1, children: 4 }),
    () => render(Box, { width: "100%", flexDirection: "column", children: 5 }),
    () => render(Box, { paddingX: 1, borderStyle: "round", borderColor: "red", children: 6 }),
    () => render(Box, { children: 7 }),
    () => render(Box, { height: 1, overflow: "hidden", children: 9 }),
    () => render(Box, { justifyContent: "space-between", width: 80, children: 10 }),
    () => render(Box, { flexShrink: 0, minWidth: 4, children: 11 }),
    () => render(Box, { alignItems: "center", flexDirection: "column", paddingY: 1, children: 12 }),
  ];
  const turns = Number(process.argv[2]);
  for (let turn = 0; turn < turns; turn++) {
    for (let i = 0; i < 4 * sites.length; i++) apply(sites[i % sites.length]!().props.style);
    Bun.gc(true);
  }
  console.log(typeof applied);
`;

const counters = [
  "counter:CompiledStructuresMade",
  "counter:AllocationSiteRecordsFilled",
  "counter:AssignmentPlansMade",
  "counter:FieldMovePlansMade",
  "counter:CopiesCollectedByName",
  "counter:SiteCacheRefills",
  "operation:operationAOTInByIdAndCache",
  "operation:operationAOTGetByIdAndCache",
  "operation:operationAOTPutByIdAndCache",
] as const;

let directory: ReturnType<typeof tempDir>;
let executable: string;

async function run(cmd: string[], env: Record<string, string | undefined>) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, String(directory), env);
  return { stdout, stderr, exitCode };
}

async function count(turns: number) {
  const path = join(String(directory), "counts" + turns);
  const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
  expect(await run([executable, String(turns)], env)).toEqual({ stdout: "number\n", stderr: "", exitCode: 0 });
  const counts = new Map(
    readFileSync(path, "utf8")
      .split("\n")
      .map(line => line.split("\t").reverse() as [string, string]),
  );
  return Object.fromEntries(counters.map(counter => [counter, Number(counts.get(counter) ?? 0)]));
}

beforeAll(async () => {
  directory = tempDir("aot-what-is-learned-outlasts-full-collections", { "main.ts": program });
  executable = join(String(directory), "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], bunEnv);
  expect(built.exitCode ? built.stderr : "built").toBe("built");
}, 240_000);

test("twenty more turns with a full collection after each make nothing again", async () => {
  const [few, many] = await Promise.all([count(10), count(30)]);
  expect(Object.fromEntries(counters.map(counter => [counter, many[counter]! - few[counter]!]))).toEqual(
    Object.fromEntries(counters.map(counter => [counter, 0])),
  );
}, 120_000);
