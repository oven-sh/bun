import { describe, test, expect } from "bun:test";

// Test if we can access Yoga via globalThis (once it's exposed)
const Yoga = globalThis.Yoga;

describe("Yoga Constants", () => {
  test("should export all alignment constants", () => {
    expect(Yoga.ALIGN_AUTO).toBeDefined();
    expect(Yoga.ALIGN_FLEX_START).toBeDefined();
    expect(Yoga.ALIGN_CENTER).toBeDefined();
    expect(Yoga.ALIGN_FLEX_END).toBeDefined();
    expect(Yoga.ALIGN_STRETCH).toBeDefined();
    expect(Yoga.ALIGN_BASELINE).toBeDefined();
    expect(Yoga.ALIGN_SPACE_BETWEEN).toBeDefined();
    expect(Yoga.ALIGN_SPACE_AROUND).toBeDefined();
    expect(Yoga.ALIGN_SPACE_EVENLY).toBeDefined();
  });

  test("should export all direction constants", () => {
    expect(Yoga.DIRECTION_INHERIT).toBeDefined();
    expect(Yoga.DIRECTION_LTR).toBeDefined();
    expect(Yoga.DIRECTION_RTL).toBeDefined();
  });

  test("should export all display constants", () => {
    expect(Yoga.DISPLAY_FLEX).toBeDefined();
    expect(Yoga.DISPLAY_NONE).toBeDefined();
  });

  test("should export all edge constants", () => {
    expect(Yoga.EDGE_LEFT).toBeDefined();
    expect(Yoga.EDGE_TOP).toBeDefined();
    expect(Yoga.EDGE_RIGHT).toBeDefined();
    expect(Yoga.EDGE_BOTTOM).toBeDefined();
    expect(Yoga.EDGE_START).toBeDefined();
    expect(Yoga.EDGE_END).toBeDefined();
    expect(Yoga.EDGE_HORIZONTAL).toBeDefined();
    expect(Yoga.EDGE_VERTICAL).toBeDefined();
    expect(Yoga.EDGE_ALL).toBeDefined();
  });

  test("should export all experimental feature constants", () => {
    expect(Yoga.EXPERIMENTAL_FEATURE_WEB_FLEX_BASIS).toBeDefined();
    expect(Yoga.EXPERIMENTAL_FEATURE_ABSOLUTE_PERCENTAGE_AGAINST_PADDING_EDGE).toBeDefined();
    expect(Yoga.EXPERIMENTAL_FEATURE_FIX_ABSOLUTE_TRAILING_COLUMN_MARGIN).toBeDefined();
  });

  test("should export all flex direction constants", () => {
    expect(Yoga.FLEX_DIRECTION_COLUMN).toBeDefined();
    expect(Yoga.FLEX_DIRECTION_COLUMN_REVERSE).toBeDefined();
    expect(Yoga.FLEX_DIRECTION_ROW).toBeDefined();
    expect(Yoga.FLEX_DIRECTION_ROW_REVERSE).toBeDefined();
  });

  test("should export all gutter constants", () => {
    expect(Yoga.GUTTER_COLUMN).toBeDefined();
    expect(Yoga.GUTTER_ROW).toBeDefined();
    expect(Yoga.GUTTER_ALL).toBeDefined();
  });

  test("should export all justify constants", () => {
    expect(Yoga.JUSTIFY_FLEX_START).toBeDefined();
    expect(Yoga.JUSTIFY_CENTER).toBeDefined();
    expect(Yoga.JUSTIFY_FLEX_END).toBeDefined();
    expect(Yoga.JUSTIFY_SPACE_BETWEEN).toBeDefined();
    expect(Yoga.JUSTIFY_SPACE_AROUND).toBeDefined();
    expect(Yoga.JUSTIFY_SPACE_EVENLY).toBeDefined();
  });

  test("should export all measure mode constants", () => {
    expect(Yoga.MEASURE_MODE_UNDEFINED).toBeDefined();
    expect(Yoga.MEASURE_MODE_EXACTLY).toBeDefined();
    expect(Yoga.MEASURE_MODE_AT_MOST).toBeDefined();
  });

  test("should export all node type constants", () => {
    expect(Yoga.NODE_TYPE_DEFAULT).toBeDefined();
    expect(Yoga.NODE_TYPE_TEXT).toBeDefined();
  });

  test("should export all overflow constants", () => {
    expect(Yoga.OVERFLOW_VISIBLE).toBeDefined();
    expect(Yoga.OVERFLOW_HIDDEN).toBeDefined();
    expect(Yoga.OVERFLOW_SCROLL).toBeDefined();
  });

  test("should export all position type constants", () => {
    expect(Yoga.POSITION_TYPE_STATIC).toBeDefined();
    expect(Yoga.POSITION_TYPE_RELATIVE).toBeDefined();
    expect(Yoga.POSITION_TYPE_ABSOLUTE).toBeDefined();
  });

  test("should export all unit constants", () => {
    expect(Yoga.UNIT_UNDEFINED).toBeDefined();
    expect(Yoga.UNIT_POINT).toBeDefined();
    expect(Yoga.UNIT_PERCENT).toBeDefined();
    expect(Yoga.UNIT_AUTO).toBeDefined();
  });

  test("should export all wrap constants", () => {
    expect(Yoga.WRAP_NO_WRAP).toBeDefined();
    expect(Yoga.WRAP_WRAP).toBeDefined();
    expect(Yoga.WRAP_WRAP_REVERSE).toBeDefined();
  });

  test("should export all errata constants", () => {
    expect(Yoga.ERRATA_NONE).toBeDefined();
    expect(Yoga.ERRATA_STRETCH_FLEX_BASIS).toBeDefined();
    expect(Yoga.ERRATA_ABSOLUTE_POSITIONING_INCORRECT).toBeDefined();
    expect(Yoga.ERRATA_ABSOLUTE_PERCENT_AGAINST_INNER_SIZE).toBeDefined();
    expect(Yoga.ERRATA_ALL).toBeDefined();
    expect(Yoga.ERRATA_CLASSIC).toBeDefined();
  });

  test("constants should have correct numeric values", () => {
    // Check a few key constants have reasonable values
    expect(typeof Yoga.EDGE_TOP).toBe("number");
    expect(typeof Yoga.UNIT_PERCENT).toBe("number");
    expect(typeof Yoga.FLEX_DIRECTION_ROW).toBe("number");
  });
});