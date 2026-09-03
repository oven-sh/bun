import { app, Table, VStack, Window } from "bun:appkit";
import { appKitInternals } from "bun:internal-for-testing";
import { emit, run, tick, waitFor } from "./_util";

await run(async () => {
  app.activationPolicy = "accessory";

  const selectEvents: number[][] = [];
  const table = new Table({
    columns: ["Name", { id: "size", title: "Size", width: 60 }],
    rows: [
      ["alpha", "1"],
      ["beta", "2"],
      ["gamma", "3"],
    ],
    onSelect: (indexes: number[]) => selectEvents.push(indexes),
  });
  const stack = new VStack();
  stack.append(table);
  const win = new Window({ width: 320, height: 240, content: stack });
  win.show();
  await tick();

  const png = table.snapshot();
  emit({
    step: "mounted",
    frame: table.frame,
    isPng: !!png && png[0] === 0x89 && png[1] === 0x50,
    selected: table.selectedIndexes,
    headerVisible: table.headerVisible,
  });

  // A single-selection table keeps the lowest wanted row; out-of-range rows are dropped.
  table.selectedIndexes = [2, 1, 99];
  const single = table.selectedIndexes;
  table.multiple = true;
  table.selectedIndexes = [2, 0, 99];
  const multi = table.selectedIndexes;
  table.multiple = false;
  emit({ step: "selection", single, multi, trimmed: table.selectedIndexes, selectEvents });

  // The wanted selection survives rows it does not fit and comes back when they grow.
  table.selectedIndexes = [4];
  const beforeGrow = table.selectedIndexes;
  table.rows = [["a"], ["b"], ["c"], ["d"], ["e"], ["f"]];
  const afterGrow = table.selectedIndexes;
  table.rows = [["x"], ["y"]];
  const afterShrink = table.selectedIndexes;
  emit({ step: "rows", beforeGrow, afterGrow, afterShrink, selectEvents });

  // Ragged and oversized rows: missing cells are empty, extra cells are ignored.
  table.rows = [["only name"], ["n", "s", "extra", "cells"], []];
  (table as { columns: unknown }).columns = null;
  table.columns = ["A", "B", "C"];
  await tick();
  emit({ step: "ragged", frame: table.frame, snapshot: table.snapshot() !== null });

  // Cells are only read as they are displayed, so a large table is cheap to assign.
  const many: string[][] = [];
  for (let i = 0; i < 20_000; i++) many.push([`row ${i}`, String(i), i % 2 ? "odd" : "even"]);
  table.rows = many;
  table.selectedIndexes = [19_999];
  emit({ step: "many rows", selected: table.selectedIndexes, snapshot: table.snapshot() !== null });

  stack.removeChild(table);
  win.close();

  Bun.gc(true);
  const baseline = appKitInternals.liveViews();
  (() => {
    for (let i = 0; i < 50; i++) new Table({ columns: ["c"], rows: [[`${i}`]] });
  })();
  let after = appKitInternals.liveViews();
  await waitFor(
    () => {
      Bun.gc(true);
      after = appKitInternals.liveViews();
      return after <= baseline + 5;
    },
    "tables to be collected",
    1500,
  ).catch(() => {});
  emit({ step: "collected", baseline, after });
});
