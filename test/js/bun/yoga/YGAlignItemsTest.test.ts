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

test('align_items_stretch', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_items_center', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setAlignItems(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(10);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(45);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(45);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_items_flex_start', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setAlignItems(Align.FlexStart);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
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
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_items_flex_end', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setAlignItems(Align.FlexEnd);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(10);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_baseline', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignItems(Align.Baseline);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(30);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(30);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_baseline_child', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignItems(Align.Baseline);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child1_child0 = Yoga.Node.create(config);
    root_child1_child0.setWidth(50);
    root_child1_child0.setHeight(10);
    root_child1.insertChild(root_child1_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(50);
    expect(root_child1_child0.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(50);
    expect(root_child1_child0.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_baseline_child_multiline', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignItems(Align.Baseline);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(60);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexDirection(FlexDirection.Row);
    root_child1.setFlexWrap(Wrap.Wrap);
    root_child1.setWidth(50);
    root_child1.setHeight(25);
    root.insertChild(root_child1, 1);

    const root_child1_child0 = Yoga.Node.create(config);
    root_child1_child0.setWidth(25);
    root_child1_child0.setHeight(20);
    root_child1.insertChild(root_child1_child0, 0);

    const root_child1_child1 = Yoga.Node.create(config);
    root_child1_child1.setWidth(25);
    root_child1_child1.setHeight(10);
    root_child1.insertChild(root_child1_child1, 1);

    const root_child1_child2 = Yoga.Node.create(config);
    root_child1_child2.setWidth(25);
    root_child1_child2.setHeight(20);
    root_child1.insertChild(root_child1_child2, 2);

    const root_child1_child3 = Yoga.Node.create(config);
    root_child1_child3.setWidth(25);
    root_child1_child3.setHeight(10);
    root_child1.insertChild(root_child1_child3, 3);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(60);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(25);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(25);
    expect(root_child1_child0.getComputedHeight()).toBe(20);

    expect(root_child1_child1.getComputedLeft()).toBe(25);
    expect(root_child1_child1.getComputedTop()).toBe(0);
    expect(root_child1_child1.getComputedWidth()).toBe(25);
    expect(root_child1_child1.getComputedHeight()).toBe(10);

    expect(root_child1_child2.getComputedLeft()).toBe(0);
    expect(root_child1_child2.getComputedTop()).toBe(20);
    expect(root_child1_child2.getComputedWidth()).toBe(25);
    expect(root_child1_child2.getComputedHeight()).toBe(20);

    expect(root_child1_child3.getComputedLeft()).toBe(25);
    expect(root_child1_child3.getComputedTop()).toBe(20);
    expect(root_child1_child3.getComputedWidth()).toBe(25);
    expect(root_child1_child3.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(60);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(25);

    expect(root_child1_child0.getComputedLeft()).toBe(25);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(25);
    expect(root_child1_child0.getComputedHeight()).toBe(20);

    expect(root_child1_child1.getComputedLeft()).toBe(0);
    expect(root_child1_child1.getComputedTop()).toBe(0);
    expect(root_child1_child1.getComputedWidth()).toBe(25);
    expect(root_child1_child1.getComputedHeight()).toBe(10);

    expect(root_child1_child2.getComputedLeft()).toBe(25);
    expect(root_child1_child2.getComputedTop()).toBe(20);
    expect(root_child1_child2.getComputedWidth()).toBe(25);
    expect(root_child1_child2.getComputedHeight()).toBe(20);

    expect(root_child1_child3.getComputedLeft()).toBe(0);
    expect(root_child1_child3.getComputedTop()).toBe(20);
    expect(root_child1_child3.getComputedWidth()).toBe(25);
    expect(root_child1_child3.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_baseline_child_multiline_override', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignItems(Align.Baseline);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(60);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexDirection(FlexDirection.Row);
    root_child1.setFlexWrap(Wrap.Wrap);
    root_child1.setWidth(50);
    root_child1.setHeight(25);
    root.insertChild(root_child1, 1);

    const root_child1_child0 = Yoga.Node.create(config);
    root_child1_child0.setWidth(25);
    root_child1_child0.setHeight(20);
    root_child1.insertChild(root_child1_child0, 0);

    const root_child1_child1 = Yoga.Node.create(config);
    root_child1_child1.setAlignSelf(Align.Baseline);
    root_child1_child1.setWidth(25);
    root_child1_child1.setHeight(10);
    root_child1.insertChild(root_child1_child1, 1);

    const root_child1_child2 = Yoga.Node.create(config);
    root_child1_child2.setWidth(25);
    root_child1_child2.setHeight(20);
    root_child1.insertChild(root_child1_child2, 2);

    const root_child1_child3 = Yoga.Node.create(config);
    root_child1_child3.setAlignSelf(Align.Baseline);
    root_child1_child3.setWidth(25);
    root_child1_child3.setHeight(10);
    root_child1.insertChild(root_child1_child3, 3);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(60);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(50);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(25);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(25);
    expect(root_child1_child0.getComputedHeight()).toBe(20);

    expect(root_child1_child1.getComputedLeft()).toBe(25);
    expect(root_child1_child1.getComputedTop()).toBe(0);
    expect(root_child1_child1.getComputedWidth()).toBe(25);
    expect(root_child1_child1.getComputedHeight()).toBe(10);

    expect(root_child1_child2.getComputedLeft()).toBe(0);
    expect(root_child1_child2.getComputedTop()).toBe(20);
    expect(root_child1_child2.getComputedWidth()).toBe(25);
    expect(root_child1_child2.getComputedHeight()).toBe(20);

    expect(root_child1_child3.getComputedLeft()).toBe(25);
    expect(root_child1_child3.getComputedTop()).toBe(20);
    expect(root_child1_child3.getComputedWidth()).toBe(25);
    expect(root_child1_child3.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(60);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(50);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(25);

    expect(root_child1_child0.getComputedLeft()).toBe(25);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(25);
    expect(root_child1_child0.getComputedHeight()).toBe(20);

    expect(root_child1_child1.getComputedLeft()).toBe(0);
    expect(root_child1_child1.getComputedTop()).toBe(0);
    expect(root_child1_child1.getComputedWidth()).toBe(25);
    expect(root_child1_child1.getComputedHeight()).toBe(10);

    expect(root_child1_child2.getComputedLeft()).toBe(25);
    expect(root_child1_child2.getComputedTop()).toBe(20);
    expect(root_child1_child2.getComputedWidth()).toBe(25);
    expect(root_child1_child2.getComputedHeight()).toBe(20);

    expect(root_child1_child3.getComputedLeft()).toBe(0);
    expect(root_child1_child3.getComputedTop()).toBe(20);
    expect(root_child1_child3.getComputedWidth()).toBe(25);
    expect(root_child1_child3.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_baseline_child_multiline_no_override_on_secondline', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignItems(Align.Baseline);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(60);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexDirection(FlexDirection.Row);
    root_child1.setFlexWrap(Wrap.Wrap);
    root_child1.setWidth(50);
    root_child1.setHeight(25);
    root.insertChild(root_child1, 1);

    const root_child1_child0 = Yoga.Node.create(config);
    root_child1_child0.setWidth(25);
    root_child1_child0.setHeight(20);
    root_child1.insertChild(root_child1_child0, 0);

    const root_child1_child1 = Yoga.Node.create(config);
    root_child1_child1.setWidth(25);
    root_child1_child1.setHeight(10);
    root_child1.insertChild(root_child1_child1, 1);

    const root_child1_child2 = Yoga.Node.create(config);
    root_child1_child2.setWidth(25);
    root_child1_child2.setHeight(20);
    root_child1.insertChild(root_child1_child2, 2);

    const root_child1_child3 = Yoga.Node.create(config);
    root_child1_child3.setAlignSelf(Align.Baseline);
    root_child1_child3.setWidth(25);
    root_child1_child3.setHeight(10);
    root_child1.insertChild(root_child1_child3, 3);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(60);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(25);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(25);
    expect(root_child1_child0.getComputedHeight()).toBe(20);

    expect(root_child1_child1.getComputedLeft()).toBe(25);
    expect(root_child1_child1.getComputedTop()).toBe(0);
    expect(root_child1_child1.getComputedWidth()).toBe(25);
    expect(root_child1_child1.getComputedHeight()).toBe(10);

    expect(root_child1_child2.getComputedLeft()).toBe(0);
    expect(root_child1_child2.getComputedTop()).toBe(20);
    expect(root_child1_child2.getComputedWidth()).toBe(25);
    expect(root_child1_child2.getComputedHeight()).toBe(20);

    expect(root_child1_child3.getComputedLeft()).toBe(25);
    expect(root_child1_child3.getComputedTop()).toBe(20);
    expect(root_child1_child3.getComputedWidth()).toBe(25);
    expect(root_child1_child3.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(60);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(25);

    expect(root_child1_child0.getComputedLeft()).toBe(25);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(25);
    expect(root_child1_child0.getComputedHeight()).toBe(20);

    expect(root_child1_child1.getComputedLeft()).toBe(0);
    expect(root_child1_child1.getComputedTop()).toBe(0);
    expect(root_child1_child1.getComputedWidth()).toBe(25);
    expect(root_child1_child1.getComputedHeight()).toBe(10);

    expect(root_child1_child2.getComputedLeft()).toBe(25);
    expect(root_child1_child2.getComputedTop()).toBe(20);
    expect(root_child1_child2.getComputedWidth()).toBe(25);
    expect(root_child1_child2.getComputedHeight()).toBe(20);

    expect(root_child1_child3.getComputedLeft()).toBe(0);
    expect(root_child1_child3.getComputedTop()).toBe(20);
    expect(root_child1_child3.getComputedWidth()).toBe(25);
    expect(root_child1_child3.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_baseline_child_top', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignItems(Align.Baseline);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPosition(Edge.Top, 10);
    root_child0.setWidth(50);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child1_child0 = Yoga.Node.create(config);
    root_child1_child0.setWidth(50);
    root_child1_child0.setHeight(10);
    root_child1.insertChild(root_child1_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(50);
    expect(root_child1_child0.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(50);
    expect(root_child1_child0.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_baseline_child_top2', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignItems(Align.Baseline);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setPosition(Edge.Top, 5);
    root_child1.setWidth(50);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child1_child0 = Yoga.Node.create(config);
    root_child1_child0.setWidth(50);
    root_child1_child0.setHeight(10);
    root_child1.insertChild(root_child1_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(45);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(50);
    expect(root_child1_child0.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(45);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(50);
    expect(root_child1_child0.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_baseline_double_nested_child', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignItems(Align.Baseline);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth(50);
    root_child0_child0.setHeight(20);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child1_child0 = Yoga.Node.create(config);
    root_child1_child0.setWidth(50);
    root_child1_child0.setHeight(15);
    root_child1.insertChild(root_child1_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(5);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(50);
    expect(root_child1_child0.getComputedHeight()).toBe(15);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(5);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(50);
    expect(root_child1_child0.getComputedHeight()).toBe(15);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_baseline_column', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setAlignItems(Align.Baseline);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(50);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(50);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_baseline_child_margin', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignItems(Align.Baseline);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Left, 5);
    root_child0.setMargin(Edge.Top, 5);
    root_child0.setMargin(Edge.Right, 5);
    root_child0.setMargin(Edge.Bottom, 5);
    root_child0.setWidth(50);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child1_child0 = Yoga.Node.create(config);
    root_child1_child0.setMargin(Edge.Left, 1);
    root_child1_child0.setMargin(Edge.Top, 1);
    root_child1_child0.setMargin(Edge.Right, 1);
    root_child1_child0.setMargin(Edge.Bottom, 1);
    root_child1_child0.setWidth(50);
    root_child1_child0.setHeight(10);
    root_child1.insertChild(root_child1_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(5);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(60);
    expect(root_child1.getComputedTop()).toBe(44);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child1_child0.getComputedLeft()).toBe(1);
    expect(root_child1_child0.getComputedTop()).toBe(1);
    expect(root_child1_child0.getComputedWidth()).toBe(50);
    expect(root_child1_child0.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(45);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(-10);
    expect(root_child1.getComputedTop()).toBe(44);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child1_child0.getComputedLeft()).toBe(-1);
    expect(root_child1_child0.getComputedTop()).toBe(1);
    expect(root_child1_child0.getComputedWidth()).toBe(50);
    expect(root_child1_child0.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_baseline_child_padding', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignItems(Align.Baseline);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Left, 5);
    root.setPadding(Edge.Top, 5);
    root.setPadding(Edge.Right, 5);
    root.setPadding(Edge.Bottom, 5);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setPadding(Edge.Left, 5);
    root_child1.setPadding(Edge.Top, 5);
    root_child1.setPadding(Edge.Right, 5);
    root_child1.setPadding(Edge.Bottom, 5);
    root_child1.setWidth(50);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child1_child0 = Yoga.Node.create(config);
    root_child1_child0.setWidth(50);
    root_child1_child0.setHeight(10);
    root_child1.insertChild(root_child1_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(5);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(55);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child1_child0.getComputedLeft()).toBe(5);
    expect(root_child1_child0.getComputedTop()).toBe(5);
    expect(root_child1_child0.getComputedWidth()).toBe(50);
    expect(root_child1_child0.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(45);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(-5);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child1_child0.getComputedLeft()).toBe(-5);
    expect(root_child1_child0.getComputedTop()).toBe(5);
    expect(root_child1_child0.getComputedWidth()).toBe(50);
    expect(root_child1_child0.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_baseline_multiline', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignItems(Align.Baseline);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child1_child0 = Yoga.Node.create(config);
    root_child1_child0.setWidth(50);
    root_child1_child0.setHeight(10);
    root_child1.insertChild(root_child1_child0, 0);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(50);
    root_child2.setHeight(20);
    root.insertChild(root_child2, 2);

    const root_child2_child0 = Yoga.Node.create(config);
    root_child2_child0.setWidth(50);
    root_child2_child0.setHeight(10);
    root_child2.insertChild(root_child2_child0, 0);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(50);
    root_child3.setHeight(50);
    root.insertChild(root_child3, 3);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(50);
    expect(root_child1_child0.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(100);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(20);

    expect(root_child2_child0.getComputedLeft()).toBe(0);
    expect(root_child2_child0.getComputedTop()).toBe(0);
    expect(root_child2_child0.getComputedWidth()).toBe(50);
    expect(root_child2_child0.getComputedHeight()).toBe(10);

    expect(root_child3.getComputedLeft()).toBe(50);
    expect(root_child3.getComputedTop()).toBe(60);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(50);
    expect(root_child1_child0.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(50);
    expect(root_child2.getComputedTop()).toBe(100);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(20);

    expect(root_child2_child0.getComputedLeft()).toBe(0);
    expect(root_child2_child0.getComputedTop()).toBe(0);
    expect(root_child2_child0.getComputedWidth()).toBe(50);
    expect(root_child2_child0.getComputedHeight()).toBe(10);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(60);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test.skip('align_baseline_multiline_column', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setAlignItems(Align.Baseline);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(30);
    root_child1.setHeight(50);
    root.insertChild(root_child1, 1);

    const root_child1_child0 = Yoga.Node.create(config);
    root_child1_child0.setWidth(20);
    root_child1_child0.setHeight(20);
    root_child1.insertChild(root_child1_child0, 0);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(40);
    root_child2.setHeight(70);
    root.insertChild(root_child2, 2);

    const root_child2_child0 = Yoga.Node.create(config);
    root_child2_child0.setWidth(10);
    root_child2_child0.setHeight(10);
    root_child2.insertChild(root_child2_child0, 0);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(50);
    root_child3.setHeight(20);
    root.insertChild(root_child3, 3);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(50);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(50);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(20);
    expect(root_child1_child0.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(50);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(40);
    expect(root_child2.getComputedHeight()).toBe(70);

    expect(root_child2_child0.getComputedLeft()).toBe(0);
    expect(root_child2_child0.getComputedTop()).toBe(0);
    expect(root_child2_child0.getComputedWidth()).toBe(10);
    expect(root_child2_child0.getComputedHeight()).toBe(10);

    expect(root_child3.getComputedLeft()).toBe(50);
    expect(root_child3.getComputedTop()).toBe(70);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(50);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(50);

    expect(root_child1_child0.getComputedLeft()).toBe(10);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(20);
    expect(root_child1_child0.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(40);
    expect(root_child2.getComputedHeight()).toBe(70);

    expect(root_child2_child0.getComputedLeft()).toBe(30);
    expect(root_child2_child0.getComputedTop()).toBe(0);
    expect(root_child2_child0.getComputedWidth()).toBe(10);
    expect(root_child2_child0.getComputedHeight()).toBe(10);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(70);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test.skip('align_baseline_multiline_column2', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setAlignItems(Align.Baseline);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(30);
    root_child1.setHeight(50);
    root.insertChild(root_child1, 1);

    const root_child1_child0 = Yoga.Node.create(config);
    root_child1_child0.setWidth(20);
    root_child1_child0.setHeight(20);
    root_child1.insertChild(root_child1_child0, 0);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(40);
    root_child2.setHeight(70);
    root.insertChild(root_child2, 2);

    const root_child2_child0 = Yoga.Node.create(config);
    root_child2_child0.setWidth(10);
    root_child2_child0.setHeight(10);
    root_child2.insertChild(root_child2_child0, 0);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(50);
    root_child3.setHeight(20);
    root.insertChild(root_child3, 3);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(50);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(50);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(20);
    expect(root_child1_child0.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(50);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(40);
    expect(root_child2.getComputedHeight()).toBe(70);

    expect(root_child2_child0.getComputedLeft()).toBe(0);
    expect(root_child2_child0.getComputedTop()).toBe(0);
    expect(root_child2_child0.getComputedWidth()).toBe(10);
    expect(root_child2_child0.getComputedHeight()).toBe(10);

    expect(root_child3.getComputedLeft()).toBe(50);
    expect(root_child3.getComputedTop()).toBe(70);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(50);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(50);

    expect(root_child1_child0.getComputedLeft()).toBe(10);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(20);
    expect(root_child1_child0.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(40);
    expect(root_child2.getComputedHeight()).toBe(70);

    expect(root_child2_child0.getComputedLeft()).toBe(30);
    expect(root_child2_child0.getComputedTop()).toBe(0);
    expect(root_child2_child0.getComputedWidth()).toBe(10);
    expect(root_child2_child0.getComputedHeight()).toBe(10);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(70);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_baseline_multiline_row_and_column', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignItems(Align.Baseline);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(50);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(50);
    root.insertChild(root_child1, 1);

    const root_child1_child0 = Yoga.Node.create(config);
    root_child1_child0.setWidth(50);
    root_child1_child0.setHeight(10);
    root_child1.insertChild(root_child1_child0, 0);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(50);
    root_child2.setHeight(20);
    root.insertChild(root_child2, 2);

    const root_child2_child0 = Yoga.Node.create(config);
    root_child2_child0.setWidth(50);
    root_child2_child0.setHeight(10);
    root_child2.insertChild(root_child2_child0, 0);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(50);
    root_child3.setHeight(20);
    root.insertChild(root_child3, 3);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(50);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(50);
    expect(root_child1_child0.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(100);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(20);

    expect(root_child2_child0.getComputedLeft()).toBe(0);
    expect(root_child2_child0.getComputedTop()).toBe(0);
    expect(root_child2_child0.getComputedWidth()).toBe(50);
    expect(root_child2_child0.getComputedHeight()).toBe(10);

    expect(root_child3.getComputedLeft()).toBe(50);
    expect(root_child3.getComputedTop()).toBe(90);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(50);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(50);
    expect(root_child1_child0.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(50);
    expect(root_child2.getComputedTop()).toBe(100);
    expect(root_child2.getComputedWidth()).toBe(50);
    expect(root_child2.getComputedHeight()).toBe(20);

    expect(root_child2_child0.getComputedLeft()).toBe(0);
    expect(root_child2_child0.getComputedTop()).toBe(0);
    expect(root_child2_child0.getComputedWidth()).toBe(50);
    expect(root_child2_child0.getComputedHeight()).toBe(10);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(90);
    expect(root_child3.getComputedWidth()).toBe(50);
    expect(root_child3.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_items_center_child_with_margin_bigger_than_parent', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setJustifyContent(Justify.Center);
    root.setAlignItems(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(52);
    root.setHeight(52);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setAlignItems(Align.Center);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setMargin(Edge.Left, 10);
    root_child0_child0.setMargin(Edge.Right, 10);
    root_child0_child0.setWidth(52);
    root_child0_child0.setHeight(52);
    root_child0.insertChild(root_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(52);
    expect(root.getComputedHeight()).toBe(52);

    expect(root_child0.getComputedLeft()).toBe(-10);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(72);
    expect(root_child0.getComputedHeight()).toBe(52);

    expect(root_child0_child0.getComputedLeft()).toBe(10);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(52);
    expect(root_child0_child0.getComputedHeight()).toBe(52);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(52);
    expect(root.getComputedHeight()).toBe(52);

    expect(root_child0.getComputedLeft()).toBe(-10);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(72);
    expect(root_child0.getComputedHeight()).toBe(52);

    expect(root_child0_child0.getComputedLeft()).toBe(10);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(52);
    expect(root_child0_child0.getComputedHeight()).toBe(52);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_items_flex_end_child_with_margin_bigger_than_parent', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setJustifyContent(Justify.Center);
    root.setAlignItems(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(52);
    root.setHeight(52);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setAlignItems(Align.FlexEnd);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setMargin(Edge.Left, 10);
    root_child0_child0.setMargin(Edge.Right, 10);
    root_child0_child0.setWidth(52);
    root_child0_child0.setHeight(52);
    root_child0.insertChild(root_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(52);
    expect(root.getComputedHeight()).toBe(52);

    expect(root_child0.getComputedLeft()).toBe(-10);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(72);
    expect(root_child0.getComputedHeight()).toBe(52);

    expect(root_child0_child0.getComputedLeft()).toBe(10);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(52);
    expect(root_child0_child0.getComputedHeight()).toBe(52);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(52);
    expect(root.getComputedHeight()).toBe(52);

    expect(root_child0.getComputedLeft()).toBe(-10);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(72);
    expect(root_child0.getComputedHeight()).toBe(52);

    expect(root_child0_child0.getComputedLeft()).toBe(10);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(52);
    expect(root_child0_child0.getComputedHeight()).toBe(52);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_items_center_child_without_margin_bigger_than_parent', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setJustifyContent(Justify.Center);
    root.setAlignItems(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(52);
    root.setHeight(52);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setAlignItems(Align.Center);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth(72);
    root_child0_child0.setHeight(72);
    root_child0.insertChild(root_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(52);
    expect(root.getComputedHeight()).toBe(52);

    expect(root_child0.getComputedLeft()).toBe(-10);
    expect(root_child0.getComputedTop()).toBe(-10);
    expect(root_child0.getComputedWidth()).toBe(72);
    expect(root_child0.getComputedHeight()).toBe(72);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(72);
    expect(root_child0_child0.getComputedHeight()).toBe(72);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(52);
    expect(root.getComputedHeight()).toBe(52);

    expect(root_child0.getComputedLeft()).toBe(-10);
    expect(root_child0.getComputedTop()).toBe(-10);
    expect(root_child0.getComputedWidth()).toBe(72);
    expect(root_child0.getComputedHeight()).toBe(72);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(72);
    expect(root_child0_child0.getComputedHeight()).toBe(72);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_items_flex_end_child_without_margin_bigger_than_parent', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setJustifyContent(Justify.Center);
    root.setAlignItems(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(52);
    root.setHeight(52);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setAlignItems(Align.FlexEnd);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth(72);
    root_child0_child0.setHeight(72);
    root_child0.insertChild(root_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(52);
    expect(root.getComputedHeight()).toBe(52);

    expect(root_child0.getComputedLeft()).toBe(-10);
    expect(root_child0.getComputedTop()).toBe(-10);
    expect(root_child0.getComputedWidth()).toBe(72);
    expect(root_child0.getComputedHeight()).toBe(72);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(72);
    expect(root_child0_child0.getComputedHeight()).toBe(72);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(52);
    expect(root.getComputedHeight()).toBe(52);

    expect(root_child0.getComputedLeft()).toBe(-10);
    expect(root_child0.getComputedTop()).toBe(-10);
    expect(root_child0.getComputedWidth()).toBe(72);
    expect(root_child0.getComputedHeight()).toBe(72);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(72);
    expect(root_child0_child0.getComputedHeight()).toBe(72);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_center_should_size_based_on_content', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setAlignItems(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setMargin(Edge.Top, 20);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setJustifyContent(Justify.Center);
    root_child0.setFlexShrink(1);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setFlexGrow(1);
    root_child0_child0.setFlexShrink(1);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setWidth(20);
    root_child0_child0_child0.setHeight(20);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(20);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(40);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(20);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(20);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(40);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(20);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_stretch_should_size_based_on_parent', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setMargin(Edge.Top, 20);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setJustifyContent(Justify.Center);
    root_child0.setFlexShrink(1);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setFlexGrow(1);
    root_child0_child0.setFlexShrink(1);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setWidth(20);
    root_child0_child0_child0.setHeight(20);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(20);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(20);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(20);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(80);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(20);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(20);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_flex_start_with_shrinking_children', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(500);
    root.setHeight(500);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setAlignItems(Align.FlexStart);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setFlexGrow(1);
    root_child0_child0.setFlexShrink(1);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setFlexGrow(1);
    root_child0_child0_child0.setFlexShrink(1);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(500);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(500);
    expect(root_child0.getComputedHeight()).toBe(0);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(0);
    expect(root_child0_child0.getComputedHeight()).toBe(0);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(0);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(0);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(500);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(500);
    expect(root_child0.getComputedHeight()).toBe(0);

    expect(root_child0_child0.getComputedLeft()).toBe(500);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(0);
    expect(root_child0_child0.getComputedHeight()).toBe(0);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(0);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(0);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_flex_start_with_stretching_children', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(500);
    root.setHeight(500);

    const root_child0 = Yoga.Node.create(config);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setFlexGrow(1);
    root_child0_child0.setFlexShrink(1);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setFlexGrow(1);
    root_child0_child0_child0.setFlexShrink(1);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(500);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(500);
    expect(root_child0.getComputedHeight()).toBe(0);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(500);
    expect(root_child0_child0.getComputedHeight()).toBe(0);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(500);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(0);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(500);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(500);
    expect(root_child0.getComputedHeight()).toBe(0);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(500);
    expect(root_child0_child0.getComputedHeight()).toBe(0);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(500);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(0);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_flex_start_with_shrinking_children_with_stretch', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(500);
    root.setHeight(500);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setAlignItems(Align.FlexStart);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setFlexGrow(1);
    root_child0_child0.setFlexShrink(1);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setFlexGrow(1);
    root_child0_child0_child0.setFlexShrink(1);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(500);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(500);
    expect(root_child0.getComputedHeight()).toBe(0);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(0);
    expect(root_child0_child0.getComputedHeight()).toBe(0);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(0);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(0);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(500);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(500);
    expect(root_child0.getComputedHeight()).toBe(0);

    expect(root_child0_child0.getComputedLeft()).toBe(500);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(0);
    expect(root_child0_child0.getComputedHeight()).toBe(0);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(0);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(0);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_flex_end_with_row_reverse', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setAlignItems(Align.FlexEnd);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(100);
    root.setHeight(75);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Left, 3);
    root_child0.setMargin(Edge.Right, 5);
    root_child0.setWidth(50);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(50);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(75);

    expect(root_child0.getComputedLeft()).toBe(3);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(58);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(75);

    expect(root_child0.getComputedLeft()).toBe(45);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(-8);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_stretch_with_row_reverse', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(100);
    root.setHeight(75);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setMargin(Edge.Left, 3);
    root_child0.setMargin(Edge.Right, 5);
    root_child0.setWidth(50);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(50);
    root_child1.setHeight(50);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(75);

    expect(root_child0.getComputedLeft()).toBe(3);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(58);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(75);

    expect(root_child0.getComputedLeft()).toBe(45);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(-8);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('align_items_non_stretch_s526008', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(400);
    root.setHeight(400);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setAlignItems(Align.FlexStart);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);

    const root_child0_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0_child0.setHeight(10);
    root_child0_child0_child0.insertChild(root_child0_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(0);
    expect(root_child0_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(0);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(0);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(400);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(400);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0.getComputedLeft()).toBe(400);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(0);
    expect(root_child0_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(0);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(10);

    expect(root_child0_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0_child0.getComputedWidth()).toBe(0);
    expect(root_child0_child0_child0_child0.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
