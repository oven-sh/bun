import { expect, test } from "bun:test";
const Yoga = Bun.Yoga;

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

test("align_baseline_parent_using_child_in_column_as_reference", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    root.setWidth(1000);
    root.setHeight(1000);
    root.setAlignItems(Yoga.ALIGN_BASELINE);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
    root_child0.setWidth(500);
    root_child0.setHeight(600);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
    root_child1.setWidth(500);
    root_child1.setHeight(800);
    root.insertChild(root_child1, 1);

    const root_child1_child0 = Yoga.Node.create(config);
    root_child1_child0.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
    root_child1_child0.setWidth(500);
    root_child1_child0.setHeight(300);
    root_child1.insertChild(root_child1_child0, 0);

    const root_child1_child1 = Yoga.Node.create(config);
    root_child1_child1.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
    root_child1_child1.setWidth(500);
    root_child1_child1.setHeight(400);
    root_child1_child1.setIsReferenceBaseline(true);
    root_child1.insertChild(root_child1_child1, 1);

    root.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(100);

    expect(root_child1.getComputedLeft()).toBe(500);
    expect(root_child1.getComputedTop()).toBe(0);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);

    expect(root_child1_child1.getComputedLeft()).toBe(0);
    expect(root_child1_child1.getComputedTop()).toBe(300);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});

test("align_baseline_parent_using_child_in_row_as_reference", () => {
  const config = Yoga.Config.create();
  let root;

  try {
    root = Yoga.Node.create(config);
    root.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    root.setWidth(1000);
    root.setHeight(1000);
    root.setAlignItems(Yoga.ALIGN_BASELINE);

    const root_child0 = Yoga.Node.create(config);
    root_child0.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
    root_child0.setWidth(500);
    root_child0.setHeight(600);
    root.insertChild(root_child0, 0);

    const root_child1 = Yoga.Node.create(config);
    root_child1.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);
    root_child1.setWidth(500);
    root_child1.setHeight(800);
    root.insertChild(root_child1, 1);

    const root_child1_child0 = Yoga.Node.create(config);
    root_child1_child0.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
    root_child1_child0.setWidth(500);
    root_child1_child0.setHeight(500);
    root_child1.insertChild(root_child1_child0, 0);

    const root_child1_child1 = Yoga.Node.create(config);
    root_child1_child1.setFlexDirection(Yoga.FLEX_DIRECTION_COLUMN);
    root_child1_child1.setWidth(500);
    root_child1_child1.setHeight(400);
    root_child1_child1.setIsReferenceBaseline(true);
    root_child1.insertChild(root_child1_child1, 1);

    root.calculateLayout(undefined, undefined, Yoga.DIRECTION_LTR);

    expect(root_child0.getComputedLeft()).toBe(0);
    expect(root_child0.getComputedTop()).toBe(0);

    expect(root_child1.getComputedLeft()).toBe(500);
    expect(root_child1.getComputedTop()).toBe(200);

    expect(root_child1_child0.getComputedLeft()).toBe(0);
    expect(root_child1_child0.getComputedTop()).toBe(0);

    expect(root_child1_child1.getComputedLeft()).toBe(500);
    expect(root_child1_child1.getComputedTop()).toBe(0);
  } finally {
    if (typeof root !== "undefined") {
      root.freeRecursive();
    }

    config.free();
  }
});
