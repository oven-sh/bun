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

test('align_content_flex_start_nowrap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(140);
    root.setHeight(120);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_flex_start_wrap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(140);
    root.setHeight(120);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(50);
    root_child2.setHeight(10);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(50);
    root_child3.setHeight(10);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(50);
    root_child4.setHeight(10);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(10);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(10);

    expect(root_child3.getComputedLeft()).toBe(50);
    expect(root_child3.getComputedTop()).toBe(10);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(10);

    expect(root_child4.getComputedLeft()).toBe(0);
    expect(root_child4.getComputedTop()).toBe(20);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(90);
    expect(root_child2.getComputedTop()).toBe(10);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(10);

    expect(root_child3.getComputedLeft()).toBe(40);
    expect(root_child3.getComputedTop()).toBe(10);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(10);

    expect(root_child4.getComputedLeft()).toBe(90);
    expect(root_child4.getComputedTop()).toBe(20);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_flex_start_wrap_singleline', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(140);
    root.setHeight(120);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_flex_start_wrapped_negative_space', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setBorder(Edge.Left, 60);
    root.setBorder(Edge.Top, 60);
    root.setBorder(Edge.Right, 60);
    root.setBorder(Edge.Bottom, 60);
    root.setWidth(320);
    root.setHeight(320);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setJustifyContent(Justify.Center);
    root_child0.setFlexWrap(Wrap.Wrap);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth("80%");
    root_child0_child0.setHeight(20);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setWidth("80%");
    root_child0_child1.setHeight(20);
    root_child0.insertChild(root_child0_child1, 1);

    const root_child0_child2 = Yoga.Node.create(config);
    root_child0_child2.setWidth("80%");
    root_child0_child2.setHeight(20);
    root_child0.insertChild(root_child0_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(20);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(40);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(20);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(40);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_flex_start_wrapped_negative_space_gap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setBorder(Edge.Left, 60);
    root.setBorder(Edge.Top, 60);
    root.setBorder(Edge.Right, 60);
    root.setBorder(Edge.Bottom, 60);
    root.setWidth(320);
    root.setHeight(320);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setJustifyContent(Justify.Center);
    root_child0.setFlexWrap(Wrap.Wrap);
    root_child0.setHeight(10);
    root_child0.setGap(Gutter.Column, 10);
    root_child0.setGap(Gutter.Row, 10);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth("80%");
    root_child0_child0.setHeight(20);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setWidth("80%");
    root_child0_child1.setHeight(20);
    root_child0.insertChild(root_child0_child1, 1);

    const root_child0_child2 = Yoga.Node.create(config);
    root_child0_child2.setWidth("80%");
    root_child0_child2.setHeight(20);
    root_child0.insertChild(root_child0_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(30);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(60);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(30);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(60);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_flex_start_without_height_on_children', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(50);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(50);
    root_child3.setHeight(10);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(50);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(0);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(10);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(0);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(10);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(10);

    expect(root_child4.getComputedLeft()).toBe(0);
    expect(root_child4.getComputedTop()).toBe(20);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(0);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(0);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(50);
    expect(root_child2.getComputedTop()).toBe(10);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(0);

    expect(root_child3.getComputedLeft()).toBe(50);
    expect(root_child3.getComputedTop()).toBe(10);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(10);

    expect(root_child4.getComputedLeft()).toBe(50);
    expect(root_child4.getComputedTop()).toBe(20);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(0);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_flex_start_with_flex', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(100);
    root.setHeight(120);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setFlexBasis("0%");
    root_child0.setWidth(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root_child1.setFlexBasis("0%");
    root_child1.setWidth(50);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(50);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setFlexGrow(1);
    root_child3.setFlexShrink(1);
    root_child3.setFlexBasis("0%");
    root_child3.setWidth(50);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(50);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(40);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(40);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(80);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(0);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(80);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(40);

    expect(root_child4.getComputedLeft()).toBe(0);
    expect(root_child4.getComputedTop()).toBe(120);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(0);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(40);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(40);

    expect(root_child2.getComputedLeft()).toBe(50);
    expect(root_child2.getComputedTop()).toBe(80);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(0);

    expect(root_child3.getComputedLeft()).toBe(50);
    expect(root_child3.getComputedTop()).toBe(80);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(40);

    expect(root_child4.getComputedLeft()).toBe(50);
    expect(root_child4.getComputedTop()).toBe(120);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(0);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_flex_end_nowrap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.FlexEnd);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(140);
    root.setHeight(120);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_flex_end_wrap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.FlexEnd);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(140);
    root.setHeight(120);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(50);
    root_child2.setHeight(10);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(50);
    root_child3.setHeight(10);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(50);
    root_child4.setHeight(10);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(90);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(90);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(100);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(10);

    expect(root_child3.getComputedLeft()).toBe(50);
    expect(root_child3.getComputedTop()).toBe(100);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(10);

    expect(root_child4.getComputedLeft()).toBe(0);
    expect(root_child4.getComputedTop()).toBe(110);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(90);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(90);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(90);
    expect(root_child2.getComputedTop()).toBe(100);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(10);

    expect(root_child3.getComputedLeft()).toBe(40);
    expect(root_child3.getComputedTop()).toBe(100);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(10);

    expect(root_child4.getComputedLeft()).toBe(90);
    expect(root_child4.getComputedTop()).toBe(110);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_flex_end_wrap_singleline', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.FlexEnd);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(140);
    root.setHeight(120);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(110);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(110);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(110);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(110);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_flex_end_wrapped_negative_space', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setBorder(Edge.Left, 60);
    root.setBorder(Edge.Top, 60);
    root.setBorder(Edge.Right, 60);
    root.setBorder(Edge.Bottom, 60);
    root.setWidth(320);
    root.setHeight(320);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setJustifyContent(Justify.Center);
    root_child0.setAlignContent(Align.FlexEnd);
    root_child0.setFlexWrap(Wrap.Wrap);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth("80%");
    root_child0_child0.setHeight(20);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setWidth("80%");
    root_child0_child1.setHeight(20);
    root_child0.insertChild(root_child0_child1, 1);

    const root_child0_child2 = Yoga.Node.create(config);
    root_child0_child2.setWidth("80%");
    root_child0_child2.setHeight(20);
    root_child0.insertChild(root_child0_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(-50);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(-30);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(-10);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(-50);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(-30);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(-10);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_flex_end_wrapped_negative_space_gap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setBorder(Edge.Left, 60);
    root.setBorder(Edge.Top, 60);
    root.setBorder(Edge.Right, 60);
    root.setBorder(Edge.Bottom, 60);
    root.setWidth(320);
    root.setHeight(320);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setJustifyContent(Justify.Center);
    root_child0.setAlignContent(Align.FlexEnd);
    root_child0.setFlexWrap(Wrap.Wrap);
    root_child0.setHeight(10);
    root_child0.setGap(Gutter.Column, 10);
    root_child0.setGap(Gutter.Row, 10);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth("80%");
    root_child0_child0.setHeight(20);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setWidth("80%");
    root_child0_child1.setHeight(20);
    root_child0.insertChild(root_child0_child1, 1);

    const root_child0_child2 = Yoga.Node.create(config);
    root_child0_child2.setWidth("80%");
    root_child0_child2.setHeight(20);
    root_child0.insertChild(root_child0_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(-70);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(-40);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(-10);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(-70);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(-40);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(-10);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_center_nowrap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(140);
    root.setHeight(120);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_center_wrap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(140);
    root.setHeight(120);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(50);
    root_child2.setHeight(10);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(50);
    root_child3.setHeight(10);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(50);
    root_child4.setHeight(10);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(45);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(45);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(55);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(10);

    expect(root_child3.getComputedLeft()).toBe(50);
    expect(root_child3.getComputedTop()).toBe(55);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(10);

    expect(root_child4.getComputedLeft()).toBe(0);
    expect(root_child4.getComputedTop()).toBe(65);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(45);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(45);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(90);
    expect(root_child2.getComputedTop()).toBe(55);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(10);

    expect(root_child3.getComputedLeft()).toBe(40);
    expect(root_child3.getComputedTop()).toBe(55);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(10);

    expect(root_child4.getComputedLeft()).toBe(90);
    expect(root_child4.getComputedTop()).toBe(65);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_center_wrap_singleline', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(140);
    root.setHeight(120);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(55);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(55);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(55);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(55);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_center_wrapped_negative_space', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setBorder(Edge.Left, 60);
    root.setBorder(Edge.Top, 60);
    root.setBorder(Edge.Right, 60);
    root.setBorder(Edge.Bottom, 60);
    root.setWidth(320);
    root.setHeight(320);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setJustifyContent(Justify.Center);
    root_child0.setAlignContent(Align.Center);
    root_child0.setFlexWrap(Wrap.Wrap);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth("80%");
    root_child0_child0.setHeight(20);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setWidth("80%");
    root_child0_child1.setHeight(20);
    root_child0.insertChild(root_child0_child1, 1);

    const root_child0_child2 = Yoga.Node.create(config);
    root_child0_child2.setWidth("80%");
    root_child0_child2.setHeight(20);
    root_child0.insertChild(root_child0_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(-25);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(-5);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(15);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(-25);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(-5);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(15);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_center_wrapped_negative_space_gap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setBorder(Edge.Left, 60);
    root.setBorder(Edge.Top, 60);
    root.setBorder(Edge.Right, 60);
    root.setBorder(Edge.Bottom, 60);
    root.setWidth(320);
    root.setHeight(320);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setJustifyContent(Justify.Center);
    root_child0.setAlignContent(Align.Center);
    root_child0.setFlexWrap(Wrap.Wrap);
    root_child0.setHeight(10);
    root_child0.setGap(Gutter.Column, 10);
    root_child0.setGap(Gutter.Row, 10);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth("80%");
    root_child0_child0.setHeight(20);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setWidth("80%");
    root_child0_child1.setHeight(20);
    root_child0.insertChild(root_child0_child1, 1);

    const root_child0_child2 = Yoga.Node.create(config);
    root_child0_child2.setWidth("80%");
    root_child0_child2.setHeight(20);
    root_child0.insertChild(root_child0_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(-35);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(-5);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(25);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(-35);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(-5);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(25);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_between_nowrap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.SpaceBetween);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(140);
    root.setHeight(120);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_between_wrap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.SpaceBetween);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(140);
    root.setHeight(120);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(50);
    root_child2.setHeight(10);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(50);
    root_child3.setHeight(10);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(50);
    root_child4.setHeight(10);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(55);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(10);

    expect(root_child3.getComputedLeft()).toBe(50);
    expect(root_child3.getComputedTop()).toBe(55);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(10);

    expect(root_child4.getComputedLeft()).toBe(0);
    expect(root_child4.getComputedTop()).toBe(110);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(90);
    expect(root_child2.getComputedTop()).toBe(55);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(10);

    expect(root_child3.getComputedLeft()).toBe(40);
    expect(root_child3.getComputedTop()).toBe(55);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(10);

    expect(root_child4.getComputedLeft()).toBe(90);
    expect(root_child4.getComputedTop()).toBe(110);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_between_wrap_singleline', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.SpaceBetween);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(140);
    root.setHeight(120);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_between_wrapped_negative_space', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setBorder(Edge.Left, 60);
    root.setBorder(Edge.Top, 60);
    root.setBorder(Edge.Right, 60);
    root.setBorder(Edge.Bottom, 60);
    root.setWidth(320);
    root.setHeight(320);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setJustifyContent(Justify.Center);
    root_child0.setAlignContent(Align.SpaceBetween);
    root_child0.setFlexWrap(Wrap.Wrap);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth("80%");
    root_child0_child0.setHeight(20);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setWidth("80%");
    root_child0_child1.setHeight(20);
    root_child0.insertChild(root_child0_child1, 1);

    const root_child0_child2 = Yoga.Node.create(config);
    root_child0_child2.setWidth("80%");
    root_child0_child2.setHeight(20);
    root_child0.insertChild(root_child0_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(20);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(40);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(20);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(40);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_between_wrapped_negative_space_row_reverse', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setBorder(Edge.Left, 60);
    root.setBorder(Edge.Top, 60);
    root.setBorder(Edge.Right, 60);
    root.setBorder(Edge.Bottom, 60);
    root.setWidth(320);
    root.setHeight(320);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.RowReverse);
    root_child0.setJustifyContent(Justify.Center);
    root_child0.setAlignContent(Align.SpaceBetween);
    root_child0.setFlexWrap(Wrap.Wrap);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth("80%");
    root_child0_child0.setHeight(20);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setWidth("80%");
    root_child0_child1.setHeight(20);
    root_child0.insertChild(root_child0_child1, 1);

    const root_child0_child2 = Yoga.Node.create(config);
    root_child0_child2.setWidth("80%");
    root_child0_child2.setHeight(20);
    root_child0.insertChild(root_child0_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(20);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(40);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(20);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(40);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_between_wrapped_negative_space_gap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setBorder(Edge.Left, 60);
    root.setBorder(Edge.Top, 60);
    root.setBorder(Edge.Right, 60);
    root.setBorder(Edge.Bottom, 60);
    root.setWidth(320);
    root.setHeight(320);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setJustifyContent(Justify.Center);
    root_child0.setAlignContent(Align.SpaceBetween);
    root_child0.setFlexWrap(Wrap.Wrap);
    root_child0.setHeight(10);
    root_child0.setGap(Gutter.Column, 10);
    root_child0.setGap(Gutter.Row, 10);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth("80%");
    root_child0_child0.setHeight(20);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setWidth("80%");
    root_child0_child1.setHeight(20);
    root_child0.insertChild(root_child0_child1, 1);

    const root_child0_child2 = Yoga.Node.create(config);
    root_child0_child2.setWidth("80%");
    root_child0_child2.setHeight(20);
    root_child0.insertChild(root_child0_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(30);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(60);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(30);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(60);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_around_nowrap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.SpaceAround);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(140);
    root.setHeight(120);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_around_wrap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.SpaceAround);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(140);
    root.setHeight(120);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(50);
    root_child2.setHeight(10);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(50);
    root_child3.setHeight(10);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(50);
    root_child4.setHeight(10);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(15);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(15);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(55);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(10);

    expect(root_child3.getComputedLeft()).toBe(50);
    expect(root_child3.getComputedTop()).toBe(55);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(10);

    expect(root_child4.getComputedLeft()).toBe(0);
    expect(root_child4.getComputedTop()).toBe(95);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(15);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(15);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(90);
    expect(root_child2.getComputedTop()).toBe(55);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(10);

    expect(root_child3.getComputedLeft()).toBe(40);
    expect(root_child3.getComputedTop()).toBe(55);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(10);

    expect(root_child4.getComputedLeft()).toBe(90);
    expect(root_child4.getComputedTop()).toBe(95);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_around_wrap_singleline', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.SpaceAround);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(140);
    root.setHeight(120);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(55);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(55);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(55);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(55);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_around_wrapped_negative_space', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setBorder(Edge.Left, 60);
    root.setBorder(Edge.Top, 60);
    root.setBorder(Edge.Right, 60);
    root.setBorder(Edge.Bottom, 60);
    root.setWidth(320);
    root.setHeight(320);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setJustifyContent(Justify.Center);
    root_child0.setAlignContent(Align.SpaceAround);
    root_child0.setFlexWrap(Wrap.Wrap);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth("80%");
    root_child0_child0.setHeight(20);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setWidth("80%");
    root_child0_child1.setHeight(20);
    root_child0.insertChild(root_child0_child1, 1);

    const root_child0_child2 = Yoga.Node.create(config);
    root_child0_child2.setWidth("80%");
    root_child0_child2.setHeight(20);
    root_child0.insertChild(root_child0_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(20);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(40);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(20);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(40);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_around_wrapped_negative_space_row_reverse', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setBorder(Edge.Left, 60);
    root.setBorder(Edge.Top, 60);
    root.setBorder(Edge.Right, 60);
    root.setBorder(Edge.Bottom, 60);
    root.setWidth(320);
    root.setHeight(320);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.RowReverse);
    root_child0.setJustifyContent(Justify.Center);
    root_child0.setAlignContent(Align.SpaceAround);
    root_child0.setFlexWrap(Wrap.Wrap);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth("80%");
    root_child0_child0.setHeight(20);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setWidth("80%");
    root_child0_child1.setHeight(20);
    root_child0.insertChild(root_child0_child1, 1);

    const root_child0_child2 = Yoga.Node.create(config);
    root_child0_child2.setWidth("80%");
    root_child0_child2.setHeight(20);
    root_child0.insertChild(root_child0_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(20);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(40);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(20);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(40);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_around_wrapped_negative_space_gap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setBorder(Edge.Left, 60);
    root.setBorder(Edge.Top, 60);
    root.setBorder(Edge.Right, 60);
    root.setBorder(Edge.Bottom, 60);
    root.setWidth(320);
    root.setHeight(320);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setJustifyContent(Justify.Center);
    root_child0.setAlignContent(Align.SpaceAround);
    root_child0.setFlexWrap(Wrap.Wrap);
    root_child0.setHeight(10);
    root_child0.setGap(Gutter.Column, 10);
    root_child0.setGap(Gutter.Row, 10);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth("80%");
    root_child0_child0.setHeight(20);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setWidth("80%");
    root_child0_child1.setHeight(20);
    root_child0.insertChild(root_child0_child1, 1);

    const root_child0_child2 = Yoga.Node.create(config);
    root_child0_child2.setWidth("80%");
    root_child0_child2.setHeight(20);
    root_child0.insertChild(root_child0_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(30);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(60);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(30);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(60);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_evenly_nowrap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.SpaceEvenly);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(140);
    root.setHeight(120);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_evenly_wrap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.SpaceEvenly);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(140);
    root.setHeight(120);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(50);
    root_child2.setHeight(10);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(50);
    root_child3.setHeight(10);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(50);
    root_child4.setHeight(10);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(23);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(23);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(55);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(10);

    expect(root_child3.getComputedLeft()).toBe(50);
    expect(root_child3.getComputedTop()).toBe(55);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(10);

    expect(root_child4.getComputedLeft()).toBe(0);
    expect(root_child4.getComputedTop()).toBe(88);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(23);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(23);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(90);
    expect(root_child2.getComputedTop()).toBe(55);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(10);

    expect(root_child3.getComputedLeft()).toBe(40);
    expect(root_child3.getComputedTop()).toBe(55);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(10);

    expect(root_child4.getComputedLeft()).toBe(90);
    expect(root_child4.getComputedTop()).toBe(88);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_evenly_wrap_singleline', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.SpaceEvenly);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(140);
    root.setHeight(120);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(55);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(55);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(120);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(55);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(55);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_evenly_wrapped_negative_space', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setBorder(Edge.Left, 60);
    root.setBorder(Edge.Top, 60);
    root.setBorder(Edge.Right, 60);
    root.setBorder(Edge.Bottom, 60);
    root.setWidth(320);
    root.setHeight(320);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setJustifyContent(Justify.Center);
    root_child0.setAlignContent(Align.SpaceEvenly);
    root_child0.setFlexWrap(Wrap.Wrap);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth("80%");
    root_child0_child0.setHeight(20);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setWidth("80%");
    root_child0_child1.setHeight(20);
    root_child0.insertChild(root_child0_child1, 1);

    const root_child0_child2 = Yoga.Node.create(config);
    root_child0_child2.setWidth("80%");
    root_child0_child2.setHeight(20);
    root_child0.insertChild(root_child0_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(20);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(40);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(20);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(40);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_evenly_wrapped_negative_space_gap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setBorder(Edge.Left, 60);
    root.setBorder(Edge.Top, 60);
    root.setBorder(Edge.Right, 60);
    root.setBorder(Edge.Bottom, 60);
    root.setWidth(320);
    root.setHeight(320);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setJustifyContent(Justify.Center);
    root_child0.setAlignContent(Align.SpaceEvenly);
    root_child0.setFlexWrap(Wrap.Wrap);
    root_child0.setHeight(10);
    root_child0.setGap(Gutter.Column, 10);
    root_child0.setGap(Gutter.Row, 10);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth("80%");
    root_child0_child0.setHeight(20);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setWidth("80%");
    root_child0_child1.setHeight(20);
    root_child0.insertChild(root_child0_child1, 1);

    const root_child0_child2 = Yoga.Node.create(config);
    root_child0_child2.setWidth("80%");
    root_child0_child2.setHeight(20);
    root_child0.insertChild(root_child0_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(30);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(60);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(60);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(20);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(160);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child1.getComputedLeft()).toBe(20);
    expect(root_child0_child1.getComputedTop()).toBe(30);
    expect(root_child0_child1.getComputedWidth()).toBe(160);
    expect(root_child0_child1.getComputedHeight()).toBe(20);

    expect(root_child0_child2.getComputedLeft()).toBe(20);
    expect(root_child0_child2.getComputedTop()).toBe(60);
    expect(root_child0_child2.getComputedWidth()).toBe(160);
    expect(root_child0_child2.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_stretch', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setAlignContent(Align.Stretch);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(150);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(50);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(50);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(50);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(0);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(0);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(0);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(0);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(0);

    expect(root_child4.getComputedLeft()).toBe(0);
    expect(root_child4.getComputedTop()).toBe(0);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(0);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(100);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(0);

    expect(root_child1.getComputedLeft()).toBe(100);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(0);

    expect(root_child2.getComputedLeft()).toBe(100);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(0);

    expect(root_child3.getComputedLeft()).toBe(100);
    expect(root_child3.getComputedTop()).toBe(0);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(0);

    expect(root_child4.getComputedLeft()).toBe(100);
    expect(root_child4.getComputedTop()).toBe(0);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(0);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_stretch_row', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Stretch);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(150);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(50);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(50);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(50);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(50);

    expect(root_child2.getComputedLeft()).toBe(100);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(50);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(50);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(50);

    expect(root_child4.getComputedLeft()).toBe(50);
    expect(root_child4.getComputedTop()).toBe(50);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(100);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(50);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(50);

    expect(root_child3.getComputedLeft()).toBe(100);
    expect(root_child3.getComputedTop()).toBe(50);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(50);

    expect(root_child4.getComputedLeft()).toBe(50);
    expect(root_child4.getComputedTop()).toBe(50);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_stretch_row_with_children', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Stretch);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(150);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setFlexGrow(1);
    root_child0_child0.setFlexShrink(1);
    root_child0_child0.setFlexBasis("0%");
    root_child0.insertChild(root_child0_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(50);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(50);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(50);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(50);

    expect(root_child2.getComputedLeft()).toBe(100);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(50);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(50);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(50);

    expect(root_child4.getComputedLeft()).toBe(50);
    expect(root_child4.getComputedTop()).toBe(50);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(100);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(50);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(50);

    expect(root_child3.getComputedLeft()).toBe(100);
    expect(root_child3.getComputedTop()).toBe(50);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(50);

    expect(root_child4.getComputedLeft()).toBe(50);
    expect(root_child4.getComputedTop()).toBe(50);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_stretch_row_with_flex', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Stretch);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(150);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root_child1.setFlexShrink(1);
    root_child1.setFlexBasis("0%");
    root_child1.setWidth(50);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(50);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setFlexGrow(1);
    root_child3.setFlexShrink(1);
    root_child3.setFlexBasis("0%");
    root_child3.setWidth(50);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(50);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(0);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(50);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(100);

    expect(root_child3.getComputedLeft()).toBe(100);
    expect(root_child3.getComputedTop()).toBe(0);
    expect(root_child3.getComputedWidth()).toBe(0);
    expect(root_child3.getComputedHeight()).toBe(100);

    expect(root_child4.getComputedLeft()).toBe(100);
    expect(root_child4.getComputedTop()).toBe(0);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(100);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(100);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(0);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(50);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(100);

    expect(root_child3.getComputedLeft()).toBe(50);
    expect(root_child3.getComputedTop()).toBe(0);
    expect(root_child3.getComputedWidth()).toBe(0);
    expect(root_child3.getComputedHeight()).toBe(100);

    expect(root_child4.getComputedLeft()).toBe(0);
    expect(root_child4.getComputedTop()).toBe(0);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_stretch_row_with_flex_no_shrink', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Stretch);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(150);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root_child1.setFlexShrink(1);
    root_child1.setFlexBasis("0%");
    root_child1.setWidth(50);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(50);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setFlexGrow(1);
    root_child3.setFlexBasis("0%");
    root_child3.setWidth(50);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(50);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(0);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(50);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(100);

    expect(root_child3.getComputedLeft()).toBe(100);
    expect(root_child3.getComputedTop()).toBe(0);
    expect(root_child3.getComputedWidth()).toBe(0);
    expect(root_child3.getComputedHeight()).toBe(100);

    expect(root_child4.getComputedLeft()).toBe(100);
    expect(root_child4.getComputedTop()).toBe(0);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(100);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(100);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(0);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(50);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(100);

    expect(root_child3.getComputedLeft()).toBe(50);
    expect(root_child3.getComputedTop()).toBe(0);
    expect(root_child3.getComputedWidth()).toBe(0);
    expect(root_child3.getComputedHeight()).toBe(100);

    expect(root_child4.getComputedLeft()).toBe(0);
    expect(root_child4.getComputedTop()).toBe(0);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_stretch_row_with_margin', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Stretch);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(150);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setMargin(Edge.Left, 10);
    root_child1.setMargin(Edge.Top, 10);
    root_child1.setMargin(Edge.Right, 10);
    root_child1.setMargin(Edge.Bottom, 10);
    root_child1.setWidth(50);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(50);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setMargin(Edge.Left, 10);
    root_child3.setMargin(Edge.Top, 10);
    root_child3.setMargin(Edge.Right, 10);
    root_child3.setMargin(Edge.Bottom, 10);
    root_child3.setWidth(50);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(50);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(40);

    expect(root_child1.getComputedLeft()).toBe(60);
    expect(root_child1.getComputedTop()).toBe(10);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(40);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(40);

    expect(root_child3.getComputedLeft()).toBe(60);
    expect(root_child3.getComputedTop()).toBe(50);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(20);

    expect(root_child4.getComputedLeft()).toBe(0);
    expect(root_child4.getComputedTop()).toBe(80);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(100);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(40);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(10);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(100);
    expect(root_child2.getComputedTop()).toBe(40);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(40);

    expect(root_child3.getComputedLeft()).toBe(40);
    expect(root_child3.getComputedTop()).toBe(50);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(20);

    expect(root_child4.getComputedLeft()).toBe(100);
    expect(root_child4.getComputedTop()).toBe(80);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_stretch_row_with_padding', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Stretch);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(150);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setPadding(Edge.Left, 10);
    root_child1.setPadding(Edge.Top, 10);
    root_child1.setPadding(Edge.Right, 10);
    root_child1.setPadding(Edge.Bottom, 10);
    root_child1.setWidth(50);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(50);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setPadding(Edge.Left, 10);
    root_child3.setPadding(Edge.Top, 10);
    root_child3.setPadding(Edge.Right, 10);
    root_child3.setPadding(Edge.Bottom, 10);
    root_child3.setWidth(50);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(50);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(50);

    expect(root_child2.getComputedLeft()).toBe(100);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(50);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(50);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(50);

    expect(root_child4.getComputedLeft()).toBe(50);
    expect(root_child4.getComputedTop()).toBe(50);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(100);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(50);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(50);

    expect(root_child3.getComputedLeft()).toBe(100);
    expect(root_child3.getComputedTop()).toBe(50);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(50);

    expect(root_child4.getComputedLeft()).toBe(50);
    expect(root_child4.getComputedTop()).toBe(50);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_stretch_row_with_single_row', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Stretch);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(150);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(100);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_stretch_row_with_fixed_height', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Stretch);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(150);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(60);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(50);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(50);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(50);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(80);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(60);

    expect(root_child2.getComputedLeft()).toBe(100);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(80);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(80);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(20);

    expect(root_child4.getComputedLeft()).toBe(50);
    expect(root_child4.getComputedTop()).toBe(80);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(100);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(80);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(60);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(80);

    expect(root_child3.getComputedLeft()).toBe(100);
    expect(root_child3.getComputedTop()).toBe(80);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(20);

    expect(root_child4.getComputedLeft()).toBe(50);
    expect(root_child4.getComputedTop()).toBe(80);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_stretch_row_with_max_height', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Stretch);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(150);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setMaxHeight(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(50);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(50);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(50);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(100);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(50);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(50);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(50);

    expect(root_child4.getComputedLeft()).toBe(50);
    expect(root_child4.getComputedTop()).toBe(50);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(100);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(50);

    expect(root_child3.getComputedLeft()).toBe(100);
    expect(root_child3.getComputedTop()).toBe(50);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(50);

    expect(root_child4.getComputedLeft()).toBe(50);
    expect(root_child4.getComputedTop()).toBe(50);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_stretch_row_with_min_height', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Stretch);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(150);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setMinHeight(80);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(50);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(50);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(50);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(90);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(90);

    expect(root_child2.getComputedLeft()).toBe(100);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(90);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(90);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(10);

    expect(root_child4.getComputedLeft()).toBe(50);
    expect(root_child4.getComputedTop()).toBe(90);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(100);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(90);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(90);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(90);

    expect(root_child3.getComputedLeft()).toBe(100);
    expect(root_child3.getComputedTop()).toBe(90);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(10);

    expect(root_child4.getComputedLeft()).toBe(50);
    expect(root_child4.getComputedTop()).toBe(90);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_stretch_column', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setAlignContent(Align.Stretch);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(100);
    root.setHeight(150);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setFlexGrow(1);
    root_child0_child0.setFlexShrink(1);
    root_child0_child0.setFlexBasis("0%");
    root_child0.insertChild(root_child0_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root_child1.setFlexShrink(1);
    root_child1.setFlexBasis("0%");
    root_child1.setHeight(50);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setHeight(50);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setHeight(50);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setHeight(50);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(150);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(50);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(0);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(50);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(50);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(100);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(50);

    expect(root_child4.getComputedLeft()).toBe(50);
    expect(root_child4.getComputedTop()).toBe(0);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(150);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(50);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(0);

    expect(root_child2.getComputedLeft()).toBe(50);
    expect(root_child2.getComputedTop()).toBe(50);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(50);

    expect(root_child3.getComputedLeft()).toBe(50);
    expect(root_child3.getComputedTop()).toBe(100);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(50);

    expect(root_child4.getComputedLeft()).toBe(0);
    expect(root_child4.getComputedTop()).toBe(0);
    expect(root_child4.getComputedWidth()).toBe(50);
    expect(root_child4.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_stretch_is_not_overriding_align_items', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setAlignContent(Align.Stretch);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setAlignContent(Align.Stretch);
    root_child0.setAlignItems(Align.Center);
    root_child0.setWidth(100);
    root_child0.setHeight(100);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setAlignContent(Align.Stretch);
    root_child0_child0.setWidth(10);
    root_child0_child0.setHeight(10);
    root_child0.insertChild(root_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(45);
    expect(root_child0_child0.getComputedWidth()).toBe(10);
    expect(root_child0_child0.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0.getComputedLeft()).toBe(90);
    expect(root_child0_child0.getComputedTop()).toBe(45);
    expect(root_child0_child0.getComputedWidth()).toBe(10);
    expect(root_child0_child0.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_stretch_with_min_cross_axis', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Stretch);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(500);
    root.setMinHeight(500);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(400);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(400);
    root_child1.setHeight(200);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(500);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(250);
    expect(root_child1.getComputedWidth()).toBe(400);
    expect(root_child1.getComputedHeight()).toBe(200);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(500);

    expect(root_child0.getComputedLeft()).toBe(100);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child1.getComputedLeft()).toBe(100);
    expect(root_child1.getComputedTop()).toBe(250);
    expect(root_child1.getComputedWidth()).toBe(400);
    expect(root_child1.getComputedHeight()).toBe(200);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_stretch_with_max_cross_axis', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Stretch);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(500);
    root.setMaxHeight(500);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(400);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(400);
    root_child1.setHeight(200);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(200);
    expect(root_child1.getComputedWidth()).toBe(400);
    expect(root_child1.getComputedHeight()).toBe(200);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(100);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child1.getComputedLeft()).toBe(100);
    expect(root_child1.getComputedTop()).toBe(200);
    expect(root_child1.getComputedWidth()).toBe(400);
    expect(root_child1.getComputedHeight()).toBe(200);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_stretch_with_max_cross_axis_and_border_padding', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Stretch);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setPadding(Edge.Left, 2);
    root.setPadding(Edge.Top, 2);
    root.setPadding(Edge.Right, 2);
    root.setPadding(Edge.Bottom, 2);
    root.setBorder(Edge.Left, 5);
    root.setBorder(Edge.Top, 5);
    root.setBorder(Edge.Right, 5);
    root.setBorder(Edge.Bottom, 5);
    root.setWidth(500);
    root.setMaxHeight(500);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(400);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(400);
    root_child1.setHeight(200);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(414);

    expect(root_child0.getComputedLeft()).toBe(7);
    expect(root_child0.getComputedTop()).toBe(7);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child1.getComputedLeft()).toBe(7);
    expect(root_child1.getComputedTop()).toBe(207);
    expect(root_child1.getComputedWidth()).toBe(400);
    expect(root_child1.getComputedHeight()).toBe(200);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(414);

    expect(root_child0.getComputedLeft()).toBe(93);
    expect(root_child0.getComputedTop()).toBe(7);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child1.getComputedLeft()).toBe(93);
    expect(root_child1.getComputedTop()).toBe(207);
    expect(root_child1.getComputedWidth()).toBe(400);
    expect(root_child1.getComputedHeight()).toBe(200);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_evenly_with_min_cross_axis', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.SpaceEvenly);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(500);
    root.setMinHeight(500);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(400);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(400);
    root_child1.setHeight(200);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(500);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(33);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(267);
    expect(root_child1.getComputedWidth()).toBe(400);
    expect(root_child1.getComputedHeight()).toBe(200);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(500);

    expect(root_child0.getComputedLeft()).toBe(100);
    expect(root_child0.getComputedTop()).toBe(33);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child1.getComputedLeft()).toBe(100);
    expect(root_child1.getComputedTop()).toBe(267);
    expect(root_child1.getComputedWidth()).toBe(400);
    expect(root_child1.getComputedHeight()).toBe(200);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_evenly_with_max_cross_axis', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.SpaceEvenly);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(500);
    root.setMaxHeight(500);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(400);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(400);
    root_child1.setHeight(200);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(200);
    expect(root_child1.getComputedWidth()).toBe(400);
    expect(root_child1.getComputedHeight()).toBe(200);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(100);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child1.getComputedLeft()).toBe(100);
    expect(root_child1.getComputedTop()).toBe(200);
    expect(root_child1.getComputedWidth()).toBe(400);
    expect(root_child1.getComputedHeight()).toBe(200);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_evenly_with_max_cross_axis_violated', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.SpaceEvenly);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(500);
    root.setMaxHeight(300);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(400);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(400);
    root_child1.setHeight(200);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(200);
    expect(root_child1.getComputedWidth()).toBe(400);
    expect(root_child1.getComputedHeight()).toBe(200);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(100);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child1.getComputedLeft()).toBe(100);
    expect(root_child1.getComputedTop()).toBe(200);
    expect(root_child1.getComputedWidth()).toBe(400);
    expect(root_child1.getComputedHeight()).toBe(200);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_evenly_with_max_cross_axis_violated_padding_and_border', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.SpaceEvenly);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setPadding(Edge.Left, 2);
    root.setPadding(Edge.Top, 2);
    root.setPadding(Edge.Right, 2);
    root.setPadding(Edge.Bottom, 2);
    root.setBorder(Edge.Left, 5);
    root.setBorder(Edge.Top, 5);
    root.setBorder(Edge.Right, 5);
    root.setBorder(Edge.Bottom, 5);
    root.setWidth(500);
    root.setMaxHeight(300);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(400);
    root_child0.setHeight(200);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(400);
    root_child1.setHeight(200);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(7);
    expect(root_child0.getComputedTop()).toBe(7);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child1.getComputedLeft()).toBe(7);
    expect(root_child1.getComputedTop()).toBe(207);
    expect(root_child1.getComputedWidth()).toBe(400);
    expect(root_child1.getComputedHeight()).toBe(200);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(93);
    expect(root_child0.getComputedTop()).toBe(7);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child1.getComputedLeft()).toBe(93);
    expect(root_child1.getComputedTop()).toBe(207);
    expect(root_child1.getComputedWidth()).toBe(400);
    expect(root_child1.getComputedHeight()).toBe(200);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_around_and_align_items_flex_end_with_flex_wrap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.SpaceAround);
    root.setAlignItems(Align.FlexEnd);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(300);
    root.setHeight(300);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(150);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(120);
    root_child1.setHeight(100);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(120);
    root_child2.setHeight(50);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(88);
    expect(root_child0.getComputedWidth()).toBe(150);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(150);
    expect(root_child1.getComputedTop()).toBe(38);
    expect(root_child1.getComputedWidth()).toBe(120);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(213);
    expect(root_child2.getComputedWidth()).toBe(120);
    expect(root_child2.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(150);
    expect(root_child0.getComputedTop()).toBe(88);
    expect(root_child0.getComputedWidth()).toBe(150);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(38);
    expect(root_child1.getComputedWidth()).toBe(120);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(180);
    expect(root_child2.getComputedTop()).toBe(213);
    expect(root_child2.getComputedWidth()).toBe(120);
    expect(root_child2.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_around_and_align_items_center_with_flex_wrap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.SpaceAround);
    root.setAlignItems(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(300);
    root.setHeight(300);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(150);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(120);
    root_child1.setHeight(100);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(120);
    root_child2.setHeight(50);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(63);
    expect(root_child0.getComputedWidth()).toBe(150);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(150);
    expect(root_child1.getComputedTop()).toBe(38);
    expect(root_child1.getComputedWidth()).toBe(120);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(213);
    expect(root_child2.getComputedWidth()).toBe(120);
    expect(root_child2.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(150);
    expect(root_child0.getComputedTop()).toBe(63);
    expect(root_child0.getComputedWidth()).toBe(150);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(38);
    expect(root_child1.getComputedWidth()).toBe(120);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(180);
    expect(root_child2.getComputedTop()).toBe(213);
    expect(root_child2.getComputedWidth()).toBe(120);
    expect(root_child2.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_around_and_align_items_flex_start_with_flex_wrap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.SpaceAround);
    root.setAlignItems(Align.FlexStart);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(300);
    root.setHeight(300);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(150);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(120);
    root_child1.setHeight(100);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(120);
    root_child2.setHeight(50);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(38);
    expect(root_child0.getComputedWidth()).toBe(150);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(150);
    expect(root_child1.getComputedTop()).toBe(38);
    expect(root_child1.getComputedWidth()).toBe(120);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(213);
    expect(root_child2.getComputedWidth()).toBe(120);
    expect(root_child2.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(150);
    expect(root_child0.getComputedTop()).toBe(38);
    expect(root_child0.getComputedWidth()).toBe(150);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(38);
    expect(root_child1.getComputedWidth()).toBe(120);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(180);
    expect(root_child2.getComputedTop()).toBe(213);
    expect(root_child2.getComputedWidth()).toBe(120);
    expect(root_child2.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_flex_start_stretch_doesnt_influence_line_box_dim', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Left, 20);
    root.setPadding(Edge.Top, 20);
    root.setPadding(Edge.Right, 20);
    root.setPadding(Edge.Bottom, 20);
    root.setWidth(400);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Right, 20);
    root_child0.setWidth(100);
    root_child0.setHeight(100);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexDirection(FlexDirection.Row);
    root_child1.setFlexWrap(Wrap.Wrap);
    root_child1.setFlexGrow(1);
    root_child1.setFlexShrink(1);
    root.insertChild(root_child1, 1);

    const root_child1_child0 = Yoga.Node.create(config);
    root_child1_child0.setMargin(Edge.Right, 20);
    root_child1_child0.setWidth(30);
    root_child1_child0.setHeight(30);
    root_child1.insertChild(root_child1_child0, 0);

    const root_child1_child1 = Yoga.Node.create(config);
    root_child1_child1.setMargin(Edge.Right, 20);
    root_child1_child1.setWidth(30);
    root_child1_child1.setHeight(30);
    root_child1.insertChild(root_child1_child1, 1);

    const root_child1_child2 = Yoga.Node.create(config);
    root_child1_child2.setMargin(Edge.Right, 20);
    root_child1_child2.setWidth(30);
    root_child1_child2.setHeight(30);
    root_child1.insertChild(root_child1_child2, 2);

    const root_child1_child3 = Yoga.Node.create(config);
    root_child1_child3.setMargin(Edge.Right, 20);
    root_child1_child3.setWidth(30);
    root_child1_child3.setHeight(30);
    root_child1.insertChild(root_child1_child3, 3);

    const root_child1_child4 = Yoga.Node.create(config);
    root_child1_child4.setMargin(Edge.Right, 20);
    root_child1_child4.setWidth(30);
    root_child1_child4.setHeight(30);
    root_child1.insertChild(root_child1_child4, 4);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setMargin(Edge.Left, 20);
    root_child2.setWidth(50);
    root_child2.setHeight(50);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(140);

    expect(root_child0.getComputedLeft()).toBe(20);
    expect(root_child0.getComputedTop()).toBe(20);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(140);
    expect(root_child1.getComputedTop()).toBe(20);
    expect(root_child1.getComputedWidth()).toBe(170);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(30);
    expect(root_child1_child0.getComputedHeight()).toBe(30);

    expect(root_child1_child1.getComputedLeft()).toBe(50);
    expect(root_child1_child1.getComputedTop()).toBe(0);
    expect(root_child1_child1.getComputedWidth()).toBe(30);
    expect(root_child1_child1.getComputedHeight()).toBe(30);

    expect(root_child1_child2.getComputedLeft()).toBe(100);
    expect(root_child1_child2.getComputedTop()).toBe(0);
    expect(root_child1_child2.getComputedWidth()).toBe(30);
    expect(root_child1_child2.getComputedHeight()).toBe(30);

    expect(root_child1_child3.getComputedLeft()).toBe(0);
    expect(root_child1_child3.getComputedTop()).toBe(30);
    expect(root_child1_child3.getComputedWidth()).toBe(30);
    expect(root_child1_child3.getComputedHeight()).toBe(30);

    expect(root_child1_child4.getComputedLeft()).toBe(50);
    expect(root_child1_child4.getComputedTop()).toBe(30);
    expect(root_child1_child4.getComputedWidth()).toBe(30);
    expect(root_child1_child4.getComputedHeight()).toBe(30);

    expect(root_child2.getComputedLeft()).toBe(330);
    expect(root_child2.getComputedTop()).toBe(20);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(140);

    expect(root_child0.getComputedLeft()).toBe(260);
    expect(root_child0.getComputedTop()).toBe(20);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(90);
    expect(root_child1.getComputedTop()).toBe(20);
    expect(root_child1.getComputedWidth()).toBe(170);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child1_child0.getComputedLeft()).toBe(120);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(30);
    expect(root_child1_child0.getComputedHeight()).toBe(30);

    expect(root_child1_child1.getComputedLeft()).toBe(70);
    expect(root_child1_child1.getComputedTop()).toBe(0);
    expect(root_child1_child1.getComputedWidth()).toBe(30);
    expect(root_child1_child1.getComputedHeight()).toBe(30);

    expect(root_child1_child2.getComputedLeft()).toBe(20);
    expect(root_child1_child2.getComputedTop()).toBe(0);
    expect(root_child1_child2.getComputedWidth()).toBe(30);
    expect(root_child1_child2.getComputedHeight()).toBe(30);

    expect(root_child1_child3.getComputedLeft()).toBe(120);
    expect(root_child1_child3.getComputedTop()).toBe(30);
    expect(root_child1_child3.getComputedWidth()).toBe(30);
    expect(root_child1_child3.getComputedHeight()).toBe(30);

    expect(root_child1_child4.getComputedLeft()).toBe(70);
    expect(root_child1_child4.getComputedTop()).toBe(30);
    expect(root_child1_child4.getComputedWidth()).toBe(30);
    expect(root_child1_child4.getComputedHeight()).toBe(30);

    expect(root_child2.getComputedLeft()).toBe(40);
    expect(root_child2.getComputedTop()).toBe(20);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_stretch_stretch_does_influence_line_box_dim', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Left, 20);
    root.setPadding(Edge.Top, 20);
    root.setPadding(Edge.Right, 20);
    root.setPadding(Edge.Bottom, 20);
    root.setWidth(400);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Right, 20);
    root_child0.setWidth(100);
    root_child0.setHeight(100);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexDirection(FlexDirection.Row);
    root_child1.setAlignContent(Align.Stretch);
    root_child1.setFlexWrap(Wrap.Wrap);
    root_child1.setFlexGrow(1);
    root_child1.setFlexShrink(1);
    root.insertChild(root_child1, 1);

    const root_child1_child0 = Yoga.Node.create(config);
    root_child1_child0.setMargin(Edge.Right, 20);
    root_child1_child0.setWidth(30);
    root_child1_child0.setHeight(30);
    root_child1.insertChild(root_child1_child0, 0);

    const root_child1_child1 = Yoga.Node.create(config);
    root_child1_child1.setMargin(Edge.Right, 20);
    root_child1_child1.setWidth(30);
    root_child1_child1.setHeight(30);
    root_child1.insertChild(root_child1_child1, 1);

    const root_child1_child2 = Yoga.Node.create(config);
    root_child1_child2.setMargin(Edge.Right, 20);
    root_child1_child2.setWidth(30);
    root_child1_child2.setHeight(30);
    root_child1.insertChild(root_child1_child2, 2);

    const root_child1_child3 = Yoga.Node.create(config);
    root_child1_child3.setMargin(Edge.Right, 20);
    root_child1_child3.setWidth(30);
    root_child1_child3.setHeight(30);
    root_child1.insertChild(root_child1_child3, 3);

    const root_child1_child4 = Yoga.Node.create(config);
    root_child1_child4.setMargin(Edge.Right, 20);
    root_child1_child4.setWidth(30);
    root_child1_child4.setHeight(30);
    root_child1.insertChild(root_child1_child4, 4);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setMargin(Edge.Left, 20);
    root_child2.setWidth(50);
    root_child2.setHeight(50);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(140);

    expect(root_child0.getComputedLeft()).toBe(20);
    expect(root_child0.getComputedTop()).toBe(20);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(140);
    expect(root_child1.getComputedTop()).toBe(20);
    expect(root_child1.getComputedWidth()).toBe(170);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(30);
    expect(root_child1_child0.getComputedHeight()).toBe(30);

    expect(root_child1_child1.getComputedLeft()).toBe(50);
    expect(root_child1_child1.getComputedTop()).toBe(0);
    expect(root_child1_child1.getComputedWidth()).toBe(30);
    expect(root_child1_child1.getComputedHeight()).toBe(30);

    expect(root_child1_child2.getComputedLeft()).toBe(100);
    expect(root_child1_child2.getComputedTop()).toBe(0);
    expect(root_child1_child2.getComputedWidth()).toBe(30);
    expect(root_child1_child2.getComputedHeight()).toBe(30);

    expect(root_child1_child3.getComputedLeft()).toBe(0);
    expect(root_child1_child3.getComputedTop()).toBe(50);
    expect(root_child1_child3.getComputedWidth()).toBe(30);
    expect(root_child1_child3.getComputedHeight()).toBe(30);

    expect(root_child1_child4.getComputedLeft()).toBe(50);
    expect(root_child1_child4.getComputedTop()).toBe(50);
    expect(root_child1_child4.getComputedWidth()).toBe(30);
    expect(root_child1_child4.getComputedHeight()).toBe(30);

    expect(root_child2.getComputedLeft()).toBe(330);
    expect(root_child2.getComputedTop()).toBe(20);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(140);

    expect(root_child0.getComputedLeft()).toBe(260);
    expect(root_child0.getComputedTop()).toBe(20);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(90);
    expect(root_child1.getComputedTop()).toBe(20);
    expect(root_child1.getComputedWidth()).toBe(170);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child1_child0.getComputedLeft()).toBe(120);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(30);
    expect(root_child1_child0.getComputedHeight()).toBe(30);

    expect(root_child1_child1.getComputedLeft()).toBe(70);
    expect(root_child1_child1.getComputedTop()).toBe(0);
    expect(root_child1_child1.getComputedWidth()).toBe(30);
    expect(root_child1_child1.getComputedHeight()).toBe(30);

    expect(root_child1_child2.getComputedLeft()).toBe(20);
    expect(root_child1_child2.getComputedTop()).toBe(0);
    expect(root_child1_child2.getComputedWidth()).toBe(30);
    expect(root_child1_child2.getComputedHeight()).toBe(30);

    expect(root_child1_child3.getComputedLeft()).toBe(120);
    expect(root_child1_child3.getComputedTop()).toBe(50);
    expect(root_child1_child3.getComputedWidth()).toBe(30);
    expect(root_child1_child3.getComputedHeight()).toBe(30);

    expect(root_child1_child4.getComputedLeft()).toBe(70);
    expect(root_child1_child4.getComputedTop()).toBe(50);
    expect(root_child1_child4.getComputedWidth()).toBe(30);
    expect(root_child1_child4.getComputedHeight()).toBe(30);

    expect(root_child2.getComputedLeft()).toBe(40);
    expect(root_child2.getComputedTop()).toBe(20);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_space_evenly_stretch_does_influence_line_box_dim', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Left, 20);
    root.setPadding(Edge.Top, 20);
    root.setPadding(Edge.Right, 20);
    root.setPadding(Edge.Bottom, 20);
    root.setWidth(400);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Right, 20);
    root_child0.setWidth(100);
    root_child0.setHeight(100);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexDirection(FlexDirection.Row);
    root_child1.setAlignContent(Align.Stretch);
    root_child1.setFlexWrap(Wrap.Wrap);
    root_child1.setFlexGrow(1);
    root_child1.setFlexShrink(1);
    root.insertChild(root_child1, 1);

    const root_child1_child0 = Yoga.Node.create(config);
    root_child1_child0.setMargin(Edge.Right, 20);
    root_child1_child0.setWidth(30);
    root_child1_child0.setHeight(30);
    root_child1.insertChild(root_child1_child0, 0);

    const root_child1_child1 = Yoga.Node.create(config);
    root_child1_child1.setMargin(Edge.Right, 20);
    root_child1_child1.setWidth(30);
    root_child1_child1.setHeight(30);
    root_child1.insertChild(root_child1_child1, 1);

    const root_child1_child2 = Yoga.Node.create(config);
    root_child1_child2.setMargin(Edge.Right, 20);
    root_child1_child2.setWidth(30);
    root_child1_child2.setHeight(30);
    root_child1.insertChild(root_child1_child2, 2);

    const root_child1_child3 = Yoga.Node.create(config);
    root_child1_child3.setMargin(Edge.Right, 20);
    root_child1_child3.setWidth(30);
    root_child1_child3.setHeight(30);
    root_child1.insertChild(root_child1_child3, 3);

    const root_child1_child4 = Yoga.Node.create(config);
    root_child1_child4.setMargin(Edge.Right, 20);
    root_child1_child4.setWidth(30);
    root_child1_child4.setHeight(30);
    root_child1.insertChild(root_child1_child4, 4);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setMargin(Edge.Left, 20);
    root_child2.setWidth(50);
    root_child2.setHeight(50);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(140);

    expect(root_child0.getComputedLeft()).toBe(20);
    expect(root_child0.getComputedTop()).toBe(20);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(140);
    expect(root_child1.getComputedTop()).toBe(20);
    expect(root_child1.getComputedWidth()).toBe(170);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(30);
    expect(root_child1_child0.getComputedHeight()).toBe(30);

    expect(root_child1_child1.getComputedLeft()).toBe(50);
    expect(root_child1_child1.getComputedTop()).toBe(0);
    expect(root_child1_child1.getComputedWidth()).toBe(30);
    expect(root_child1_child1.getComputedHeight()).toBe(30);

    expect(root_child1_child2.getComputedLeft()).toBe(100);
    expect(root_child1_child2.getComputedTop()).toBe(0);
    expect(root_child1_child2.getComputedWidth()).toBe(30);
    expect(root_child1_child2.getComputedHeight()).toBe(30);

    expect(root_child1_child3.getComputedLeft()).toBe(0);
    expect(root_child1_child3.getComputedTop()).toBe(50);
    expect(root_child1_child3.getComputedWidth()).toBe(30);
    expect(root_child1_child3.getComputedHeight()).toBe(30);

    expect(root_child1_child4.getComputedLeft()).toBe(50);
    expect(root_child1_child4.getComputedTop()).toBe(50);
    expect(root_child1_child4.getComputedWidth()).toBe(30);
    expect(root_child1_child4.getComputedHeight()).toBe(30);

    expect(root_child2.getComputedLeft()).toBe(330);
    expect(root_child2.getComputedTop()).toBe(20);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(140);

    expect(root_child0.getComputedLeft()).toBe(260);
    expect(root_child0.getComputedTop()).toBe(20);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(90);
    expect(root_child1.getComputedTop()).toBe(20);
    expect(root_child1.getComputedWidth()).toBe(170);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child1_child0.getComputedLeft()).toBe(120);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(30);
    expect(root_child1_child0.getComputedHeight()).toBe(30);

    expect(root_child1_child1.getComputedLeft()).toBe(70);
    expect(root_child1_child1.getComputedTop()).toBe(0);
    expect(root_child1_child1.getComputedWidth()).toBe(30);
    expect(root_child1_child1.getComputedHeight()).toBe(30);

    expect(root_child1_child2.getComputedLeft()).toBe(20);
    expect(root_child1_child2.getComputedTop()).toBe(0);
    expect(root_child1_child2.getComputedWidth()).toBe(30);
    expect(root_child1_child2.getComputedHeight()).toBe(30);

    expect(root_child1_child3.getComputedLeft()).toBe(120);
    expect(root_child1_child3.getComputedTop()).toBe(50);
    expect(root_child1_child3.getComputedWidth()).toBe(30);
    expect(root_child1_child3.getComputedHeight()).toBe(30);

    expect(root_child1_child4.getComputedLeft()).toBe(70);
    expect(root_child1_child4.getComputedTop()).toBe(50);
    expect(root_child1_child4.getComputedWidth()).toBe(30);
    expect(root_child1_child4.getComputedHeight()).toBe(30);

    expect(root_child2.getComputedLeft()).toBe(40);
    expect(root_child2.getComputedTop()).toBe(20);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_stretch_and_align_items_flex_end_with_flex_wrap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Stretch);
    root.setAlignItems(Align.FlexEnd);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(300);
    root.setHeight(300);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setAlignSelf(Align.FlexStart);
    root_child0.setWidth(150);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(120);
    root_child1.setHeight(100);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(120);
    root_child2.setHeight(50);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(150);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(150);
    expect(root_child1.getComputedTop()).toBe(75);
    expect(root_child1.getComputedWidth()).toBe(120);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(250);
    expect(root_child2.getComputedWidth()).toBe(120);
    expect(root_child2.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(150);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(150);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(75);
    expect(root_child1.getComputedWidth()).toBe(120);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(180);
    expect(root_child2.getComputedTop()).toBe(250);
    expect(root_child2.getComputedWidth()).toBe(120);
    expect(root_child2.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_stretch_and_align_items_flex_start_with_flex_wrap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Stretch);
    root.setAlignItems(Align.FlexStart);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(300);
    root.setHeight(300);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setAlignSelf(Align.FlexEnd);
    root_child0.setWidth(150);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(120);
    root_child1.setHeight(100);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(120);
    root_child2.setHeight(50);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(125);
    expect(root_child0.getComputedWidth()).toBe(150);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(150);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(120);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(175);
    expect(root_child2.getComputedWidth()).toBe(120);
    expect(root_child2.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(150);
    expect(root_child0.getComputedTop()).toBe(125);
    expect(root_child0.getComputedWidth()).toBe(150);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(120);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(180);
    expect(root_child2.getComputedTop()).toBe(175);
    expect(root_child2.getComputedWidth()).toBe(120);
    expect(root_child2.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_stretch_and_align_items_center_with_flex_wrap', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Stretch);
    root.setAlignItems(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(300);
    root.setHeight(300);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setAlignSelf(Align.FlexEnd);
    root_child0.setWidth(150);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(120);
    root_child1.setHeight(100);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(120);
    root_child2.setHeight(50);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(125);
    expect(root_child0.getComputedWidth()).toBe(150);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(150);
    expect(root_child1.getComputedTop()).toBe(38);
    expect(root_child1.getComputedWidth()).toBe(120);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(213);
    expect(root_child2.getComputedWidth()).toBe(120);
    expect(root_child2.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(150);
    expect(root_child0.getComputedTop()).toBe(125);
    expect(root_child0.getComputedWidth()).toBe(150);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(38);
    expect(root_child1.getComputedWidth()).toBe(120);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(180);
    expect(root_child2.getComputedTop()).toBe(213);
    expect(root_child2.getComputedWidth()).toBe(120);
    expect(root_child2.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_content_stretch_and_align_items_stretch_with_flex_wrap', () => {
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

    const root_child0 = Yoga.Node.create(config);
    root_child0.setAlignSelf(Align.FlexEnd);
    root_child0.setWidth(150);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(120);
    root_child1.setHeight(100);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(120);
    root_child2.setHeight(50);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(125);
    expect(root_child0.getComputedWidth()).toBe(150);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(150);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(120);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(175);
    expect(root_child2.getComputedWidth()).toBe(120);
    expect(root_child2.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(300);

    expect(root_child0.getComputedLeft()).toBe(150);
    expect(root_child0.getComputedTop()).toBe(125);
    expect(root_child0.getComputedWidth()).toBe(150);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(120);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(180);
    expect(root_child2.getComputedTop()).toBe(175);
    expect(root_child2.getComputedWidth()).toBe(120);
    expect(root_child2.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
