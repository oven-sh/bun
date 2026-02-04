import { test, expect, describe } from "bun:test";
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

test('rounding_flex_basis_flex_grow_row_width_of_100', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setFlexGrow(1);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(33);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(33);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(34);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(67);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(33);
    expect(root_child2.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(67);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(33);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(33);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(34);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(33);
    expect(root_child2.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('rounding_flex_basis_flex_grow_row_prime_number_width', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(113);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setFlexGrow(1);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setFlexGrow(1);
    root.insertChild(root_child3, 3);

    const root_child4 = Yoga.Node.create(config);
    root_child4.setFlexGrow(1);
    root.insertChild(root_child4, 4);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(113);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(23);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(23);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(22);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(45);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(23);
    expect(root_child2.getComputedHeight()).toBe(100);

    expect(root_child3.getComputedLeft()).toBe(68);
    expect(root_child3.getComputedTop()).toBe(0);
    expect(root_child3.getComputedWidth()).toBe(22);
    expect(root_child3.getComputedHeight()).toBe(100);

    expect(root_child4.getComputedLeft()).toBe(90);
    expect(root_child4.getComputedTop()).toBe(0);
    expect(root_child4.getComputedWidth()).toBe(23);
    expect(root_child4.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(113);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(23);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(68);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(22);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(45);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(23);
    expect(root_child2.getComputedHeight()).toBe(100);

    expect(root_child3.getComputedLeft()).toBe(23);
    expect(root_child3.getComputedTop()).toBe(0);
    expect(root_child3.getComputedWidth()).toBe(22);
    expect(root_child3.getComputedHeight()).toBe(100);

    expect(root_child4.getComputedLeft()).toBe(0);
    expect(root_child4.getComputedTop()).toBe(0);
    expect(root_child4.getComputedWidth()).toBe(23);
    expect(root_child4.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('rounding_flex_basis_flex_shrink_row', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(101);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexShrink(1);
    root_child0.setFlexBasis(100);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexBasis(25);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setFlexBasis(25);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(101);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(51);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(51);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(25);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(76);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(25);
    expect(root_child2.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(101);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(51);
    expect(root_child0.getComputedHeight()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(25);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(25);
    expect(root_child1.getComputedHeight()).toBe(100);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(25);
    expect(root_child2.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('rounding_flex_basis_overrides_main_size', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(113);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setFlexBasis(50);
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setFlexGrow(1);
    root_child2.setHeight(10);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(113);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(64);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(64);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(25);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(89);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(24);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(113);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(64);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(64);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(25);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(89);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(24);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('rounding_total_fractial', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(87.4);
    root.setHeight(113.4);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(0.7);
    root_child0.setFlexBasis(50.3);
    root_child0.setHeight(20.3);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1.6);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setFlexGrow(1.1);
    root_child2.setHeight(10.7);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(87);
    expect(root.getComputedHeight()).toBe(113);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(87);
    expect(root_child0.getComputedHeight()).toBe(59);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(59);
    expect(root_child1.getComputedWidth()).toBe(87);
    expect(root_child1.getComputedHeight()).toBe(30);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(89);
    expect(root_child2.getComputedWidth()).toBe(87);
    expect(root_child2.getComputedHeight()).toBe(24);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(87);
    expect(root.getComputedHeight()).toBe(113);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(87);
    expect(root_child0.getComputedHeight()).toBe(59);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(59);
    expect(root_child1.getComputedWidth()).toBe(87);
    expect(root_child1.getComputedHeight()).toBe(30);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(89);
    expect(root_child2.getComputedWidth()).toBe(87);
    expect(root_child2.getComputedHeight()).toBe(24);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('rounding_total_fractial_nested', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(87.4);
    root.setHeight(113.4);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(0.7);
    root_child0.setFlexBasis(50.3);
    root_child0.setHeight(20.3);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setFlexGrow(1);
    root_child0_child0.setFlexBasis(0.3);
    root_child0_child0.setPosition(Edge.Bottom, 13.3);
    root_child0_child0.setHeight(9.9);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child1 = Yoga.Node.create(config);
    root_child0_child1.setFlexGrow(4);
    root_child0_child1.setFlexBasis(0.3);
    root_child0_child1.setPosition(Edge.Top, 13.3);
    root_child0_child1.setHeight(1.1);
    root_child0.insertChild(root_child0_child1, 1);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1.6);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setFlexGrow(1.1);
    root_child2.setHeight(10.7);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(87);
    expect(root.getComputedHeight()).toBe(113);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(87);
    expect(root_child0.getComputedHeight()).toBe(59);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(-13);
    expect(root_child0_child0.getComputedWidth()).toBe(87);
    expect(root_child0_child0.getComputedHeight()).toBe(12);

    expect(root_child0_child1.getComputedLeft()).toBe(0);
    expect(root_child0_child1.getComputedTop()).toBe(25);
    expect(root_child0_child1.getComputedWidth()).toBe(87);
    expect(root_child0_child1.getComputedHeight()).toBe(47);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(59);
    expect(root_child1.getComputedWidth()).toBe(87);
    expect(root_child1.getComputedHeight()).toBe(30);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(89);
    expect(root_child2.getComputedWidth()).toBe(87);
    expect(root_child2.getComputedHeight()).toBe(24);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(87);
    expect(root.getComputedHeight()).toBe(113);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(87);
    expect(root_child0.getComputedHeight()).toBe(59);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(-13);
    expect(root_child0_child0.getComputedWidth()).toBe(87);
    expect(root_child0_child0.getComputedHeight()).toBe(12);

    expect(root_child0_child1.getComputedLeft()).toBe(0);
    expect(root_child0_child1.getComputedTop()).toBe(25);
    expect(root_child0_child1.getComputedWidth()).toBe(87);
    expect(root_child0_child1.getComputedHeight()).toBe(47);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(59);
    expect(root_child1.getComputedWidth()).toBe(87);
    expect(root_child1.getComputedHeight()).toBe(30);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(89);
    expect(root_child2.getComputedWidth()).toBe(87);
    expect(root_child2.getComputedHeight()).toBe(24);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('rounding_fractial_input_1', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(113.4);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setFlexBasis(50);
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setFlexGrow(1);
    root_child2.setHeight(10);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(113);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(64);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(64);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(25);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(89);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(24);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(113);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(64);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(64);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(25);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(89);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(24);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('rounding_fractial_input_2', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(113.6);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setFlexBasis(50);
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setFlexGrow(1);
    root_child2.setHeight(10);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(114);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(65);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(65);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(24);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(89);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(25);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(114);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(65);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(65);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(24);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(89);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(25);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('rounding_fractial_input_3', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPosition(Edge.Top, 0.3);
    root.setWidth(100);
    root.setHeight(113.4);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setFlexBasis(50);
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setFlexGrow(1);
    root_child2.setHeight(10);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(114);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(65);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(64);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(24);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(89);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(25);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(114);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(65);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(64);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(24);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(89);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(25);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('rounding_fractial_input_4', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPosition(Edge.Top, 0.7);
    root.setWidth(100);
    root.setHeight(113.4);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setFlexBasis(50);
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setFlexGrow(1);
    root_child2.setHeight(10);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(1);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(113);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(64);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(64);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(25);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(89);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(24);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(1);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(113);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(64);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(64);
    expect(root_child1.getComputedWidth()).toBe(100);
    expect(root_child1.getComputedHeight()).toBe(25);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(89);
    expect(root_child2.getComputedWidth()).toBe(100);
    expect(root_child2.getComputedHeight()).toBe(24);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('rounding_inner_node_controversy_horizontal', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(320);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setHeight(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root_child1.setHeight(10);
    root.insertChild(root_child1, 1);

    const root_child1_child0 = Yoga.Node.create(config);
    root_child1_child0.setFlexGrow(1);
    root_child1_child0.setHeight(10);
    root_child1.insertChild(root_child1_child0, 0);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setFlexGrow(1);
    root_child2.setHeight(10);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(10);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(107);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(107);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(106);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(106);
    expect(root_child1_child0.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(213);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(107);
    expect(root_child2.getComputedHeight()).toBe(10);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(320);
    expect(root.getComputedHeight()).toBe(10);

    expect(root_child0.getComputedLeft()).toBe(213);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(107);
    expect(root_child0.getComputedHeight()).toBe(10);

    expect(root_child1.getComputedLeft()).toBe(107);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(106);
    expect(root_child1.getComputedHeight()).toBe(10);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(106);
    expect(root_child1_child0.getComputedHeight()).toBe(10);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(107);
    expect(root_child2.getComputedHeight()).toBe(10);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('rounding_inner_node_controversy_vertical', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setHeight(320);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setWidth(10);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root_child1.setWidth(10);
    root.insertChild(root_child1, 1);

    const root_child1_child0 = Yoga.Node.create(config);
    root_child1_child0.setFlexGrow(1);
    root_child1_child0.setWidth(10);
    root_child1.insertChild(root_child1_child0, 0);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setFlexGrow(1);
    root_child2.setWidth(10);
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(10);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(107);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(107);
    expect(root_child1.getComputedWidth()).toBe(10);
    expect(root_child1.getComputedHeight()).toBe(106);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(10);
    expect(root_child1_child0.getComputedHeight()).toBe(106);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(213);
    expect(root_child2.getComputedWidth()).toBe(10);
    expect(root_child2.getComputedHeight()).toBe(107);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(10);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(10);
    expect(root_child0.getComputedHeight()).toBe(107);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(107);
    expect(root_child1.getComputedWidth()).toBe(10);
    expect(root_child1.getComputedHeight()).toBe(106);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(10);
    expect(root_child1_child0.getComputedHeight()).toBe(106);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(213);
    expect(root_child2.getComputedWidth()).toBe(10);
    expect(root_child2.getComputedHeight()).toBe(107);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
test('rounding_inner_node_controversy_combined', () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(640);
    root.setHeight(320);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexGrow(1);
    root_child0.setHeight("100%");
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexGrow(1);
    root_child1.setHeight("100%");
    root.insertChild(root_child1, 1);

    const root_child1_child0 = Yoga.Node.create(config);
    root_child1_child0.setFlexGrow(1);
    root_child1_child0.setWidth("100%");
    root_child1.insertChild(root_child1_child0, 0);

    const root_child1_child1 = Yoga.Node.create(config);
    root_child1_child1.setFlexGrow(1);
    root_child1_child1.setWidth("100%");
    root_child1.insertChild(root_child1_child1, 1);

    const root_child1_child1_child0 = Yoga.Node.create(config);
    root_child1_child1_child0.setFlexGrow(1);
    root_child1_child1_child0.setWidth("100%");
    root_child1_child1.insertChild(root_child1_child1_child0, 0);

    const root_child1_child2 = Yoga.Node.create(config);
    root_child1_child2.setFlexGrow(1);
    root_child1_child2.setWidth("100%");
    root_child1.insertChild(root_child1_child2, 2);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setFlexGrow(1);
    root_child2.setHeight("100%");
    root.insertChild(root_child2, 2);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(640);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(213);
    expect(root_child0.getComputedHeight()).toBe(320);

    expect(root_child1.getComputedLeft()).toBe(213);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(214);
    expect(root_child1.getComputedHeight()).toBe(320);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(214);
    expect(root_child1_child0.getComputedHeight()).toBe(107);

    expect(root_child1_child1.getComputedLeft()).toBe(0);
    expect(root_child1_child1.getComputedTop()).toBe(107);
    expect(root_child1_child1.getComputedWidth()).toBe(214);
    expect(root_child1_child1.getComputedHeight()).toBe(106);

    expect(root_child1_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child1_child0.getComputedWidth()).toBe(214);
    expect(root_child1_child1_child0.getComputedHeight()).toBe(106);

    expect(root_child1_child2.getComputedLeft()).toBe(0);
    expect(root_child1_child2.getComputedTop()).toBe(213);
    expect(root_child1_child2.getComputedWidth()).toBe(214);
    expect(root_child1_child2.getComputedHeight()).toBe(107);

    expect(root_child2.getComputedLeft()).toBe(427);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(213);
    expect(root_child2.getComputedHeight()).toBe(320);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(640);
    expect(root.getComputedHeight()).toBe(320);

    expect(root_child0.getComputedLeft()).toBe(427);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(213);
    expect(root_child0.getComputedHeight()).toBe(320);

    expect(root_child1.getComputedLeft()).toBe(213);
    expect(root_child1.getComputedTop()).toBe(0);
    expect(root_child1.getComputedWidth()).toBe(214);
    expect(root_child1.getComputedHeight()).toBe(320);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child0.getComputedWidth()).toBe(214);
    expect(root_child1_child0.getComputedHeight()).toBe(107);

    expect(root_child1_child1.getComputedLeft()).toBe(0);
    expect(root_child1_child1.getComputedTop()).toBe(107);
    expect(root_child1_child1.getComputedWidth()).toBe(214);
    expect(root_child1_child1.getComputedHeight()).toBe(106);

    expect(root_child1_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child1_child0.getComputedTop()).toBe(0);
    expect(root_child1_child1_child0.getComputedWidth()).toBe(214);
    expect(root_child1_child1_child0.getComputedHeight()).toBe(106);

    expect(root_child1_child2.getComputedLeft()).toBe(0);
    expect(root_child1_child2.getComputedTop()).toBe(213);
    expect(root_child1_child2.getComputedWidth()).toBe(214);
    expect(root_child1_child2.getComputedHeight()).toBe(107);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(0);
    expect(root_child2.getComputedWidth()).toBe(213);
    expect(root_child2.getComputedHeight()).toBe(320);
  } finally {
    if (typeof root !== 'undefined') {
      root.freeRecursive();
    }

    config.free();
  }
});
