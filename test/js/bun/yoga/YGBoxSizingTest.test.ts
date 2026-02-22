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

test("box_sizing_content_box_simple", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Left, 5);
    root.setPadding(Edge.Top, 5);
    root.setPadding(Edge.Right, 5);
    root.setPadding(Edge.Bottom, 5);
    root.setBorder(Edge.Left, 10);
    root.setBorder(Edge.Top, 10);
    root.setBorder(Edge.Right, 10);
    root.setBorder(Edge.Bottom, 10);
    root.setWidth(100);
    root.setHeight(100);
    root.setBoxSizing(BoxSizing.ContentBox);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(130);
    expect(root.getComputedHeight()).toBe(130);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(130);
    expect(root.getComputedHeight()).toBe(130);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_simple", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Left, 5);
    root.setPadding(Edge.Top, 5);
    root.setPadding(Edge.Right, 5);
    root.setPadding(Edge.Bottom, 5);
    root.setBorder(Edge.Left, 10);
    root.setBorder(Edge.Top, 10);
    root.setBorder(Edge.Right, 10);
    root.setBorder(Edge.Bottom, 10);
    root.setWidth(100);
    root.setHeight(100);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_content_box_percent", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 4);
    root_child0.setPadding(Edge.Top, 4);
    root_child0.setPadding(Edge.Right, 4);
    root_child0.setPadding(Edge.Bottom, 4);
    root_child0.setBorder(Edge.Left, 16);
    root_child0.setBorder(Edge.Top, 16);
    root_child0.setBorder(Edge.Right, 16);
    root_child0.setBorder(Edge.Bottom, 16);
    root_child0.setWidth("50%");
    root_child0.setHeight("25%");
    root_child0.setBoxSizing(BoxSizing.ContentBox);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(90);
    expect(root_child0.getComputedHeight()).toBe(65);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(10);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(90);
    expect(root_child0.getComputedHeight()).toBe(65);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_percent", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 4);
    root_child0.setPadding(Edge.Top, 4);
    root_child0.setPadding(Edge.Right, 4);
    root_child0.setPadding(Edge.Bottom, 4);
    root_child0.setBorder(Edge.Left, 16);
    root_child0.setBorder(Edge.Top, 16);
    root_child0.setBorder(Edge.Right, 16);
    root_child0.setBorder(Edge.Bottom, 16);
    root_child0.setWidth("50%");
    root_child0.setHeight("25%");
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(40);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(40);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_content_box_absolute", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setPadding(Edge.Left, 12);
    root_child0.setPadding(Edge.Top, 12);
    root_child0.setPadding(Edge.Right, 12);
    root_child0.setPadding(Edge.Bottom, 12);
    root_child0.setBorder(Edge.Left, 8);
    root_child0.setBorder(Edge.Top, 8);
    root_child0.setBorder(Edge.Right, 8);
    root_child0.setBorder(Edge.Bottom, 8);
    root_child0.setHeight("25%");
    root_child0.setBoxSizing(BoxSizing.ContentBox);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(65);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(65);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_absolute", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Absolute);
    root_child0.setPadding(Edge.Left, 12);
    root_child0.setPadding(Edge.Top, 12);
    root_child0.setPadding(Edge.Right, 12);
    root_child0.setPadding(Edge.Bottom, 12);
    root_child0.setBorder(Edge.Left, 8);
    root_child0.setBorder(Edge.Top, 8);
    root_child0.setBorder(Edge.Right, 8);
    root_child0.setBorder(Edge.Bottom, 8);
    root_child0.setHeight("25%");
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(40);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(40);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_content_box_comtaining_block", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Left, 12);
    root.setPadding(Edge.Top, 12);
    root.setPadding(Edge.Right, 12);
    root.setPadding(Edge.Bottom, 12);
    root.setBorder(Edge.Left, 8);
    root.setBorder(Edge.Top, 8);
    root.setBorder(Edge.Right, 8);
    root.setBorder(Edge.Bottom, 8);
    root.setWidth(100);
    root.setHeight(100);
    root.setBoxSizing(BoxSizing.ContentBox);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Static);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0.setWidth(50);
    root_child0_child0.setHeight("25%");
    root_child0.insertChild(root_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(140);

    expect(root_child0.getComputedLeft()).toBe(20);
    expect(root_child0.getComputedTop()).toBe(20);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(0);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0.getComputedHeight()).toBe(31);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(140);
    expect(root.getComputedHeight()).toBe(140);

    expect(root_child0.getComputedLeft()).toBe(20);
    expect(root_child0.getComputedTop()).toBe(20);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(0);

    expect(root_child0_child0.getComputedLeft()).toBe(50);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0.getComputedHeight()).toBe(31);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_comtaining_block", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Left, 12);
    root.setPadding(Edge.Top, 12);
    root.setPadding(Edge.Right, 12);
    root.setPadding(Edge.Bottom, 12);
    root.setBorder(Edge.Left, 8);
    root.setBorder(Edge.Top, 8);
    root.setBorder(Edge.Right, 8);
    root.setBorder(Edge.Bottom, 8);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPositionType(PositionType.Static);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPositionType(PositionType.Absolute);
    root_child0_child0.setWidth(50);
    root_child0_child0.setHeight("25%");
    root_child0.insertChild(root_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(20);
    expect(root_child0.getComputedTop()).toBe(20);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(0);

    expect(root_child0_child0.getComputedLeft()).toBe(0);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0.getComputedHeight()).toBe(21);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(20);
    expect(root_child0.getComputedTop()).toBe(20);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(0);

    expect(root_child0_child0.getComputedLeft()).toBe(10);
    expect(root_child0_child0.getComputedTop()).toBe(0);
    expect(root_child0_child0.getComputedWidth()).toBe(50);
    expect(root_child0_child0.getComputedHeight()).toBe(21);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_content_box_padding_only", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Left, 5);
    root.setPadding(Edge.Top, 5);
    root.setPadding(Edge.Right, 5);
    root.setPadding(Edge.Bottom, 5);
    root.setWidth(100);
    root.setHeight(100);
    root.setBoxSizing(BoxSizing.ContentBox);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(110);
    expect(root.getComputedHeight()).toBe(110);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(110);
    expect(root.getComputedHeight()).toBe(110);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_content_box_padding_only_percent", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(150);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, "10%");
    root_child0.setPadding(Edge.Top, "10%");
    root_child0.setPadding(Edge.Right, "10%");
    root_child0.setPadding(Edge.Bottom, "10%");
    root_child0.setWidth(50);
    root_child0.setHeight(75);
    root_child0.setBoxSizing(BoxSizing.ContentBox);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(150);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(70);
    expect(root_child0.getComputedHeight()).toBe(95);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(150);

    expect(root_child0.getComputedLeft()).toBe(30);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(70);
    expect(root_child0.getComputedHeight()).toBe(95);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_padding_only", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Left, 5);
    root.setPadding(Edge.Top, 5);
    root.setPadding(Edge.Right, 5);
    root.setPadding(Edge.Bottom, 5);
    root.setWidth(100);
    root.setHeight(100);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_padding_only_percent", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(150);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, "10%");
    root_child0.setPadding(Edge.Top, "10%");
    root_child0.setPadding(Edge.Right, "10%");
    root_child0.setPadding(Edge.Bottom, "10%");
    root_child0.setWidth(50);
    root_child0.setHeight(75);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(150);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(75);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(150);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(75);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_content_box_border_only", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setBorder(Edge.Left, 10);
    root.setBorder(Edge.Top, 10);
    root.setBorder(Edge.Right, 10);
    root.setBorder(Edge.Bottom, 10);
    root.setWidth(100);
    root.setHeight(100);
    root.setBoxSizing(BoxSizing.ContentBox);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(120);
    expect(root.getComputedHeight()).toBe(120);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(120);
    expect(root.getComputedHeight()).toBe(120);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_content_box_border_only_percent", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth("50%");
    root_child0.setBoxSizing(BoxSizing.ContentBox);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(0);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(0);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_border_only", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setBorder(Edge.Left, 10);
    root.setBorder(Edge.Top, 10);
    root.setBorder(Edge.Right, 10);
    root.setBorder(Edge.Bottom, 10);
    root.setWidth(100);
    root.setHeight(100);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_border_only_percent", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth("50%");
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(0);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(0);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_content_box_no_padding_no_border", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);
    root.setBoxSizing(BoxSizing.ContentBox);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_no_padding_no_border", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_content_box_children", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Left, 5);
    root.setPadding(Edge.Top, 5);
    root.setPadding(Edge.Right, 5);
    root.setPadding(Edge.Bottom, 5);
    root.setBorder(Edge.Left, 10);
    root.setBorder(Edge.Top, 10);
    root.setBorder(Edge.Right, 10);
    root.setBorder(Edge.Bottom, 10);
    root.setWidth(100);
    root.setHeight(100);
    root.setBoxSizing(BoxSizing.ContentBox);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(25);
    root_child0.setHeight(25);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(25);
    root_child1.setHeight(25);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(25);
    root_child2.setHeight(25);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(25);
    root_child3.setHeight(25);
    root.insertChild(root_child3, 3);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(130);
    expect(root.getComputedHeight()).toBe(130);

    expect(root_child0.getComputedLeft()).toBe(15);
    expect(root_child0.getComputedTop()).toBe(15);
    expect(root_child0.getComputedWidth()).toBe(25);
    expect(root_child0.getComputedHeight()).toBe(25);

    expect(root_child1.getComputedLeft()).toBe(15);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(25);
    expect(root_child1.getComputedHeight()).toBe(25);

    expect(root_child2.getComputedLeft()).toBe(15);
    expect(root_child2.getComputedTop()).toBe(65);
    expect(root_child2.getComputedWidth()).toBe(25);
    expect(root_child2.getComputedHeight()).toBe(25);

    expect(root_child3.getComputedLeft()).toBe(15);
    expect(root_child3.getComputedTop()).toBe(90);
    expect(root_child3.getComputedWidth()).toBe(25);
    expect(root_child3.getComputedHeight()).toBe(25);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(130);
    expect(root.getComputedHeight()).toBe(130);

    expect(root_child0.getComputedLeft()).toBe(90);
    expect(root_child0.getComputedTop()).toBe(15);
    expect(root_child0.getComputedWidth()).toBe(25);
    expect(root_child0.getComputedHeight()).toBe(25);

    expect(root_child1.getComputedLeft()).toBe(90);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(25);
    expect(root_child1.getComputedHeight()).toBe(25);

    expect(root_child2.getComputedLeft()).toBe(90);
    expect(root_child2.getComputedTop()).toBe(65);
    expect(root_child2.getComputedWidth()).toBe(25);
    expect(root_child2.getComputedHeight()).toBe(25);

    expect(root_child3.getComputedLeft()).toBe(90);
    expect(root_child3.getComputedTop()).toBe(90);
    expect(root_child3.getComputedWidth()).toBe(25);
    expect(root_child3.getComputedHeight()).toBe(25);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_children", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Left, 5);
    root.setPadding(Edge.Top, 5);
    root.setPadding(Edge.Right, 5);
    root.setPadding(Edge.Bottom, 5);
    root.setBorder(Edge.Left, 10);
    root.setBorder(Edge.Top, 10);
    root.setBorder(Edge.Right, 10);
    root.setBorder(Edge.Bottom, 10);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(25);
    root_child0.setHeight(25);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(25);
    root_child1.setHeight(25);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(25);
    root_child2.setHeight(25);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(25);
    root_child3.setHeight(25);
    root.insertChild(root_child3, 3);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(15);
    expect(root_child0.getComputedTop()).toBe(15);
    expect(root_child0.getComputedWidth()).toBe(25);
    expect(root_child0.getComputedHeight()).toBe(25);

    expect(root_child1.getComputedLeft()).toBe(15);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(25);
    expect(root_child1.getComputedHeight()).toBe(25);

    expect(root_child2.getComputedLeft()).toBe(15);
    expect(root_child2.getComputedTop()).toBe(65);
    expect(root_child2.getComputedWidth()).toBe(25);
    expect(root_child2.getComputedHeight()).toBe(25);

    expect(root_child3.getComputedLeft()).toBe(15);
    expect(root_child3.getComputedTop()).toBe(90);
    expect(root_child3.getComputedWidth()).toBe(25);
    expect(root_child3.getComputedHeight()).toBe(25);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(60);
    expect(root_child0.getComputedTop()).toBe(15);
    expect(root_child0.getComputedWidth()).toBe(25);
    expect(root_child0.getComputedHeight()).toBe(25);

    expect(root_child1.getComputedLeft()).toBe(60);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(25);
    expect(root_child1.getComputedHeight()).toBe(25);

    expect(root_child2.getComputedLeft()).toBe(60);
    expect(root_child2.getComputedTop()).toBe(65);
    expect(root_child2.getComputedWidth()).toBe(25);
    expect(root_child2.getComputedHeight()).toBe(25);

    expect(root_child3.getComputedLeft()).toBe(60);
    expect(root_child3.getComputedTop()).toBe(90);
    expect(root_child3.getComputedWidth()).toBe(25);
    expect(root_child3.getComputedHeight()).toBe(25);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_content_box_siblings", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(25);
    root_child0.setHeight(25);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setPadding(Edge.Left, 10);
    root_child1.setPadding(Edge.Top, 10);
    root_child1.setPadding(Edge.Right, 10);
    root_child1.setPadding(Edge.Bottom, 10);
    root_child1.setBorder(Edge.Left, 10);
    root_child1.setBorder(Edge.Top, 10);
    root_child1.setBorder(Edge.Right, 10);
    root_child1.setBorder(Edge.Bottom, 10);
    root_child1.setWidth(25);
    root_child1.setHeight(25);
    root_child1.setBoxSizing(BoxSizing.ContentBox);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(25);
    root_child2.setHeight(25);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(25);
    root_child3.setHeight(25);
    root.insertChild(root_child3, 3);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(25);
    expect(root_child0.getComputedHeight()).toBe(25);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(25);
    expect(root_child1.getComputedWidth()).toBe(65);
    expect(root_child1.getComputedHeight()).toBe(65);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(90);
    expect(root_child2.getComputedWidth()).toBe(25);
    expect(root_child2.getComputedHeight()).toBe(25);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(115);
    expect(root_child3.getComputedWidth()).toBe(25);
    expect(root_child3.getComputedHeight()).toBe(25);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(75);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(25);
    expect(root_child0.getComputedHeight()).toBe(25);

    expect(root_child1.getComputedLeft()).toBe(35);
    expect(root_child1.getComputedTop()).toBe(25);
    expect(root_child1.getComputedWidth()).toBe(65);
    expect(root_child1.getComputedHeight()).toBe(65);

    expect(root_child2.getComputedLeft()).toBe(75);
    expect(root_child2.getComputedTop()).toBe(90);
    expect(root_child2.getComputedWidth()).toBe(25);
    expect(root_child2.getComputedHeight()).toBe(25);

    expect(root_child3.getComputedLeft()).toBe(75);
    expect(root_child3.getComputedTop()).toBe(115);
    expect(root_child3.getComputedWidth()).toBe(25);
    expect(root_child3.getComputedHeight()).toBe(25);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_siblings", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setWidth(25);
    root_child0.setHeight(25);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setPadding(Edge.Left, 10);
    root_child1.setPadding(Edge.Top, 10);
    root_child1.setPadding(Edge.Right, 10);
    root_child1.setPadding(Edge.Bottom, 10);
    root_child1.setBorder(Edge.Left, 10);
    root_child1.setBorder(Edge.Top, 10);
    root_child1.setBorder(Edge.Right, 10);
    root_child1.setBorder(Edge.Bottom, 10);
    root_child1.setWidth(25);
    root_child1.setHeight(25);
    root.insertChild(root_child1, 1);

    const root_child2 = Yoga.Node.create(config);
    root_child2.setWidth(25);
    root_child2.setHeight(25);
    root.insertChild(root_child2, 2);

    const root_child3 = Yoga.Node.create(config);
    root_child3.setWidth(25);
    root_child3.setHeight(25);
    root.insertChild(root_child3, 3);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(25);
    expect(root_child0.getComputedHeight()).toBe(25);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(25);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(40);

    expect(root_child2.getComputedLeft()).toBe(0);
    expect(root_child2.getComputedTop()).toBe(65);
    expect(root_child2.getComputedWidth()).toBe(25);
    expect(root_child2.getComputedHeight()).toBe(25);

    expect(root_child3.getComputedLeft()).toBe(0);
    expect(root_child3.getComputedTop()).toBe(90);
    expect(root_child3.getComputedWidth()).toBe(25);
    expect(root_child3.getComputedHeight()).toBe(25);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(75);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(25);
    expect(root_child0.getComputedHeight()).toBe(25);

    expect(root_child1.getComputedLeft()).toBe(60);
    expect(root_child1.getComputedTop()).toBe(25);
    expect(root_child1.getComputedWidth()).toBe(40);
    expect(root_child1.getComputedHeight()).toBe(40);

    expect(root_child2.getComputedLeft()).toBe(75);
    expect(root_child2.getComputedTop()).toBe(65);
    expect(root_child2.getComputedWidth()).toBe(25);
    expect(root_child2.getComputedHeight()).toBe(25);

    expect(root_child3.getComputedLeft()).toBe(75);
    expect(root_child3.getComputedTop()).toBe(90);
    expect(root_child3.getComputedWidth()).toBe(25);
    expect(root_child3.getComputedHeight()).toBe(25);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_content_box_max_width", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 5);
    root_child0.setPadding(Edge.Top, 5);
    root_child0.setPadding(Edge.Right, 5);
    root_child0.setPadding(Edge.Bottom, 5);
    root_child0.setBorder(Edge.Left, 15);
    root_child0.setBorder(Edge.Top, 15);
    root_child0.setBorder(Edge.Right, 15);
    root_child0.setBorder(Edge.Bottom, 15);
    root_child0.setMaxWidth(50);
    root_child0.setHeight(25);
    root_child0.setBoxSizing(BoxSizing.ContentBox);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(25);
    root_child1.setHeight(25);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(90);
    expect(root_child0.getComputedHeight()).toBe(65);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(65);
    expect(root_child1.getComputedWidth()).toBe(25);
    expect(root_child1.getComputedHeight()).toBe(25);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(10);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(90);
    expect(root_child0.getComputedHeight()).toBe(65);

    expect(root_child1.getComputedLeft()).toBe(75);
    expect(root_child1.getComputedTop()).toBe(65);
    expect(root_child1.getComputedWidth()).toBe(25);
    expect(root_child1.getComputedHeight()).toBe(25);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_max_width", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 5);
    root_child0.setPadding(Edge.Top, 5);
    root_child0.setPadding(Edge.Right, 5);
    root_child0.setPadding(Edge.Bottom, 5);
    root_child0.setBorder(Edge.Left, 15);
    root_child0.setBorder(Edge.Top, 15);
    root_child0.setBorder(Edge.Right, 15);
    root_child0.setBorder(Edge.Bottom, 15);
    root_child0.setMaxWidth(50);
    root_child0.setHeight(25);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(25);
    root_child1.setHeight(25);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(40);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(25);
    expect(root_child1.getComputedHeight()).toBe(25);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(40);

    expect(root_child1.getComputedLeft()).toBe(75);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(25);
    expect(root_child1.getComputedHeight()).toBe(25);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_content_box_max_height", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 5);
    root_child0.setPadding(Edge.Top, 5);
    root_child0.setPadding(Edge.Right, 5);
    root_child0.setPadding(Edge.Bottom, 5);
    root_child0.setBorder(Edge.Left, 15);
    root_child0.setBorder(Edge.Top, 15);
    root_child0.setBorder(Edge.Right, 15);
    root_child0.setBorder(Edge.Bottom, 15);
    root_child0.setWidth(50);
    root_child0.setMaxHeight(50);
    root_child0.setBoxSizing(BoxSizing.ContentBox);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(25);
    root_child1.setHeight(25);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(90);
    expect(root_child0.getComputedHeight()).toBe(40);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(25);
    expect(root_child1.getComputedHeight()).toBe(25);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(10);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(90);
    expect(root_child0.getComputedHeight()).toBe(40);

    expect(root_child1.getComputedLeft()).toBe(75);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(25);
    expect(root_child1.getComputedHeight()).toBe(25);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_max_height", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 5);
    root_child0.setPadding(Edge.Top, 5);
    root_child0.setPadding(Edge.Right, 5);
    root_child0.setPadding(Edge.Bottom, 5);
    root_child0.setBorder(Edge.Left, 15);
    root_child0.setBorder(Edge.Top, 15);
    root_child0.setBorder(Edge.Right, 15);
    root_child0.setBorder(Edge.Bottom, 15);
    root_child0.setWidth(50);
    root_child0.setMaxHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(25);
    root_child1.setHeight(25);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(40);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(25);
    expect(root_child1.getComputedHeight()).toBe(25);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(40);

    expect(root_child1.getComputedLeft()).toBe(75);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(25);
    expect(root_child1.getComputedHeight()).toBe(25);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_content_box_min_width", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 5);
    root_child0.setPadding(Edge.Top, 5);
    root_child0.setPadding(Edge.Right, 5);
    root_child0.setPadding(Edge.Bottom, 5);
    root_child0.setBorder(Edge.Left, 15);
    root_child0.setBorder(Edge.Top, 15);
    root_child0.setBorder(Edge.Right, 15);
    root_child0.setBorder(Edge.Bottom, 15);
    root_child0.setMinWidth(50);
    root_child0.setHeight(25);
    root_child0.setBoxSizing(BoxSizing.ContentBox);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(25);
    root_child1.setHeight(25);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(65);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(65);
    expect(root_child1.getComputedWidth()).toBe(25);
    expect(root_child1.getComputedHeight()).toBe(25);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(65);

    expect(root_child1.getComputedLeft()).toBe(75);
    expect(root_child1.getComputedTop()).toBe(65);
    expect(root_child1.getComputedWidth()).toBe(25);
    expect(root_child1.getComputedHeight()).toBe(25);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_min_width", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 5);
    root_child0.setPadding(Edge.Top, 5);
    root_child0.setPadding(Edge.Right, 5);
    root_child0.setPadding(Edge.Bottom, 5);
    root_child0.setBorder(Edge.Left, 15);
    root_child0.setBorder(Edge.Top, 15);
    root_child0.setBorder(Edge.Right, 15);
    root_child0.setBorder(Edge.Bottom, 15);
    root_child0.setMinWidth(50);
    root_child0.setHeight(25);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(25);
    root_child1.setHeight(25);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(40);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(25);
    expect(root_child1.getComputedHeight()).toBe(25);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(40);

    expect(root_child1.getComputedLeft()).toBe(75);
    expect(root_child1.getComputedTop()).toBe(40);
    expect(root_child1.getComputedWidth()).toBe(25);
    expect(root_child1.getComputedHeight()).toBe(25);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_content_box_min_height", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 5);
    root_child0.setPadding(Edge.Top, 5);
    root_child0.setPadding(Edge.Right, 5);
    root_child0.setPadding(Edge.Bottom, 5);
    root_child0.setBorder(Edge.Left, 15);
    root_child0.setBorder(Edge.Top, 15);
    root_child0.setBorder(Edge.Right, 15);
    root_child0.setBorder(Edge.Bottom, 15);
    root_child0.setWidth(50);
    root_child0.setMinHeight(50);
    root_child0.setBoxSizing(BoxSizing.ContentBox);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(25);
    root_child1.setHeight(25);
    root.insertChild(root_child1, 1);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(90);
    expect(root_child0.getComputedHeight()).toBe(90);

    expect(root_child1.getComputedLeft()).toBe(0);
    expect(root_child1.getComputedTop()).toBe(90);
    expect(root_child1.getComputedWidth()).toBe(25);
    expect(root_child1.getComputedHeight()).toBe(25);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(10);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(90);
    expect(root_child0.getComputedHeight()).toBe(90);

    expect(root_child1.getComputedLeft()).toBe(75);
    expect(root_child1.getComputedTop()).toBe(90);
    expect(root_child1.getComputedWidth()).toBe(25);
    expect(root_child1.getComputedHeight()).toBe(25);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_min_height", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 5);
    root_child0.setPadding(Edge.Top, 5);
    root_child0.setPadding(Edge.Right, 5);
    root_child0.setPadding(Edge.Bottom, 5);
    root_child0.setBorder(Edge.Left, 15);
    root_child0.setBorder(Edge.Top, 15);
    root_child0.setBorder(Edge.Right, 15);
    root_child0.setBorder(Edge.Bottom, 15);
    root_child0.setWidth(50);
    root_child0.setMinHeight(50);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setWidth(25);
    root_child1.setHeight(25);
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
    expect(root_child1.getComputedWidth()).toBe(25);
    expect(root_child1.getComputedHeight()).toBe(25);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(50);

    expect(root_child1.getComputedLeft()).toBe(75);
    expect(root_child1.getComputedTop()).toBe(50);
    expect(root_child1.getComputedWidth()).toBe(25);
    expect(root_child1.getComputedHeight()).toBe(25);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_content_box_no_height_no_width", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 2);
    root_child0.setPadding(Edge.Top, 2);
    root_child0.setPadding(Edge.Right, 2);
    root_child0.setPadding(Edge.Bottom, 2);
    root_child0.setBorder(Edge.Left, 7);
    root_child0.setBorder(Edge.Top, 7);
    root_child0.setBorder(Edge.Right, 7);
    root_child0.setBorder(Edge.Bottom, 7);
    root_child0.setBoxSizing(BoxSizing.ContentBox);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(18);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(18);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_no_height_no_width", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 2);
    root_child0.setPadding(Edge.Top, 2);
    root_child0.setPadding(Edge.Right, 2);
    root_child0.setPadding(Edge.Bottom, 2);
    root_child0.setBorder(Edge.Left, 7);
    root_child0.setBorder(Edge.Top, 7);
    root_child0.setBorder(Edge.Right, 7);
    root_child0.setBorder(Edge.Bottom, 7);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(18);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(18);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_content_box_nested", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Left, 15);
    root.setPadding(Edge.Top, 15);
    root.setPadding(Edge.Right, 15);
    root.setPadding(Edge.Bottom, 15);
    root.setBorder(Edge.Left, 3);
    root.setBorder(Edge.Top, 3);
    root.setBorder(Edge.Right, 3);
    root.setBorder(Edge.Bottom, 3);
    root.setWidth(100);
    root.setHeight(100);
    root.setBoxSizing(BoxSizing.ContentBox);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 2);
    root_child0.setPadding(Edge.Top, 2);
    root_child0.setPadding(Edge.Right, 2);
    root_child0.setPadding(Edge.Bottom, 2);
    root_child0.setBorder(Edge.Left, 7);
    root_child0.setBorder(Edge.Top, 7);
    root_child0.setBorder(Edge.Right, 7);
    root_child0.setBorder(Edge.Bottom, 7);
    root_child0.setWidth(20);
    root_child0.setHeight(20);
    root_child0.setBoxSizing(BoxSizing.ContentBox);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPadding(Edge.Left, 1);
    root_child0_child0.setPadding(Edge.Top, 1);
    root_child0_child0.setPadding(Edge.Right, 1);
    root_child0_child0.setPadding(Edge.Bottom, 1);
    root_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0.setBorder(Edge.Top, 2);
    root_child0_child0.setBorder(Edge.Right, 2);
    root_child0_child0.setBorder(Edge.Bottom, 2);
    root_child0_child0.setWidth(10);
    root_child0_child0.setHeight(5);
    root_child0_child0.setBoxSizing(BoxSizing.ContentBox);
    root_child0.insertChild(root_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(136);
    expect(root.getComputedHeight()).toBe(136);

    expect(root_child0.getComputedLeft()).toBe(18);
    expect(root_child0.getComputedTop()).toBe(18);
    expect(root_child0.getComputedWidth()).toBe(38);
    expect(root_child0.getComputedHeight()).toBe(38);

    expect(root_child0_child0.getComputedLeft()).toBe(9);
    expect(root_child0_child0.getComputedTop()).toBe(9);
    expect(root_child0_child0.getComputedWidth()).toBe(16);
    expect(root_child0_child0.getComputedHeight()).toBe(11);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(136);
    expect(root.getComputedHeight()).toBe(136);

    expect(root_child0.getComputedLeft()).toBe(80);
    expect(root_child0.getComputedTop()).toBe(18);
    expect(root_child0.getComputedWidth()).toBe(38);
    expect(root_child0.getComputedHeight()).toBe(38);

    expect(root_child0_child0.getComputedLeft()).toBe(13);
    expect(root_child0_child0.getComputedTop()).toBe(9);
    expect(root_child0_child0.getComputedWidth()).toBe(16);
    expect(root_child0_child0.getComputedHeight()).toBe(11);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_nested", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Left, 15);
    root.setPadding(Edge.Top, 15);
    root.setPadding(Edge.Right, 15);
    root.setPadding(Edge.Bottom, 15);
    root.setBorder(Edge.Left, 3);
    root.setBorder(Edge.Top, 3);
    root.setBorder(Edge.Right, 3);
    root.setBorder(Edge.Bottom, 3);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 2);
    root_child0.setPadding(Edge.Top, 2);
    root_child0.setPadding(Edge.Right, 2);
    root_child0.setPadding(Edge.Bottom, 2);
    root_child0.setBorder(Edge.Left, 7);
    root_child0.setBorder(Edge.Top, 7);
    root_child0.setBorder(Edge.Right, 7);
    root_child0.setBorder(Edge.Bottom, 7);
    root_child0.setWidth(20);
    root_child0.setHeight(20);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPadding(Edge.Left, 1);
    root_child0_child0.setPadding(Edge.Top, 1);
    root_child0_child0.setPadding(Edge.Right, 1);
    root_child0_child0.setPadding(Edge.Bottom, 1);
    root_child0_child0.setBorder(Edge.Left, 2);
    root_child0_child0.setBorder(Edge.Top, 2);
    root_child0_child0.setBorder(Edge.Right, 2);
    root_child0_child0.setBorder(Edge.Bottom, 2);
    root_child0_child0.setWidth(10);
    root_child0_child0.setHeight(5);
    root_child0.insertChild(root_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(18);
    expect(root_child0.getComputedTop()).toBe(18);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child0.getComputedLeft()).toBe(9);
    expect(root_child0_child0.getComputedTop()).toBe(9);
    expect(root_child0_child0.getComputedWidth()).toBe(10);
    expect(root_child0_child0.getComputedHeight()).toBe(6);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(62);
    expect(root_child0.getComputedTop()).toBe(18);
    expect(root_child0.getComputedWidth()).toBe(20);
    expect(root_child0.getComputedHeight()).toBe(20);

    expect(root_child0_child0.getComputedLeft()).toBe(1);
    expect(root_child0_child0.getComputedTop()).toBe(9);
    expect(root_child0_child0.getComputedWidth()).toBe(10);
    expect(root_child0_child0.getComputedHeight()).toBe(6);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_content_box_nested_alternating", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Left, 3);
    root.setPadding(Edge.Top, 3);
    root.setPadding(Edge.Right, 3);
    root.setPadding(Edge.Bottom, 3);
    root.setBorder(Edge.Left, 2);
    root.setBorder(Edge.Top, 2);
    root.setBorder(Edge.Right, 2);
    root.setBorder(Edge.Bottom, 2);
    root.setWidth(100);
    root.setHeight(100);
    root.setBoxSizing(BoxSizing.ContentBox);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 8);
    root_child0.setPadding(Edge.Top, 8);
    root_child0.setPadding(Edge.Right, 8);
    root_child0.setPadding(Edge.Bottom, 8);
    root_child0.setBorder(Edge.Left, 2);
    root_child0.setBorder(Edge.Top, 2);
    root_child0.setBorder(Edge.Right, 2);
    root_child0.setBorder(Edge.Bottom, 2);
    root_child0.setWidth(40);
    root_child0.setHeight(40);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPadding(Edge.Left, 3);
    root_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0.setPadding(Edge.Right, 3);
    root_child0_child0.setPadding(Edge.Bottom, 3);
    root_child0_child0.setBorder(Edge.Left, 6);
    root_child0_child0.setBorder(Edge.Top, 6);
    root_child0_child0.setBorder(Edge.Right, 6);
    root_child0_child0.setBorder(Edge.Bottom, 6);
    root_child0_child0.setWidth(20);
    root_child0_child0.setHeight(25);
    root_child0_child0.setBoxSizing(BoxSizing.ContentBox);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPadding(Edge.Left, 1);
    root_child0_child0_child0.setPadding(Edge.Top, 1);
    root_child0_child0_child0.setPadding(Edge.Right, 1);
    root_child0_child0_child0.setPadding(Edge.Bottom, 1);
    root_child0_child0_child0.setBorder(Edge.Left, 1);
    root_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0.setBorder(Edge.Right, 1);
    root_child0_child0_child0.setBorder(Edge.Bottom, 1);
    root_child0_child0_child0.setWidth(10);
    root_child0_child0_child0.setHeight(5);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(110);
    expect(root.getComputedHeight()).toBe(110);

    expect(root_child0.getComputedLeft()).toBe(5);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(40);

    expect(root_child0_child0.getComputedLeft()).toBe(10);
    expect(root_child0_child0.getComputedTop()).toBe(10);
    expect(root_child0_child0.getComputedWidth()).toBe(38);
    expect(root_child0_child0.getComputedHeight()).toBe(43);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(9);
    expect(root_child0_child0_child0.getComputedTop()).toBe(9);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(10);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(5);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(110);
    expect(root.getComputedHeight()).toBe(110);

    expect(root_child0.getComputedLeft()).toBe(65);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(40);
    expect(root_child0.getComputedHeight()).toBe(40);

    expect(root_child0_child0.getComputedLeft()).toBe(-8);
    expect(root_child0_child0.getComputedTop()).toBe(10);
    expect(root_child0_child0.getComputedWidth()).toBe(38);
    expect(root_child0_child0.getComputedHeight()).toBe(43);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(19);
    expect(root_child0_child0_child0.getComputedTop()).toBe(9);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(10);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(5);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_nested_alternating", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Left, 3);
    root.setPadding(Edge.Top, 3);
    root.setPadding(Edge.Right, 3);
    root.setPadding(Edge.Bottom, 3);
    root.setBorder(Edge.Left, 2);
    root.setBorder(Edge.Top, 2);
    root.setBorder(Edge.Right, 2);
    root.setBorder(Edge.Bottom, 2);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setPadding(Edge.Left, 8);
    root_child0.setPadding(Edge.Top, 8);
    root_child0.setPadding(Edge.Right, 8);
    root_child0.setPadding(Edge.Bottom, 8);
    root_child0.setBorder(Edge.Left, 2);
    root_child0.setBorder(Edge.Top, 2);
    root_child0.setBorder(Edge.Right, 2);
    root_child0.setBorder(Edge.Bottom, 2);
    root_child0.setWidth(40);
    root_child0.setHeight(40);
    root_child0.setBoxSizing(BoxSizing.ContentBox);
    root.insertChild(root_child0, 0);

    const root_child0_child0 = Yoga.Node.create(config);
    root_child0_child0.setPadding(Edge.Left, 3);
    root_child0_child0.setPadding(Edge.Top, 3);
    root_child0_child0.setPadding(Edge.Right, 3);
    root_child0_child0.setPadding(Edge.Bottom, 3);
    root_child0_child0.setBorder(Edge.Left, 6);
    root_child0_child0.setBorder(Edge.Top, 6);
    root_child0_child0.setBorder(Edge.Right, 6);
    root_child0_child0.setBorder(Edge.Bottom, 6);
    root_child0_child0.setWidth(20);
    root_child0_child0.setHeight(25);
    root_child0.insertChild(root_child0_child0, 0);

    const root_child0_child0_child0 = Yoga.Node.create(config);
    root_child0_child0_child0.setPadding(Edge.Left, 1);
    root_child0_child0_child0.setPadding(Edge.Top, 1);
    root_child0_child0_child0.setPadding(Edge.Right, 1);
    root_child0_child0_child0.setPadding(Edge.Bottom, 1);
    root_child0_child0_child0.setBorder(Edge.Left, 1);
    root_child0_child0_child0.setBorder(Edge.Top, 1);
    root_child0_child0_child0.setBorder(Edge.Right, 1);
    root_child0_child0_child0.setBorder(Edge.Bottom, 1);
    root_child0_child0_child0.setWidth(10);
    root_child0_child0_child0.setHeight(5);
    root_child0_child0_child0.setBoxSizing(BoxSizing.ContentBox);
    root_child0_child0.insertChild(root_child0_child0_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(5);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(60);

    expect(root_child0_child0.getComputedLeft()).toBe(10);
    expect(root_child0_child0.getComputedTop()).toBe(10);
    expect(root_child0_child0.getComputedWidth()).toBe(20);
    expect(root_child0_child0.getComputedHeight()).toBe(25);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(9);
    expect(root_child0_child0_child0.getComputedTop()).toBe(9);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(14);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(9);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(35);
    expect(root_child0.getComputedTop()).toBe(5);
    expect(root_child0.getComputedWidth()).toBe(60);
    expect(root_child0.getComputedHeight()).toBe(60);

    expect(root_child0_child0.getComputedLeft()).toBe(30);
    expect(root_child0_child0.getComputedTop()).toBe(10);
    expect(root_child0_child0.getComputedWidth()).toBe(20);
    expect(root_child0_child0.getComputedHeight()).toBe(25);

    expect(root_child0_child0_child0.getComputedLeft()).toBe(-3);
    expect(root_child0_child0_child0.getComputedTop()).toBe(9);
    expect(root_child0_child0_child0.getComputedWidth()).toBe(14);
    expect(root_child0_child0_child0.getComputedHeight()).toBe(9);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test.skip("box_sizing_content_box_flex_basis_row", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexBasis(50);
    root_child0.setPadding(Edge.Left, 5);
    root_child0.setPadding(Edge.Top, 5);
    root_child0.setPadding(Edge.Right, 5);
    root_child0.setPadding(Edge.Bottom, 5);
    root_child0.setBorder(Edge.Left, 10);
    root_child0.setBorder(Edge.Top, 10);
    root_child0.setBorder(Edge.Right, 10);
    root_child0.setBorder(Edge.Bottom, 10);
    root_child0.setHeight(25);
    root_child0.setBoxSizing(BoxSizing.ContentBox);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(80);
    expect(root_child0.getComputedHeight()).toBe(55);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(20);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(80);
    expect(root_child0.getComputedHeight()).toBe(55);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_flex_basis_row", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(FlexDirection.Row);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexBasis(50);
    root_child0.setPadding(Edge.Left, 5);
    root_child0.setPadding(Edge.Top, 5);
    root_child0.setPadding(Edge.Right, 5);
    root_child0.setPadding(Edge.Bottom, 5);
    root_child0.setBorder(Edge.Left, 10);
    root_child0.setBorder(Edge.Top, 10);
    root_child0.setBorder(Edge.Right, 10);
    root_child0.setBorder(Edge.Bottom, 10);
    root_child0.setHeight(25);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(30);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(50);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(50);
    expect(root_child0.getComputedHeight()).toBe(30);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test.skip("box_sizing_content_box_flex_basis_column", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexBasis(50);
    root_child0.setPadding(Edge.Left, 5);
    root_child0.setPadding(Edge.Top, 5);
    root_child0.setPadding(Edge.Right, 5);
    root_child0.setPadding(Edge.Bottom, 5);
    root_child0.setBorder(Edge.Left, 10);
    root_child0.setBorder(Edge.Top, 10);
    root_child0.setBorder(Edge.Right, 10);
    root_child0.setBorder(Edge.Bottom, 10);
    root_child0.setHeight(25);
    root_child0.setBoxSizing(BoxSizing.ContentBox);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(80);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(80);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_flex_basis_column", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setWidth(100);
    root.setHeight(100);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexBasis(50);
    root_child0.setPadding(Edge.Left, 5);
    root_child0.setPadding(Edge.Top, 5);
    root_child0.setPadding(Edge.Right, 5);
    root_child0.setPadding(Edge.Bottom, 5);
    root_child0.setBorder(Edge.Left, 10);
    root_child0.setBorder(Edge.Top, 10);
    root_child0.setBorder(Edge.Right, 10);
    root_child0.setBorder(Edge.Bottom, 10);
    root_child0.setHeight(25);
    root.insertChild(root_child0, 0);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(50);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);
    expect(root_child0.getComputedWidth()).toBe(100);
    expect(root_child0.getComputedHeight()).toBe(50);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_content_box_padding_start", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Start, 5);
    root.setWidth(100);
    root.setHeight(100);
    root.setBoxSizing(BoxSizing.ContentBox);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(105);
    expect(root.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(105);
    expect(root.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_padding_start", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.Start, 5);
    root.setWidth(100);
    root.setHeight(100);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_content_box_padding_end", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.End, 5);
    root.setWidth(100);
    root.setHeight(100);
    root.setBoxSizing(BoxSizing.ContentBox);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(105);
    expect(root.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(105);
    expect(root.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_padding_end", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setPadding(Edge.End, 5);
    root.setWidth(100);
    root.setHeight(100);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_content_box_border_start", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setBorder(Edge.Start, 5);
    root.setWidth(100);
    root.setHeight(100);
    root.setBoxSizing(BoxSizing.ContentBox);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(105);
    expect(root.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(105);
    expect(root.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_border_start", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setBorder(Edge.Start, 5);
    root.setWidth(100);
    root.setHeight(100);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_content_box_border_end", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setBorder(Edge.End, 5);
    root.setWidth(100);
    root.setHeight(100);
    root.setBoxSizing(BoxSizing.ContentBox);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(105);
    expect(root.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(105);
    expect(root.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
test("box_sizing_border_box_border_end", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setPositionType(PositionType.Absolute);
    root.setBorder(Edge.End, 5);
    root.setWidth(100);
    root.setHeight(100);
    root.calculateLayout(undefined, undefined, Direction.LTR);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);

    root.calculateLayout(undefined, undefined, Direction.RTL);

    expect(root.getComputedLeft()).toBe(0);
    expect(root.getComputedTop()).toBe(0);
    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(100);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
