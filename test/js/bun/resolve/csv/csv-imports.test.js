import { expect, it } from "bun:test";
import empty_csv from "./test_files/empty.csv";
import empty_tsv from "./test_files/empty.tsv";

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
  const table = (await import("./test_files/base.csv")).default;
  checkWithHeader(table);
});

it("csv via dynamic import with type attribute", async () => {
  const table = (await import("./test_files/base.csv", { with: { type: "csv" } })).default;
  checkWithHeader(table);
});

it("csv empty via import statement", () => {
  expect(empty_csv).toEqual([]);
});

// MARK: - CSV no header
it("csv_no_header via dynamic import", async () => {
  const table = (await import("./test_files/base_no_header.csv", { with: { type: "csv_no_header" } })).default;
  checkWithoutHeader(table);
});

it("csv_no_header via dynamic import with type attribute", async () => {
  const table = (await import("./test_files/base_no_header.csv", { with: { type: "csv_no_header" } })).default;
  checkWithoutHeader(table);
});

// MARK: - TSV
it("tsv via dynamic import", async () => {
  const table = (await import("./test_files/base.tsv")).default;
  checkWithHeader(table, "\t");
});

it("tsv via dynamic import with type attribute", async () => {
  const table = (await import("./test_files/base.tsv", { with: { type: "tsv" } })).default;
  checkWithHeader(table, "\t");
});

it("tsv empty via import statement", () => {
  expect(empty_tsv).toEqual([]);
});

// MARK: - TSV no header
it("tsv_no_header via dynamic import", async () => {
  const table = (await import("./test_files/base_no_header.tsv", { with: { type: "tsv_no_header" } })).default;
  checkWithoutHeader(table, "\t");
});

it("tsv_no_header via dynamic import with type attribute", async () => {
  const table = (await import("./test_files/base_no_header.tsv", { with: { type: "tsv_no_header" } })).default;
  checkWithoutHeader(table, "\t");
});
