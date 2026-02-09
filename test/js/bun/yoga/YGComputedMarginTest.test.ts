import { expect, test } from "bun:test";
const Yoga = Bun.Yoga;

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

test("margin_start", () => {
  const root = Yoga.Node.create();
  try {
    root.setWidth(100);
    root.setHeight(100);
    root.setMargin(Yoga.EDGE_START, `10%`);

    root.calculateLayout(100, 100, Yoga.DIRECTION_LTR);

    expect(root.getComputedMargin(Yoga.EDGE_LEFT)).toBe(10);
    expect(root.getComputedMargin(Yoga.EDGE_RIGHT)).toBe(0);

    root.calculateLayout(100, 100, Yoga.DIRECTION_RTL);

    expect(root.getComputedMargin(Yoga.EDGE_LEFT)).toBe(0);
    expect(root.getComputedMargin(Yoga.EDGE_RIGHT)).toBe(10);
  } finally {
    root.freeRecursive();
  }
});
