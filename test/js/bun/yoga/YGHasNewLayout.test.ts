import { expect, test } from "bun:test";
const Yoga = Bun.Yoga;

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

test("new_layout_can_be_marked_seen", () => {
  const root = Yoga.Node.create();
  root.markLayoutSeen();
  expect(root.hasNewLayout()).toBe(false);
});

test("new_layout_calculating_layout_marks_layout_as_unseen", () => {
  const root = Yoga.Node.create();
  root.markLayoutSeen();
  root.calculateLayout(undefined, undefined);
  expect(root.hasNewLayout()).toBe(true);
});

test("new_layout_calculated_layout_can_be_marked_seen", () => {
  const root = Yoga.Node.create();
  root.calculateLayout(undefined, undefined);
  root.markLayoutSeen();
  expect(root.hasNewLayout()).toBe(false);
});

test("new_layout_recalculating_layout_does_mark_as_unseen", () => {
  const root = Yoga.Node.create();
  root.calculateLayout(undefined, undefined);
  root.markLayoutSeen();
  root.calculateLayout(undefined, undefined);
  expect(root.hasNewLayout()).toBe(true);
});

test("new_layout_reset_also_resets_layout_seen", () => {
  const root = Yoga.Node.create();
  root.markLayoutSeen();
  root.reset();
  expect(root.hasNewLayout()).toBe(true);
});

test("new_layout_children_sets_new_layout", () => {
  const root = Yoga.Node.create();
  root.setAlignItems(Yoga.ALIGN_FLEX_START);
  root.setWidth(100);
  root.setHeight(100);

  const root_child0 = Yoga.Node.create();
  root_child0.setAlignItems(Yoga.ALIGN_FLEX_START);
  root_child0.setWidth(50);
  root_child0.setHeight(20);
  root.insertChild(root_child0, 0);

  const root_child1 = Yoga.Node.create();
  root_child1.setAlignItems(Yoga.ALIGN_FLEX_START);
  root_child1.setWidth(50);
  root_child1.setHeight(20);
  root.insertChild(root_child1, 0);

  expect(root.hasNewLayout()).toEqual(true);
  expect(root_child0.hasNewLayout()).toEqual(true);
  expect(root_child1.hasNewLayout()).toEqual(true);

  root.markLayoutSeen();
  root_child0.markLayoutSeen();
  root_child1.markLayoutSeen();

  expect(root.hasNewLayout()).toEqual(false);
  expect(root_child0.hasNewLayout()).toEqual(false);
  expect(root_child1.hasNewLayout()).toEqual(false);

  root_child1.setHeight(30);
  root.calculateLayout(undefined, undefined);

  expect(root.hasNewLayout()).toEqual(true);
  expect(root_child0.hasNewLayout()).toEqual(true);
  expect(root_child1.hasNewLayout()).toEqual(true);
});
