import { describe, expect, test } from "bun:test";

const Yoga = Bun.Yoga;

describe("Yoga - Comprehensive Layout Tests", () => {
  test("basic flexbox row layout with flex grow", () => {
    const container = new Yoga.Node();
    container.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    container.setWidth(300);
    container.setHeight(100);

    const child1 = new Yoga.Node();
    child1.setFlex(1);
    
    const child2 = new Yoga.Node();
    child2.setFlex(2);
    
    const child3 = new Yoga.Node();
    child3.setWidth(50); // Fixed width

    container.insertChild(child1, 0);
    container.insertChild(child2, 1);
    container.insertChild(child3, 2);

    container.calculateLayout();

    // Verify container layout
    const containerLayout = container.getComputedLayout();
    expect(containerLayout.width).toBe(300);
    expect(containerLayout.height).toBe(100);

    // Verify children layout
    // Available space: 300 - 50 (fixed width) = 250
    // child1 gets 1/3 of 250 = ~83.33
    // child2 gets 2/3 of 250 = ~166.67
    // child3 gets fixed 50
    const child1Layout = child1.getComputedLayout();
    const child2Layout = child2.getComputedLayout();
    const child3Layout = child3.getComputedLayout();

    expect(child1Layout.left).toBe(0);
    expect(child1Layout.width).toBe(83);
    expect(child1Layout.height).toBe(100);

    expect(child2Layout.left).toBe(83);
    expect(child2Layout.width).toBe(167);
    expect(child2Layout.height).toBe(100);

    expect(child3Layout.left).toBe(250);
    expect(child3Layout.width).toBe(50);
    expect(child3Layout.height).toBe(100);
  });

  test("column layout with justify content and align items", () => {
    const container = new Yoga.Node();
    container.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
    container.setJustifyContent(Yoga.JUSTIFY_SPACE_BETWEEN);
    container.setAlignItems(Yoga.ALIGN_CENTER);
    container.setWidth(200);
    container.setHeight(300);

    const child1 = new Yoga.Node();
    child1.setWidth(50);
    child1.setHeight(50);

    const child2 = new Yoga.Node();
    child2.setWidth(80);
    child2.setHeight(60);

    const child3 = new Yoga.Node();
    child3.setWidth(30);
    child3.setHeight(40);

    container.insertChild(child1, 0);
    container.insertChild(child2, 1);
    container.insertChild(child3, 2);

    container.calculateLayout();

    const child1Layout = child1.getComputedLayout();
    const child2Layout = child2.getComputedLayout();
    const child3Layout = child3.getComputedLayout();

    // Verify vertical spacing (JUSTIFY_SPACE_BETWEEN)
    // Total child height: 50 + 60 + 40 = 150
    // Available space: 300 - 150 = 150
    // Space between: 150 / 2 = 75
    expect(child1Layout.top).toBe(0);
    expect(child2Layout.top).toBe(125); // 50 + 75
    expect(child3Layout.top).toBe(260); // 50 + 75 + 60 + 75

    // Verify horizontal centering (ALIGN_CENTER)
    expect(child1Layout.left).toBe(75); // (200 - 50) / 2
    expect(child2Layout.left).toBe(60); // (200 - 80) / 2
    expect(child3Layout.left).toBe(85); // (200 - 30) / 2
  });

  test("nested flexbox layout", () => {
    const outerContainer = new Yoga.Node();
    outerContainer.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    outerContainer.setWidth(400);
    outerContainer.setHeight(200);

    const leftPanel = new Yoga.Node();
    leftPanel.setWidth(100);

    const rightPanel = new Yoga.Node();
    rightPanel.setFlex(1);
    rightPanel.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);

    const topSection = new Yoga.Node();
    topSection.setFlex(1);

    const bottomSection = new Yoga.Node();
    bottomSection.setHeight(50);

    outerContainer.insertChild(leftPanel, 0);
    outerContainer.insertChild(rightPanel, 1);
    rightPanel.insertChild(topSection, 0);
    rightPanel.insertChild(bottomSection, 1);

    outerContainer.calculateLayout();

    const leftLayout = leftPanel.getComputedLayout();
    const rightLayout = rightPanel.getComputedLayout();
    const topLayout = topSection.getComputedLayout();
    const bottomLayout = bottomSection.getComputedLayout();

    // Left panel
    expect(leftLayout.left).toBe(0);
    expect(leftLayout.width).toBe(100);
    expect(leftLayout.height).toBe(200);

    // Right panel
    expect(rightLayout.left).toBe(100);
    expect(rightLayout.width).toBe(300); // 400 - 100
    expect(rightLayout.height).toBe(200);

    // Top section of right panel
    expect(topLayout.left).toBe(0); // Relative to right panel
    expect(topLayout.top).toBe(0);
    expect(topLayout.width).toBe(300);
    expect(topLayout.height).toBe(150); // 200 - 50

    // Bottom section of right panel
    expect(bottomLayout.left).toBe(0);
    expect(bottomLayout.top).toBe(150);
    expect(bottomLayout.width).toBe(300);
    expect(bottomLayout.height).toBe(50);
  });

  test("flex wrap with multiple lines", () => {
    const container = new Yoga.Node();
    container.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    container.setFlexWrap(Yoga.WRAP_WRAP);
    container.setWidth(200);
    container.setHeight(200);

    // Create children that will overflow and wrap
    for (let i = 0; i < 5; i++) {
      const child = new Yoga.Node();
      child.setWidth(80);
      child.setHeight(50);
      container.insertChild(child, i);
    }

    container.calculateLayout();

    // First line: child 0, 1 (80 + 80 = 160, fits in 200)
    // Second line: child 2, 3 (80 + 80 = 160, fits in 200)
    // Third line: child 4 (80, fits in 200)

    const child0Layout = container.getChild(0).getComputedLayout();
    const child1Layout = container.getChild(1).getComputedLayout();
    const child2Layout = container.getChild(2).getComputedLayout();
    const child3Layout = container.getChild(3).getComputedLayout();
    const child4Layout = container.getChild(4).getComputedLayout();

    // First line
    expect(child0Layout.top).toBe(0);
    expect(child0Layout.left).toBe(0);
    expect(child1Layout.top).toBe(0);
    expect(child1Layout.left).toBe(80);

    // Second line
    expect(child2Layout.top).toBe(50);
    expect(child2Layout.left).toBe(0);
    expect(child3Layout.top).toBe(50);
    expect(child3Layout.left).toBe(80);

    // Third line
    expect(child4Layout.top).toBe(100);
    expect(child4Layout.left).toBe(0);
  });

  test("margin and padding calculations", () => {
    const container = new Yoga.Node();
    container.setPadding(Yoga.EDGE_ALL, 10);
    container.setWidth(200);
    container.setHeight(150);

    const child = new Yoga.Node();
    child.setMargin(Yoga.EDGE_ALL, 15);
    child.setFlex(1);

    container.insertChild(child, 0);
    container.calculateLayout();

    const containerLayout = container.getComputedLayout();
    const childLayout = child.getComputedLayout();

    // Container should maintain its size
    expect(containerLayout.width).toBe(200);
    expect(containerLayout.height).toBe(150);

    // Child should account for container padding and its own margin
    // Available width: 200 - (10+10 padding) - (15+15 margin) = 150
    // Available height: 150 - (10+10 padding) - (15+15 margin) = 100
    expect(childLayout.left).toBe(25); // container padding + child margin
    expect(childLayout.top).toBe(25);
    expect(childLayout.width).toBe(150);
    expect(childLayout.height).toBe(100);
  });

  test("percentage-based dimensions", () => {
    const container = new Yoga.Node();
    container.setWidth(400);
    container.setHeight(300);

    const child = new Yoga.Node();
    child.setWidth("50%"); // 50% of 400 = 200
    child.setHeight("75%"); // 75% of 300 = 225

    container.insertChild(child, 0);
    container.calculateLayout();

    const childLayout = child.getComputedLayout();
    expect(childLayout.width).toBe(200);
    expect(childLayout.height).toBe(225);
  });

  test("min/max constraints", () => {
    const container = new Yoga.Node();
    container.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    container.setWidth(500);
    container.setHeight(100);

    const child1 = new Yoga.Node();
    child1.setFlex(1);
    child1.setMinWidth(100);
    child1.setMaxWidth(200);

    const child2 = new Yoga.Node();
    child2.setFlex(2);

    container.insertChild(child1, 0);
    container.insertChild(child2, 1);
    container.calculateLayout();

    const child1Layout = child1.getComputedLayout();
    const child2Layout = child2.getComputedLayout();

    // child1 would normally get 1/3 of 500 = ~166.67
    // But it's clamped by maxWidth(200), so it gets 200
    expect(child1Layout.width).toBe(200);
    
    // child2 gets the remaining space: 500 - 200 = 300
    expect(child2Layout.width).toBe(300);
  });

  test("absolute positioning", () => {
    const container = new Yoga.Node();
    container.setWidth(300);
    container.setHeight(200);

    const normalChild = new Yoga.Node();
    normalChild.setWidth(100);
    normalChild.setHeight(50);

    const absoluteChild = new Yoga.Node();
    absoluteChild.setPositionType(Yoga.POSITION_TYPE_ABSOLUTE);
    absoluteChild.setPosition(Yoga.EDGE_TOP, 20);
    absoluteChild.setPosition(Yoga.EDGE_LEFT, 50);
    absoluteChild.setWidth(80);
    absoluteChild.setHeight(60);

    container.insertChild(normalChild, 0);
    container.insertChild(absoluteChild, 1);
    container.calculateLayout();

    const normalLayout = normalChild.getComputedLayout();
    const absoluteLayout = absoluteChild.getComputedLayout();

    // Normal child positioned normally
    expect(normalLayout.left).toBe(0);
    expect(normalLayout.top).toBe(0);

    // Absolute child positioned absolutely
    expect(absoluteLayout.left).toBe(50);
    expect(absoluteLayout.top).toBe(20);
    expect(absoluteLayout.width).toBe(80);
    expect(absoluteLayout.height).toBe(60);
  });
});