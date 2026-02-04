import { test, expect, describe } from "bun:test";
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

test('column_gap_flexible', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(80);
    root.setHeight(100);
    root.setGap(Gutter.Column, 10);
    root.setGap(Gutter.Row, 20);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setFlexShrink(1);
    root_child0.setFlexBasis("0%");
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root_child1.setFlexShrink(1);
    root_child1.setFlexBasis("0%");
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setFlexGrow(1);
    root_child2.setFlexShrink(1);
    root_child2.setFlexBasis("0%");
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(80);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(60);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(80);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('column_gap_inflexible', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(80);
    root.setHeight(100);
    root.setGap(Gutter.Column, 10);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(20);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(80);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(60);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(80);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('column_gap_mixed_flexible', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(80);
    root.setHeight(100);
    root.setGap(Gutter.Column, 10);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root_child1.setFlexShrink(1);
    root_child1.setFlexBasis("0%");
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(20);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(80);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(60);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(80);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('column_gap_child_margins', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(80);
    root.setHeight(100);
    root.setGap(Gutter.Column, 10);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setFlexShrink(1);
    root_child0.setFlexBasis("0%");
    root_child0.setMargin(Edge.Left, 2);
    root_child0.setMargin(Edge.Right, 2);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root_child1.setFlexShrink(1);
    root_child1.setFlexBasis("0%");
    root_child1.setMargin(Edge.Left, 10);
    root_child1.setMargin(Edge.Right, 10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setFlexGrow(1);
    root_child2.setFlexShrink(1);
    root_child2.setFlexBasis("0%");
    root_child2.setMargin(Edge.Left, 15);
    root_child2.setMargin(Edge.Right, 15);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(80);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(2);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(2);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(26);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(2);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(63);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(2);
    expect(root_child2.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(80);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(76);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(2);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(52);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(2);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(15);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(2);
    expect(root_child2.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('column_row_gap_wrapping', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(80);
    root.setGap(Gutter.Column, 10);
    root.setGap(Gutter.Row, 20);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(20);
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(20);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(20);
    root_child2.setHeight(20);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(20);
    root_child3.setHeight(20);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(20);
    root_child4.setHeight(20);
    root.insertChild(root_child4, 4);

    const root_child5 = Yoga.Node.create(config);
    root_child5.setWidth(20);
    root_child5.setHeight(20);
    root.insertChild(root_child5, 5);

    const root_child6 = Yoga.Node.create(config);
    root_child6.setWidth(20);
    root_child6.setHeight(20);
    root.insertChild(root_child6, 6);

    const root_child7 = Yoga.Node.create(config);
    root_child7.setWidth(20);
    root_child7.setHeight(20);
    root.insertChild(root_child7, 7);

    const root_child8 = Yoga.Node.create(config);
    root_child8.setWidth(20);
    root_child8.setHeight(20);
    root.insertChild(root_child8, 8);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(80);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(60);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(20);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(40);
    expect(root_child3.getComputedWidth()).toBe(20);
    expect(root_child3.getComputedHeight()).toBe(20);

    expect(root_child4.getComputedLeft()).toBe(30);
    expect(root_child4.getComputedTop()).toBe(40);
    expect(root_child4.getComputedWidth()).toBe(20);
    expect(root_child4.getComputedHeight()).toBe(20);

    expect(root_child5.getComputedLeft()).toBe(60);
    expect(root_child5.getComputedTop()).toBe(40);
    expect(root_child5.getComputedWidth()).toBe(20);
    expect(root_child5.getComputedHeight()).toBe(20);

    expect(root_child6.getComputedLeft()).toBe(0);
    expect(root_child6.getComputedTop()).toBe(80);
    expect(root_child6.getComputedWidth()).toBe(20);
    expect(root_child6.getComputedHeight()).toBe(20);

    expect(root_child7.getComputedLeft()).toBe(30);
    expect(root_child7.getComputedTop()).toBe(80);
    expect(root_child7.getComputedWidth()).toBe(20);
    expect(root_child7.getComputedHeight()).toBe(20);

    expect(root_child8.getComputedLeft()).toBe(60);
    expect(root_child8.getComputedTop()).toBe(80);
    expect(root_child8.getComputedWidth()).toBe(20);
    expect(root_child8.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(80);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(20);

    expect(root_child3.getComputedLeft()).toBe(60);
    expect(root_child3.getComputedTop()).toBe(40);
    expect(root_child3.getComputedWidth()).toBe(20);
    expect(root_child3.getComputedHeight()).toBe(20);

    expect(root_child4.getComputedLeft()).toBe(30);
    expect(root_child4.getComputedTop()).toBe(40);
    expect(root_child4.getComputedWidth()).toBe(20);
    expect(root_child4.getComputedHeight()).toBe(20);

    expect(root_child5.getComputedLeft()).toBe(0);
    expect(root_child5.getComputedTop()).toBe(40);
    expect(root_child5.getComputedWidth()).toBe(20);
    expect(root_child5.getComputedHeight()).toBe(20);

    expect(root_child6.getComputedLeft()).toBe(60);
    expect(root_child6.getComputedTop()).toBe(80);
    expect(root_child6.getComputedWidth()).toBe(20);
    expect(root_child6.getComputedHeight()).toBe(20);

    expect(root_child7.getComputedLeft()).toBe(30);
    expect(root_child7.getComputedTop()).toBe(80);
    expect(root_child7.getComputedWidth()).toBe(20);
    expect(root_child7.getComputedHeight()).toBe(20);

    expect(root_child8.getComputedLeft()).toBe(0);
    expect(root_child8.getComputedTop()).toBe(80);
    expect(root_child8.getComputedWidth()).toBe(20);
    expect(root_child8.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('column_gap_start_index', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(80);
    root.setGap(Gutter.Column, 10);
    root.setGap(Gutter.Row, 20);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setWidth(20);
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(20);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(20);
    root_child2.setHeight(20);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(20);
    root_child3.setHeight(20);
    root.insertChild(root_child3, 3);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(80);
    expect(root.getComputedHeight()).toBe(20);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(30);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(20);

    expect(root_child3.getComputedLeft()).toBe(60);
    expect(root_child3.getComputedTop()).toBe(0);
    expect(root_child3.getComputedWidth()).toBe(20);
    expect(root_child3.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(80);
    expect(root.getComputedHeight()).toBe(20);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    expect(root_child1.getComputedLeft()).toBe(60);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(30);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(20);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(0);
    expect(root_child3.getComputedWidth()).toBe(20);
    expect(root_child3.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('column_gap_justify_flex_start', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);
    root.setGap(Gutter.Column, 10);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(20);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(60);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(20);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('column_gap_justify_center', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setJustifyContent(Justify.Center);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);
    root.setGap(Gutter.Column, 10);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(20);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(10);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(70);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(70);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(10);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('column_gap_justify_flex_end', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setJustifyContent(Justify.FlexEnd);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);
    root.setGap(Gutter.Column, 10);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(20);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(20);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(80);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('column_gap_justify_space_between', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setJustifyContent(Justify.SpaceBetween);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);
    root.setGap(Gutter.Column, 10);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(20);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(80);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('column_gap_justify_space_around', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setJustifyContent(Justify.SpaceAround);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);
    root.setGap(Gutter.Column, 10);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(20);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(3);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(77);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(77);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(3);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('column_gap_justify_space_evenly', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setJustifyContent(Justify.SpaceEvenly);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);
    root.setGap(Gutter.Column, 10);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(20);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(5);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(75);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(75);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(5);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('column_gap_wrap_align_flex_start', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(100);
    root.setHeight(100);
    root.setGap(Gutter.Column, 10);
    root.setGap(Gutter.Row, 20);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(20);
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(20);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(20);
    root_child2.setHeight(20);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(20);
    root_child3.setHeight(20);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(20);
    root_child4.setHeight(20);
    root.insertChild(root_child4, 4);

    const root_child5 = Yoga.Node.create(config);
    root_child5.setWidth(20);
    root_child5.setHeight(20);
    root.insertChild(root_child5, 5);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(60);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(20);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(40);
    expect(root_child3.getComputedWidth()).toBe(20);
    expect(root_child3.getComputedHeight()).toBe(20);

    expect(root_child4.getComputedLeft()).toBe(30);
    expect(root_child4.getComputedTop()).toBe(40);
    expect(root_child4.getComputedWidth()).toBe(20);
    expect(root_child4.getComputedHeight()).toBe(20);

    expect(root_child5.getComputedLeft()).toBe(60);
    expect(root_child5.getComputedTop()).toBe(40);
    expect(root_child5.getComputedWidth()).toBe(20);
    expect(root_child5.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(20);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(20);

    expect(root_child3.getComputedLeft()).toBe(80);
    expect(root_child3.getComputedTop()).toBe(40);
    expect(root_child3.getComputedWidth()).toBe(20);
    expect(root_child3.getComputedHeight()).toBe(20);

    expect(root_child4.getComputedLeft()).toBe(50);
    expect(root_child4.getComputedTop()).toBe(40);
    expect(root_child4.getComputedWidth()).toBe(20);
    expect(root_child4.getComputedHeight()).toBe(20);

    expect(root_child5.getComputedLeft()).toBe(20);
    expect(root_child5.getComputedTop()).toBe(40);
    expect(root_child5.getComputedWidth()).toBe(20);
    expect(root_child5.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('column_gap_wrap_align_center', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(100);
    root.setHeight(100);
    root.setGap(Gutter.Column, 10);
    root.setGap(Gutter.Row, 20);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(20);
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(20);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(20);
    root_child2.setHeight(20);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(20);
    root_child3.setHeight(20);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(20);
    root_child4.setHeight(20);
    root.insertChild(root_child4, 4);

    const root_child5 = Yoga.Node.create(config);
    root_child5.setWidth(20);
    root_child5.setHeight(20);
    root.insertChild(root_child5, 5);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(20);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(20);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(60);
    expect(root_child2.getComputedTop()).toBe(20);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(20);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(60);
    expect(root_child3.getComputedWidth()).toBe(20);
    expect(root_child3.getComputedHeight()).toBe(20);

    expect(root_child4.getComputedLeft()).toBe(30);
    expect(root_child4.getComputedTop()).toBe(60);
    expect(root_child4.getComputedWidth()).toBe(20);
    expect(root_child4.getComputedHeight()).toBe(20);

    expect(root_child5.getComputedLeft()).toBe(60);
    expect(root_child5.getComputedTop()).toBe(60);
    expect(root_child5.getComputedWidth()).toBe(20);
    expect(root_child5.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(20);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(20);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(20);
    expect(root_child2.getComputedTop()).toBe(20);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(20);

    expect(root_child3.getComputedLeft()).toBe(80);
    expect(root_child3.getComputedTop()).toBe(60);
    expect(root_child3.getComputedWidth()).toBe(20);
    expect(root_child3.getComputedHeight()).toBe(20);

    expect(root_child4.getComputedLeft()).toBe(50);
    expect(root_child4.getComputedTop()).toBe(60);
    expect(root_child4.getComputedWidth()).toBe(20);
    expect(root_child4.getComputedHeight()).toBe(20);

    expect(root_child5.getComputedLeft()).toBe(20);
    expect(root_child5.getComputedTop()).toBe(60);
    expect(root_child5.getComputedWidth()).toBe(20);
    expect(root_child5.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('column_gap_wrap_align_flex_end', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.FlexEnd);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(100);
    root.setHeight(100);
    root.setGap(Gutter.Column, 10);
    root.setGap(Gutter.Row, 20);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(20);
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(20);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(20);
    root_child2.setHeight(20);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(20);
    root_child3.setHeight(20);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(20);
    root_child4.setHeight(20);
    root.insertChild(root_child4, 4);

    const root_child5 = Yoga.Node.create(config);
    root_child5.setWidth(20);
    root_child5.setHeight(20);
    root.insertChild(root_child5, 5);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(40);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(60);
    expect(root_child2.getComputedTop()).toBe(40);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(20);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(80);
    expect(root_child3.getComputedWidth()).toBe(20);
    expect(root_child3.getComputedHeight()).toBe(20);

    expect(root_child4.getComputedLeft()).toBe(30);
    expect(root_child4.getComputedTop()).toBe(80);
    expect(root_child4.getComputedWidth()).toBe(20);
    expect(root_child4.getComputedHeight()).toBe(20);

    expect(root_child5.getComputedLeft()).toBe(60);
    expect(root_child5.getComputedTop()).toBe(80);
    expect(root_child5.getComputedWidth()).toBe(20);
    expect(root_child5.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(40);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(20);
    expect(root_child2.getComputedTop()).toBe(40);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(20);

    expect(root_child3.getComputedLeft()).toBe(80);
    expect(root_child3.getComputedTop()).toBe(80);
    expect(root_child3.getComputedWidth()).toBe(20);
    expect(root_child3.getComputedHeight()).toBe(20);

    expect(root_child4.getComputedLeft()).toBe(50);
    expect(root_child4.getComputedTop()).toBe(80);
    expect(root_child4.getComputedWidth()).toBe(20);
    expect(root_child4.getComputedHeight()).toBe(20);

    expect(root_child5.getComputedLeft()).toBe(20);
    expect(root_child5.getComputedTop()).toBe(80);
    expect(root_child5.getComputedWidth()).toBe(20);
    expect(root_child5.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('column_gap_wrap_align_space_between', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.SpaceBetween);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(100);
    root.setHeight(100);
    root.setGap(Gutter.Column, 10);
    root.setGap(Gutter.Row, 20);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(20);
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(20);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(20);
    root_child2.setHeight(20);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(20);
    root_child3.setHeight(20);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(20);
    root_child4.setHeight(20);
    root.insertChild(root_child4, 4);

    const root_child5 = Yoga.Node.create(config);
    root_child5.setWidth(20);
    root_child5.setHeight(20);
    root.insertChild(root_child5, 5);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(60);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(20);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(80);
    expect(root_child3.getComputedWidth()).toBe(20);
    expect(root_child3.getComputedHeight()).toBe(20);

    expect(root_child4.getComputedLeft()).toBe(30);
    expect(root_child4.getComputedTop()).toBe(80);
    expect(root_child4.getComputedWidth()).toBe(20);
    expect(root_child4.getComputedHeight()).toBe(20);

    expect(root_child5.getComputedLeft()).toBe(60);
    expect(root_child5.getComputedTop()).toBe(80);
    expect(root_child5.getComputedWidth()).toBe(20);
    expect(root_child5.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(20);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(20);

    expect(root_child3.getComputedLeft()).toBe(80);
    expect(root_child3.getComputedTop()).toBe(80);
    expect(root_child3.getComputedWidth()).toBe(20);
    expect(root_child3.getComputedHeight()).toBe(20);

    expect(root_child4.getComputedLeft()).toBe(50);
    expect(root_child4.getComputedTop()).toBe(80);
    expect(root_child4.getComputedWidth()).toBe(20);
    expect(root_child4.getComputedHeight()).toBe(20);

    expect(root_child5.getComputedLeft()).toBe(20);
    expect(root_child5.getComputedTop()).toBe(80);
    expect(root_child5.getComputedWidth()).toBe(20);
    expect(root_child5.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('column_gap_wrap_align_space_around', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.SpaceAround);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(100);
    root.setHeight(100);
    root.setGap(Gutter.Column, 10);
    root.setGap(Gutter.Row, 20);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(20);
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(20);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(20);
    root_child2.setHeight(20);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(20);
    root_child3.setHeight(20);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(20);
    root_child4.setHeight(20);
    root.insertChild(root_child4, 4);

    const root_child5 = Yoga.Node.create(config);
    root_child5.setWidth(20);
    root_child5.setHeight(20);
    root.insertChild(root_child5, 5);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(10);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(60);
    expect(root_child2.getComputedTop()).toBe(10);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(20);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(70);
    expect(root_child3.getComputedWidth()).toBe(20);
    expect(root_child3.getComputedHeight()).toBe(20);

    expect(root_child4.getComputedLeft()).toBe(30);
    expect(root_child4.getComputedTop()).toBe(70);
    expect(root_child4.getComputedWidth()).toBe(20);
    expect(root_child4.getComputedHeight()).toBe(20);

    expect(root_child5.getComputedLeft()).toBe(60);
    expect(root_child5.getComputedTop()).toBe(70);
    expect(root_child5.getComputedWidth()).toBe(20);
    expect(root_child5.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(10);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(20);
    expect(root_child2.getComputedTop()).toBe(10);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(20);

    expect(root_child3.getComputedLeft()).toBe(80);
    expect(root_child3.getComputedTop()).toBe(70);
    expect(root_child3.getComputedWidth()).toBe(20);
    expect(root_child3.getComputedHeight()).toBe(20);

    expect(root_child4.getComputedLeft()).toBe(50);
    expect(root_child4.getComputedTop()).toBe(70);
    expect(root_child4.getComputedWidth()).toBe(20);
    expect(root_child4.getComputedHeight()).toBe(20);

    expect(root_child5.getComputedLeft()).toBe(20);
    expect(root_child5.getComputedTop()).toBe(70);
    expect(root_child5.getComputedWidth()).toBe(20);
    expect(root_child5.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('column_gap_wrap_align_stretch', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Stretch);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(300);
    root.setHeight(300);
    root.setGap(Gutter.Column, 5);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setMinWidth(60);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root_child1.setMinWidth(60);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setFlexGrow(1);
    root_child2.setMinWidth(60);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setFlexGrow(1);
    root_child3.setMinWidth(60);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setFlexGrow(1);
    root_child4.setMinWidth(60);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(71);
    expect(root_child0.getComputedHeight()).toBe(150);

    expect(root_child1.getComputedLeft()).toBe(76);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(72);
    expect(root_child1.getComputedHeight()).toBe(150);

    expect(root_child2.getComputedLeft()).toBe(153);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(71);
    expect(root_child2.getComputedHeight()).toBe(150);

    expect(root_child3.getComputedLeft()).toBe(229);
    expect(root_child3.getComputedTop()).toBe(0);
    expect(root_child3.getComputedWidth()).toBe(71);
    expect(root_child3.getComputedHeight()).toBe(150);

    expect(root_child4.getComputedLeft()).toBe(0);
    expect(root_child4.getComputedTop()).toBe(150);
    expect(root_child4.getComputedWidth()).toBe(300);
    expect(root_child4.getComputedHeight()).toBe(150);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(229);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(71);
    expect(root_child0.getComputedHeight()).toBe(150);

    expect(root_child1.getComputedLeft()).toBe(153);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(71);
    expect(root_child1.getComputedHeight()).toBe(150);

    expect(root_child2.getComputedLeft()).toBe(76);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(72);
    expect(root_child2.getComputedHeight()).toBe(150);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(0);
    expect(root_child3.getComputedWidth()).toBe(71);
    expect(root_child3.getComputedHeight()).toBe(150);

    expect(root_child4.getComputedLeft()).toBe(0);
    expect(root_child4.getComputedTop()).toBe(150);
    expect(root_child4.getComputedWidth()).toBe(300);
    expect(root_child4.getComputedHeight()).toBe(150);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('column_gap_determines_parent_width', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setHeight(100);
    root.setGap(Gutter.Column, 10);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(30);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(80);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(20);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(50);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(80);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(70);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('row_gap_align_items_stretch', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Stretch);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(100);
    root.setHeight(200);
    root.setGap(Gutter.Column, 10);
    root.setGap(Gutter.Row, 20);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(20);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(20);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(20);
    root.insertChild(root_child4, 4);

    const root_child5 = Yoga.Node.create(config);
    root_child5.setWidth(20);
    root.insertChild(root_child5, 5);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(90);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(90);

    expect(root_child2.getComputedLeft()).toBe(60);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(90);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(110);
    expect(root_child3.getComputedWidth()).toBe(20);
    expect(root_child3.getComputedHeight()).toBe(90);

    expect(root_child4.getComputedLeft()).toBe(30);
    expect(root_child4.getComputedTop()).toBe(110);
    expect(root_child4.getComputedWidth()).toBe(20);
    expect(root_child4.getComputedHeight()).toBe(90);

    expect(root_child5.getComputedLeft()).toBe(60);
    expect(root_child5.getComputedTop()).toBe(110);
    expect(root_child5.getComputedWidth()).toBe(20);
    expect(root_child5.getComputedHeight()).toBe(90);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(90);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(90);

    expect(root_child2.getComputedLeft()).toBe(20);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(90);

    expect(root_child3.getComputedLeft()).toBe(80);
    expect(root_child3.getComputedTop()).toBe(110);
    expect(root_child3.getComputedWidth()).toBe(20);
    expect(root_child3.getComputedHeight()).toBe(90);

    expect(root_child4.getComputedLeft()).toBe(50);
    expect(root_child4.getComputedTop()).toBe(110);
    expect(root_child4.getComputedWidth()).toBe(20);
    expect(root_child4.getComputedHeight()).toBe(90);

    expect(root_child5.getComputedLeft()).toBe(20);
    expect(root_child5.getComputedTop()).toBe(110);
    expect(root_child5.getComputedWidth()).toBe(20);
    expect(root_child5.getComputedHeight()).toBe(90);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('row_gap_align_items_end', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignItems(Align.FlexEnd);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(100);
    root.setHeight(200);
    root.setGap(Gutter.Column, 10);
    root.setGap(Gutter.Row, 20);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(20);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(20);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(20);
    root.insertChild(root_child4, 4);

    const root_child5 = Yoga.Node.create(config);
    root_child5.setWidth(20);
    root.insertChild(root_child5, 5);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(0);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(0);

    expect(root_child2.getComputedLeft()).toBe(60);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(0);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(20);
    expect(root_child3.getComputedWidth()).toBe(20);
    expect(root_child3.getComputedHeight()).toBe(0);

    expect(root_child4.getComputedLeft()).toBe(30);
    expect(root_child4.getComputedTop()).toBe(20);
    expect(root_child4.getComputedWidth()).toBe(20);
    expect(root_child4.getComputedHeight()).toBe(0);

    expect(root_child5.getComputedLeft()).toBe(60);
    expect(root_child5.getComputedTop()).toBe(20);
    expect(root_child5.getComputedWidth()).toBe(20);
    expect(root_child5.getComputedHeight()).toBe(0);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(0);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(0);

    expect(root_child2.getComputedLeft()).toBe(20);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(0);

    expect(root_child3.getComputedLeft()).toBe(80);
    expect(root_child3.getComputedTop()).toBe(20);
    expect(root_child3.getComputedWidth()).toBe(20);
    expect(root_child3.getComputedHeight()).toBe(0);

    expect(root_child4.getComputedLeft()).toBe(50);
    expect(root_child4.getComputedTop()).toBe(20);
    expect(root_child4.getComputedWidth()).toBe(20);
    expect(root_child4.getComputedHeight()).toBe(0);

    expect(root_child5.getComputedLeft()).toBe(20);
    expect(root_child5.getComputedTop()).toBe(20);
    expect(root_child5.getComputedWidth()).toBe(20);
    expect(root_child5.getComputedHeight()).toBe(0);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('row_gap_column_child_margins', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(200);
    root.setGap(Gutter.Row, 10);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setFlexShrink(1);
    root_child0.setFlexBasis("0%");
    root_child0.setMargin(Edge.Top, 2);
    root_child0.setMargin(Edge.Bottom, 2);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root_child1.setFlexShrink(1);
    root_child1.setFlexBasis("0%");
    root_child1.setMargin(Edge.Top, 10);
    root_child1.setMargin(Edge.Bottom, 10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setFlexGrow(1);
    root_child2.setFlexShrink(1);
    root_child2.setFlexBasis("0%");
    root_child2.setMargin(Edge.Top, 15);
    root_child2.setMargin(Edge.Bottom, 15);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(2);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(42);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(66);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(42);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(143);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(42);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(2);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(42);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(66);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(42);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(143);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(42);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('row_gap_row_wrap_child_margins', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(100);
    root.setHeight(200);
    root.setGap(Gutter.Row, 10);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Top, 2);
    root_child0.setMargin(Edge.Bottom, 2);
    root_child0.setWidth(60);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setMargin(Edge.Top, 10);
    root_child1.setMargin(Edge.Bottom, 10);
    root_child1.setWidth(60);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setMargin(Edge.Top, 15);
    root_child2.setMargin(Edge.Bottom, 15);
    root_child2.setWidth(60);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(2);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(0);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(24);
    expect(root_child1.getComputedWidth()).toBe(60);
    expect(root_child1.getComputedHeight()).toBe(0);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(59);
    expect(root_child2.getComputedWidth()).toBe(60);
    expect(root_child2.getComputedHeight()).toBe(0);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(40);
    expect(root_child0.getComputedTop()).toBe(2);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(0);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(24);
    expect(root_child1.getComputedWidth()).toBe(60);
    expect(root_child1.getComputedHeight()).toBe(0);

    expect(root_child2.getComputedLeft()).toBe(40);
    expect(root_child2.getComputedTop()).toBe(59);
    expect(root_child2.getComputedWidth()).toBe(60);
    expect(root_child2.getComputedHeight()).toBe(0);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('row_gap_determines_parent_height', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setGap(Gutter.Row, 10);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setHeight(30);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(80);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(20);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(50);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(30);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(80);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(20);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(50);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(30);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('row_gap_percent_wrapping', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setPadding(Edge.Left, 10);
    root.setPadding(Edge.Top, 10);
    root.setPadding(Edge.Right, 10);
    root.setPadding(Edge.Bottom, 10);
    root.setWidth(300);
    root.setHeight(700);
    root.setGap(Gutter.Column, "10%");
    root.setGap(Gutter.Row, "10%");

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(100);
    root_child0.setHeight(100);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(100);
    root_child1.setHeight(100);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(100);
    root_child2.setHeight(100);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(100);
    root_child3.setHeight(100);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(100);
    root_child4.setHeight(100);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(700);

    expect(root_child0.getComputedLeft()).toBe(10);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(138);
    expect(root_child1.getComputedTop()).toBe(10);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(10);
    expect(root_child2.getComputedTop()).toBe(178);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(100);

    expect(root_child3.getComputedLeft()).toBe(138);
    expect(root_child3.getComputedTop()).toBe(178);
    expect(root_child3.getComputedWidth()).toBe(100);
    expect(root_child3.getComputedHeight()).toBe(100);

    expect(root_child4.getComputedLeft()).toBe(10);
    expect(root_child4.getComputedTop()).toBe(346);
    expect(root_child4.getComputedWidth()).toBe(100);
    expect(root_child4.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(700);

    expect(root_child0.getComputedLeft()).toBe(190);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(62);
    expect(root_child1.getComputedTop()).toBe(10);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(190);
    expect(root_child2.getComputedTop()).toBe(178);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(100);

    expect(root_child3.getComputedLeft()).toBe(62);
    expect(root_child3.getComputedTop()).toBe(178);
    expect(root_child3.getComputedWidth()).toBe(100);
    expect(root_child3.getComputedHeight()).toBe(100);

    expect(root_child4.getComputedLeft()).toBe(190);
    expect(root_child4.getComputedTop()).toBe(346);
    expect(root_child4.getComputedWidth()).toBe(100);
    expect(root_child4.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('row_gap_percent_determines_parent_height', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(300);
    root.setGap(Gutter.Column, "10%");
    root.setGap(Gutter.Row, "10%");

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(100);
    root_child0.setHeight(100);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(100);
    root_child1.setHeight(100);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(100);
    root_child2.setHeight(100);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(100);
    root_child3.setHeight(100);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(100);
    root_child4.setHeight(100);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(130);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(100);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(100);

    expect(root_child3.getComputedLeft()).toBe(130);
    expect(root_child3.getComputedTop()).toBe(100);
    expect(root_child3.getComputedWidth()).toBe(100);
    expect(root_child3.getComputedHeight()).toBe(100);

    expect(root_child4.getComputedLeft()).toBe(0);
    expect(root_child4.getComputedTop()).toBe(200);
    expect(root_child4.getComputedWidth()).toBe(100);
    expect(root_child4.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(200);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(70);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(200);
    expect(root_child2.getComputedTop()).toBe(100);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(100);

    expect(root_child3.getComputedLeft()).toBe(70);
    expect(root_child3.getComputedTop()).toBe(100);
    expect(root_child3.getComputedWidth()).toBe(100);
    expect(root_child3.getComputedHeight()).toBe(100);

    expect(root_child4.getComputedLeft()).toBe(200);
    expect(root_child4.getComputedTop()).toBe(200);
    expect(root_child4.getComputedWidth()).toBe(100);
    expect(root_child4.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('row_gap_percent_wrapping_with_both_content_padding_and_item_padding', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setPadding(Edge.Left, 10);
    root.setPadding(Edge.Top, 10);
    root.setPadding(Edge.Right, 10);
    root.setPadding(Edge.Bottom, 10);
    root.setWidth(300);
    root.setHeight(700);
    root.setGap(Gutter.Column, "10%");
    root.setGap(Gutter.Row, "10%");

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 10);
    root_child0.setPadding(Edge.Top, 10);
    root_child0.setPadding(Edge.Right, 10);
    root_child0.setPadding(Edge.Bottom, 10);
    root_child0.setWidth(100);
    root_child0.setHeight(100);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setPadding(Edge.Left, 10);
    root_child1.setPadding(Edge.Top, 10);
    root_child1.setPadding(Edge.Right, 10);
    root_child1.setPadding(Edge.Bottom, 10);
    root_child1.setWidth(100);
    root_child1.setHeight(100);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setPadding(Edge.Left, 10);
    root_child2.setPadding(Edge.Top, 10);
    root_child2.setPadding(Edge.Right, 10);
    root_child2.setPadding(Edge.Bottom, 10);
    root_child2.setWidth(100);
    root_child2.setHeight(100);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setPadding(Edge.Left, 10);
    root_child3.setPadding(Edge.Top, 10);
    root_child3.setPadding(Edge.Right, 10);
    root_child3.setPadding(Edge.Bottom, 10);
    root_child3.setWidth(100);
    root_child3.setHeight(100);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setPadding(Edge.Left, 10);
    root_child4.setPadding(Edge.Top, 10);
    root_child4.setPadding(Edge.Right, 10);
    root_child4.setPadding(Edge.Bottom, 10);
    root_child4.setWidth(100);
    root_child4.setHeight(100);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(700);

    expect(root_child0.getComputedLeft()).toBe(10);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(138);
    expect(root_child1.getComputedTop()).toBe(10);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(10);
    expect(root_child2.getComputedTop()).toBe(178);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(100);

    expect(root_child3.getComputedLeft()).toBe(138);
    expect(root_child3.getComputedTop()).toBe(178);
    expect(root_child3.getComputedWidth()).toBe(100);
    expect(root_child3.getComputedHeight()).toBe(100);

    expect(root_child4.getComputedLeft()).toBe(10);
    expect(root_child4.getComputedTop()).toBe(346);
    expect(root_child4.getComputedWidth()).toBe(100);
    expect(root_child4.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(700);

    expect(root_child0.getComputedLeft()).toBe(190);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(62);
    expect(root_child1.getComputedTop()).toBe(10);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(190);
    expect(root_child2.getComputedTop()).toBe(178);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(100);

    expect(root_child3.getComputedLeft()).toBe(62);
    expect(root_child3.getComputedTop()).toBe(178);
    expect(root_child3.getComputedWidth()).toBe(100);
    expect(root_child3.getComputedHeight()).toBe(100);

    expect(root_child4.getComputedLeft()).toBe(190);
    expect(root_child4.getComputedTop()).toBe(346);
    expect(root_child4.getComputedWidth()).toBe(100);
    expect(root_child4.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('row_gap_percent_wrapping_with_both_content_padding', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setPadding(Edge.Left, 10);
    root.setPadding(Edge.Top, 10);
    root.setPadding(Edge.Right, 10);
    root.setPadding(Edge.Bottom, 10);
    root.setWidth(300);
    root.setHeight(700);
    root.setGap(Gutter.Column, "10%");
    root.setGap(Gutter.Row, "10%");

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(100);
    root_child0.setHeight(100);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(100);
    root_child1.setHeight(100);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(100);
    root_child2.setHeight(100);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(100);
    root_child3.setHeight(100);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(100);
    root_child4.setHeight(100);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(700);

    expect(root_child0.getComputedLeft()).toBe(10);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(138);
    expect(root_child1.getComputedTop()).toBe(10);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(10);
    expect(root_child2.getComputedTop()).toBe(178);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(100);

    expect(root_child3.getComputedLeft()).toBe(138);
    expect(root_child3.getComputedTop()).toBe(178);
    expect(root_child3.getComputedWidth()).toBe(100);
    expect(root_child3.getComputedHeight()).toBe(100);

    expect(root_child4.getComputedLeft()).toBe(10);
    expect(root_child4.getComputedTop()).toBe(346);
    expect(root_child4.getComputedWidth()).toBe(100);
    expect(root_child4.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(700);

    expect(root_child0.getComputedLeft()).toBe(190);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(62);
    expect(root_child1.getComputedTop()).toBe(10);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(190);
    expect(root_child2.getComputedTop()).toBe(178);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(100);

    expect(root_child3.getComputedLeft()).toBe(62);
    expect(root_child3.getComputedTop()).toBe(178);
    expect(root_child3.getComputedWidth()).toBe(100);
    expect(root_child3.getComputedHeight()).toBe(100);

    expect(root_child4.getComputedLeft()).toBe(190);
    expect(root_child4.getComputedTop()).toBe(346);
    expect(root_child4.getComputedWidth()).toBe(100);
    expect(root_child4.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('row_gap_percent_wrapping_with_content_margin', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setMargin(Edge.Left, 10);
    root.setMargin(Edge.Top, 10);
    root.setMargin(Edge.Right, 10);
    root.setMargin(Edge.Bottom, 10);
    root.setWidth(300);
    root.setHeight(700);
    root.setGap(Gutter.Column, "10%");
    root.setGap(Gutter.Row, "10%");

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(100);
    root_child0.setHeight(100);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(100);
    root_child1.setHeight(100);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(100);
    root_child2.setHeight(100);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(100);
    root_child3.setHeight(100);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(100);
    root_child4.setHeight(100);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(10);
    expect(root.getComputedTop()).toBe(10);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(700);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(130);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(170);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(100);

    expect(root_child3.getComputedLeft()).toBe(130);
    expect(root_child3.getComputedTop()).toBe(170);
    expect(root_child3.getComputedWidth()).toBe(100);
    expect(root_child3.getComputedHeight()).toBe(100);

    expect(root_child4.getComputedLeft()).toBe(0);
    expect(root_child4.getComputedTop()).toBe(340);
    expect(root_child4.getComputedWidth()).toBe(100);
    expect(root_child4.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(10);
    expect(root.getComputedTop()).toBe(10);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(700);

    expect(root_child0.getComputedLeft()).toBe(200);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(70);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(200);
    expect(root_child2.getComputedTop()).toBe(170);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(100);

    expect(root_child3.getComputedLeft()).toBe(70);
    expect(root_child3.getComputedTop()).toBe(170);
    expect(root_child3.getComputedWidth()).toBe(100);
    expect(root_child3.getComputedHeight()).toBe(100);

    expect(root_child4.getComputedLeft()).toBe(200);
    expect(root_child4.getComputedTop()).toBe(340);
    expect(root_child4.getComputedWidth()).toBe(100);
    expect(root_child4.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('row_gap_percent_wrapping_with_content_margin_and_padding', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setMargin(Edge.Left, 10);
    root.setMargin(Edge.Top, 10);
    root.setMargin(Edge.Right, 10);
    root.setMargin(Edge.Bottom, 10);
    root.setPadding(Edge.Left, 10);
    root.setPadding(Edge.Top, 10);
    root.setPadding(Edge.Right, 10);
    root.setPadding(Edge.Bottom, 10);
    root.setWidth(300);
    root.setHeight(700);
    root.setGap(Gutter.Column, "10%");
    root.setGap(Gutter.Row, "10%");

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(100);
    root_child0.setHeight(100);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(100);
    root_child1.setHeight(100);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(100);
    root_child2.setHeight(100);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(100);
    root_child3.setHeight(100);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(100);
    root_child4.setHeight(100);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(10);
    expect(root.getComputedTop()).toBe(10);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(700);

    expect(root_child0.getComputedLeft()).toBe(10);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(138);
    expect(root_child1.getComputedTop()).toBe(10);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(10);
    expect(root_child2.getComputedTop()).toBe(178);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(100);

    expect(root_child3.getComputedLeft()).toBe(138);
    expect(root_child3.getComputedTop()).toBe(178);
    expect(root_child3.getComputedWidth()).toBe(100);
    expect(root_child3.getComputedHeight()).toBe(100);

    expect(root_child4.getComputedLeft()).toBe(10);
    expect(root_child4.getComputedTop()).toBe(346);
    expect(root_child4.getComputedWidth()).toBe(100);
    expect(root_child4.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(10);
    expect(root.getComputedTop()).toBe(10);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(700);

    expect(root_child0.getComputedLeft()).toBe(190);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(62);
    expect(root_child1.getComputedTop()).toBe(10);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(190);
    expect(root_child2.getComputedTop()).toBe(178);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(100);

    expect(root_child3.getComputedLeft()).toBe(62);
    expect(root_child3.getComputedTop()).toBe(178);
    expect(root_child3.getComputedWidth()).toBe(100);
    expect(root_child3.getComputedHeight()).toBe(100);

    expect(root_child4.getComputedLeft()).toBe(190);
    expect(root_child4.getComputedTop()).toBe(346);
    expect(root_child4.getComputedWidth()).toBe(100);
    expect(root_child4.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('row_gap_percent_wrapping_with_flexible_content', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(300);
    root.setHeight(300);
    root.setGap(Gutter.Column, "10%");
    root.setGap(Gutter.Row, "10%");

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setFlexShrink(1);
    root_child0.setFlexBasis("0%");
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root_child1.setFlexShrink(1);
    root_child1.setFlexBasis("0%");
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setFlexGrow(1);
    root_child2.setFlexShrink(1);
    root_child2.setFlexBasis("0%");
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(80);
    expect(root_child0.getComputedHeight()).toBe(300);

    expect(root_child1.getComputedLeft()).toBe(110);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(80);
    expect(root_child1.getComputedHeight()).toBe(300);

    expect(root_child2.getComputedLeft()).toBe(220);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(80);
    expect(root_child2.getComputedHeight()).toBe(300);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(220);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(80);
    expect(root_child0.getComputedHeight()).toBe(300);

    expect(root_child1.getComputedLeft()).toBe(110);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(80);
    expect(root_child1.getComputedHeight()).toBe(300);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(80);
    expect(root_child2.getComputedHeight()).toBe(300);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('row_gap_percent_wrapping_with_mixed_flexible_content', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(300);
    root.setHeight(300);
    root.setGap(Gutter.Column, "10%");
    root.setGap(Gutter.Row, "10%");

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root_child1.setFlexShrink(1);
    root_child1.setFlexBasis("0%");
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth("10%");
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(300);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(200);
    expect(root_child1.getComputedHeight()).toBe(300);

    expect(root_child2.getComputedLeft()).toBe(270);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(300);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(290);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(300);

    expect(root_child1.getComputedLeft()).toBe(60);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(200);
    expect(root_child1.getComputedHeight()).toBe(300);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(300);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test.skip('row_gap_percent_wrapping_with_min_width', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setMinWidth(300);
    root.setGap(Gutter.Column, "10%");
    root.setGap(Gutter.Row, "10%");

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(100);
    root_child0.setHeight(100);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(100);
    root_child1.setHeight(100);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(100);
    root_child2.setHeight(100);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(100);
    root_child3.setHeight(100);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(100);
    root_child4.setHeight(100);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(130);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(100);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(100);

    expect(root_child3.getComputedLeft()).toBe(130);
    expect(root_child3.getComputedTop()).toBe(100);
    expect(root_child3.getComputedWidth()).toBe(100);
    expect(root_child3.getComputedHeight()).toBe(100);

    expect(root_child4.getComputedLeft()).toBe(0);
    expect(root_child4.getComputedTop()).toBe(200);
    expect(root_child4.getComputedWidth()).toBe(100);
    expect(root_child4.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(200);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(70);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(200);
    expect(root_child2.getComputedTop()).toBe(100);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(100);

    expect(root_child3.getComputedLeft()).toBe(70);
    expect(root_child3.getComputedTop()).toBe(100);
    expect(root_child3.getComputedWidth()).toBe(100);
    expect(root_child3.getComputedHeight()).toBe(100);

    expect(root_child4.getComputedLeft()).toBe(200);
    expect(root_child4.getComputedTop()).toBe(200);
    expect(root_child4.getComputedWidth()).toBe(100);
    expect(root_child4.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
