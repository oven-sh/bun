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

const Wrap = {
  NoWrap: Yoga.WRAP_NO_WRAP,
  Wrap: Yoga.WRAP_WRAP,
  WrapReverse: Yoga.WRAP_WRAP_REVERSE,
};

test("absolute_layout_width_height_start_top", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setPosition(Edge.Start, 10);
    root_child0.setPosition(Edge.Top, 10);
    root_child0.setWidth(10);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(10);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(80);
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
test("absolute_layout_width_height_left_auto_right", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setPositionAuto(Edge.Left);
    root_child0.setPosition(Edge.Right, 10);
    root_child0.setWidth(10);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_width_height_left_right_auto", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setPosition(Edge.Left, 10);
    root_child0.setPositionAuto(Edge.Right);
    root_child0.setWidth(10);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(10);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(10);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_width_height_left_auto_right_auto", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setPositionAuto(Edge.Left);
    root_child0.setPositionAuto(Edge.Right);
    root_child0.setWidth(10);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_width_height_end_bottom", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setPosition(Edge.End, 10);
    root_child0.setPosition(Edge.Bottom, 10);
    root_child0.setWidth(10);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(80);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(10);
    expect(root_child0.getComputedTop()).toBe(80);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_start_top_end_bottom", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setPosition(Edge.Start, 10);
    root_child0.setPosition(Edge.Top, 10);
    root_child0.setPosition(Edge.End, 10);
    root_child0.setPosition(Edge.Bottom, 10);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(10);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(80);
    expect(root_child0.getComputedHeight()).toBe(80);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(10);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(80);
    expect(root_child0.getComputedHeight()).toBe(80);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_width_height_start_top_end_bottom", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setPosition(Edge.Start, 10);
    root_child0.setPosition(Edge.Top, 10);
    root_child0.setPosition(Edge.End, 10);
    root_child0.setPosition(Edge.Bottom, 10);
    root_child0.setWidth(10);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(10);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(80);
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
test("do_not_clamp_height_of_absolute_node_to_height_of_its_overflow_hidden_parent", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setOverflow(Overflow.Hidden);
    root.setWidth(50);
    root.setHeight(50);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setPosition(Edge.Start, 0);
    root_child0.setPosition(Edge.Top, 0);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(50);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(50);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(-50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_within_border", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setMargin(Edge.Left, 10);
    root.setMargin(Edge.Top, 10);
    root.setMargin(Edge.Right, 10);
    root.setMargin(Edge.Bottom, 10);
    root.setPadding(Edge.Left, 10);
    root.setPadding(Edge.Top, 10);
    root.setPadding(Edge.Right, 10);
    root.setPadding(Edge.Bottom, 10);
    root.setBorder(Edge.Left, 10);
    root.setBorder(Edge.Top, 10);
    root.setBorder(Edge.Right, 10);
    root.setBorder(Edge.Bottom, 10);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setPosition(Edge.Left, 0);
    root_child0.setPosition(Edge.Top, 0);
    root_child0.setWidth(50);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setPositionType(PositionType.Absolute);
    root_child1.setPosition(Edge.Right, 0);
    root_child1.setPosition(Edge.Bottom, 0);
    root_child1.setWidth(50);
    root_child1.setHeight(50);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setPositionType(PositionType.Absolute);
    root_child2.setPosition(Edge.Left, 0);
    root_child2.setPosition(Edge.Top, 0);
    root_child2.setMargin(Edge.Left, 10);
    root_child2.setMargin(Edge.Top, 10);
    root_child2.setMargin(Edge.Right, 10);
    root_child2.setMargin(Edge.Bottom, 10);
    root_child2.setWidth(50);
    root_child2.setHeight(50);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setPositionType(PositionType.Absolute);
    root_child3.setPosition(Edge.Right, 0);
    root_child3.setPosition(Edge.Bottom, 0);
    root_child3.setMargin(Edge.Left, 10);
    root_child3.setMargin(Edge.Top, 10);
    root_child3.setMargin(Edge.Right, 10);
    root_child3.setMargin(Edge.Bottom, 10);
    root_child3.setWidth(50);
    root_child3.setHeight(50);
    root.insertChild(root_child3, 3);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(10);
    expect(root.getComputedTop()).toBe(10);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(10);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(50);

    expect(root_child2.getComputedLeft()).toBe(20);
    expect(root_child2.getComputedTop()).toBe(20);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(50);

    expect(root_child3.getComputedLeft()).toBe(30);
    expect(root_child3.getComputedTop()).toBe(30);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(10);
    expect(root.getComputedTop()).toBe(10);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(10);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(50);

    expect(root_child2.getComputedLeft()).toBe(20);
    expect(root_child2.getComputedTop()).toBe(20);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(50);

    expect(root_child3.getComputedLeft()).toBe(30);
    expect(root_child3.getComputedTop()).toBe(30);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_align_items_and_justify_content_center", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setJustifyContent(Justify.Center);
    root.setAlignItems(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setFlexGrow(1);
    root.setWidth(110);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setWidth(60);
    root_child0.setHeight(40);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(110);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(25);
    expect(root_child0.getComputedTop()).toBe(30);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(40);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(110);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(25);
    expect(root_child0.getComputedTop()).toBe(30);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(40);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_align_items_and_justify_content_flex_end", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setJustifyContent(Justify.FlexEnd);
    root.setAlignItems(Align.FlexEnd);
    root.setPositionType(PositionType.Absolute);
    root.setFlexGrow(1);
    root.setWidth(110);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setWidth(60);
    root_child0.setHeight(40);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(110);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(40);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(110);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(40);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_justify_content_center", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setJustifyContent(Justify.Center);
    root.setPositionType(PositionType.Absolute);
    root.setFlexGrow(1);
    root.setWidth(110);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setWidth(60);
    root_child0.setHeight(40);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(110);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(30);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(40);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(110);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(30);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(40);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_align_items_center", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setAlignItems(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setFlexGrow(1);
    root.setWidth(110);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setWidth(60);
    root_child0.setHeight(40);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(110);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(25);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(40);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(110);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(25);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(40);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_align_items_center_on_child_only", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setFlexGrow(1);
    root.setWidth(110);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setAlignSelf(Align.Center);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setWidth(60);
    root_child0.setHeight(40);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(110);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(25);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(40);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(110);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(25);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(40);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_align_items_and_justify_content_center_and_top_position", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setJustifyContent(Justify.Center);
    root.setAlignItems(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setFlexGrow(1);
    root.setWidth(110);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setPosition(Edge.Top, 10);
    root_child0.setWidth(60);
    root_child0.setHeight(40);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(110);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(25);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(40);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(110);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(25);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(40);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_align_items_and_justify_content_center_and_bottom_position", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setJustifyContent(Justify.Center);
    root.setAlignItems(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setFlexGrow(1);
    root.setWidth(110);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setPosition(Edge.Bottom, 10);
    root_child0.setWidth(60);
    root_child0.setHeight(40);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(110);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(25);
    expect(root_child0.getComputedTop()).toBe(50);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(40);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(110);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(25);
    expect(root_child0.getComputedTop()).toBe(50);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(40);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_align_items_and_justify_content_center_and_left_position", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setJustifyContent(Justify.Center);
    root.setAlignItems(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setFlexGrow(1);
    root.setWidth(110);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setPosition(Edge.Left, 5);
    root_child0.setWidth(60);
    root_child0.setHeight(40);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(110);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(5);
    expect(root_child0.getComputedTop()).toBe(30);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(40);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(110);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(5);
    expect(root_child0.getComputedTop()).toBe(30);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(40);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_align_items_and_justify_content_center_and_right_position", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setJustifyContent(Justify.Center);
    root.setAlignItems(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setFlexGrow(1);
    root.setWidth(110);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setPosition(Edge.Right, 5);
    root_child0.setWidth(60);
    root_child0.setHeight(40);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(110);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(45);
    expect(root_child0.getComputedTop()).toBe(30);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(40);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(110);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(45);
    expect(root_child0.getComputedTop()).toBe(30);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(40);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("position_root_with_rtl_should_position_withoutdirection", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPosition(Edge.Left, 72);
    root.setWidth(52);
    root.setHeight(52);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(72);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(52);
    expect(root.getComputedHeight()).toBe(52);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(72);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(52);
    expect(root.getComputedHeight()).toBe(52);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_percentage_bottom_based_on_parent_height", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(200);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setPosition(Edge.Top, "50%");
    root_child0.setWidth(10);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setPositionType(PositionType.Absolute);
    root_child1.setPosition(Edge.Bottom, "50%");
    root_child1.setWidth(10);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setPositionType(PositionType.Absolute);
    root_child2.setPosition(Edge.Top, "10%");
    root_child2.setPosition(Edge.Bottom, "10%");
    root_child2.setWidth(10);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(100);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(90);
    expect(root_child1.getComputedWidth()).toBe(10);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(20);
    expect(root_child2.getComputedWidth()).toBe(10);
    expect(root_child2.getComputedHeight()).toBe(160);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(100);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(90);
    expect(root_child1.getComputedTop()).toBe(90);
    expect(root_child1.getComputedWidth()).toBe(10);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(90);
    expect(root_child2.getComputedTop()).toBe(20);
    expect(root_child2.getComputedWidth()).toBe(10);
    expect(root_child2.getComputedHeight()).toBe(160);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_in_wrap_reverse_column_container", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.WrapReverse);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setWidth(20);
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_in_wrap_reverse_row_container", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.WrapReverse);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setWidth(20);
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(80);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(80);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_in_wrap_reverse_column_container_flex_end", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.WrapReverse);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setAlignSelf(Align.FlexEnd);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setWidth(20);
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_in_wrap_reverse_row_container_flex_end", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.WrapReverse);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setAlignSelf(Align.FlexEnd);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setWidth(20);
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("percent_absolute_position_infinite_height", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(300);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(300);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setPositionType(PositionType.Absolute);
    root_child1.setPosition(Edge.Left, "20%");
    root_child1.setPosition(Edge.Top, "20%");
    root_child1.setWidth("20%");
    root_child1.setHeight("20%");
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(0);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(300);
    expect(root_child0.getComputedHeight()).toBe(0);

    expect(root_child1.getComputedLeft()).toBe(60);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(60);
    expect(root_child1.getComputedHeight()).toBe(0);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(0);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(300);
    expect(root_child0.getComputedHeight()).toBe(0);

    expect(root_child1.getComputedLeft()).toBe(60);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(60);
    expect(root_child1.getComputedHeight()).toBe(0);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_percentage_height_based_on_padded_parent", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Top, 10);
    root.setBorder(Edge.Top, 10);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setWidth(100);
    root_child0.setHeight("50%");
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(20);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(45);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(20);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(45);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_percentage_height_based_on_padded_parent_and_align_items_center", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setJustifyContent(Justify.Center);
    root.setAlignItems(Align.Center);
    root.setPadding(Edge.Top, 20);
    root.setPadding(Edge.Bottom, 20);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setWidth(100);
    root_child0.setHeight("50%");
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(25);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(25);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_padding_left", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Left, 100);
    root.setWidth(200);
    root.setHeight(200);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setWidth(50);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(100);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(150);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_padding_right", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Right, 100);
    root.setWidth(200);
    root.setHeight(200);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setWidth(50);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_padding_top", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Top, 100);
    root.setWidth(200);
    root.setHeight(200);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setWidth(50);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(100);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(150);
    expect(root_child0.getComputedTop()).toBe(100);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_padding_bottom", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Bottom, 100);
    root.setWidth(200);
    root.setHeight(200);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setWidth(50);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(150);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_padding", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Left, 10);
    root_child0.setMargin(Edge.Top, 10);
    root_child0.setMargin(Edge.Right, 10);
    root_child0.setMargin(Edge.Bottom, 10);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setPadding(Edge.Left, 50);
    root_child0_child0.setPadding(Edge.Top, 50);
    root_child0_child0.setPadding(Edge.Right, 50);
    root_child0_child0.setPadding(Edge.Bottom, 50);
    root_child0_child0.setWidth(200);
    root_child0_child0.setHeight(200);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(220);
    expect(root.getComputedHeight()).toBe(220);

    expect(root_child0.getComputedLeft()).toBe(10);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(50);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(220);
    expect(root.getComputedHeight()).toBe(220);

    expect(root_child0.getComputedLeft()).toBe(10);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0_child0.getComputedTop()).toBe(50);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_border", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Left, 10);
    root_child0.setMargin(Edge.Top, 10);
    root_child0.setMargin(Edge.Right, 10);
    root_child0.setMargin(Edge.Bottom, 10);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setBorder(Edge.Left, 10);
    root_child0_child0.setBorder(Edge.Top, 10);
    root_child0_child0.setBorder(Edge.Right, 10);
    root_child0_child0.setBorder(Edge.Bottom, 10);
    root_child0_child0.setWidth(200);
    root_child0_child0.setHeight(200);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(220);
    expect(root.getComputedHeight()).toBe(220);

    expect(root_child0.getComputedLeft()).toBe(10);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(10);
    expect(root_child0_child0_child0.getComputedTop()).toBe(10);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(220);
    expect(root.getComputedHeight()).toBe(220);

    expect(root_child0.getComputedLeft()).toBe(10);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(140);
    expect(root_child0_child0_child0.getComputedTop()).toBe(10);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("absolute_layout_column_reverse_margin_border", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.ColumnReverse);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(200);
    root.setHeight(200);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setPosition(Edge.Left, 5);
    root_child0.setPosition(Edge.Right, 3);
    root_child0.setMargin(Edge.Left, 3);
    root_child0.setMargin(Edge.Right, 4);
    root_child0.setBorder(Edge.Left, 1);
    root_child0.setBorder(Edge.Right, 7);
    root_child0.setWidth(50);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(8);
    expect(root_child0.getComputedTop()).toBe(150);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(143);
    expect(root_child0.getComputedTop()).toBe(150);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
