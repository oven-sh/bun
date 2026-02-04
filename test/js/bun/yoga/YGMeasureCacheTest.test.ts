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

type MeasureCounter = {
  inc: (width: number, widthMode: number, height: number, heightMode: number) => {width?: number; height?: number};
  get: () => number;
};

function getMeasureCounter(
  cb?: ((width: number, widthMode: number, height: number, heightMode: number) => {width?: number; height?: number}) | null,
  staticWidth = 0,
  staticHeight = 0,
): MeasureCounter {
  let counter = 0;

  return {
    inc: function (width: number, widthMode: number, height: number, heightMode: number) {
      counter += 1;

      return cb
        ? cb(width, widthMode, height, heightMode)
        : {width: staticWidth, height: staticHeight};
    },

    get: function () {
      return counter;
    },
  };
}

function getMeasureCounterMax(): MeasureCounter {
  return getMeasureCounter((width, widthMode, height, heightMode) => {
    const measuredWidth =
      widthMode === Yoga.MEASURE_MODE_UNDEFINED ? 10 : width;
    const measuredHeight =
      heightMode === Yoga.MEASURE_MODE_UNDEFINED ? 10 : height;

    return {width: measuredWidth, height: measuredHeight};
  });
}

function getMeasureCounterMin(): MeasureCounter {
  return getMeasureCounter((width, widthMode, height, heightMode) => {
    const measuredWidth =
      widthMode === Yoga.MEASURE_MODE_UNDEFINED ||
      (widthMode == Yoga.MEASURE_MODE_AT_MOST && width > 10)
        ? 10
        : width;
    const measuredHeight =
      heightMode === Yoga.MEASURE_MODE_UNDEFINED ||
      (heightMode == Yoga.MEASURE_MODE_AT_MOST && height > 10)
        ? 10
        : height;

    return {width: measuredWidth, height: measuredHeight};
  });
}

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */



test('measure_once_single_flexible_child', () => {
  const root = Yoga.Node.create();
  root.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
  root.setAlignItems(Yoga.ALIGN_FLEX_START);
  root.setWidth(100);
  root.setHeight(100);

  const measureCounter = getMeasureCounterMax();

  const root_child0 = Yoga.Node.create();
  root_child0.setMeasureFunc(measureCounter.inc);
  root_child0.setFlexGrow(1);
  root.insertChild(root_child0, 0);

  root.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);

  expect(measureCounter.get()).toBe(1);

  root.freeRecursive();
});
