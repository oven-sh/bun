import { expect, test } from "bun:test";
const Yoga = Bun.Yoga;

/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

test("flex_basis_auto", () => {
  const root = Yoga.Node.create();

  expect(root.getFlexBasis().unit).toBe(Yoga.UNIT_AUTO);

  root.setFlexBasis(10);
  expect(root.getFlexBasis().unit).toBe(Yoga.UNIT_POINT);
  expect(root.getFlexBasis().value).toBe(10);

  root.setFlexBasisAuto();
  expect(root.getFlexBasis().unit).toBe(Yoga.UNIT_AUTO);

  root.freeRecursive();
});
