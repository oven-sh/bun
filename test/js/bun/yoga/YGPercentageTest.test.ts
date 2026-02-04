import { expect, test } from "bun:test";
const Yoga = Bun.Yoga;

const Align = {
  Center: Yoga.ALIGN_CENTER,
  FlexEnd: Yoga.ALIGN_FLEX_END,
  FlexStart: Yoga.ALIGN_FLEX_START,
  Stretch: Yoga.ALIGN_STRETCH,
  Baseline: Yoga.ALIGN_BASELINE,
  SpaceBetween: Yoga.ALIGN_SPACE_BETWEEN,
  SpaceAround: Yoga.ALIGN_SPACE_AROUND,
  SpaceEvenly: Yoga.ALIGN_SPACE_EVENLY,
  Auto: Yoga.ALIGN_AUTO,
};

const BoxSizing = {
  BorderBox: Yoga.BOX_SIZING_BORDER_BOX,
  ContentBox: Yoga.BOX_SIZING_CONTENT_BOX,
};

const Direction = {
  LTR: Yoga.DIRECTION_LTR,
  RTL: Yoga.DIRECTION_RTL,
  Inherit: Yoga.DIRECTION_INHERIT,
};

const Display = {
  Flex: Yoga.DISPLAY_FLEX,
  None: Yoga.DISPLAY_NONE,
  Contents: Yoga.DISPLAY_CONTENTS,
};

const Edge = {
  Left: Yoga.EDGE_LEFT,
  Top: Yoga.EDGE_TOP,
  Right: Yoga.EDGE_RIGHT,
  Bottom: Yoga.EDGE_BOTTOM,
  Start: Yoga.EDGE_START,
  End: Yoga.EDGE_END,
  Horizontal: Yoga.EDGE_HORIZONTAL,
  Vertical: Yoga.EDGE_VERTICAL,
  All: Yoga.EDGE_ALL,
};

const FlexDirection = {
  Column: Yoga.FLEX_DIRECTION_COLUMN,
  ColumnReverse: Yoga.FLEX_DIRECTION_COLUMN_REVERSE,
  Row: Yoga.FLEX_DIRECTION_ROW,
  RowReverse: Yoga.FLEX_DIRECTION_ROW_REVERSE,
};

const Justify = {
  FlexStart: Yoga.JUSTIFY_FLEX_START,
  Center: Yoga.JUSTIFY_CENTER,
  FlexEnd: Yoga.JUSTIFY_FLEX_END,
  SpaceBetween: Yoga.JUSTIFY_SPACE_BETWEEN,
  SpaceAround: Yoga.JUSTIFY_SPACE_AROUND,
  SpaceEvenly: Yoga.JUSTIFY_SPACE_EVENLY,
};

const MeasureMode = {
  Undefined: Yoga.MEASURE_MODE_UNDEFINED,
  Exactly: Yoga.MEASURE_MODE_EXACTLY,
  AtMost: Yoga.MEASURE_MODE_AT_MOST,
};

const Overflow = {
  Visible: Yoga.OVERFLOW_VISIBLE,
  Hidden: Yoga.OVERFLOW_HIDDEN,
  Scroll: Yoga.OVERFLOW_SCROLL,
};

const PositionType = {
  Static: Yoga.POSITION_TYPE_STATIC,
  Relative: Yoga.POSITION_TYPE_RELATIVE,
  Absolute: Yoga.POSITION_TYPE_ABSOLUTE,
};

const Unit = {
  Undefined: Yoga.UNIT_UNDEFINED,
  Point: Yoga.UNIT_POINT,
  Percent: Yoga.UNIT_PERCENT,
  Auto: Yoga.UNIT_AUTO,
};

const Wrap = {
  NoWrap: Yoga.WRAP_NO_WRAP,
  Wrap: Yoga.WRAP_WRAP,
  WrapReverse: Yoga.WRAP_WRAP_REVERSE,
};

