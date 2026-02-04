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

test('wrap_column', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(30);
    root_child0.setHeight(30);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(30);
    root_child1.setHeight(30);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(30);
    root_child2.setHeight(30);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(30);
    root_child3.setHeight(30);
    root.insertChild(root_child3, 3);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(60);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(30);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(30);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(30);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(60);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(30);

    expect(root_child3.getComputedLeft()).toBe(30);
    expect(root_child3.getComputedTop()).toBe(0);
    expect(root_child3.getComputedWidth()).toBe(30);
    expect(root_child3.getComputedHeight()).toBe(30);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(60);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(30);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(30);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(30);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(30);

    expect(root_child2.getComputedLeft()).toBe(30);
    expect(root_child2.getComputedTop()).toBe(60);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(30);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(0);
    expect(root_child3.getComputedWidth()).toBe(30);
    expect(root_child3.getComputedHeight()).toBe(30);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('wrap_row', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(30);
    root_child0.setHeight(30);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(30);
    root_child1.setHeight(30);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(30);
    root_child2.setHeight(30);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(30);
    root_child3.setHeight(30);
    root.insertChild(root_child3, 3);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(60);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(30);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(30);

    expect(root_child2.getComputedLeft()).toBe(60);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(30);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(30);
    expect(root_child3.getComputedWidth()).toBe(30);
    expect(root_child3.getComputedHeight()).toBe(30);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(60);

    expect(root_child0.getComputedLeft()).toBe(70);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(30);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(30);

    expect(root_child2.getComputedLeft()).toBe(10);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(30);

    expect(root_child3.getComputedLeft()).toBe(70);
    expect(root_child3.getComputedTop()).toBe(30);
    expect(root_child3.getComputedWidth()).toBe(30);
    expect(root_child3.getComputedHeight()).toBe(30);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('wrap_row_align_items_flex_end', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignItems(Align.FlexEnd);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(30);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(30);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(30);
    root_child2.setHeight(30);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(30);
    root_child3.setHeight(30);
    root.insertChild(root_child3, 3);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(60);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(20);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(10);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(60);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(30);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(30);
    expect(root_child3.getComputedWidth()).toBe(30);
    expect(root_child3.getComputedHeight()).toBe(30);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(60);

    expect(root_child0.getComputedLeft()).toBe(70);
    expect(root_child0.getComputedTop()).toBe(20);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(10);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(10);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(30);

    expect(root_child3.getComputedLeft()).toBe(70);
    expect(root_child3.getComputedTop()).toBe(30);
    expect(root_child3.getComputedWidth()).toBe(30);
    expect(root_child3.getComputedHeight()).toBe(30);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('wrap_row_align_items_center', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignItems(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(30);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(30);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(30);
    root_child2.setHeight(30);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(30);
    root_child3.setHeight(30);
    root.insertChild(root_child3, 3);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(60);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(5);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(60);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(30);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(30);
    expect(root_child3.getComputedWidth()).toBe(30);
    expect(root_child3.getComputedHeight()).toBe(30);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(60);

    expect(root_child0.getComputedLeft()).toBe(70);
    expect(root_child0.getComputedTop()).toBe(10);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(5);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(10);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(30);

    expect(root_child3.getComputedLeft()).toBe(70);
    expect(root_child3.getComputedTop()).toBe(30);
    expect(root_child3.getComputedWidth()).toBe(30);
    expect(root_child3.getComputedHeight()).toBe(30);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('flex_wrap_children_with_min_main_overriding_flex_basis', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexBasis(50);
    root_child0.setMinWidth(55);
    root_child0.setHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexBasis(50);
    root_child1.setMinWidth(55);
    root_child1.setHeight(50);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(55);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(50);
    expect(root_child1.getComputedWidth()).toBe(55);
    expect(root_child1.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(45);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(55);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(45);
    expect(root_child1.getComputedTop()).toBe(50);
    expect(root_child1.getComputedWidth()).toBe(55);
    expect(root_child1.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('flex_wrap_wrap_to_child_height', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setAlignItems(Align.FlexStart);
    root_child0.setFlexWrap(Wrap.Wrap);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth(100);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setWidth(100);
    root_child0_child0_child0.setHeight(100);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(100);
    root_child1.setHeight(100);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(100);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(100);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(100);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('flex_wrap_align_stretch_fits_one_row', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
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
    expect(root_child0.getComputedHeight()).toBe(0);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(0);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(150);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(100);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(0);

    expect(root_child1.getComputedLeft()).toBe(50);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(50);
    expect(root_child1.getComputedHeight()).toBe(0);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('wrap_reverse_row_align_content_flex_start', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.WrapReverse);
    root.setWidth(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(30);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(30);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(30);
    root_child2.setHeight(30);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(30);
    root_child3.setHeight(40);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(30);
    root_child4.setHeight(50);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(80);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(70);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(60);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(60);
    expect(root_child2.getComputedTop()).toBe(50);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(30);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(10);
    expect(root_child3.getComputedWidth()).toBe(30);
    expect(root_child3.getComputedHeight()).toBe(40);

    expect(root_child4.getComputedLeft()).toBe(30);
    expect(root_child4.getComputedTop()).toBe(0);
    expect(root_child4.getComputedWidth()).toBe(30);
    expect(root_child4.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(80);

    expect(root_child0.getComputedLeft()).toBe(70);
    expect(root_child0.getComputedTop()).toBe(70);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(60);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(10);
    expect(root_child2.getComputedTop()).toBe(50);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(30);

    expect(root_child3.getComputedLeft()).toBe(70);
    expect(root_child3.getComputedTop()).toBe(10);
    expect(root_child3.getComputedWidth()).toBe(30);
    expect(root_child3.getComputedHeight()).toBe(40);

    expect(root_child4.getComputedLeft()).toBe(40);
    expect(root_child4.getComputedTop()).toBe(0);
    expect(root_child4.getComputedWidth()).toBe(30);
    expect(root_child4.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('wrap_reverse_row_align_content_center', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.WrapReverse);
    root.setWidth(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(30);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(30);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(30);
    root_child2.setHeight(30);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(30);
    root_child3.setHeight(40);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(30);
    root_child4.setHeight(50);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(80);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(70);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(60);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(60);
    expect(root_child2.getComputedTop()).toBe(50);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(30);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(10);
    expect(root_child3.getComputedWidth()).toBe(30);
    expect(root_child3.getComputedHeight()).toBe(40);

    expect(root_child4.getComputedLeft()).toBe(30);
    expect(root_child4.getComputedTop()).toBe(0);
    expect(root_child4.getComputedWidth()).toBe(30);
    expect(root_child4.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(80);

    expect(root_child0.getComputedLeft()).toBe(70);
    expect(root_child0.getComputedTop()).toBe(70);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(60);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(10);
    expect(root_child2.getComputedTop()).toBe(50);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(30);

    expect(root_child3.getComputedLeft()).toBe(70);
    expect(root_child3.getComputedTop()).toBe(10);
    expect(root_child3.getComputedWidth()).toBe(30);
    expect(root_child3.getComputedHeight()).toBe(40);

    expect(root_child4.getComputedLeft()).toBe(40);
    expect(root_child4.getComputedTop()).toBe(0);
    expect(root_child4.getComputedWidth()).toBe(30);
    expect(root_child4.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('wrap_reverse_row_single_line_different_size', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.WrapReverse);
    root.setWidth(300);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(30);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(30);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(30);
    root_child2.setHeight(30);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(30);
    root_child3.setHeight(40);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(30);
    root_child4.setHeight(50);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(40);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(30);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(60);
    expect(root_child2.getComputedTop()).toBe(20);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(30);

    expect(root_child3.getComputedLeft()).toBe(90);
    expect(root_child3.getComputedTop()).toBe(10);
    expect(root_child3.getComputedWidth()).toBe(30);
    expect(root_child3.getComputedHeight()).toBe(40);

    expect(root_child4.getComputedLeft()).toBe(120);
    expect(root_child4.getComputedTop()).toBe(0);
    expect(root_child4.getComputedWidth()).toBe(30);
    expect(root_child4.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(300);
    expect(root.getComputedHeight()).toBe(50);

    expect(root_child0.getComputedLeft()).toBe(270);
    expect(root_child0.getComputedTop()).toBe(40);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(240);
    expect(root_child1.getComputedTop()).toBe(30);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(210);
    expect(root_child2.getComputedTop()).toBe(20);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(30);

    expect(root_child3.getComputedLeft()).toBe(180);
    expect(root_child3.getComputedTop()).toBe(10);
    expect(root_child3.getComputedWidth()).toBe(30);
    expect(root_child3.getComputedHeight()).toBe(40);

    expect(root_child4.getComputedLeft()).toBe(150);
    expect(root_child4.getComputedTop()).toBe(0);
    expect(root_child4.getComputedWidth()).toBe(30);
    expect(root_child4.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('wrap_reverse_row_align_content_stretch', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.Stretch);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.WrapReverse);
    root.setWidth(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(30);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(30);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(30);
    root_child2.setHeight(30);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(30);
    root_child3.setHeight(40);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(30);
    root_child4.setHeight(50);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(80);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(70);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(60);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(60);
    expect(root_child2.getComputedTop()).toBe(50);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(30);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(10);
    expect(root_child3.getComputedWidth()).toBe(30);
    expect(root_child3.getComputedHeight()).toBe(40);

    expect(root_child4.getComputedLeft()).toBe(30);
    expect(root_child4.getComputedTop()).toBe(0);
    expect(root_child4.getComputedWidth()).toBe(30);
    expect(root_child4.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(80);

    expect(root_child0.getComputedLeft()).toBe(70);
    expect(root_child0.getComputedTop()).toBe(70);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(60);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(10);
    expect(root_child2.getComputedTop()).toBe(50);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(30);

    expect(root_child3.getComputedLeft()).toBe(70);
    expect(root_child3.getComputedTop()).toBe(10);
    expect(root_child3.getComputedWidth()).toBe(30);
    expect(root_child3.getComputedHeight()).toBe(40);

    expect(root_child4.getComputedLeft()).toBe(40);
    expect(root_child4.getComputedTop()).toBe(0);
    expect(root_child4.getComputedWidth()).toBe(30);
    expect(root_child4.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('wrap_reverse_row_align_content_space_around', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setAlignContent(Align.SpaceAround);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.WrapReverse);
    root.setWidth(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(30);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(30);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(30);
    root_child2.setHeight(30);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(30);
    root_child3.setHeight(40);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(30);
    root_child4.setHeight(50);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(80);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(70);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(30);
    expect(root_child1.getComputedTop()).toBe(60);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(60);
    expect(root_child2.getComputedTop()).toBe(50);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(30);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(10);
    expect(root_child3.getComputedWidth()).toBe(30);
    expect(root_child3.getComputedHeight()).toBe(40);

    expect(root_child4.getComputedLeft()).toBe(30);
    expect(root_child4.getComputedTop()).toBe(0);
    expect(root_child4.getComputedWidth()).toBe(30);
    expect(root_child4.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(80);

    expect(root_child0.getComputedLeft()).toBe(70);
    expect(root_child0.getComputedTop()).toBe(70);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(40);
    expect(root_child1.getComputedTop()).toBe(60);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(10);
    expect(root_child2.getComputedTop()).toBe(50);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(30);

    expect(root_child3.getComputedLeft()).toBe(70);
    expect(root_child3.getComputedTop()).toBe(10);
    expect(root_child3.getComputedWidth()).toBe(30);
    expect(root_child3.getComputedHeight()).toBe(40);

    expect(root_child4.getComputedLeft()).toBe(40);
    expect(root_child4.getComputedTop()).toBe(0);
    expect(root_child4.getComputedWidth()).toBe(30);
    expect(root_child4.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('wrap_reverse_column_fixed_size', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setAlignItems(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.WrapReverse);
    root.setWidth(200);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(30);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(30);
    root_child1.setHeight(20);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(30);
    root_child2.setHeight(30);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(30);
    root_child3.setHeight(40);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setWidth(30);
    root_child4.setHeight(50);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(170);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(170);
    expect(root_child1.getComputedTop()).toBe(10);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(170);
    expect(root_child2.getComputedTop()).toBe(30);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(30);

    expect(root_child3.getComputedLeft()).toBe(170);
    expect(root_child3.getComputedTop()).toBe(60);
    expect(root_child3.getComputedWidth()).toBe(30);
    expect(root_child3.getComputedHeight()).toBe(40);

    expect(root_child4.getComputedLeft()).toBe(140);
    expect(root_child4.getComputedTop()).toBe(0);
    expect(root_child4.getComputedWidth()).toBe(30);
    expect(root_child4.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(30);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(10);
    expect(root_child1.getComputedWidth()).toBe(30);
    expect(root_child1.getComputedHeight()).toBe(20);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(30);
    expect(root_child2.getComputedWidth()).toBe(30);
    expect(root_child2.getComputedHeight()).toBe(30);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(60);
    expect(root_child3.getComputedWidth()).toBe(30);
    expect(root_child3.getComputedHeight()).toBe(40);

    expect(root_child4.getComputedLeft()).toBe(30);
    expect(root_child4.getComputedTop()).toBe(0);
    expect(root_child4.getComputedWidth()).toBe(30);
    expect(root_child4.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('wrapped_row_within_align_items_center', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setAlignItems(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(200);
    root.setHeight(200);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setFlexWrap(Wrap.Wrap);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth(150);
    root_child0_child0.setHeight(80);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setWidth(80);
    root_child0_child1.setHeight(80);
    root_child0.insertChild(root_child0_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(160);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(150);
    expect(root_child0_child0.getComputedHeight()).toBe(80);

    expect(root_child0_child1.getComputedLeft()).toBe(0);
    expect(root_child0_child1.getComputedTop()).toBe(80);
    expect(root_child0_child1.getComputedWidth()).toBe(80);
    expect(root_child0_child1.getComputedHeight()).toBe(80);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(160);

    expect(root_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(150);
    expect(root_child0_child0.getComputedHeight()).toBe(80);

    expect(root_child0_child1.getComputedLeft()).toBe(120);
    expect(root_child0_child1.getComputedTop()).toBe(80);
    expect(root_child0_child1.getComputedWidth()).toBe(80);
    expect(root_child0_child1.getComputedHeight()).toBe(80);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('wrapped_row_within_align_items_flex_start', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setAlignItems(Align.FlexStart);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(200);
    root.setHeight(200);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setFlexWrap(Wrap.Wrap);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth(150);
    root_child0_child0.setHeight(80);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setWidth(80);
    root_child0_child1.setHeight(80);
    root_child0.insertChild(root_child0_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(160);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(150);
    expect(root_child0_child0.getComputedHeight()).toBe(80);

    expect(root_child0_child1.getComputedLeft()).toBe(0);
    expect(root_child0_child1.getComputedTop()).toBe(80);
    expect(root_child0_child1.getComputedWidth()).toBe(80);
    expect(root_child0_child1.getComputedHeight()).toBe(80);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(160);

    expect(root_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(150);
    expect(root_child0_child0.getComputedHeight()).toBe(80);

    expect(root_child0_child1.getComputedLeft()).toBe(120);
    expect(root_child0_child1.getComputedTop()).toBe(80);
    expect(root_child0_child1.getComputedWidth()).toBe(80);
    expect(root_child0_child1.getComputedHeight()).toBe(80);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('wrapped_row_within_align_items_flex_end', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setAlignItems(Align.FlexEnd);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(200);
    root.setHeight(200);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setFlexWrap(Wrap.Wrap);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setWidth(150);
    root_child0_child0.setHeight(80);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setWidth(80);
    root_child0_child1.setHeight(80);
    root_child0.insertChild(root_child0_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(160);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(150);
    expect(root_child0_child0.getComputedHeight()).toBe(80);

    expect(root_child0_child1.getComputedLeft()).toBe(0);
    expect(root_child0_child1.getComputedTop()).toBe(80);
    expect(root_child0_child1.getComputedWidth()).toBe(80);
    expect(root_child0_child1.getComputedHeight()).toBe(80);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(200);
    expect(root.getComputedHeight()).toBe(200);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(200);
    expect(root_child0.getComputedHeight()).toBe(160);

    expect(root_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(150);
    expect(root_child0_child0.getComputedHeight()).toBe(80);

    expect(root_child0_child1.getComputedLeft()).toBe(120);
    expect(root_child0_child1.getComputedTop()).toBe(80);
    expect(root_child0_child1.getComputedWidth()).toBe(80);
    expect(root_child0_child1.getComputedHeight()).toBe(80);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('wrapped_column_max_height', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setJustifyContent(Justify.Center);
    root.setAlignContent(Align.Center);
    root.setAlignItems(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(700);
    root.setHeight(500);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(100);
    root_child0.setHeight(500);
    root_child0.setMaxHeight(200);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setMargin(Edge.Left, 20);
    root_child1.setMargin(Edge.Top, 20);
    root_child1.setMargin(Edge.Right, 20);
    root_child1.setMargin(Edge.Bottom, 20);
    root_child1.setWidth(200);
    root_child1.setHeight(200);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(100);
    root_child2.setHeight(100);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(700);
    expect(root.getComputedHeight()).toBe(500);

    expect(root_child0.getComputedLeft()).toBe(250);
    expect(root_child0.getComputedTop()).toBe(30);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child1.getComputedLeft()).toBe(200);
    expect(root_child1.getComputedTop()).toBe(250);
    expect(root_child1.getComputedWidth()).toBe(200);
    expect(root_child1.getComputedHeight()).toBe(200);

    expect(root_child2.getComputedLeft()).toBe(420);
    expect(root_child2.getComputedTop()).toBe(200);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(700);
    expect(root.getComputedHeight()).toBe(500);

    expect(root_child0.getComputedLeft()).toBe(350);
    expect(root_child0.getComputedTop()).toBe(30);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(200);

    expect(root_child1.getComputedLeft()).toBe(300);
    expect(root_child1.getComputedTop()).toBe(250);
    expect(root_child1.getComputedWidth()).toBe(200);
    expect(root_child1.getComputedHeight()).toBe(200);

    expect(root_child2.getComputedLeft()).toBe(180);
    expect(root_child2.getComputedTop()).toBe(200);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('wrapped_column_max_height_flex', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setJustifyContent(Justify.Center);
    root.setAlignContent(Align.Center);
    root.setAlignItems(Align.Center);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setWidth(700);
    root.setHeight(500);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setFlexShrink(1);
    root_child0.setFlexBasis("0%");
    root_child0.setWidth(100);
    root_child0.setHeight(500);
    root_child0.setMaxHeight(200);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root_child1.setFlexShrink(1);
    root_child1.setFlexBasis("0%");
    root_child1.setMargin(Edge.Left, 20);
    root_child1.setMargin(Edge.Top, 20);
    root_child1.setMargin(Edge.Right, 20);
    root_child1.setMargin(Edge.Bottom, 20);
    root_child1.setWidth(200);
    root_child1.setHeight(200);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(100);
    root_child2.setHeight(100);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(700);
    expect(root.getComputedHeight()).toBe(500);

    expect(root_child0.getComputedLeft()).toBe(300);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(180);

    expect(root_child1.getComputedLeft()).toBe(250);
    expect(root_child1.getComputedTop()).toBe(200);
    expect(root_child1.getComputedWidth()).toBe(200);
    expect(root_child1.getComputedHeight()).toBe(180);

    expect(root_child2.getComputedLeft()).toBe(300);
    expect(root_child2.getComputedTop()).toBe(400);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(700);
    expect(root.getComputedHeight()).toBe(500);

    expect(root_child0.getComputedLeft()).toBe(300);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(180);

    expect(root_child1.getComputedLeft()).toBe(250);
    expect(root_child1.getComputedTop()).toBe(200);
    expect(root_child1.getComputedWidth()).toBe(200);
    expect(root_child1.getComputedHeight()).toBe(180);

    expect(root_child2.getComputedLeft()).toBe(300);
    expect(root_child2.getComputedTop()).toBe(400);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('wrap_nodes_with_content_sizing_overflowing_margin', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(500);
    root.setHeight(500);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setFlexWrap(Wrap.Wrap);
    root_child0.setWidth(85);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setWidth(40);
    root_child0_child0_child0.setHeight(40);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setMargin(Edge.Right, 10);
    root_child0.insertChild(root_child0_child1, 1);

    const root_child0_child1_child0 = Yoga.Node.create(config);
    root_child0_child1_child0.setWidth(40);
    root_child0_child1_child0.setHeight(40);
    root_child0_child1.insertChild(root_child0_child1_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(500);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(85);
    expect(root_child0.getComputedHeight()).toBe(80);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child0.getComputedHeight()).toBe(40);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(40);

    expect(root_child0_child1.getComputedLeft()).toBe(0);
    expect(root_child0_child1.getComputedTop()).toBe(40);
    expect(root_child0_child1.getComputedWidth()).toBe(40);
    expect(root_child0_child1.getComputedHeight()).toBe(40);

    expect(root_child0_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child1_child0.getComputedTop()).toBe(0);
    expect(root_child0_child1_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child1_child0.getComputedHeight()).toBe(40);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(500);

    expect(root_child0.getComputedLeft()).toBe(415);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(85);
    expect(root_child0.getComputedHeight()).toBe(80);

    expect(root_child0_child0.getComputedLeft()).toBe(45);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child0.getComputedHeight()).toBe(40);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(40);

    expect(root_child0_child1.getComputedLeft()).toBe(35);
    expect(root_child0_child1.getComputedTop()).toBe(40);
    expect(root_child0_child1.getComputedWidth()).toBe(40);
    expect(root_child0_child1.getComputedHeight()).toBe(40);

    expect(root_child0_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child1_child0.getComputedTop()).toBe(0);
    expect(root_child0_child1_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child1_child0.getComputedHeight()).toBe(40);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('wrap_nodes_with_content_sizing_margin_cross', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(500);
    root.setHeight(500);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(FlexDirection.Row);
    root_child0.setFlexWrap(Wrap.Wrap);
    root_child0.setWidth(70);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setWidth(40);
    root_child0_child0_child0.setHeight(40);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setMargin(Edge.Top, 10);
    root_child0.insertChild(root_child0_child1, 1);

    const root_child0_child1_child0 = Yoga.Node.create(config);
    root_child0_child1_child0.setWidth(40);
    root_child0_child1_child0.setHeight(40);
    root_child0_child1.insertChild(root_child0_child1_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(500);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(70);
    expect(root_child0.getComputedHeight()).toBe(90);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child0.getComputedHeight()).toBe(40);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(40);

    expect(root_child0_child1.getComputedLeft()).toBe(0);
    expect(root_child0_child1.getComputedTop()).toBe(50);
    expect(root_child0_child1.getComputedWidth()).toBe(40);
    expect(root_child0_child1.getComputedHeight()).toBe(40);

    expect(root_child0_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child1_child0.getComputedTop()).toBe(0);
    expect(root_child0_child1_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child1_child0.getComputedHeight()).toBe(40);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(500);
    expect(root.getComputedHeight()).toBe(500);

    expect(root_child0.getComputedLeft()).toBe(430);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(70);
    expect(root_child0.getComputedHeight()).toBe(90);

    expect(root_child0_child0.getComputedLeft()).toBe(30);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child0.getComputedHeight()).toBe(40);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(40);

    expect(root_child0_child1.getComputedLeft()).toBe(30);
    expect(root_child0_child1.getComputedTop()).toBe(50);
    expect(root_child0_child1.getComputedWidth()).toBe(40);
    expect(root_child0_child1.getComputedHeight()).toBe(40);

    expect(root_child0_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child1_child0.getComputedTop()).toBe(0);
    expect(root_child0_child1_child0.getComputedWidth()).toBe(40);
    expect(root_child0_child1_child0.getComputedHeight()).toBe(40);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('wrap_with_min_cross_axis', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
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
    expect(root_child1.getComputedTop()).toBe(200);
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
test('wrap_with_max_cross_axis', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
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
test('nowrap_expands_flexline_box_to_min_cross', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setMinHeight(400);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setFlexShrink(1);
    root_child0.setFlexBasis("0%");
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(0);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(0);
    expect(root_child0.getComputedHeight()).toBe(400);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(0);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(0);
    expect(root_child0.getComputedHeight()).toBe(400);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('wrap_does_not_impose_min_cross_onto_single_flexline', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setFlexWrap(Wrap.Wrap);
    root.setMinHeight(400);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setFlexShrink(1);
    root_child0.setFlexBasis("0%");
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(0);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(0);
    expect(root_child0.getComputedHeight()).toBe(0);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(0);
    expect(root.getComputedHeight()).toBe(400);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(0);
    expect(root_child0.getComputedHeight()).toBe(0);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
