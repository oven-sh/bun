import { expect, test } from "bun:test";
const Yoga = Bun.Yoga;

// Enum compatibility layer: map Facebook Yoga enum style to Bun's constant style
const Align = {
  Auto: Yoga.ALIGN_AUTO,
  FlexStart: Yoga.ALIGN_FLEX_START,
  Center: Yoga.ALIGN_CENTER,
  FlexEnd: Yoga.ALIGN_FLEX_END,
  Stretch: Yoga.ALIGN_STRETCH,
  Baseline: Yoga.ALIGN_BASELINE,
  SpaceBetween: Yoga.ALIGN_SPACE_BETWEEN,
  SpaceAround: Yoga.ALIGN_SPACE_AROUND,
  SpaceEvenly: Yoga.ALIGN_SPACE_EVENLY,
};

const Direction = {
  Inherit: Yoga.DIRECTION_INHERIT,
  LTR: Yoga.DIRECTION_LTR,
  RTL: Yoga.DIRECTION_RTL,
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

const Gutter = {
  Column: Yoga.GUTTER_COLUMN,
  Row: Yoga.GUTTER_ROW,
  All: Yoga.GUTTER_ALL,
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

const BoxSizing = {
  BorderBox: Yoga.BOX_SIZING_BORDER_BOX,
  ContentBox: Yoga.BOX_SIZING_CONTENT_BOX,
};

const Errata = {
  None: Yoga.ERRATA_NONE,
  StretchFlexBasis: Yoga.ERRATA_STRETCH_FLEX_BASIS,
  AbsolutePositionWithoutInsetsExcludesPadding: Yoga.ERRATA_ABSOLUTE_POSITION_WITHOUT_INSETS_EXCLUDES_PADDING,
  AbsolutePercentAgainstInnerSize: Yoga.ERRATA_ABSOLUTE_PERCENT_AGAINST_INNER_SIZE,
  All: Yoga.ERRATA_ALL,
  Classic: Yoga.ERRATA_CLASSIC,
};

const ExperimentalFeature = {
  WebFlexBasis: Yoga.EXPERIMENTAL_FEATURE_WEB_FLEX_BASIS,
};

test("static_position_insets_have_no_effect_left_top", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Static);
    root_child0.setPosition(Edge.Left, 50);
    root_child0.setPosition(Edge.Top, 50);
    root_child0.setWidth(100);
    root_child0.setHeight(100);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_insets_have_no_effect_right_bottom", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Static);
    root_child0.setPosition(Edge.Right, 50);
    root_child0.setPosition(Edge.Bottom, 50);
    root_child0.setWidth(100);
    root_child0.setHeight(100);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_absolute_child_insets_relative_to_positioned_ancestor", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setMargin(Edge.Left, 100);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setPosition(Edge.Left, 50);
    root_child0_child0_child0.setPosition(Edge.Top, 50);
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(-50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(50);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(-50);
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
test("static_position_absolute_child_insets_relative_to_positioned_ancestor_row_reverse", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.RowReverse);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setPosition(Edge.Left, 50);
    root_child0_child0_child0.setPosition(Edge.Top, 50);
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(-50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(50);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
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
test("column_reverse_static_position_absolute_child_insets_relative_to_positioned_ancestor_row_reverse", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.RowReverse);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setFlexDirection(FlexDirection.ColumnReverse);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setPosition(Edge.Left, 50);
    root_child0_child0_child0.setPosition(Edge.Top, 50);
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(-50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(50);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
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
test("static_position_absolute_child_insets_relative_to_positioned_ancestor_row", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setPosition(Edge.Top, 50);
    root_child0_child0_child0.setPosition(Edge.Right, 50);
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0_child0.getComputedTop()).toBe(50);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
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
test("column_reverse_static_position_absolute_child_insets_relative_to_positioned_ancestor_row", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setFlexDirection(FlexDirection.ColumnReverse);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setPosition(Edge.Top, 50);
    root_child0_child0_child0.setPosition(Edge.Right, 50);
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0_child0.getComputedTop()).toBe(50);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
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
test("static_position_absolute_child_insets_relative_to_positioned_ancestor_column_reverse", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.ColumnReverse);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setPosition(Edge.Top, 50);
    root_child0_child0_child0.setPosition(Edge.Right, 50);
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(100);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0_child0.getComputedTop()).toBe(-50);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(100);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(-50);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("column_reverse_static_position_absolute_child_insets_relative_to_positioned_ancestor_column_reverse", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.ColumnReverse);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setFlexDirection(FlexDirection.ColumnReverse);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setPosition(Edge.Top, 50);
    root_child0_child0_child0.setPosition(Edge.Right, 50);
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(100);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0_child0.getComputedTop()).toBe(-50);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(100);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(-50);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_absolute_child_insets_relative_to_positioned_ancestor_deep", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setMargin(Edge.Left, 100);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0_child0.setMargin(Edge.Left, 100);
    root_child0_child0_child0.setWidth(100);
    root_child0_child0_child0.setHeight(100);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);

    const root_child0_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0_child0_child0.setMargin(Edge.Left, 100);
    root_child0_child0_child0_child0.setWidth(100);
    root_child0_child0_child0_child0.setHeight(100);
    root_child0_child0_child0.insertChild(root_child0_child0_child0_child0, 0);

    const root_child0_child0_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0_child0_child0_child0.setMargin(Edge.Left, 100);
    root_child0_child0_child0_child0_child0.setWidth(100);
    root_child0_child0_child0_child0_child0.setHeight(100);
    root_child0_child0_child0_child0.insertChild(root_child0_child0_child0_child0_child0, 0);

    const root_child0_child0_child0_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0_child0_child0_child0.setPosition(Edge.Left, 50);
    root_child0_child0_child0_child0_child0_child0.setPosition(Edge.Top, 50);
    root_child0_child0_child0_child0_child0_child0.setWidth(50);
    root_child0_child0_child0_child0_child0_child0.setHeight(50);
    root_child0_child0_child0_child0_child0.insertChild(root_child0_child0_child0_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0_child0_child0_child0.getComputedLeft()).toBe(-350);
    expect(root_child0_child0_child0_child0_child0_child0.getComputedTop()).toBe(50);
    expect(root_child0_child0_child0_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0_child0_child0_child0.getComputedLeft()).toBe(-50);
    expect(root_child0_child0_child0_child0_child0_child0.getComputedTop()).toBe(50);
    expect(root_child0_child0_child0_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_absolute_child_width_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setWidth("50%");
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_relative_child_width_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setWidth("50%");
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_static_child_width_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0_child0.setWidth("50%");
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_absolute_child_height_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight("50%");
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_relative_child_height_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight("50%");
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_static_child_height_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight("50%");
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_absolute_child_left_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setPosition(Edge.Left, "50%");
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_relative_child_left_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPosition(Edge.Left, "50%");
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_static_child_left_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0_child0.setPosition(Edge.Left, "50%");
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_absolute_child_right_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setPosition(Edge.Right, "50%");
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(-50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_relative_child_right_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPosition(Edge.Right, "50%");
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(-50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_static_child_right_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0_child0.setPosition(Edge.Right, "50%");
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_absolute_child_top_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setPosition(Edge.Top, "50%");
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(100);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(100);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_relative_child_top_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPosition(Edge.Top, "50%");
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(50);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
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
test("static_position_static_child_top_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0_child0.setPosition(Edge.Top, "50%");
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_absolute_child_bottom_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setPosition(Edge.Bottom, "50%");
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(50);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
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
test("static_position_relative_child_bottom_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPosition(Edge.Bottom, "50%");
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(-50);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(-50);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_static_child_bottom_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0_child0.setPosition(Edge.Bottom, "50%");
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_absolute_child_margin_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setMargin(Edge.Left, "50%");
    root_child0_child0_child0.setMargin(Edge.Top, "50%");
    root_child0_child0_child0.setMargin(Edge.Right, "50%");
    root_child0_child0_child0.setMargin(Edge.Bottom, "50%");
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0_child0.getComputedTop()).toBe(100);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(-50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(100);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_relative_child_margin_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setMargin(Edge.Left, "50%");
    root_child0_child0_child0.setMargin(Edge.Top, "50%");
    root_child0_child0_child0.setMargin(Edge.Right, "50%");
    root_child0_child0_child0.setMargin(Edge.Bottom, "50%");
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(50);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
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
test("static_position_static_child_margin_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0_child0.setMargin(Edge.Left, "50%");
    root_child0_child0_child0.setMargin(Edge.Top, "50%");
    root_child0_child0_child0.setMargin(Edge.Right, "50%");
    root_child0_child0_child0.setMargin(Edge.Bottom, "50%");
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(50);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
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
test("static_position_absolute_child_padding_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setPadding(Edge.Left, "50%");
    root_child0_child0_child0.setPadding(Edge.Top, "50%");
    root_child0_child0_child0.setPadding(Edge.Right, "50%");
    root_child0_child0_child0.setPadding(Edge.Bottom, "50%");
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(200);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(-100);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(200);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_relative_child_padding_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPadding(Edge.Left, "50%");
    root_child0_child0_child0.setPadding(Edge.Top, "50%");
    root_child0_child0_child0.setPadding(Edge.Right, "50%");
    root_child0_child0_child0.setPadding(Edge.Bottom, "50%");
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_static_child_padding_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0_child0.setPadding(Edge.Left, "50%");
    root_child0_child0_child0.setPadding(Edge.Top, "50%");
    root_child0_child0_child0.setPadding(Edge.Right, "50%");
    root_child0_child0_child0.setPadding(Edge.Bottom, "50%");
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_absolute_child_border_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_relative_child_border_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_static_child_border_percentage", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(200);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0_child0.setWidth(50);
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_absolute_child_containing_block_padding_box", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 100);
    root_child0.setPadding(Edge.Top, 100);
    root_child0.setPadding(Edge.Right, 100);
    root_child0.setPadding(Edge.Bottom, 100);
    root_child0.setWidth(400);
    root_child0.setHeight(400);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setWidth("50%");
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(400);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(100);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(400);

    expect(root_child0_child0.getComputedLeft()).toBe(200);
    expect(root_child0_child0.getComputedTop()).toBe(100);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(-100);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_relative_child_containing_block_padding_box", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 100);
    root_child0.setPadding(Edge.Top, 100);
    root_child0.setPadding(Edge.Right, 100);
    root_child0.setPadding(Edge.Bottom, 100);
    root_child0.setWidth(400);
    root_child0.setHeight(400);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setWidth("50%");
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(400);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(100);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(400);

    expect(root_child0_child0.getComputedLeft()).toBe(200);
    expect(root_child0_child0.getComputedTop()).toBe(100);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_static_child_containing_block_padding_box", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 100);
    root_child0.setPadding(Edge.Top, 100);
    root_child0.setPadding(Edge.Right, 100);
    root_child0.setPadding(Edge.Bottom, 100);
    root_child0.setWidth(400);
    root_child0.setHeight(400);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0_child0.setWidth("50%");
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(400);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(100);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(400);

    expect(root_child0_child0.getComputedLeft()).toBe(200);
    expect(root_child0_child0.getComputedTop()).toBe(100);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_absolute_child_containing_block_content_box", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 100);
    root_child0.setPadding(Edge.Top, 100);
    root_child0.setPadding(Edge.Right, 100);
    root_child0.setPadding(Edge.Bottom, 100);
    root_child0.setWidth(400);
    root_child0.setHeight(400);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0.setWidth("50%");
    root_child0_child0.setHeight(50);
    root_child0.insertChild(root_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(400);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(100);
    expect(root_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(400);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(100);
    expect(root_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_relative_child_containing_block_content_box", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 100);
    root_child0.setPadding(Edge.Top, 100);
    root_child0.setPadding(Edge.Right, 100);
    root_child0.setPadding(Edge.Bottom, 100);
    root_child0.setWidth(400);
    root_child0.setHeight(400);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth("50%");
    root_child0_child0.setHeight(50);
    root_child0.insertChild(root_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(400);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(100);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(400);

    expect(root_child0_child0.getComputedLeft()).toBe(200);
    expect(root_child0_child0.getComputedTop()).toBe(100);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_static_child_containing_block_content_box", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 100);
    root_child0.setPadding(Edge.Top, 100);
    root_child0.setPadding(Edge.Right, 100);
    root_child0.setPadding(Edge.Bottom, 100);
    root_child0.setWidth(400);
    root_child0.setHeight(400);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth("50%");
    root_child0_child0.setHeight(50);
    root_child0.insertChild(root_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(400);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(100);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(400);

    expect(root_child0_child0.getComputedLeft()).toBe(200);
    expect(root_child0_child0.getComputedTop()).toBe(100);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_containing_block_padding_and_border", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 9);
    root_child0.setPadding(Edge.Top, 8);
    root_child0.setPadding(Edge.Right, 1);
    root_child0.setPadding(Edge.Bottom, 4);
    root_child0.setBorder(Edge.Left, 2);
    root_child0.setBorder(Edge.Top, 5);
    root_child0.setBorder(Edge.Right, 7);
    root_child0.setBorder(Edge.Bottom, 4);
    root_child0.setWidth(400);
    root_child0.setHeight(400);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setWidth("41%");
    root_child0_child0_child0.setHeight("61%");
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(400);

    expect(root_child0_child0.getComputedLeft()).toBe(11);
    expect(root_child0_child0.getComputedTop()).toBe(13);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(239);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(400);

    expect(root_child0_child0.getComputedLeft()).toBe(292);
    expect(root_child0_child0.getComputedTop()).toBe(13);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(-60);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(239);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_amalgamation", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Left, 4);
    root_child0.setMargin(Edge.Top, 5);
    root_child0.setMargin(Edge.Right, 9);
    root_child0.setMargin(Edge.Bottom, 1);
    root_child0.setPadding(Edge.Left, 2);
    root_child0.setPadding(Edge.Top, 9);
    root_child0.setPadding(Edge.Right, 11);
    root_child0.setPadding(Edge.Bottom, 13);
    root_child0.setBorder(Edge.Left, 5);
    root_child0.setBorder(Edge.Top, 6);
    root_child0.setBorder(Edge.Right, 7);
    root_child0.setBorder(Edge.Bottom, 8);
    root_child0.setWidth(500);
    root_child0.setHeight(500);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setMargin(Edge.Left, 8);
    root_child0_child0.setMargin(Edge.Top, 6);
    root_child0_child0.setMargin(Edge.Right, 3);
    root_child0_child0.setMargin(Edge.Bottom, 9);
    root_child0_child0.setPadding(Edge.Left, 1);
    root_child0_child0.setPadding(Edge.Top, 7);
    root_child0_child0.setPadding(Edge.Right, 9);
    root_child0_child0.setPadding(Edge.Bottom, 4);
    root_child0_child0.setBorder(Edge.Left, 8);
    root_child0_child0.setBorder(Edge.Top, 10);
    root_child0_child0.setBorder(Edge.Right, 2);
    root_child0_child0.setBorder(Edge.Bottom, 1);
    root_child0_child0.setWidth(200);
    root_child0_child0.setHeight(200);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setPosition(Edge.Left, 2);
    root_child0_child0_child0.setPosition(Edge.Right, 12);
    root_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0.setWidth("41%");
    root_child0_child0_child0.setHeight("63%");
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(513);
    expect(root.getComputedHeight()).toBe(506);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(500);
    expect(root_child0.getComputedHeight()).toBe(500);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(1);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(306);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(513);
    expect(root.getComputedHeight()).toBe(506);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(500);
    expect(root_child0.getComputedHeight()).toBe(500);

    expect(root_child0_child0.getComputedLeft()).toBe(279);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(-2);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(306);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_no_position_amalgamation", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Left, 4);
    root_child0.setMargin(Edge.Top, 5);
    root_child0.setMargin(Edge.Right, 9);
    root_child0.setMargin(Edge.Bottom, 1);
    root_child0.setPadding(Edge.Left, 2);
    root_child0.setPadding(Edge.Top, 9);
    root_child0.setPadding(Edge.Right, 11);
    root_child0.setPadding(Edge.Bottom, 13);
    root_child0.setBorder(Edge.Left, 5);
    root_child0.setBorder(Edge.Top, 6);
    root_child0.setBorder(Edge.Right, 7);
    root_child0.setBorder(Edge.Bottom, 8);
    root_child0.setWidth(500);
    root_child0.setHeight(500);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setMargin(Edge.Left, 8);
    root_child0_child0.setMargin(Edge.Top, 6);
    root_child0_child0.setMargin(Edge.Right, 3);
    root_child0_child0.setMargin(Edge.Bottom, 9);
    root_child0_child0.setPadding(Edge.Left, 1);
    root_child0_child0.setPadding(Edge.Top, 7);
    root_child0_child0.setPadding(Edge.Right, 9);
    root_child0_child0.setPadding(Edge.Bottom, 4);
    root_child0_child0.setBorder(Edge.Left, 8);
    root_child0_child0.setBorder(Edge.Top, 10);
    root_child0_child0.setBorder(Edge.Right, 2);
    root_child0_child0.setBorder(Edge.Bottom, 1);
    root_child0_child0.setWidth(200);
    root_child0_child0.setHeight(200);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0.setWidth("41%");
    root_child0_child0_child0.setHeight("63%");
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(513);
    expect(root.getComputedHeight()).toBe(506);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(500);
    expect(root_child0.getComputedHeight()).toBe(500);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(18);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(306);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(513);
    expect(root.getComputedHeight()).toBe(506);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(500);
    expect(root_child0.getComputedHeight()).toBe(500);

    expect(root_child0_child0.getComputedLeft()).toBe(279);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(-15);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(306);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_zero_for_inset_amalgamation", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Left, 4);
    root_child0.setMargin(Edge.Top, 5);
    root_child0.setMargin(Edge.Right, 9);
    root_child0.setMargin(Edge.Bottom, 1);
    root_child0.setPadding(Edge.Left, 2);
    root_child0.setPadding(Edge.Top, 9);
    root_child0.setPadding(Edge.Right, 11);
    root_child0.setPadding(Edge.Bottom, 13);
    root_child0.setBorder(Edge.Left, 5);
    root_child0.setBorder(Edge.Top, 6);
    root_child0.setBorder(Edge.Right, 7);
    root_child0.setBorder(Edge.Bottom, 8);
    root_child0.setWidth(500);
    root_child0.setHeight(500);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setMargin(Edge.Left, 8);
    root_child0_child0.setMargin(Edge.Top, 6);
    root_child0_child0.setMargin(Edge.Right, 3);
    root_child0_child0.setMargin(Edge.Bottom, 9);
    root_child0_child0.setPadding(Edge.Left, 1);
    root_child0_child0.setPadding(Edge.Top, 7);
    root_child0_child0.setPadding(Edge.Right, 9);
    root_child0_child0.setPadding(Edge.Bottom, 4);
    root_child0_child0.setBorder(Edge.Left, 8);
    root_child0_child0.setBorder(Edge.Top, 10);
    root_child0_child0.setBorder(Edge.Right, 2);
    root_child0_child0.setBorder(Edge.Bottom, 1);
    root_child0_child0.setWidth(200);
    root_child0_child0.setHeight(200);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setPosition(Edge.Left, "0%");
    root_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0.setWidth("41%");
    root_child0_child0_child0.setHeight("63%");
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(513);
    expect(root.getComputedHeight()).toBe(506);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(500);
    expect(root_child0.getComputedHeight()).toBe(500);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(-1);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(306);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(513);
    expect(root.getComputedHeight()).toBe(506);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(500);
    expect(root_child0.getComputedHeight()).toBe(500);

    expect(root_child0_child0.getComputedLeft()).toBe(279);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(-265);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(306);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_start_inset_amalgamation", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Left, 4);
    root_child0.setMargin(Edge.Top, 5);
    root_child0.setMargin(Edge.Right, 9);
    root_child0.setMargin(Edge.Bottom, 1);
    root_child0.setPadding(Edge.Left, 2);
    root_child0.setPadding(Edge.Top, 9);
    root_child0.setPadding(Edge.Right, 11);
    root_child0.setPadding(Edge.Bottom, 13);
    root_child0.setBorder(Edge.Left, 5);
    root_child0.setBorder(Edge.Top, 6);
    root_child0.setBorder(Edge.Right, 7);
    root_child0.setBorder(Edge.Bottom, 8);
    root_child0.setWidth(500);
    root_child0.setHeight(500);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setMargin(Edge.Left, 8);
    root_child0_child0.setMargin(Edge.Top, 6);
    root_child0_child0.setMargin(Edge.Right, 3);
    root_child0_child0.setMargin(Edge.Bottom, 9);
    root_child0_child0.setPadding(Edge.Left, 1);
    root_child0_child0.setPadding(Edge.Top, 7);
    root_child0_child0.setPadding(Edge.Right, 9);
    root_child0_child0.setPadding(Edge.Bottom, 4);
    root_child0_child0.setBorder(Edge.Left, 8);
    root_child0_child0.setBorder(Edge.Top, 10);
    root_child0_child0.setBorder(Edge.Right, 2);
    root_child0_child0.setBorder(Edge.Bottom, 1);
    root_child0_child0.setWidth(200);
    root_child0_child0.setHeight(200);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setPosition(Edge.Start, 12);
    root_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0.setWidth("41%");
    root_child0_child0_child0.setHeight("63%");
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(513);
    expect(root.getComputedHeight()).toBe(506);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(500);
    expect(root_child0.getComputedHeight()).toBe(500);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(11);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(306);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(513);
    expect(root.getComputedHeight()).toBe(506);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(500);
    expect(root_child0.getComputedHeight()).toBe(500);

    expect(root_child0_child0.getComputedLeft()).toBe(279);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(-2);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(306);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_end_inset_amalgamation", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Left, 4);
    root_child0.setMargin(Edge.Top, 5);
    root_child0.setMargin(Edge.Right, 9);
    root_child0.setMargin(Edge.Bottom, 1);
    root_child0.setPadding(Edge.Left, 2);
    root_child0.setPadding(Edge.Top, 9);
    root_child0.setPadding(Edge.Right, 11);
    root_child0.setPadding(Edge.Bottom, 13);
    root_child0.setBorder(Edge.Left, 5);
    root_child0.setBorder(Edge.Top, 6);
    root_child0.setBorder(Edge.Right, 7);
    root_child0.setBorder(Edge.Bottom, 8);
    root_child0.setWidth(500);
    root_child0.setHeight(500);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setMargin(Edge.Left, 8);
    root_child0_child0.setMargin(Edge.Top, 6);
    root_child0_child0.setMargin(Edge.Right, 3);
    root_child0_child0.setMargin(Edge.Bottom, 9);
    root_child0_child0.setPadding(Edge.Left, 1);
    root_child0_child0.setPadding(Edge.Top, 7);
    root_child0_child0.setPadding(Edge.Right, 9);
    root_child0_child0.setPadding(Edge.Bottom, 4);
    root_child0_child0.setBorder(Edge.Left, 8);
    root_child0_child0.setBorder(Edge.Top, 10);
    root_child0_child0.setBorder(Edge.Right, 2);
    root_child0_child0.setBorder(Edge.Bottom, 1);
    root_child0_child0.setWidth(200);
    root_child0_child0.setHeight(200);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setPosition(Edge.End, 4);
    root_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0.setWidth("41%");
    root_child0_child0_child0.setHeight("63%");
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(513);
    expect(root.getComputedHeight()).toBe(506);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(500);
    expect(root_child0.getComputedHeight()).toBe(500);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(270);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(306);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(513);
    expect(root.getComputedHeight()).toBe(506);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(500);
    expect(root_child0.getComputedHeight()).toBe(500);

    expect(root_child0_child0.getComputedLeft()).toBe(279);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0.getComputedHeight()).toBe(200);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(-261);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(306);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_row_reverse_amalgamation", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Left, 4);
    root_child0.setMargin(Edge.Top, 5);
    root_child0.setMargin(Edge.Right, 9);
    root_child0.setMargin(Edge.Bottom, 1);
    root_child0.setPadding(Edge.Left, 2);
    root_child0.setPadding(Edge.Top, 9);
    root_child0.setPadding(Edge.Right, 11);
    root_child0.setPadding(Edge.Bottom, 13);
    root_child0.setBorder(Edge.Left, 5);
    root_child0.setBorder(Edge.Top, 6);
    root_child0.setBorder(Edge.Right, 7);
    root_child0.setBorder(Edge.Bottom, 8);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setFlexDirection(FlexDirection.RowReverse);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setMargin(Edge.Left, 8);
    root_child0_child0.setMargin(Edge.Top, 6);
    root_child0_child0.setMargin(Edge.Right, 3);
    root_child0_child0.setMargin(Edge.Bottom, 9);
    root_child0_child0.setPadding(Edge.Left, 1);
    root_child0_child0.setPadding(Edge.Top, 7);
    root_child0_child0.setPadding(Edge.Right, 9);
    root_child0_child0.setPadding(Edge.Bottom, 4);
    root_child0_child0.setBorder(Edge.Left, 8);
    root_child0_child0.setBorder(Edge.Top, 10);
    root_child0_child0.setBorder(Edge.Right, 2);
    root_child0_child0.setBorder(Edge.Bottom, 1);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0.setHeight("12%");
    root_child0_child0.insertChild(root_child0_child0_child0, 0);

    const root_child0_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0_child0.setWidth(100);
    root_child0_child0_child0_child0.setHeight(50);
    root_child0_child0_child0.insertChild(root_child0_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(69);
    expect(root.getComputedHeight()).toBe(79);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(56);
    expect(root_child0.getComputedHeight()).toBe(73);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(20);
    expect(root_child0_child0.getComputedHeight()).toBe(22);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(-128);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(133);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(23);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(69);
    expect(root.getComputedHeight()).toBe(79);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(56);
    expect(root_child0.getComputedHeight()).toBe(73);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(20);
    expect(root_child0_child0.getComputedHeight()).toBe(22);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(18);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(133);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(23);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_column_reverse_amalgamation", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Left, 4);
    root_child0.setMargin(Edge.Top, 5);
    root_child0.setMargin(Edge.Right, 9);
    root_child0.setMargin(Edge.Bottom, 1);
    root_child0.setPadding(Edge.Left, 2);
    root_child0.setPadding(Edge.Top, 9);
    root_child0.setPadding(Edge.Right, 11);
    root_child0.setPadding(Edge.Bottom, 13);
    root_child0.setBorder(Edge.Left, 5);
    root_child0.setBorder(Edge.Top, 6);
    root_child0.setBorder(Edge.Right, 7);
    root_child0.setBorder(Edge.Bottom, 8);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setFlexDirection(FlexDirection.ColumnReverse);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setMargin(Edge.Left, 8);
    root_child0_child0.setMargin(Edge.Top, 6);
    root_child0_child0.setMargin(Edge.Right, 3);
    root_child0_child0.setMargin(Edge.Bottom, 9);
    root_child0_child0.setPadding(Edge.Left, 1);
    root_child0_child0.setPadding(Edge.Top, 7);
    root_child0_child0.setPadding(Edge.Right, 9);
    root_child0_child0.setPadding(Edge.Bottom, 4);
    root_child0_child0.setBorder(Edge.Left, 8);
    root_child0_child0.setBorder(Edge.Top, 10);
    root_child0_child0.setBorder(Edge.Right, 2);
    root_child0_child0.setBorder(Edge.Bottom, 1);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0.setWidth("21%");
    root_child0_child0.insertChild(root_child0_child0_child0, 0);

    const root_child0_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0_child0.setWidth(100);
    root_child0_child0_child0_child0.setHeight(50);
    root_child0_child0_child0.insertChild(root_child0_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(69);
    expect(root.getComputedHeight()).toBe(79);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(56);
    expect(root_child0.getComputedHeight()).toBe(73);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(20);
    expect(root_child0_child0.getComputedHeight()).toBe(22);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(18);
    expect(root_child0_child0_child0.getComputedTop()).toBe(-82);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(69);
    expect(root.getComputedHeight()).toBe(79);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(56);
    expect(root_child0.getComputedHeight()).toBe(73);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(20);
    expect(root_child0_child0.getComputedHeight()).toBe(22);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(-15);
    expect(root_child0_child0_child0.getComputedTop()).toBe(-82);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(-97);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_justify_flex_start_amalgamation", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Left, 4);
    root_child0.setMargin(Edge.Top, 5);
    root_child0.setMargin(Edge.Right, 9);
    root_child0.setMargin(Edge.Bottom, 1);
    root_child0.setPadding(Edge.Left, 2);
    root_child0.setPadding(Edge.Top, 9);
    root_child0.setPadding(Edge.Right, 11);
    root_child0.setPadding(Edge.Bottom, 13);
    root_child0.setBorder(Edge.Left, 5);
    root_child0.setBorder(Edge.Top, 6);
    root_child0.setBorder(Edge.Right, 7);
    root_child0.setBorder(Edge.Bottom, 8);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setMargin(Edge.Left, 8);
    root_child0_child0.setMargin(Edge.Top, 6);
    root_child0_child0.setMargin(Edge.Right, 3);
    root_child0_child0.setMargin(Edge.Bottom, 9);
    root_child0_child0.setPadding(Edge.Left, 1);
    root_child0_child0.setPadding(Edge.Top, 7);
    root_child0_child0.setPadding(Edge.Right, 9);
    root_child0_child0.setPadding(Edge.Bottom, 4);
    root_child0_child0.setBorder(Edge.Left, 8);
    root_child0_child0.setBorder(Edge.Top, 10);
    root_child0_child0.setBorder(Edge.Right, 2);
    root_child0_child0.setBorder(Edge.Bottom, 1);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0.setWidth("21%");
    root_child0_child0.insertChild(root_child0_child0_child0, 0);

    const root_child0_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0_child0.setWidth(100);
    root_child0_child0_child0_child0.setHeight(50);
    root_child0_child0_child0.insertChild(root_child0_child0_child0_child0, 0);

    const root_child0_child0_child1 = Yoga.Node.create(config);
    root_child0_child0_child1.setMargin(Edge.Left, 9);
    root_child0_child0_child1.setMargin(Edge.Top, 12);
    root_child0_child0_child1.setMargin(Edge.Right, 4);
    root_child0_child0_child1.setMargin(Edge.Bottom, 7);
    root_child0_child0_child1.setPadding(Edge.Left, 5);
    root_child0_child0_child1.setPadding(Edge.Top, 3);
    root_child0_child0_child1.setPadding(Edge.Right, 8);
    root_child0_child0_child1.setPadding(Edge.Bottom, 10);
    root_child0_child0_child1.setBorder(Edge.Left, 2);
    root_child0_child0_child1.setBorder(Edge.Top, 1);
    root_child0_child0_child1.setBorder(Edge.Right, 5);
    root_child0_child0_child1.setBorder(Edge.Bottom, 9);
    root_child0_child0_child1.setWidth("10%");
    root_child0_child0.insertChild(root_child0_child0_child1, 1);

    const root_child0_child0_child1_child0 = Yoga.Node.create(config);
    root_child0_child0_child1_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child1_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child1_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child1_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child1_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child1_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child1_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child1_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child1_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child1_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child1_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child1_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child1_child0.setWidth(100);
    root_child0_child0_child1_child0.setHeight(50);
    root_child0_child0_child1.insertChild(root_child0_child0_child1_child0, 0);

    const root_child0_child0_child2 = Yoga.Node.create(config);
    root_child0_child0_child2.setMargin(Edge.Left, 9);
    root_child0_child0_child2.setMargin(Edge.Top, 12);
    root_child0_child0_child2.setMargin(Edge.Right, 4);
    root_child0_child0_child2.setMargin(Edge.Bottom, 7);
    root_child0_child0_child2.setPadding(Edge.Left, 5);
    root_child0_child0_child2.setPadding(Edge.Top, 3);
    root_child0_child0_child2.setPadding(Edge.Right, 8);
    root_child0_child0_child2.setPadding(Edge.Bottom, 10);
    root_child0_child0_child2.setBorder(Edge.Left, 2);
    root_child0_child0_child2.setBorder(Edge.Top, 1);
    root_child0_child0_child2.setBorder(Edge.Right, 5);
    root_child0_child0_child2.setBorder(Edge.Bottom, 9);
    root_child0_child0_child2.setWidth("10%");
    root_child0_child0.insertChild(root_child0_child0_child2, 2);

    const root_child0_child0_child2_child0 = Yoga.Node.create(config);
    root_child0_child0_child2_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child2_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child2_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child2_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child2_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child2_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child2_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child2_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child2_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child2_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child2_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child2_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child2_child0.setWidth(100);
    root_child0_child0_child2_child0.setHeight(50);
    root_child0_child0_child2.insertChild(root_child0_child0_child2_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(215);
    expect(root.getComputedHeight()).toBe(301);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(202);
    expect(root_child0.getComputedHeight()).toBe(295);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(166);
    expect(root_child0_child0.getComputedHeight()).toBe(244);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(18);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child1.getComputedLeft()).toBe(18);
    expect(root_child0_child0_child1.getComputedTop()).toBe(29);
    expect(root_child0_child0_child1.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child1.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child1_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child1_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child1_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child1_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child2.getComputedLeft()).toBe(18);
    expect(root_child0_child0_child2.getComputedTop()).toBe(140);
    expect(root_child0_child0_child2.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child2.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child2_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child2_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child2_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child2_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(215);
    expect(root.getComputedHeight()).toBe(301);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(202);
    expect(root_child0.getComputedHeight()).toBe(295);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(166);
    expect(root_child0_child0.getComputedHeight()).toBe(244);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(111);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(-77);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child1.getComputedLeft()).toBe(131);
    expect(root_child0_child0_child1.getComputedTop()).toBe(29);
    expect(root_child0_child0_child1.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child1.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child1_child0.getComputedLeft()).toBe(-97);
    expect(root_child0_child0_child1_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child1_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child1_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child2.getComputedLeft()).toBe(131);
    expect(root_child0_child0_child2.getComputedTop()).toBe(140);
    expect(root_child0_child0_child2.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child2.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child2_child0.getComputedLeft()).toBe(-97);
    expect(root_child0_child0_child2_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child2_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child2_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_justify_flex_start_position_set_amalgamation", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Left, 4);
    root_child0.setMargin(Edge.Top, 5);
    root_child0.setMargin(Edge.Right, 9);
    root_child0.setMargin(Edge.Bottom, 1);
    root_child0.setPadding(Edge.Left, 2);
    root_child0.setPadding(Edge.Top, 9);
    root_child0.setPadding(Edge.Right, 11);
    root_child0.setPadding(Edge.Bottom, 13);
    root_child0.setBorder(Edge.Left, 5);
    root_child0.setBorder(Edge.Top, 6);
    root_child0.setBorder(Edge.Right, 7);
    root_child0.setBorder(Edge.Bottom, 8);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setMargin(Edge.Left, 8);
    root_child0_child0.setMargin(Edge.Top, 6);
    root_child0_child0.setMargin(Edge.Right, 3);
    root_child0_child0.setMargin(Edge.Bottom, 9);
    root_child0_child0.setPadding(Edge.Left, 1);
    root_child0_child0.setPadding(Edge.Top, 7);
    root_child0_child0.setPadding(Edge.Right, 9);
    root_child0_child0.setPadding(Edge.Bottom, 4);
    root_child0_child0.setBorder(Edge.Left, 8);
    root_child0_child0.setBorder(Edge.Top, 10);
    root_child0_child0.setBorder(Edge.Right, 2);
    root_child0_child0.setBorder(Edge.Bottom, 1);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setPosition(Edge.Right, 30);
    root_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0.setWidth("21%");
    root_child0_child0.insertChild(root_child0_child0_child0, 0);

    const root_child0_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0_child0.setWidth(100);
    root_child0_child0_child0_child0.setHeight(50);
    root_child0_child0_child0.insertChild(root_child0_child0_child0_child0, 0);

    const root_child0_child0_child1 = Yoga.Node.create(config);
    root_child0_child0_child1.setMargin(Edge.Left, 9);
    root_child0_child0_child1.setMargin(Edge.Top, 12);
    root_child0_child0_child1.setMargin(Edge.Right, 4);
    root_child0_child0_child1.setMargin(Edge.Bottom, 7);
    root_child0_child0_child1.setPadding(Edge.Left, 5);
    root_child0_child0_child1.setPadding(Edge.Top, 3);
    root_child0_child0_child1.setPadding(Edge.Right, 8);
    root_child0_child0_child1.setPadding(Edge.Bottom, 10);
    root_child0_child0_child1.setBorder(Edge.Left, 2);
    root_child0_child0_child1.setBorder(Edge.Top, 1);
    root_child0_child0_child1.setBorder(Edge.Right, 5);
    root_child0_child0_child1.setBorder(Edge.Bottom, 9);
    root_child0_child0_child1.setWidth("10%");
    root_child0_child0.insertChild(root_child0_child0_child1, 1);

    const root_child0_child0_child1_child0 = Yoga.Node.create(config);
    root_child0_child0_child1_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child1_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child1_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child1_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child1_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child1_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child1_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child1_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child1_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child1_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child1_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child1_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child1_child0.setWidth(100);
    root_child0_child0_child1_child0.setHeight(50);
    root_child0_child0_child1.insertChild(root_child0_child0_child1_child0, 0);

    const root_child0_child0_child2 = Yoga.Node.create(config);
    root_child0_child0_child2.setMargin(Edge.Left, 9);
    root_child0_child0_child2.setMargin(Edge.Top, 12);
    root_child0_child0_child2.setMargin(Edge.Right, 4);
    root_child0_child0_child2.setMargin(Edge.Bottom, 7);
    root_child0_child0_child2.setPadding(Edge.Left, 5);
    root_child0_child0_child2.setPadding(Edge.Top, 3);
    root_child0_child0_child2.setPadding(Edge.Right, 8);
    root_child0_child0_child2.setPadding(Edge.Bottom, 10);
    root_child0_child0_child2.setBorder(Edge.Left, 2);
    root_child0_child0_child2.setBorder(Edge.Top, 1);
    root_child0_child0_child2.setBorder(Edge.Right, 5);
    root_child0_child0_child2.setBorder(Edge.Bottom, 9);
    root_child0_child0_child2.setWidth("10%");
    root_child0_child0.insertChild(root_child0_child0_child2, 2);

    const root_child0_child0_child2_child0 = Yoga.Node.create(config);
    root_child0_child0_child2_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child2_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child2_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child2_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child2_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child2_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child2_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child2_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child2_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child2_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child2_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child2_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child2_child0.setWidth(100);
    root_child0_child0_child2_child0.setHeight(50);
    root_child0_child0_child2.insertChild(root_child0_child0_child2_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(215);
    expect(root.getComputedHeight()).toBe(301);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(202);
    expect(root_child0.getComputedHeight()).toBe(295);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(166);
    expect(root_child0_child0.getComputedHeight()).toBe(244);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(106);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child1.getComputedLeft()).toBe(18);
    expect(root_child0_child0_child1.getComputedTop()).toBe(29);
    expect(root_child0_child0_child1.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child1.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child1_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child1_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child1_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child1_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child2.getComputedLeft()).toBe(18);
    expect(root_child0_child0_child2.getComputedTop()).toBe(140);
    expect(root_child0_child0_child2.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child2.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child2_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child2_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child2_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child2_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(215);
    expect(root.getComputedHeight()).toBe(301);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(202);
    expect(root_child0.getComputedHeight()).toBe(295);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(166);
    expect(root_child0_child0.getComputedHeight()).toBe(244);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(106);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(-77);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child1.getComputedLeft()).toBe(131);
    expect(root_child0_child0_child1.getComputedTop()).toBe(29);
    expect(root_child0_child0_child1.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child1.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child1_child0.getComputedLeft()).toBe(-97);
    expect(root_child0_child0_child1_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child1_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child1_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child2.getComputedLeft()).toBe(131);
    expect(root_child0_child0_child2.getComputedTop()).toBe(140);
    expect(root_child0_child0_child2.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child2.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child2_child0.getComputedLeft()).toBe(-97);
    expect(root_child0_child0_child2_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child2_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child2_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_no_definite_size_amalgamation", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Left, 4);
    root_child0.setMargin(Edge.Top, 5);
    root_child0.setMargin(Edge.Right, 9);
    root_child0.setMargin(Edge.Bottom, 1);
    root_child0.setPadding(Edge.Left, 2);
    root_child0.setPadding(Edge.Top, 9);
    root_child0.setPadding(Edge.Right, 11);
    root_child0.setPadding(Edge.Bottom, 13);
    root_child0.setBorder(Edge.Left, 5);
    root_child0.setBorder(Edge.Top, 6);
    root_child0.setBorder(Edge.Right, 7);
    root_child0.setBorder(Edge.Bottom, 8);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setMargin(Edge.Left, 8);
    root_child0_child0.setMargin(Edge.Top, 6);
    root_child0_child0.setMargin(Edge.Right, 3);
    root_child0_child0.setMargin(Edge.Bottom, 9);
    root_child0_child0.setPadding(Edge.Left, 1);
    root_child0_child0.setPadding(Edge.Top, 7);
    root_child0_child0.setPadding(Edge.Right, 9);
    root_child0_child0.setPadding(Edge.Bottom, 4);
    root_child0_child0.setBorder(Edge.Left, 8);
    root_child0_child0.setBorder(Edge.Top, 10);
    root_child0_child0.setBorder(Edge.Right, 2);
    root_child0_child0.setBorder(Edge.Bottom, 1);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setPosition(Edge.Left, "23%");
    root_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);

    const root_child0_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0_child0.setWidth(100);
    root_child0_child0_child0_child0.setHeight(50);
    root_child0_child0_child0.insertChild(root_child0_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(69);
    expect(root.getComputedHeight()).toBe(79);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(56);
    expect(root_child0.getComputedHeight()).toBe(73);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(20);
    expect(root_child0_child0.getComputedHeight()).toBe(22);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(9);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(133);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(69);
    expect(root.getComputedHeight()).toBe(79);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(56);
    expect(root_child0.getComputedHeight()).toBe(73);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(20);
    expect(root_child0_child0.getComputedHeight()).toBe(22);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(9);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(133);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_both_insets_set_amalgamation", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Left, 4);
    root_child0.setMargin(Edge.Top, 5);
    root_child0.setMargin(Edge.Right, 9);
    root_child0.setMargin(Edge.Bottom, 1);
    root_child0.setPadding(Edge.Left, 2);
    root_child0.setPadding(Edge.Top, 9);
    root_child0.setPadding(Edge.Right, 11);
    root_child0.setPadding(Edge.Bottom, 13);
    root_child0.setBorder(Edge.Left, 5);
    root_child0.setBorder(Edge.Top, 6);
    root_child0.setBorder(Edge.Right, 7);
    root_child0.setBorder(Edge.Bottom, 8);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setMargin(Edge.Left, 8);
    root_child0_child0.setMargin(Edge.Top, 6);
    root_child0_child0.setMargin(Edge.Right, 3);
    root_child0_child0.setMargin(Edge.Bottom, 9);
    root_child0_child0.setPadding(Edge.Left, 1);
    root_child0_child0.setPadding(Edge.Top, 7);
    root_child0_child0.setPadding(Edge.Right, 9);
    root_child0_child0.setPadding(Edge.Bottom, 4);
    root_child0_child0.setBorder(Edge.Left, 8);
    root_child0_child0.setBorder(Edge.Top, 10);
    root_child0_child0.setBorder(Edge.Right, 2);
    root_child0_child0.setBorder(Edge.Bottom, 1);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setPosition(Edge.Left, "23%");
    root_child0_child0_child0.setPosition(Edge.Right, 13);
    root_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);

    const root_child0_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0_child0.setWidth(100);
    root_child0_child0_child0_child0.setHeight(50);
    root_child0_child0_child0.insertChild(root_child0_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(69);
    expect(root.getComputedHeight()).toBe(79);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(56);
    expect(root_child0.getComputedHeight()).toBe(73);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(20);
    expect(root_child0_child0.getComputedHeight()).toBe(22);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(9);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(69);
    expect(root.getComputedHeight()).toBe(79);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(56);
    expect(root_child0.getComputedHeight()).toBe(73);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(20);
    expect(root_child0_child0.getComputedHeight()).toBe(22);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(-3);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(-97);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_justify_center_amalgamation", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Left, 4);
    root_child0.setMargin(Edge.Top, 5);
    root_child0.setMargin(Edge.Right, 9);
    root_child0.setMargin(Edge.Bottom, 1);
    root_child0.setPadding(Edge.Left, 2);
    root_child0.setPadding(Edge.Top, 9);
    root_child0.setPadding(Edge.Right, 11);
    root_child0.setPadding(Edge.Bottom, 13);
    root_child0.setBorder(Edge.Left, 5);
    root_child0.setBorder(Edge.Top, 6);
    root_child0.setBorder(Edge.Right, 7);
    root_child0.setBorder(Edge.Bottom, 8);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setJustifyContent(Justify.Center);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setMargin(Edge.Left, 8);
    root_child0_child0.setMargin(Edge.Top, 6);
    root_child0_child0.setMargin(Edge.Right, 3);
    root_child0_child0.setMargin(Edge.Bottom, 9);
    root_child0_child0.setPadding(Edge.Left, 1);
    root_child0_child0.setPadding(Edge.Top, 7);
    root_child0_child0.setPadding(Edge.Right, 9);
    root_child0_child0.setPadding(Edge.Bottom, 4);
    root_child0_child0.setBorder(Edge.Left, 8);
    root_child0_child0.setBorder(Edge.Top, 10);
    root_child0_child0.setBorder(Edge.Right, 2);
    root_child0_child0.setBorder(Edge.Bottom, 1);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0.setWidth("21%");
    root_child0_child0.insertChild(root_child0_child0_child0, 0);

    const root_child0_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0_child0.setWidth(100);
    root_child0_child0_child0_child0.setHeight(50);
    root_child0_child0_child0.insertChild(root_child0_child0_child0_child0, 0);

    const root_child0_child0_child1 = Yoga.Node.create(config);
    root_child0_child0_child1.setMargin(Edge.Left, 9);
    root_child0_child0_child1.setMargin(Edge.Top, 12);
    root_child0_child0_child1.setMargin(Edge.Right, 4);
    root_child0_child0_child1.setMargin(Edge.Bottom, 7);
    root_child0_child0_child1.setPadding(Edge.Left, 5);
    root_child0_child0_child1.setPadding(Edge.Top, 3);
    root_child0_child0_child1.setPadding(Edge.Right, 8);
    root_child0_child0_child1.setPadding(Edge.Bottom, 10);
    root_child0_child0_child1.setBorder(Edge.Left, 2);
    root_child0_child0_child1.setBorder(Edge.Top, 1);
    root_child0_child0_child1.setBorder(Edge.Right, 5);
    root_child0_child0_child1.setBorder(Edge.Bottom, 9);
    root_child0_child0_child1.setWidth("10%");
    root_child0_child0.insertChild(root_child0_child0_child1, 1);

    const root_child0_child0_child1_child0 = Yoga.Node.create(config);
    root_child0_child0_child1_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child1_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child1_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child1_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child1_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child1_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child1_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child1_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child1_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child1_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child1_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child1_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child1_child0.setWidth(100);
    root_child0_child0_child1_child0.setHeight(50);
    root_child0_child0_child1.insertChild(root_child0_child0_child1_child0, 0);

    const root_child0_child0_child2 = Yoga.Node.create(config);
    root_child0_child0_child2.setMargin(Edge.Left, 9);
    root_child0_child0_child2.setMargin(Edge.Top, 12);
    root_child0_child0_child2.setMargin(Edge.Right, 4);
    root_child0_child0_child2.setMargin(Edge.Bottom, 7);
    root_child0_child0_child2.setPadding(Edge.Left, 5);
    root_child0_child0_child2.setPadding(Edge.Top, 3);
    root_child0_child0_child2.setPadding(Edge.Right, 8);
    root_child0_child0_child2.setPadding(Edge.Bottom, 10);
    root_child0_child0_child2.setBorder(Edge.Left, 2);
    root_child0_child0_child2.setBorder(Edge.Top, 1);
    root_child0_child0_child2.setBorder(Edge.Right, 5);
    root_child0_child0_child2.setBorder(Edge.Bottom, 9);
    root_child0_child0_child2.setWidth("10%");
    root_child0_child0.insertChild(root_child0_child0_child2, 2);

    const root_child0_child0_child2_child0 = Yoga.Node.create(config);
    root_child0_child0_child2_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child2_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child2_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child2_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child2_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child2_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child2_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child2_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child2_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child2_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child2_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child2_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child2_child0.setWidth(100);
    root_child0_child0_child2_child0.setHeight(50);
    root_child0_child0_child2.insertChild(root_child0_child0_child2_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(215);
    expect(root.getComputedHeight()).toBe(301);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(202);
    expect(root_child0.getComputedHeight()).toBe(295);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(166);
    expect(root_child0_child0.getComputedHeight()).toBe(244);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(18);
    expect(root_child0_child0_child0.getComputedTop()).toBe(85);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child1.getComputedLeft()).toBe(18);
    expect(root_child0_child0_child1.getComputedTop()).toBe(29);
    expect(root_child0_child0_child1.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child1.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child1_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child1_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child1_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child1_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child2.getComputedLeft()).toBe(18);
    expect(root_child0_child0_child2.getComputedTop()).toBe(140);
    expect(root_child0_child0_child2.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child2.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child2_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child2_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child2_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child2_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(215);
    expect(root.getComputedHeight()).toBe(301);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(202);
    expect(root_child0.getComputedHeight()).toBe(295);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(166);
    expect(root_child0_child0.getComputedHeight()).toBe(244);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(111);
    expect(root_child0_child0_child0.getComputedTop()).toBe(85);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(-77);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child1.getComputedLeft()).toBe(131);
    expect(root_child0_child0_child1.getComputedTop()).toBe(29);
    expect(root_child0_child0_child1.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child1.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child1_child0.getComputedLeft()).toBe(-97);
    expect(root_child0_child0_child1_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child1_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child1_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child2.getComputedLeft()).toBe(131);
    expect(root_child0_child0_child2.getComputedTop()).toBe(140);
    expect(root_child0_child0_child2.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child2.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child2_child0.getComputedLeft()).toBe(-97);
    expect(root_child0_child0_child2_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child2_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child2_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_justify_flex_end_amalgamation", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Left, 4);
    root_child0.setMargin(Edge.Top, 5);
    root_child0.setMargin(Edge.Right, 9);
    root_child0.setMargin(Edge.Bottom, 1);
    root_child0.setPadding(Edge.Left, 2);
    root_child0.setPadding(Edge.Top, 9);
    root_child0.setPadding(Edge.Right, 11);
    root_child0.setPadding(Edge.Bottom, 13);
    root_child0.setBorder(Edge.Left, 5);
    root_child0.setBorder(Edge.Top, 6);
    root_child0.setBorder(Edge.Right, 7);
    root_child0.setBorder(Edge.Bottom, 8);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setJustifyContent(Justify.FlexEnd);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setMargin(Edge.Left, 8);
    root_child0_child0.setMargin(Edge.Top, 6);
    root_child0_child0.setMargin(Edge.Right, 3);
    root_child0_child0.setMargin(Edge.Bottom, 9);
    root_child0_child0.setPadding(Edge.Left, 1);
    root_child0_child0.setPadding(Edge.Top, 7);
    root_child0_child0.setPadding(Edge.Right, 9);
    root_child0_child0.setPadding(Edge.Bottom, 4);
    root_child0_child0.setBorder(Edge.Left, 8);
    root_child0_child0.setBorder(Edge.Top, 10);
    root_child0_child0.setBorder(Edge.Right, 2);
    root_child0_child0.setBorder(Edge.Bottom, 1);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0.setWidth("21%");
    root_child0_child0.insertChild(root_child0_child0_child0, 0);

    const root_child0_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0_child0.setWidth(100);
    root_child0_child0_child0_child0.setHeight(50);
    root_child0_child0_child0.insertChild(root_child0_child0_child0_child0, 0);

    const root_child0_child0_child1 = Yoga.Node.create(config);
    root_child0_child0_child1.setMargin(Edge.Left, 9);
    root_child0_child0_child1.setMargin(Edge.Top, 12);
    root_child0_child0_child1.setMargin(Edge.Right, 4);
    root_child0_child0_child1.setMargin(Edge.Bottom, 7);
    root_child0_child0_child1.setPadding(Edge.Left, 5);
    root_child0_child0_child1.setPadding(Edge.Top, 3);
    root_child0_child0_child1.setPadding(Edge.Right, 8);
    root_child0_child0_child1.setPadding(Edge.Bottom, 10);
    root_child0_child0_child1.setBorder(Edge.Left, 2);
    root_child0_child0_child1.setBorder(Edge.Top, 1);
    root_child0_child0_child1.setBorder(Edge.Right, 5);
    root_child0_child0_child1.setBorder(Edge.Bottom, 9);
    root_child0_child0_child1.setWidth("10%");
    root_child0_child0.insertChild(root_child0_child0_child1, 1);

    const root_child0_child0_child1_child0 = Yoga.Node.create(config);
    root_child0_child0_child1_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child1_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child1_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child1_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child1_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child1_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child1_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child1_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child1_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child1_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child1_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child1_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child1_child0.setWidth(100);
    root_child0_child0_child1_child0.setHeight(50);
    root_child0_child0_child1.insertChild(root_child0_child0_child1_child0, 0);

    const root_child0_child0_child2 = Yoga.Node.create(config);
    root_child0_child0_child2.setMargin(Edge.Left, 9);
    root_child0_child0_child2.setMargin(Edge.Top, 12);
    root_child0_child0_child2.setMargin(Edge.Right, 4);
    root_child0_child0_child2.setMargin(Edge.Bottom, 7);
    root_child0_child0_child2.setPadding(Edge.Left, 5);
    root_child0_child0_child2.setPadding(Edge.Top, 3);
    root_child0_child0_child2.setPadding(Edge.Right, 8);
    root_child0_child0_child2.setPadding(Edge.Bottom, 10);
    root_child0_child0_child2.setBorder(Edge.Left, 2);
    root_child0_child0_child2.setBorder(Edge.Top, 1);
    root_child0_child0_child2.setBorder(Edge.Right, 5);
    root_child0_child0_child2.setBorder(Edge.Bottom, 9);
    root_child0_child0_child2.setWidth("10%");
    root_child0_child0.insertChild(root_child0_child0_child2, 2);

    const root_child0_child0_child2_child0 = Yoga.Node.create(config);
    root_child0_child0_child2_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child2_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child2_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child2_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child2_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child2_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child2_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child2_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child2_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child2_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child2_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child2_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child2_child0.setWidth(100);
    root_child0_child0_child2_child0.setHeight(50);
    root_child0_child0_child2.insertChild(root_child0_child0_child2_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(215);
    expect(root.getComputedHeight()).toBe(301);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(202);
    expect(root_child0.getComputedHeight()).toBe(295);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(166);
    expect(root_child0_child0.getComputedHeight()).toBe(244);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(18);
    expect(root_child0_child0_child0.getComputedTop()).toBe(140);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child1.getComputedLeft()).toBe(18);
    expect(root_child0_child0_child1.getComputedTop()).toBe(29);
    expect(root_child0_child0_child1.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child1.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child1_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child1_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child1_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child1_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child2.getComputedLeft()).toBe(18);
    expect(root_child0_child0_child2.getComputedTop()).toBe(140);
    expect(root_child0_child0_child2.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child2.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child2_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child2_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child2_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child2_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(215);
    expect(root.getComputedHeight()).toBe(301);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(202);
    expect(root_child0.getComputedHeight()).toBe(295);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(166);
    expect(root_child0_child0.getComputedHeight()).toBe(244);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(111);
    expect(root_child0_child0_child0.getComputedTop()).toBe(140);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(-77);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child1.getComputedLeft()).toBe(131);
    expect(root_child0_child0_child1.getComputedTop()).toBe(29);
    expect(root_child0_child0_child1.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child1.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child1_child0.getComputedLeft()).toBe(-97);
    expect(root_child0_child0_child1_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child1_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child1_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child2.getComputedLeft()).toBe(131);
    expect(root_child0_child0_child2.getComputedTop()).toBe(140);
    expect(root_child0_child0_child2.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child2.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child2_child0.getComputedLeft()).toBe(-97);
    expect(root_child0_child0_child2_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child2_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child2_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_align_flex_start_amalgamation", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Left, 4);
    root_child0.setMargin(Edge.Top, 5);
    root_child0.setMargin(Edge.Right, 9);
    root_child0.setMargin(Edge.Bottom, 1);
    root_child0.setPadding(Edge.Left, 2);
    root_child0.setPadding(Edge.Top, 9);
    root_child0.setPadding(Edge.Right, 11);
    root_child0.setPadding(Edge.Bottom, 13);
    root_child0.setBorder(Edge.Left, 5);
    root_child0.setBorder(Edge.Top, 6);
    root_child0.setBorder(Edge.Right, 7);
    root_child0.setBorder(Edge.Bottom, 8);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setAlignItems(Align.FlexStart);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setMargin(Edge.Left, 8);
    root_child0_child0.setMargin(Edge.Top, 6);
    root_child0_child0.setMargin(Edge.Right, 3);
    root_child0_child0.setMargin(Edge.Bottom, 9);
    root_child0_child0.setPadding(Edge.Left, 1);
    root_child0_child0.setPadding(Edge.Top, 7);
    root_child0_child0.setPadding(Edge.Right, 9);
    root_child0_child0.setPadding(Edge.Bottom, 4);
    root_child0_child0.setBorder(Edge.Left, 8);
    root_child0_child0.setBorder(Edge.Top, 10);
    root_child0_child0.setBorder(Edge.Right, 2);
    root_child0_child0.setBorder(Edge.Bottom, 1);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0.setWidth("21%");
    root_child0_child0.insertChild(root_child0_child0_child0, 0);

    const root_child0_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0_child0.setWidth(100);
    root_child0_child0_child0_child0.setHeight(50);
    root_child0_child0_child0.insertChild(root_child0_child0_child0_child0, 0);

    const root_child0_child0_child1 = Yoga.Node.create(config);
    root_child0_child0_child1.setMargin(Edge.Left, 9);
    root_child0_child0_child1.setMargin(Edge.Top, 12);
    root_child0_child0_child1.setMargin(Edge.Right, 4);
    root_child0_child0_child1.setMargin(Edge.Bottom, 7);
    root_child0_child0_child1.setPadding(Edge.Left, 5);
    root_child0_child0_child1.setPadding(Edge.Top, 3);
    root_child0_child0_child1.setPadding(Edge.Right, 8);
    root_child0_child0_child1.setPadding(Edge.Bottom, 10);
    root_child0_child0_child1.setBorder(Edge.Left, 2);
    root_child0_child0_child1.setBorder(Edge.Top, 1);
    root_child0_child0_child1.setBorder(Edge.Right, 5);
    root_child0_child0_child1.setBorder(Edge.Bottom, 9);
    root_child0_child0_child1.setWidth("10%");
    root_child0_child0.insertChild(root_child0_child0_child1, 1);

    const root_child0_child0_child1_child0 = Yoga.Node.create(config);
    root_child0_child0_child1_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child1_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child1_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child1_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child1_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child1_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child1_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child1_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child1_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child1_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child1_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child1_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child1_child0.setWidth(100);
    root_child0_child0_child1_child0.setHeight(50);
    root_child0_child0_child1.insertChild(root_child0_child0_child1_child0, 0);

    const root_child0_child0_child2 = Yoga.Node.create(config);
    root_child0_child0_child2.setMargin(Edge.Left, 9);
    root_child0_child0_child2.setMargin(Edge.Top, 12);
    root_child0_child0_child2.setMargin(Edge.Right, 4);
    root_child0_child0_child2.setMargin(Edge.Bottom, 7);
    root_child0_child0_child2.setPadding(Edge.Left, 5);
    root_child0_child0_child2.setPadding(Edge.Top, 3);
    root_child0_child0_child2.setPadding(Edge.Right, 8);
    root_child0_child0_child2.setPadding(Edge.Bottom, 10);
    root_child0_child0_child2.setBorder(Edge.Left, 2);
    root_child0_child0_child2.setBorder(Edge.Top, 1);
    root_child0_child0_child2.setBorder(Edge.Right, 5);
    root_child0_child0_child2.setBorder(Edge.Bottom, 9);
    root_child0_child0_child2.setWidth("10%");
    root_child0_child0.insertChild(root_child0_child0_child2, 2);

    const root_child0_child0_child2_child0 = Yoga.Node.create(config);
    root_child0_child0_child2_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child2_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child2_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child2_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child2_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child2_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child2_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child2_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child2_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child2_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child2_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child2_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child2_child0.setWidth(100);
    root_child0_child0_child2_child0.setHeight(50);
    root_child0_child0_child2.insertChild(root_child0_child0_child2_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(215);
    expect(root.getComputedHeight()).toBe(301);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(202);
    expect(root_child0.getComputedHeight()).toBe(295);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(166);
    expect(root_child0_child0.getComputedHeight()).toBe(244);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(18);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child1.getComputedLeft()).toBe(18);
    expect(root_child0_child0_child1.getComputedTop()).toBe(29);
    expect(root_child0_child0_child1.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child1.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child1_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child1_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child1_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child1_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child2.getComputedLeft()).toBe(18);
    expect(root_child0_child0_child2.getComputedTop()).toBe(140);
    expect(root_child0_child0_child2.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child2.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child2_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child2_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child2_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child2_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(215);
    expect(root.getComputedHeight()).toBe(301);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(202);
    expect(root_child0.getComputedHeight()).toBe(295);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(166);
    expect(root_child0_child0.getComputedHeight()).toBe(244);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(111);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(-77);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child1.getComputedLeft()).toBe(131);
    expect(root_child0_child0_child1.getComputedTop()).toBe(29);
    expect(root_child0_child0_child1.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child1.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child1_child0.getComputedLeft()).toBe(-97);
    expect(root_child0_child0_child1_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child1_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child1_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child2.getComputedLeft()).toBe(131);
    expect(root_child0_child0_child2.getComputedTop()).toBe(140);
    expect(root_child0_child0_child2.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child2.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child2_child0.getComputedLeft()).toBe(-97);
    expect(root_child0_child0_child2_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child2_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child2_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_align_center_amalgamation", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Left, 4);
    root_child0.setMargin(Edge.Top, 5);
    root_child0.setMargin(Edge.Right, 9);
    root_child0.setMargin(Edge.Bottom, 1);
    root_child0.setPadding(Edge.Left, 2);
    root_child0.setPadding(Edge.Top, 9);
    root_child0.setPadding(Edge.Right, 11);
    root_child0.setPadding(Edge.Bottom, 13);
    root_child0.setBorder(Edge.Left, 5);
    root_child0.setBorder(Edge.Top, 6);
    root_child0.setBorder(Edge.Right, 7);
    root_child0.setBorder(Edge.Bottom, 8);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setAlignItems(Align.Center);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setMargin(Edge.Left, 8);
    root_child0_child0.setMargin(Edge.Top, 6);
    root_child0_child0.setMargin(Edge.Right, 3);
    root_child0_child0.setMargin(Edge.Bottom, 9);
    root_child0_child0.setPadding(Edge.Left, 1);
    root_child0_child0.setPadding(Edge.Top, 7);
    root_child0_child0.setPadding(Edge.Right, 9);
    root_child0_child0.setPadding(Edge.Bottom, 4);
    root_child0_child0.setBorder(Edge.Left, 8);
    root_child0_child0.setBorder(Edge.Top, 10);
    root_child0_child0.setBorder(Edge.Right, 2);
    root_child0_child0.setBorder(Edge.Bottom, 1);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0.setWidth("21%");
    root_child0_child0.insertChild(root_child0_child0_child0, 0);

    const root_child0_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0_child0.setWidth(100);
    root_child0_child0_child0_child0.setHeight(50);
    root_child0_child0_child0.insertChild(root_child0_child0_child0_child0, 0);

    const root_child0_child0_child1 = Yoga.Node.create(config);
    root_child0_child0_child1.setMargin(Edge.Left, 9);
    root_child0_child0_child1.setMargin(Edge.Top, 12);
    root_child0_child0_child1.setMargin(Edge.Right, 4);
    root_child0_child0_child1.setMargin(Edge.Bottom, 7);
    root_child0_child0_child1.setPadding(Edge.Left, 5);
    root_child0_child0_child1.setPadding(Edge.Top, 3);
    root_child0_child0_child1.setPadding(Edge.Right, 8);
    root_child0_child0_child1.setPadding(Edge.Bottom, 10);
    root_child0_child0_child1.setBorder(Edge.Left, 2);
    root_child0_child0_child1.setBorder(Edge.Top, 1);
    root_child0_child0_child1.setBorder(Edge.Right, 5);
    root_child0_child0_child1.setBorder(Edge.Bottom, 9);
    root_child0_child0_child1.setWidth("10%");
    root_child0_child0.insertChild(root_child0_child0_child1, 1);

    const root_child0_child0_child1_child0 = Yoga.Node.create(config);
    root_child0_child0_child1_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child1_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child1_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child1_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child1_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child1_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child1_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child1_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child1_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child1_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child1_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child1_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child1_child0.setWidth(100);
    root_child0_child0_child1_child0.setHeight(50);
    root_child0_child0_child1.insertChild(root_child0_child0_child1_child0, 0);

    const root_child0_child0_child2 = Yoga.Node.create(config);
    root_child0_child0_child2.setMargin(Edge.Left, 9);
    root_child0_child0_child2.setMargin(Edge.Top, 12);
    root_child0_child0_child2.setMargin(Edge.Right, 4);
    root_child0_child0_child2.setMargin(Edge.Bottom, 7);
    root_child0_child0_child2.setPadding(Edge.Left, 5);
    root_child0_child0_child2.setPadding(Edge.Top, 3);
    root_child0_child0_child2.setPadding(Edge.Right, 8);
    root_child0_child0_child2.setPadding(Edge.Bottom, 10);
    root_child0_child0_child2.setBorder(Edge.Left, 2);
    root_child0_child0_child2.setBorder(Edge.Top, 1);
    root_child0_child0_child2.setBorder(Edge.Right, 5);
    root_child0_child0_child2.setBorder(Edge.Bottom, 9);
    root_child0_child0_child2.setWidth("10%");
    root_child0_child0.insertChild(root_child0_child0_child2, 2);

    const root_child0_child0_child2_child0 = Yoga.Node.create(config);
    root_child0_child0_child2_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child2_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child2_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child2_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child2_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child2_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child2_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child2_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child2_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child2_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child2_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child2_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child2_child0.setWidth(100);
    root_child0_child0_child2_child0.setHeight(50);
    root_child0_child0_child2.insertChild(root_child0_child0_child2_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(215);
    expect(root.getComputedHeight()).toBe(301);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(202);
    expect(root_child0.getComputedHeight()).toBe(295);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(166);
    expect(root_child0_child0.getComputedHeight()).toBe(244);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(65);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(39);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child1.getComputedLeft()).toBe(75);
    expect(root_child0_child0_child1.getComputedTop()).toBe(29);
    expect(root_child0_child0_child1.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child1.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child1_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child1_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child1_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child1_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child2.getComputedLeft()).toBe(75);
    expect(root_child0_child0_child2.getComputedTop()).toBe(140);
    expect(root_child0_child0_child2.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child2.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child2_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child2_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child2_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child2_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(215);
    expect(root.getComputedHeight()).toBe(301);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(202);
    expect(root_child0.getComputedHeight()).toBe(295);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(166);
    expect(root_child0_child0.getComputedHeight()).toBe(244);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(65);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(39);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(-77);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child1.getComputedLeft()).toBe(75);
    expect(root_child0_child0_child1.getComputedTop()).toBe(29);
    expect(root_child0_child0_child1.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child1.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child1_child0.getComputedLeft()).toBe(-97);
    expect(root_child0_child0_child1_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child1_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child1_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child2.getComputedLeft()).toBe(75);
    expect(root_child0_child0_child2.getComputedTop()).toBe(140);
    expect(root_child0_child0_child2.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child2.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child2_child0.getComputedLeft()).toBe(-97);
    expect(root_child0_child0_child2_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child2_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child2_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_align_flex_end_amalgamation", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Left, 4);
    root_child0.setMargin(Edge.Top, 5);
    root_child0.setMargin(Edge.Right, 9);
    root_child0.setMargin(Edge.Bottom, 1);
    root_child0.setPadding(Edge.Left, 2);
    root_child0.setPadding(Edge.Top, 9);
    root_child0.setPadding(Edge.Right, 11);
    root_child0.setPadding(Edge.Bottom, 13);
    root_child0.setBorder(Edge.Left, 5);
    root_child0.setBorder(Edge.Top, 6);
    root_child0.setBorder(Edge.Right, 7);
    root_child0.setBorder(Edge.Bottom, 8);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setAlignItems(Align.FlexEnd);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setMargin(Edge.Left, 8);
    root_child0_child0.setMargin(Edge.Top, 6);
    root_child0_child0.setMargin(Edge.Right, 3);
    root_child0_child0.setMargin(Edge.Bottom, 9);
    root_child0_child0.setPadding(Edge.Left, 1);
    root_child0_child0.setPadding(Edge.Top, 7);
    root_child0_child0.setPadding(Edge.Right, 9);
    root_child0_child0.setPadding(Edge.Bottom, 4);
    root_child0_child0.setBorder(Edge.Left, 8);
    root_child0_child0.setBorder(Edge.Top, 10);
    root_child0_child0.setBorder(Edge.Right, 2);
    root_child0_child0.setBorder(Edge.Bottom, 1);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0.setWidth("21%");
    root_child0_child0.insertChild(root_child0_child0_child0, 0);

    const root_child0_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child0_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child0_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child0_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child0_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child0_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child0_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child0_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child0_child0.setWidth(100);
    root_child0_child0_child0_child0.setHeight(50);
    root_child0_child0_child0.insertChild(root_child0_child0_child0_child0, 0);

    const root_child0_child0_child1 = Yoga.Node.create(config);
    root_child0_child0_child1.setMargin(Edge.Left, 9);
    root_child0_child0_child1.setMargin(Edge.Top, 12);
    root_child0_child0_child1.setMargin(Edge.Right, 4);
    root_child0_child0_child1.setMargin(Edge.Bottom, 7);
    root_child0_child0_child1.setPadding(Edge.Left, 5);
    root_child0_child0_child1.setPadding(Edge.Top, 3);
    root_child0_child0_child1.setPadding(Edge.Right, 8);
    root_child0_child0_child1.setPadding(Edge.Bottom, 10);
    root_child0_child0_child1.setBorder(Edge.Left, 2);
    root_child0_child0_child1.setBorder(Edge.Top, 1);
    root_child0_child0_child1.setBorder(Edge.Right, 5);
    root_child0_child0_child1.setBorder(Edge.Bottom, 9);
    root_child0_child0_child1.setWidth("10%");
    root_child0_child0.insertChild(root_child0_child0_child1, 1);

    const root_child0_child0_child1_child0 = Yoga.Node.create(config);
    root_child0_child0_child1_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child1_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child1_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child1_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child1_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child1_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child1_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child1_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child1_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child1_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child1_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child1_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child1_child0.setWidth(100);
    root_child0_child0_child1_child0.setHeight(50);
    root_child0_child0_child1.insertChild(root_child0_child0_child1_child0, 0);

    const root_child0_child0_child2 = Yoga.Node.create(config);
    root_child0_child0_child2.setMargin(Edge.Left, 9);
    root_child0_child0_child2.setMargin(Edge.Top, 12);
    root_child0_child0_child2.setMargin(Edge.Right, 4);
    root_child0_child0_child2.setMargin(Edge.Bottom, 7);
    root_child0_child0_child2.setPadding(Edge.Left, 5);
    root_child0_child0_child2.setPadding(Edge.Top, 3);
    root_child0_child0_child2.setPadding(Edge.Right, 8);
    root_child0_child0_child2.setPadding(Edge.Bottom, 10);
    root_child0_child0_child2.setBorder(Edge.Left, 2);
    root_child0_child0_child2.setBorder(Edge.Top, 1);
    root_child0_child0_child2.setBorder(Edge.Right, 5);
    root_child0_child0_child2.setBorder(Edge.Bottom, 9);
    root_child0_child0_child2.setWidth("10%");
    root_child0_child0.insertChild(root_child0_child0_child2, 2);

    const root_child0_child0_child2_child0 = Yoga.Node.create(config);
    root_child0_child0_child2_child0.setMargin(Edge.Left, 9);
    root_child0_child0_child2_child0.setMargin(Edge.Top, 12);
    root_child0_child0_child2_child0.setMargin(Edge.Right, 4);
    root_child0_child0_child2_child0.setMargin(Edge.Bottom, 7);
    root_child0_child0_child2_child0.setPadding(Edge.Left, 5);
    root_child0_child0_child2_child0.setPadding(Edge.Top, 3);
    root_child0_child0_child2_child0.setPadding(Edge.Right, 8);
    root_child0_child0_child2_child0.setPadding(Edge.Bottom, 10);
    root_child0_child0_child2_child0.setBorder(Edge.Left, 2);
    root_child0_child0_child2_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child2_child0.setBorder(Edge.Right, 5);
    root_child0_child0_child2_child0.setBorder(Edge.Bottom, 9);
    root_child0_child0_child2_child0.setWidth(100);
    root_child0_child0_child2_child0.setHeight(50);
    root_child0_child0_child2.insertChild(root_child0_child0_child2_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(215);
    expect(root.getComputedHeight()).toBe(301);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(202);
    expect(root_child0.getComputedHeight()).toBe(295);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(166);
    expect(root_child0_child0.getComputedHeight()).toBe(244);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(111);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child1.getComputedLeft()).toBe(131);
    expect(root_child0_child0_child1.getComputedTop()).toBe(29);
    expect(root_child0_child0_child1.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child1.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child1_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child1_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child1_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child1_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child2.getComputedLeft()).toBe(131);
    expect(root_child0_child0_child2.getComputedTop()).toBe(140);
    expect(root_child0_child0_child2.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child2.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child2_child0.getComputedLeft()).toBe(16);
    expect(root_child0_child0_child2_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child2_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child2_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(215);
    expect(root.getComputedHeight()).toBe(301);

    expect(root_child0.getComputedLeft()).toBe(4);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(202);
    expect(root_child0.getComputedHeight()).toBe(295);

    expect(root_child0_child0.getComputedLeft()).toBe(15);
    expect(root_child0_child0.getComputedTop()).toBe(21);
    expect(root_child0_child0.getComputedWidth()).toBe(166);
    expect(root_child0_child0.getComputedHeight()).toBe(244);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(18);
    expect(root_child0_child0_child0.getComputedTop()).toBe(29);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(-77);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child1.getComputedLeft()).toBe(18);
    expect(root_child0_child0_child1.getComputedTop()).toBe(29);
    expect(root_child0_child0_child1.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child1.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child1_child0.getComputedLeft()).toBe(-97);
    expect(root_child0_child0_child1_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child1_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child1_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0_child2.getComputedLeft()).toBe(18);
    expect(root_child0_child0_child2.getComputedTop()).toBe(140);
    expect(root_child0_child0_child2.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child2.getComputedHeight()).toBe(92);

    expect(root_child0_child0_child2_child0.getComputedLeft()).toBe(-97);
    expect(root_child0_child0_child2_child0.getComputedTop()).toBe(16);
    expect(root_child0_child0_child2_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child2_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_static_root", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Static);
    root.setPadding(Edge.Left, 6);
    root.setPadding(Edge.Top, 1);
    root.setPadding(Edge.Right, 11);
    root.setPadding(Edge.Bottom, 4);
    root.setWidth(100);
    root.setHeight(200);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setMargin(Edge.Left, 12);
    root_child0.setMargin(Edge.Top, 11);
    root_child0.setMargin(Edge.Right, 15);
    root_child0.setMargin(Edge.Bottom, 1);
    root_child0.setPadding(Edge.Left, 3);
    root_child0.setPadding(Edge.Top, 7);
    root_child0.setPadding(Edge.Right, 5);
    root_child0.setPadding(Edge.Bottom, 4);
    root_child0.setBorder(Edge.Left, 4);
    root_child0.setBorder(Edge.Top, 3);
    root_child0.setBorder(Edge.Right, 2);
    root_child0.setBorder(Edge.Bottom, 1);
    root_child0.setWidth("50%");
    root_child0.setHeight("50%");
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(18);
    expect(root_child0.getComputedTop()).toBe(12);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(24);
    expect(root_child0.getComputedTop()).toBe(12);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("static_position_absolute_child_multiple", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 100);
    root_child0.setPadding(Edge.Top, 100);
    root_child0.setPadding(Edge.Right, 100);
    root_child0.setPadding(Edge.Bottom, 100);
    root_child0.setWidth(400);
    root_child0.setHeight(400);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Static);
    root_child0_child0.setWidth(100);
    root_child0_child0.setHeight(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0_child0.setWidth("10%");
    root_child0_child0_child0.setHeight(50);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setPositionType(PositionType.Static);
    root_child0_child1.setWidth(100);
    root_child0_child1.setHeight(100);
    root_child0.insertChild(root_child0_child1, 1);

    const root_child0_child1_child0 = Yoga.Node.create(config);
    root_child0_child1_child0.setPositionType(PositionType.Absolute);
    root_child0_child1_child0.setWidth("50%");
    root_child0_child1_child0.setHeight(50);
    root_child0_child1.insertChild(root_child0_child1_child0, 0);

    const root_child0_child1_child1 = Yoga.Node.create(config);
    root_child0_child1_child1.setPositionType(PositionType.Absolute);
    root_child0_child1_child1.setWidth("50%");
    root_child0_child1_child1.setHeight(50);
    root_child0_child1.insertChild(root_child0_child1_child1, 1);

    const root_child0_child2 = Yoga.Node.create(config);
    root_child0_child2.setPositionType(PositionType.Absolute);
    root_child0_child2.setWidth(25);
    root_child0_child2.setHeight(50);
    root_child0.insertChild(root_child0_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(400);

    expect(root_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0.getComputedTop()).toBe(100);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child1.getComputedLeft()).toBe(100);
    expect(root_child0_child1.getComputedTop()).toBe(200);
    expect(root_child0_child1.getComputedWidth()).toBe(100);
    expect(root_child0_child1.getComputedHeight()).toBe(100);

    expect(root_child0_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child1_child0.getComputedTop()).toBe(0);
    expect(root_child0_child1_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child1_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child1_child1.getComputedLeft()).toBe(0);
    expect(root_child0_child1_child1.getComputedTop()).toBe(0);
    expect(root_child0_child1_child1.getComputedWidth()).toBe(200);
    expect(root_child0_child1_child1.getComputedHeight()).toBe(50);

    expect(root_child0_child2.getComputedLeft()).toBe(100);
    expect(root_child0_child2.getComputedTop()).toBe(100);
    expect(root_child0_child2.getComputedWidth()).toBe(25);
    expect(root_child0_child2.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(400);

    expect(root_child0_child0.getComputedLeft()).toBe(200);
    expect(root_child0_child0.getComputedTop()).toBe(100);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(60);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child1.getComputedLeft()).toBe(200);
    expect(root_child0_child1.getComputedTop()).toBe(200);
    expect(root_child0_child1.getComputedWidth()).toBe(100);
    expect(root_child0_child1.getComputedHeight()).toBe(100);

    expect(root_child0_child1_child0.getComputedLeft()).toBe(-100);
    expect(root_child0_child1_child0.getComputedTop()).toBe(0);
    expect(root_child0_child1_child0.getComputedWidth()).toBe(200);
    expect(root_child0_child1_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child1_child1.getComputedLeft()).toBe(-100);
    expect(root_child0_child1_child1.getComputedTop()).toBe(0);
    expect(root_child0_child1_child1.getComputedWidth()).toBe(200);
    expect(root_child0_child1_child1.getComputedHeight()).toBe(50);

    expect(root_child0_child2.getComputedLeft()).toBe(275);
    expect(root_child0_child2.getComputedTop()).toBe(100);
    expect(root_child0_child2.getComputedWidth()).toBe(25);
    expect(root_child0_child2.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
