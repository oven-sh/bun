/**
 * The |splineCurve| option controls curve interpolation.
 */
const a = 1;

/**
 * | Name | Value |
 * | ---- | ----- |
 * | foo  | 1     |
 */
const b = 2;

/**
 * This function calculates Bézier control points in a similar way than
 * |splineCurve|, but preserves monotonicity of the provided data and ensures no
 * local extremums are added between the dataset discrete points due to the
 * interpolation.
 */
const c = 3;