test("percentage_width_height", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(200);
    root.setHeight(200);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth("30%");
    root_child0.setHeight("30%");
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(60);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(140);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(60);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percentage_position_left_top", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(400);
    root.setHeight(400);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPosition(Edge.Left, "10%");
    root_child0.setPosition(Edge.Top, "20%");
    root_child0.setWidth("45%");
    root_child0.setHeight("55%");
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(40);
    expect(root_child0.getComputedTop()).toBe(80);
    expect(root_child0.getComputedWidth()).toBe(180);
    expect(root_child0.getComputedHeight()).toBe(220);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(260);
    expect(root_child0.getComputedTop()).toBe(80);
    expect(root_child0.getComputedWidth()).toBe(180);
    expect(root_child0.getComputedHeight()).toBe(220);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percentage_position_bottom_right", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(500);
    root.setHeight(500);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPosition(Edge.Right, "20%");
    root_child0.setPosition(Edge.Bottom, "10%");
    root_child0.setWidth("55%");
    root_child0.setHeight("15%");
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(500);

    expect(root_child0.getComputedLeft()).toBe(-100);
    expect(root_child0.getComputedTop()).toBe(-50);
    expect(root_child0.getComputedWidth()).toBe(275);
    expect(root_child0.getComputedHeight()).toBe(75);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(500);

    expect(root_child0.getComputedLeft()).toBe(125);
    expect(root_child0.getComputedTop()).toBe(-50);
    expect(root_child0.getComputedWidth()).toBe(275);
    expect(root_child0.getComputedHeight()).toBe(75);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percentage_flex_basis", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(200);
    root.setHeight(200);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setFlexBasis("50%");
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root_child1.setFlexBasis("25%");
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(125);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child1.getComputedLeft()).toBe(125);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(75);
    expect(root_child1.getComputedHeight()).toBe(200);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(75);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(125);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(75);
    expect(root_child1.getComputedHeight()).toBe(200);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percentage_flex_basis_cross", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(200);
    root.setHeight(200);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setFlexBasis("50%");
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root_child1.setFlexBasis("25%");
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(125);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(125);
    expect(root_child1.getComputedWidth()).toBe(200);
    expect(root_child1.getComputedHeight()).toBe(75);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(125);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(125);
    expect(root_child1.getComputedWidth()).toBe(200);
    expect(root_child1.getComputedHeight()).toBe(75);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test.skip("percentage_flex_basis_cross_min_height", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(200);
    root.setHeight(200);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setMinHeight("60%");
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(2);
    root_child1.setMinHeight("10%");
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(120);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(120);
    expect(root_child1.getComputedWidth()).toBe(200);
    expect(root_child1.getComputedHeight()).toBe(80);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(120);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(120);
    expect(root_child1.getComputedWidth()).toBe(200);
    expect(root_child1.getComputedHeight()).toBe(80);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percentage_flex_basis_main_max_height", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(200);
    root.setHeight(200);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setFlexBasis("10%");
    root_child0.setMaxHeight("60%");
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(4);
    root_child1.setFlexBasis("10%");
    root_child1.setMaxHeight("20%");
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(52);
    expect(root_child0.getComputedHeight()).toBe(120);

    expect(root_child1.getComputedLeft()).toBe(52);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(148);
    expect(root_child1.getComputedHeight()).toBe(40);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(148);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(52);
    expect(root_child0.getComputedHeight()).toBe(120);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(148);
    expect(root_child1.getComputedHeight()).toBe(40);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percentage_flex_basis_cross_max_height", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(200);
    root.setHeight(200);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setFlexBasis("10%");
    root_child0.setMaxHeight("60%");
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(4);
    root_child1.setFlexBasis("10%");
    root_child1.setMaxHeight("20%");
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(120);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(120);
    expect(root_child1.getComputedWidth()).toBe(200);
    expect(root_child1.getComputedHeight()).toBe(40);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(120);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(120);
    expect(root_child1.getComputedWidth()).toBe(200);
    expect(root_child1.getComputedHeight()).toBe(40);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percentage_flex_basis_main_max_width", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(200);
    root.setHeight(200);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setFlexBasis("15%");
    root_child0.setMaxWidth("60%");
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(4);
    root_child1.setFlexBasis("10%");
    root_child1.setMaxWidth("20%");
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(120);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child1.getComputedLeft()).toBe(120);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(200);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(120);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(200);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percentage_flex_basis_cross_max_width", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(200);
    root.setHeight(200);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setFlexBasis("10%");
    root_child0.setMaxWidth("60%");
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(4);
    root_child1.setFlexBasis("15%");
    root_child1.setMaxWidth("20%");
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(120);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(50);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(150);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(120);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(160);
    expect(root_child1.getComputedTop()).toBe(50);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(150);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percentage_flex_basis_main_min_width", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(200);
    root.setHeight(200);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setFlexBasis("15%");
    root_child0.setMinWidth("60%");
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(4);
    root_child1.setFlexBasis("10%");
    root_child1.setMinWidth("20%");
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(120);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child1.getComputedLeft()).toBe(120);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(80);
    expect(root_child1.getComputedHeight()).toBe(200);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(120);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(80);
    expect(root_child1.getComputedHeight()).toBe(200);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percentage_flex_basis_cross_min_width", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(200);
    root.setHeight(200);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setFlexBasis("10%");
    root_child0.setMinWidth("60%");
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(4);
    root_child1.setFlexBasis("15%");
    root_child1.setMinWidth("20%");
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(50);
    expect(root_child1.getComputedWidth()).toBe(200);
    expect(root_child1.getComputedHeight()).toBe(150);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(50);
    expect(root_child1.getComputedWidth()).toBe(200);
    expect(root_child1.getComputedHeight()).toBe(150);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percentage_multiple_nested_with_padding_margin_and_percentage_values", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(200);
    root.setHeight(200);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setFlexBasis("10%");
    root_child0.setMargin(Edge.Left, 5);
    root_child0.setMargin(Edge.Top, 5);
    root_child0.setMargin(Edge.Right, 5);
    root_child0.setMargin(Edge.Bottom, 5);
    root_child0.setPadding(Edge.Left, 3);
    root_child0.setPadding(Edge.Top, 3);
    root_child0.setPadding(Edge.Right, 3);
    root_child0.setPadding(Edge.Bottom, 3);
    root_child0.setMinWidth("60%");
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setMargin(Edge.Left, 5);
    root_child0_child0.setMargin(Edge.Top, 5);
    root_child0_child0.setMargin(Edge.Right, 5);
    root_child0_child0.setMargin(Edge.Bottom, 5);
    root_child0_child0.setPadding(Edge.Left, "3%");
    root_child0_child0.setPadding(Edge.Top, "3%");
    root_child0_child0.setPadding(Edge.Right, "3%");
    root_child0_child0.setPadding(Edge.Bottom, "3%");
    root_child0_child0.setWidth("50%");
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setMargin(Edge.Left, "5%");
    root_child0_child0_child0.setMargin(Edge.Top, "5%");
    root_child0_child0_child0.setMargin(Edge.Right, "5%");
    root_child0_child0_child0.setMargin(Edge.Bottom, "5%");
    root_child0_child0_child0.setPadding(Edge.Left, 3);
    root_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0.setPadding(Edge.Right, 3);
    root_child0_child0_child0.setPadding(Edge.Bottom, 3);
    root_child0_child0_child0.setWidth("45%");
    root_child0_child0.insertChild(root_child0_child0_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(4);
    root_child1.setFlexBasis("15%");
    root_child1.setMinWidth("20%");
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(5);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(190);
    expect(root_child0.getComputedHeight()).toBe(48);

    expect(root_child0_child0.getComputedLeft()).toBe(8);
    expect(root_child0_child0.getComputedTop()).toBe(8);
    expect(root_child0_child0.getComputedWidth()).toBe(92);
    expect(root_child0_child0.getComputedHeight()).toBe(25);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(10);
    expect(root_child0_child0_child0.getComputedTop()).toBe(10);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(36);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(6);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(58);
    expect(root_child1.getComputedWidth()).toBe(200);
    expect(root_child1.getComputedHeight()).toBe(142);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(5);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(190);
    expect(root_child0.getComputedHeight()).toBe(48);

    expect(root_child0_child0.getComputedLeft()).toBe(90);
    expect(root_child0_child0.getComputedTop()).toBe(8);
    expect(root_child0_child0.getComputedWidth()).toBe(92);
    expect(root_child0_child0.getComputedHeight()).toBe(25);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(46);
    expect(root_child0_child0_child0.getComputedTop()).toBe(10);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(36);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(6);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(58);
    expect(root_child1.getComputedWidth()).toBe(200);
    expect(root_child1.getComputedHeight()).toBe(142);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percentage_margin_should_calculate_based_only_on_width", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(200);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setMargin(Edge.Left, "10%");
    root_child0.setMargin(Edge.Top, "10%");
    root_child0.setMargin(Edge.Right, "10%");
    root_child0.setMargin(Edge.Bottom, "10%");
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth(10);
    root_child0_child0.setHeight(10);
    root_child0.insertChild(root_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(20);
    expect(root_child0.getComputedTop()).toBe(20);
    expect(root_child0.getComputedWidth()).toBe(160);
    expect(root_child0.getComputedHeight()).toBe(60);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(10);
    expect(root_child0_child0.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(20);
    expect(root_child0.getComputedTop()).toBe(20);
    expect(root_child0.getComputedWidth()).toBe(160);
    expect(root_child0.getComputedHeight()).toBe(60);

    expect(root_child0_child0.getComputedLeft()).toBe(150);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(10);
    expect(root_child0_child0.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percentage_padding_should_calculate_based_only_on_width", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(200);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setPadding(Edge.Left, "10%");
    root_child0.setPadding(Edge.Top, "10%");
    root_child0.setPadding(Edge.Right, "10%");
    root_child0.setPadding(Edge.Bottom, "10%");
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth(10);
    root_child0_child0.setHeight(10);
    root_child0.insertChild(root_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(20);
    expect(root_child0_child0.getComputedWidth()).toBe(10);
    expect(root_child0_child0.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0.getComputedLeft()).toBe(170);
    expect(root_child0_child0.getComputedTop()).toBe(20);
    expect(root_child0_child0.getComputedWidth()).toBe(10);
    expect(root_child0_child0.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percentage_absolute_position", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(200);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setPosition(Edge.Left, "30%");
    root_child0.setPosition(Edge.Top, "10%");
    root_child0.setWidth(10);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percentage_width_height_undefined_parent_size", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth("50%");
    root_child0.setHeight("50%");
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(0);
    expect(root.getComputedHeight()).toBe(0);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(0);
    expect(root_child0.getComputedHeight()).toBe(0);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(0);
    expect(root.getComputedHeight()).toBe(0);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(0);
    expect(root_child0.getComputedHeight()).toBe(0);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percent_within_flex_grow", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(350);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(100);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root.insertChild(root_child1, 1);

    const root_child1_child0 = Yoga.Node.create(config);
    root_child1_child0.setWidth("100%");
    root_child1.insertChild(root_child1_child0, 0);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(100);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(350);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(100);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(150);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(150);
    expect(root_child1_child0.getComputedHeight()).toBe(0);

    expect(root_child2.getComputedLeft()).toBe(250);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(350);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(250);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(100);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(150);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(150);
    expect(root_child1_child0.getComputedHeight()).toBe(0);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percentage_container_in_wrapping_container", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setJustifyContent(Justify.Center);
    root.setAlignItems(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(200);
    root.setHeight(200);

    const root_child0 = Yoga.Node.create(config);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setFlexDirection(FlexDirection.Row);
    root_child0_child0.setJustifyContent(Justify.Center);
    root_child0_child0.setWidth("100%");
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);

    const root_child0_child0_child1 = Yoga.Node.create(config);
    root_child0_child0_child1.setWidth(50);
    root_child0_child0_child1.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(75);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child1.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child1.getComputedTop()).toBe(0);
    expect(root_child0_child0_child1.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child1.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(75);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child1.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child1.getComputedTop()).toBe(0);
    expect(root_child0_child0_child1.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child1.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percent_absolute_position", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(60);
    root.setHeight(50);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setPosition(Edge.Left, "50%");
    root_child0.setWidth("100%");
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth("100%");
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setWidth("100%");
    root_child0.insertChild(root_child0_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(60);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(30);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(60);
    expect(root_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child1.getComputedLeft()).toBe(60);
    expect(root_child0_child1.getComputedTop()).toBe(0);
    expect(root_child0_child1.getComputedWidth()).toBe(60);
    expect(root_child0_child1.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(60);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(30);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(60);
    expect(root_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child1.getComputedLeft()).toBe(-60);
    expect(root_child0_child1.getComputedTop()).toBe(0);
    expect(root_child0_child1.getComputedWidth()).toBe(60);
    expect(root_child0_child1.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percent_of_minmax_main", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setMinWidth(60);
    root.setMaxWidth(60);
    root.setHeight(50);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth("50%");
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(60);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(60);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(30);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test.skip("percent_of_min_main", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setMinWidth(60);
    root.setHeight(50);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth("50%");
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(60);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(60);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(30);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test.skip("percent_of_min_main_multiple", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setMinWidth(60);
    root.setHeight(50);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth("50%");
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth("50%");
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth("50%");
    root_child2.setHeight(20);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(60);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(20);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(60);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(60);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(30);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(20);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(-30);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test.skip("percent_of_max_main", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setMaxWidth(60);
    root.setHeight(50);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth("50%");
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(0);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(0);
    expect(root_child0.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(0);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(0);
    expect(root_child0.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percent_of_minmax_cross_stretched", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setMinWidth(60);
    root.setMaxWidth(60);
    root.setHeight(50);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth("50%");
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(60);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(60);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(30);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percent_absolute_of_minmax_cross_stretched", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setMinWidth(60);
    root.setMaxWidth(60);
    root.setHeight(50);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setWidth("50%");
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(60);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(60);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(30);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percent_of_minmax_cross_unstretched", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setAlignItems(Align.FlexStart);
    root.setPositionType(PositionType.Absolute);
    root.setMinWidth(60);
    root.setMaxWidth(60);
    root.setHeight(50);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth("50%");
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(60);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(60);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(30);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test.skip("percent_of_min_cross_unstretched", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setAlignItems(Align.FlexStart);
    root.setPositionType(PositionType.Absolute);
    root.setMinWidth(60);
    root.setHeight(50);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth("50%");
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(60);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(60);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(30);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percent_of_max_cross_unstretched", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setAlignItems(Align.FlexStart);
    root.setPositionType(PositionType.Absolute);
    root.setMaxWidth(60);
    root.setHeight(50);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth("50%");
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(0);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(0);
    expect(root_child0.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(0);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(0);
    expect(root_child0.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
