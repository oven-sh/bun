import { test, expect } from "bun:test";

test("Yoga global exists", () => {
  expect(globalThis.Yoga).toBeDefined();
  expect(typeof globalThis.Yoga).toBe("object");
});

test("Yoga.Config exists and can be constructed", () => {
  expect(Yoga.Config).toBeDefined();
  expect(typeof Yoga.Config).toBe("function");
  
  const config = new Yoga.Config();
  expect(config).toBeDefined();
  expect(config.constructor.name).toBe("Config");
  
  // Test basic Config methods
  expect(typeof config.setUseWebDefaults).toBe("function");
  expect(typeof config.useWebDefaults).toBe("function");
  expect(typeof config.setPointScaleFactor).toBe("function");
  expect(typeof config.isExperimentalFeatureEnabled).toBe("function");
  expect(typeof config.setExperimentalFeatureEnabled).toBe("function");
});

test("Yoga.Config.setUseWebDefaults/useWebDefaults", () => {
  const config = new Yoga.Config();
  
  // Default should be false
  expect(config.useWebDefaults()).toBe(false);
  
  // Set to true
  config.setUseWebDefaults(true);
  expect(config.useWebDefaults()).toBe(true);
  
  // Set back to false
  config.setUseWebDefaults(false);
  expect(config.useWebDefaults()).toBe(false);
});

test("Yoga.Config.setPointScaleFactor", () => {
  const config = new Yoga.Config();
  
  // Should not throw
  expect(() => config.setPointScaleFactor(2.0)).not.toThrow();
  expect(() => config.setPointScaleFactor(1.5)).not.toThrow();
  expect(() => config.setPointScaleFactor(1.0)).not.toThrow();
});

test("Yoga.Node exists and can be constructed", () => {
  expect(Yoga.Node).toBeDefined();
  expect(typeof Yoga.Node).toBe("function");
  
  const node = new Yoga.Node();
  expect(node).toBeDefined();
  expect(node.constructor.name).toBe("Node");
  
  // Test that basic methods exist
  expect(typeof node.calculateLayout).toBe("function");
  expect(typeof node.getComputedLayout).toBe("function");
  expect(typeof node.insertChild).toBe("function");
  expect(typeof node.removeChild).toBe("function");
  expect(typeof node.getChild).toBe("function");
  expect(typeof node.getChildCount).toBe("function");
  expect(typeof node.getParent).toBe("function");
  expect(typeof node.markDirty).toBe("function");
  expect(typeof node.isDirty).toBe("function");
  expect(typeof node.reset).toBe("function");
  expect(typeof node.copyStyle).toBe("function");
  expect(typeof node.free).toBe("function");
  expect(typeof node.freeRecursive).toBe("function");
});

test("Yoga.Node can be constructed with Config", () => {
  const config = new Yoga.Config();
  const node = new Yoga.Node(config);
  expect(node).toBeDefined();
  expect(node.constructor.name).toBe("Node");
});

test("Yoga.Node hierarchy operations", () => {
  const parent = new Yoga.Node();
  const child1 = new Yoga.Node();
  const child2 = new Yoga.Node();
  
  // Initially no children
  expect(parent.getChildCount()).toBe(0);
  expect(parent.getChild(0)).toBeNull();
  
  // Insert first child
  parent.insertChild(child1, 0);
  expect(parent.getChildCount()).toBe(1);
  expect(parent.getChild(0)).toBe(child1);
  expect(child1.getParent()).toBe(parent);
  
  // Insert second child
  parent.insertChild(child2, 1);
  expect(parent.getChildCount()).toBe(2);
  expect(parent.getChild(1)).toBe(child2);
  expect(child2.getParent()).toBe(parent);
  
  // Remove first child
  parent.removeChild(child1);
  expect(parent.getChildCount()).toBe(1);
  expect(parent.getChild(0)).toBe(child2);
  expect(child1.getParent()).toBeNull();
});

test("Yoga.Node calculateLayout and getComputedLayout", () => {
  const node = new Yoga.Node();
  
  // Should have default layout values
  const layout = node.getComputedLayout();
  expect(layout).toBeDefined();
  expect(typeof layout.left).toBe("number");
  expect(typeof layout.top).toBe("number");
  expect(typeof layout.width).toBe("number");
  expect(typeof layout.height).toBe("number");
  
  // Calculate layout
  node.calculateLayout(100, 100);
  const newLayout = node.getComputedLayout();
  expect(newLayout).toBeDefined();
  // After calculation, width and height should reflect the constraints
  expect(newLayout.width).toBe(100);
  expect(newLayout.height).toBe(100);
});

test("Yoga.Node dirty state", () => {
  const node = new Yoga.Node();
  
  // New nodes start dirty
  expect(node.isDirty()).toBe(true);
  
  // After calculating layout, should not be dirty
  node.calculateLayout();
  expect(node.isDirty()).toBe(false);
  
  // Can mark as dirty again
  node.markDirty();
  expect(node.isDirty()).toBe(true);
});

test("Yoga.Node reset", () => {
  const parent = new Yoga.Node();
  const child = new Yoga.Node();
  
  parent.insertChild(child, 0);
  expect(parent.getChildCount()).toBe(1);
  
  // Reset should clear all style properties but not children
  parent.reset();
  expect(parent.getChildCount()).toBe(1);
});

test("Yoga.Node copyStyle", () => {
  const source = new Yoga.Node();
  const target = new Yoga.Node();
  
  // Should not throw
  expect(() => target.copyStyle(source)).not.toThrow();
});