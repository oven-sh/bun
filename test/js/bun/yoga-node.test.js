import { describe, expect, test } from "bun:test";

const Yoga = Bun.Yoga;

describe("Yoga.Node", () => {
  test("Node constructor", () => {
    const node = new Yoga.Node();
    expect(node).toBeDefined();
    expect(node.constructor.name).toBe("Node");
  });

  test("Node.create() static method", () => {
    const node = Yoga.Node.create();
    expect(node).toBeDefined();
    expect(node.constructor.name).toBe("Node");
  });

  test("Node with config", () => {
    const config = new Yoga.Config();
    const node = new Yoga.Node(config);
    expect(node).toBeDefined();
  });

  test("setWidth with various values", () => {
    const node = new Yoga.Node();

    // Number
    expect(() => node.setWidth(100)).not.toThrow();

    // Percentage string
    expect(() => node.setWidth("50%")).not.toThrow();

    // Auto
    expect(() => node.setWidth("auto")).not.toThrow();

    // Object format
    expect(() => node.setWidth({ unit: Yoga.UNIT_POINT, value: 200 })).not.toThrow();
    expect(() => node.setWidth({ unit: Yoga.UNIT_PERCENT, value: 75 })).not.toThrow();

    // Undefined/null
    expect(() => node.setWidth(undefined)).not.toThrow();
    expect(() => node.setWidth(null)).not.toThrow();
  });

  test("getWidth returns correct format", () => {
    const node = new Yoga.Node();

    node.setWidth(100);
    let width = node.getWidth();
    expect(width).toEqual({ unit: Yoga.UNIT_POINT, value: 100 });

    node.setWidth("50%");
    width = node.getWidth();
    expect(width).toEqual({ unit: Yoga.UNIT_PERCENT, value: 50 });

    node.setWidth("auto");
    width = node.getWidth();
    expect(width).toEqual({ unit: Yoga.UNIT_AUTO, value: expect.any(Number) });
  });

  test("setMargin/getPadding edge values", () => {
    const node = new Yoga.Node();

    // Set margins
    node.setMargin(Yoga.EDGE_TOP, 10);
    node.setMargin(Yoga.EDGE_RIGHT, "20%");
    node.setMargin(Yoga.EDGE_BOTTOM, "auto");
    node.setMargin(Yoga.EDGE_LEFT, { unit: Yoga.UNIT_POINT, value: 30 });

    // Get margins
    expect(node.getMargin(Yoga.EDGE_TOP)).toEqual({ unit: Yoga.UNIT_POINT, value: 10 });
    expect(node.getMargin(Yoga.EDGE_RIGHT)).toEqual({ unit: Yoga.UNIT_PERCENT, value: 20 });
    expect(node.getMargin(Yoga.EDGE_BOTTOM)).toEqual({ unit: Yoga.UNIT_AUTO, value: expect.any(Number) });
    expect(node.getMargin(Yoga.EDGE_LEFT)).toEqual({ unit: Yoga.UNIT_POINT, value: 30 });
  });

  test("flexbox properties", () => {
    const node = new Yoga.Node();

    // Flex direction
    expect(() => node.setFlexDirection(Yoga.FLEX_DIRECTION_ROW)).not.toThrow();
    expect(() => node.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN)).not.toThrow();

    // Justify content
    expect(() => node.setJustifyContent(Yoga.JUSTIFY_CENTER)).not.toThrow();
    expect(() => node.setJustifyContent(Yoga.JUSTIFY_SPACE_BETWEEN)).not.toThrow();

    // Align items
    expect(() => node.setAlignItems(Yoga.ALIGN_CENTER)).not.toThrow();
    expect(() => node.setAlignItems(Yoga.ALIGN_FLEX_START)).not.toThrow();

    // Flex properties
    expect(() => node.setFlex(1)).not.toThrow();
    expect(() => node.setFlexGrow(2)).not.toThrow();
    expect(() => node.setFlexShrink(0.5)).not.toThrow();
    expect(() => node.setFlexBasis(100)).not.toThrow();
    expect(() => node.setFlexBasis("auto")).not.toThrow();
  });

  test("hierarchy operations", () => {
    const parent = new Yoga.Node();
    const child1 = new Yoga.Node();
    const child2 = new Yoga.Node();

    // Insert children
    parent.insertChild(child1, 0);
    parent.insertChild(child2, 1);

    expect(parent.getChildCount()).toBe(2);
    expect(parent.getChild(0)).toBe(child1);
    expect(parent.getChild(1)).toBe(child2);

    expect(child1.getParent()).toBe(parent);
    expect(child2.getParent()).toBe(parent);

    // Remove child
    parent.removeChild(child1);
    expect(parent.getChildCount()).toBe(1);
    expect(parent.getChild(0)).toBe(child2);
    expect(child1.getParent()).toBeNull();
  });

  test("layout calculation", () => {
    const root = new Yoga.Node();
    root.setWidth(500);
    root.setHeight(300);
    root.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);

    const child = new Yoga.Node();
    child.setFlex(1);
    root.insertChild(child, 0);

    // Calculate layout
    root.calculateLayout(500, 300, Yoga.DIRECTION_LTR);

    // Get computed layout
    const layout = root.getComputedLayout();
    expect(layout).toHaveProperty("left");
    expect(layout).toHaveProperty("top");
    expect(layout).toHaveProperty("width");
    expect(layout).toHaveProperty("height");
    expect(layout.width).toBe(500);
    expect(layout.height).toBe(300);

    const childLayout = child.getComputedLayout();
    expect(childLayout.width).toBe(500); // Should fill parent width
    expect(childLayout.height).toBe(300); // Should fill parent height
  });

  test("measure function", () => {
    const node = new Yoga.Node();
    let measureCalled = false;

    const measureFunc = (width, widthMode, height, heightMode) => {
      measureCalled = true;
      return { width: 100, height: 50 };
    };

    node.setMeasureFunc(measureFunc);
    node.markDirty();

    // Calculate layout - this should call measure function
    node.calculateLayout();
    expect(measureCalled).toBe(true);

    // Clear measure function
    node.setMeasureFunc(null);
  });

  test("dirtied callback", () => {
    const node = new Yoga.Node();
    let dirtiedCalled = false;

    const dirtiedFunc = () => {
      dirtiedCalled = true;
    };

    node.setDirtiedFunc(dirtiedFunc);
    
    // markDirty requires a measure function
    node.setMeasureFunc(() => ({ width: 100, height: 50 }));
    
    // Nodes start dirty, so clear the dirty flag first
    node.calculateLayout();
    expect(node.isDirty()).toBe(false);
    
    // Now mark dirty - this should trigger the callback
    node.markDirty();

    expect(dirtiedCalled).toBe(true);

    // Clear dirtied function
    node.setDirtiedFunc(null);
  });

  test("reset node", () => {
    const node = new Yoga.Node();
    node.setWidth(100);
    node.setHeight(200);
    node.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);

    node.reset();

    // After reset, width/height default to AUTO, not UNDEFINED
    const width = node.getWidth();
    expect(width.unit).toBe(Yoga.UNIT_AUTO);
  });

  test("dirty state", () => {
    const node = new Yoga.Node();

    // Nodes start as dirty by default in Yoga
    expect(node.isDirty()).toBe(true);

    // Calculate layout clears dirty flag
    node.calculateLayout();
    expect(node.isDirty()).toBe(false);

    // Mark as dirty (requires measure function)
    node.setMeasureFunc(() => ({ width: 100, height: 50 }));
    node.markDirty();
    expect(node.isDirty()).toBe(true);

    // Calculate layout clears dirty flag again
    node.calculateLayout();
    expect(node.isDirty()).toBe(false);
  });

  test("free node", () => {
    const node = new Yoga.Node();
    expect(() => node.free()).not.toThrow();
    // After free, the node should not crash but operations may not work
  });

  test("aspect ratio", () => {
    const node = new Yoga.Node();

    // Set aspect ratio
    expect(() => node.setAspectRatio(16 / 9)).not.toThrow();
    expect(() => node.setAspectRatio(undefined)).not.toThrow();
    expect(() => node.setAspectRatio(null)).not.toThrow();
  });

  test("display type", () => {
    const node = new Yoga.Node();

    expect(() => node.setDisplay(Yoga.DISPLAY_FLEX)).not.toThrow();
    expect(() => node.setDisplay(Yoga.DISPLAY_NONE)).not.toThrow();
  });

  test("overflow", () => {
    const node = new Yoga.Node();

    expect(() => node.setOverflow(Yoga.OVERFLOW_VISIBLE)).not.toThrow();
    expect(() => node.setOverflow(Yoga.OVERFLOW_HIDDEN)).not.toThrow();
    expect(() => node.setOverflow(Yoga.OVERFLOW_SCROLL)).not.toThrow();
  });

  test("position type", () => {
    const node = new Yoga.Node();

    expect(() => node.setPositionType(Yoga.POSITION_TYPE_RELATIVE)).not.toThrow();
    expect(() => node.setPositionType(Yoga.POSITION_TYPE_ABSOLUTE)).not.toThrow();
  });

  test("gap property", () => {
    const node = new Yoga.Node();

    expect(() => node.setGap(Yoga.GUTTER_ROW, 10)).not.toThrow();
    expect(() => node.setGap(Yoga.GUTTER_COLUMN, 20)).not.toThrow();
  });
});
