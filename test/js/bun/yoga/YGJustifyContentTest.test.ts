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

test('justify_content_row_flex_start', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(102);
    root.setHeight(102);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(10);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(10);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(10);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(20);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(10);
    expect(root_child2.getComputedHeight()).toBe(102);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(92);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(82);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(10);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(72);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(10);
    expect(root_child2.getComputedHeight()).toBe(102);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_row_flex_end', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setJustifyContent(Justify.FlexEnd);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(102);
    root.setHeight(102);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(10);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(72);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(82);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(10);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(92);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(10);
    expect(root_child2.getComputedHeight()).toBe(102);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(20);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(10);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(10);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(10);
    expect(root_child2.getComputedHeight()).toBe(102);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_row_center', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setJustifyContent(Justify.Center);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(102);
    root.setHeight(102);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(10);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(36);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(46);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(10);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(56);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(10);
    expect(root_child2.getComputedHeight()).toBe(102);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(56);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(46);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(10);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(36);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(10);
    expect(root_child2.getComputedHeight()).toBe(102);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_row_space_between', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setJustifyContent(Justify.SpaceBetween);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(102);
    root.setHeight(102);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(10);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(46);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(10);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(92);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(10);
    expect(root_child2.getComputedHeight()).toBe(102);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(92);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(46);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(10);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(10);
    expect(root_child2.getComputedHeight()).toBe(102);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_row_space_around', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setJustifyContent(Justify.SpaceAround);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(102);
    root.setHeight(102);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(10);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(12);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(46);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(10);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(80);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(10);
    expect(root_child2.getComputedHeight()).toBe(102);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(46);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(10);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(12);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(10);
    expect(root_child2.getComputedHeight()).toBe(102);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_column_flex_start', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(102);
    root.setHeight(102);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setHeight(10);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(102);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(10);
    expect(root_child1.getComputedWidth()).toBe(102);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(20);
    expect(root_child2.getComputedWidth()).toBe(102);
    expect(root_child2.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(102);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(10);
    expect(root_child1.getComputedWidth()).toBe(102);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(20);
    expect(root_child2.getComputedWidth()).toBe(102);
    expect(root_child2.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_column_flex_end', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setJustifyContent(Justify.FlexEnd);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(102);
    root.setHeight(102);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setHeight(10);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(72);
    expect(root_child0.getComputedWidth()).toBe(102);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(82);
    expect(root_child1.getComputedWidth()).toBe(102);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(92);
    expect(root_child2.getComputedWidth()).toBe(102);
    expect(root_child2.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(72);
    expect(root_child0.getComputedWidth()).toBe(102);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(82);
    expect(root_child1.getComputedWidth()).toBe(102);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(92);
    expect(root_child2.getComputedWidth()).toBe(102);
    expect(root_child2.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_column_center', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setJustifyContent(Justify.Center);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(102);
    root.setHeight(102);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setHeight(10);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(36);
    expect(root_child0.getComputedWidth()).toBe(102);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(46);
    expect(root_child1.getComputedWidth()).toBe(102);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(56);
    expect(root_child2.getComputedWidth()).toBe(102);
    expect(root_child2.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(36);
    expect(root_child0.getComputedWidth()).toBe(102);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(46);
    expect(root_child1.getComputedWidth()).toBe(102);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(56);
    expect(root_child2.getComputedWidth()).toBe(102);
    expect(root_child2.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_column_space_between', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setJustifyContent(Justify.SpaceBetween);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(102);
    root.setHeight(102);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setHeight(10);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(102);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(46);
    expect(root_child1.getComputedWidth()).toBe(102);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(92);
    expect(root_child2.getComputedWidth()).toBe(102);
    expect(root_child2.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(102);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(46);
    expect(root_child1.getComputedWidth()).toBe(102);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(92);
    expect(root_child2.getComputedWidth()).toBe(102);
    expect(root_child2.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_column_space_around', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setJustifyContent(Justify.SpaceAround);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(102);
    root.setHeight(102);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setHeight(10);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(12);
    expect(root_child0.getComputedWidth()).toBe(102);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(46);
    expect(root_child1.getComputedWidth()).toBe(102);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(80);
    expect(root_child2.getComputedWidth()).toBe(102);
    expect(root_child2.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(12);
    expect(root_child0.getComputedWidth()).toBe(102);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(46);
    expect(root_child1.getComputedWidth()).toBe(102);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(80);
    expect(root_child2.getComputedWidth()).toBe(102);
    expect(root_child2.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_row_min_width_and_margin', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setJustifyContent(Justify.Center);
    root.setPositionType(PositionType.Absolute);
    root.setMargin(Edge.Left, 100);
    root.setMinWidth(50);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(20);
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(100);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(50);
    expect(root.getComputedHeight()).toBe(20);

    expect(root_child0.getComputedLeft()).toBe(15);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(100);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(50);
    expect(root.getComputedHeight()).toBe(20);

    expect(root_child0.getComputedLeft()).toBe(15);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_row_max_width_and_margin', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setJustifyContent(Justify.Center);
    root.setPositionType(PositionType.Absolute);
    root.setMargin(Edge.Left, 100);
    root.setWidth(100);
    root.setMaxWidth(80);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(20);
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(100);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(80);
    expect(root.getComputedHeight()).toBe(20);

    expect(root_child0.getComputedLeft()).toBe(30);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(100);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(80);
    expect(root.getComputedHeight()).toBe(20);

    expect(root_child0.getComputedLeft()).toBe(30);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_column_min_height_and_margin', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setJustifyContent(Justify.Center);
    root.setPositionType(PositionType.Absolute);
    root.setMargin(Edge.Top, 100);
    root.setMinHeight(50);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(20);
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(100);
    expect(root.getComputedWidth()).toBe(20);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(15);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(100);
    expect(root.getComputedWidth()).toBe(20);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(15);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_column_max_height_and_margin', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setJustifyContent(Justify.Center);
    root.setPositionType(PositionType.Absolute);
    root.setMargin(Edge.Top, 100);
    root.setHeight(100);
    root.setMaxHeight(80);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(20);
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(100);
    expect(root.getComputedWidth()).toBe(20);
    expect(root.getComputedHeight()).toBe(80);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(30);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(100);
    expect(root.getComputedWidth()).toBe(20);
    expect(root.getComputedHeight()).toBe(80);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(30);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_column_space_evenly', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setJustifyContent(Justify.SpaceEvenly);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(102);
    root.setHeight(102);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setHeight(10);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(18);
    expect(root_child0.getComputedWidth()).toBe(102);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(46);
    expect(root_child1.getComputedWidth()).toBe(102);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(74);
    expect(root_child2.getComputedWidth()).toBe(102);
    expect(root_child2.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(18);
    expect(root_child0.getComputedWidth()).toBe(102);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(46);
    expect(root_child1.getComputedWidth()).toBe(102);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(74);
    expect(root_child2.getComputedWidth()).toBe(102);
    expect(root_child2.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_row_space_evenly', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setJustifyContent(Justify.SpaceEvenly);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(102);
    root.setHeight(102);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setHeight(10);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(26);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(0);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(51);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(0);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(77);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(0);
    expect(root_child2.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(77);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(0);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(51);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(0);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(26);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(0);
    expect(root_child2.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_min_width_with_padding_child_width_greater_than_parent', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setAlignContent(Align.Stretch);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(1000);
    root.setHeight(1584);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setAlignContent(Align.Stretch);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setFlexDirection(FlexDirection.Row);
    root_child0_child0.setJustifyContent(Justify.Center);
    root_child0_child0.setAlignContent(Align.Stretch);
    root_child0_child0.setPadding(Edge.Left, 100);
    root_child0_child0.setPadding(Edge.Right, 100);
    root_child0_child0.setMinWidth(400);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setFlexDirection(FlexDirection.Row);
    root_child0_child0_child0.setAlignContent(Align.Stretch);
    root_child0_child0_child0.setWidth(300);
    root_child0_child0_child0.setHeight(100);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(1000);
    expect(root.getComputedHeight()).toBe(1584);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(1000);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(500);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(300);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(1000);
    expect(root.getComputedHeight()).toBe(1584);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(1000);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0.getComputedLeft()).toBe(500);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(500);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(100);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(300);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_min_width_with_padding_child_width_lower_than_parent', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setAlignContent(Align.Stretch);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(1080);
    root.setHeight(1584);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setAlignContent(Align.Stretch);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setFlexDirection(FlexDirection.Row);
    root_child0_child0.setJustifyContent(Justify.Center);
    root_child0_child0.setAlignContent(Align.Stretch);
    root_child0_child0.setPadding(Edge.Left, 100);
    root_child0_child0.setPadding(Edge.Right, 100);
    root_child0_child0.setMinWidth(400);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setFlexDirection(FlexDirection.Row);
    root_child0_child0_child0.setAlignContent(Align.Stretch);
    root_child0_child0_child0.setWidth(199);
    root_child0_child0_child0.setHeight(100);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(1080);
    expect(root.getComputedHeight()).toBe(1584);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(1080);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(400);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(101);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(199);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(1080);
    expect(root.getComputedHeight()).toBe(1584);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(1080);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0.getComputedLeft()).toBe(680);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(400);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(101);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(199);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_space_between_indefinite_container_dim_with_free_space', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setAlignItems(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(300);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setJustifyContent(Justify.SpaceBetween);
    root_child0.setMinWidth(200);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth(50);
    root_child0_child0.setHeight(50);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setWidth(50);
    root_child0_child1.setHeight(50);
    root_child0.insertChild(root_child0_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child1.getComputedLeft()).toBe(150);
    expect(root_child0_child1.getComputedTop()).toBe(0);
    expect(root_child0_child1.getComputedWidth()).toBe(50);
    expect(root_child0_child1.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0.getComputedLeft()).toBe(150);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child1.getComputedLeft()).toBe(0);
    expect(root_child0_child1.getComputedTop()).toBe(0);
    expect(root_child0_child1.getComputedWidth()).toBe(50);
    expect(root_child0_child1.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_flex_start_row_reverse', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.RowReverse);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

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

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(60);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(40);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(20);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(40);
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
test('justify_content_flex_end_row_reverse', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.RowReverse);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

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

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(60);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(40);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(20);
    expect(root_child2.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(20);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(20);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(40);
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
test('justify_content_overflow_row_flex_start', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(102);
    root.setHeight(102);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(40);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(40);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(40);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(80);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(40);
    expect(root_child2.getComputedHeight()).toBe(102);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(62);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(22);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(-18);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(40);
    expect(root_child2.getComputedHeight()).toBe(102);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_overflow_row_flex_end', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setJustifyContent(Justify.FlexEnd);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(102);
    root.setHeight(102);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(40);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(40);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(40);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(-18);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(22);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(62);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(40);
    expect(root_child2.getComputedHeight()).toBe(102);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(40);
    expect(root_child2.getComputedHeight()).toBe(102);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_overflow_row_center', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setJustifyContent(Justify.Center);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(102);
    root.setHeight(102);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(40);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(40);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(40);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(-9);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(31);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(71);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(40);
    expect(root_child2.getComputedHeight()).toBe(102);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(71);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(31);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(-9);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(40);
    expect(root_child2.getComputedHeight()).toBe(102);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_overflow_row_space_between', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setJustifyContent(Justify.SpaceBetween);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(102);
    root.setHeight(102);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(40);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(40);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(40);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(80);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(40);
    expect(root_child2.getComputedHeight()).toBe(102);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(62);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(22);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(-18);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(40);
    expect(root_child2.getComputedHeight()).toBe(102);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_overflow_row_space_around', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setJustifyContent(Justify.SpaceAround);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(102);
    root.setHeight(102);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(40);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(40);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(40);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(80);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(40);
    expect(root_child2.getComputedHeight()).toBe(102);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(62);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(22);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(-18);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(40);
    expect(root_child2.getComputedHeight()).toBe(102);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_overflow_row_space_evenly', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setJustifyContent(Justify.SpaceEvenly);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(102);
    root.setHeight(102);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(40);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(40);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(40);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(80);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(40);
    expect(root_child2.getComputedHeight()).toBe(102);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(62);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(22);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(-18);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(40);
    expect(root_child2.getComputedHeight()).toBe(102);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test.skip('justify_content_overflow_row_reverse_space_around', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.RowReverse);
    root.setJustifyContent(Justify.SpaceAround);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(102);
    root.setHeight(102);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(40);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(40);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(40);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(40);
    expect(root_child2.getComputedHeight()).toBe(102);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(-18);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(22);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(62);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(40);
    expect(root_child2.getComputedHeight()).toBe(102);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test.skip('justify_content_overflow_row_reverse_space_evenly', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.RowReverse);
    root.setJustifyContent(Justify.SpaceEvenly);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(102);
    root.setHeight(102);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(40);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(40);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(40);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(40);
    expect(root_child2.getComputedHeight()).toBe(102);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(-18);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(22);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(62);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(40);
    expect(root_child2.getComputedHeight()).toBe(102);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('justify_content_overflow_row_space_evenly_auto_margin', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setJustifyContent(Justify.SpaceEvenly);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(102);
    root.setHeight(102);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Right, 'auto');
    root_child0.setWidth(40);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(40);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(40);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(80);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(40);
    expect(root_child2.getComputedHeight()).toBe(102);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(102);
    expect(root.getComputedHeight()).toBe(102);

    expect(root_child0.getComputedLeft()).toBe(62);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(102);

    expect(root_child1.getComputedLeft()).toBe(22);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(102);

    expect(root_child2.getComputedLeft()).toBe(-18);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(40);
    expect(root_child2.getComputedHeight()).toBe(102);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
