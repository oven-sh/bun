import { expect, it } from "bun:test";
import empty_csv, {
  columns as empty_csv_columns,
  data as empty_csv_data,
  rows as empty_csv_rows,
} from "./test_files/empty.csv";
import empty_tsv, {
  columns as empty_tsv_columns,
  data as empty_tsv_data,
  rows as empty_tsv_rows,
} from "./test_files/empty.tsv";

function checkWithHeader(table, delimiter = ",") {
  expect(table.length).toBe(3);
  expect(table[0]["col 1"]).toBe("hello");
  expect(table[0]["col 2"]).toBe("world");
  expect(table[1]["col 1"]).toBe("foo");
  expect(table[1]["col 2"]).toBe("bar");
  expect(table[2]["col 1"]).toBe(`problem${delimiter} huh?`);
  expect(table[2]["col 2"]).toBe(
    `what's up

with the 
multiline
strings

?`,
  );
}

function checkWithoutHeader(table, delimiter = ",") {
  expect(table.length).toBe(4);
  expect(table[0][0]).toBe("col 1");
  expect(table[0][1]).toBe("col 2");
  expect(table[1][0]).toBe("hello");
  expect(table[1][1]).toBe("world");
  expect(table[2][0]).toBe("foo");
  expect(table[2][1]).toBe("bar");
  expect(table[3][0]).toBe(`problem${delimiter} huh?`);
  expect(table[3][1]).toBe(
    `what's up

with the 
multiline
strings

?`,
  );
}

// MARK: - CSV
it("csv via dynamic import", async () => {
  const result = (await import("./test_files/base.csv")).default;
  checkWithHeader(result);
});

it("csv via dynamic import with type attribute", async () => {
  const result = (await import("./test_files/base.csv", { with: { type: "csv" } })).default;
  checkWithHeader(result);
});

it("csv via dynamic import with query parameter", async () => {
  const { default: table, data, rows, columns, errors, comments } = await import("./test_files/base.csv?header=false");
  checkWithHeader(table);
  checkWithHeader(data);
  expect(rows).toBe(3);
  expect(columns).toBe(2);
  expect(errors).toBeUndefined();
  expect(comments).toBeUndefined();
});

it("csv empty via import statement", () => {
  expect(empty_csv).toEqual([]);
  expect(empty_csv_data).toEqual([]);
  expect(empty_csv_rows).toBe(0);
  expect(empty_csv_columns).toBe(0);
});

it("csv named imports", async () => {
  const { data, rows, columns, errors, comments } = await import("./test_files/base.csv");
  checkWithHeader(data);
  expect(rows).toBe(3);
  expect(columns).toBe(2);
  expect(errors).toBeUndefined();
  expect(comments).toBeUndefined();
});

it("csv_no_header via dynamic import with type attribute", async () => {
  const result = (await import("./test_files/base_no_header.csv", { with: { type: "csv_no_header" } })).default;
  checkWithoutHeader(result);
});

it("csv_no_header via dynamic import with query parameter", async () => {
  const {
    default: table,
    data,
    rows,
    columns,
    errors,
    comments,
  } = await import("./test_files/base_no_header.csv?header=false", { with: { type: "csv_no_header" } });
  checkWithoutHeader(table);
  checkWithoutHeader(data);
  expect(rows).toBe(4);
  expect(columns).toBe(2);
  expect(errors).toBeUndefined();
  expect(comments).toBeUndefined();
});

// MARK: - TSV
it("tsv via dynamic import", async () => {
  const result = (await import("./test_files/base.tsv")).default;
  checkWithHeader(result, "\t");
});

it("tsv via dynamic import with type attribute", async () => {
  const result = (await import("./test_files/base.tsv", { with: { type: "tsv" } })).default;
  checkWithHeader(result, "\t");
});

it("tsv via dynamic import with query parameter", async () => {
  const { default: table, data, rows, columns, errors, comments } = await import("./test_files/base.tsv?header=false");
  checkWithHeader(table, "\t");
  checkWithHeader(data, "\t");
  expect(rows).toBe(3);
  expect(columns).toBe(2);
  expect(errors).toBeUndefined();
  expect(comments).toBeUndefined();
});

it("tsv empty via import statement", () => {
  expect(empty_tsv).toEqual([]);
  expect(empty_tsv_data).toEqual([]);
  expect(empty_tsv_rows).toBe(0);
  expect(empty_tsv_columns).toBe(0);
});

it("tsv named imports", async () => {
  const { data, rows, columns, errors, comments } = await import("./test_files/base.tsv");
  checkWithHeader(data, "\t");
  expect(rows).toBe(3);
  expect(columns).toBe(2);
  expect(errors).toBeUndefined();
  expect(comments).toBeUndefined();
});

// MARK: - TSV no header
it("tsv_no_header via dynamic import", async () => {
  const result = (await import("./test_files/base_no_header.tsv", { with: { type: "tsv_no_header" } })).default;
  checkWithoutHeader(result, "\t");
});

it("tsv_no_header via dynamic import with type attribute", async () => {
  const result = (await import("./test_files/base_no_header.tsv", { with: { type: "tsv_no_header" } })).default;
  checkWithoutHeader(result, "\t");
});

it("tsv_no_header via dynamic import with query parameter", async () => {
  const {
    default: table,
    data,
    rows,
    columns,
    errors,
    comments,
  } = await import("./test_files/base_no_header.tsv?header=false", { with: { type: "tsv_no_header" } });
  checkWithoutHeader(table, "\t");
  checkWithoutHeader(data, "\t");
  expect(rows).toBe(4);
  expect(columns).toBe(2);
  expect(errors).toBeUndefined();
  expect(comments).toBeUndefined();
});
