import { expectType } from "./utilities";

// -- Bun.FileIndex --

// Construction
new Bun.FileIndex(".");
new Bun.FileIndex("/some/root", {});
const index = new Bun.FileIndex(process.cwd(), {
  gitignore: true,
  ignore: ["dist/**", "*.log", "!important.log"],
  watch: true,
  maxMemory: 64 * 1024 * 1024,
  maxFileSize: 1024 * 1024,
  onchange: events => {
    expectType(events).is<Array<{ kind: "create" | "modify" | "delete"; path: string }>>();
  },
});

// @ts-expect-error root is required
new Bun.FileIndex();
// @ts-expect-error unknown option
new Bun.FileIndex(".", { followSymlinks: true });

// `using` support
{
  using disposable = new Bun.FileIndex(".");
  expectType(disposable).is<Bun.FileIndex>();
}

// Properties
expectType(index.ready).is<Promise<Bun.FileIndex>>();
expectType(index.root).is<string>();
expectType(index.size).is<number>();
expectType(index.memoryUsage).is<number>();
expectType(index.truncated).is<boolean>();
expectType(index.watching).is<boolean>();
// @ts-expect-error readonly
index.size = 1;

// complete()
expectType(index.complete("srvidx")).is<Array<{ path: string; score: number; positions: number[] }>>();
index.complete("q", { limit: 10, cwd: "src", directories: true });
// @ts-expect-error unknown option
index.complete("q", { caseSensitive: true });

// glob()
expectType(index.glob("**/*.ts")).is<string[]>();
index.glob("src/**", { limit: 5, cwd: "src" });

// has() / stat()
expectType(index.has("package.json")).is<boolean>();
const st = index.stat("src/index.ts");
expectType(st).is<{ size: number; mtimeMs: number; mode: number; kind: "file" | "dir" | "symlink" } | null>();
if (st) {
  expectType(st.kind).is<"file" | "dir" | "symlink">();
}

// grep()
expectType(index.grep("TODO")).is<
  AsyncIterable<{
    path: string;
    line: number;
    column: number;
    lineText: string;
    before?: string[];
    after?: string[];
  }>
>();
index.grep(/TODO/, { glob: "src/**", cwd: "src", limit: 100, maxFileSize: 4096, caseSensitive: false, context: 2 });
async () => {
  for await (const match of index.grep("needle")) {
    expectType(match.path).is<string>();
    expectType(match.line).is<number>();
    expectType(match.column).is<number>();
    expectType(match.lineText).is<string>();
    expectType(match.before).is<string[] | undefined>();
    expectType(match.after).is<string[] | undefined>();
  }
};

// gitStatus() / gitDiff()
expectType(index.gitStatus()).is<
  Promise<{
    branch: string | null;
    oid: string | null;
    detached: boolean;
    files: Array<{ path: string; status: string }>;
  } | null>
>();
expectType(index.gitDiff("src/index.ts")).is<
  Promise<{
    oldText: string | null;
    newText: string | null;
    hunks: Array<{
      oldStart: number;
      oldLines: number;
      newStart: number;
      newLines: number;
      lines: Array<{ kind: "context" | "add" | "del"; text: string }>;
    }>;
  } | null>
>();

// touch() / recent()
expectType(index.touch("src/index.ts")).is<void>();
expectType(index.recent()).is<string[]>();
expectType(index.recent(10)).is<string[]>();

// refresh() / onchange / close()
expectType(index.refresh()).is<Promise<Bun.FileIndex>>();
index.onchange = null;
index.onchange = events => {
  for (const event of events) {
    expectType(event.kind).is<"create" | "modify" | "delete">();
    expectType(event.path).is<string>();
  }
};
expectType(index.close()).is<void>();
index[Symbol.dispose]();

// Also exported from the "bun" module
import { FileIndex } from "bun";
expectType<typeof FileIndex>().is<typeof Bun.FileIndex>();
