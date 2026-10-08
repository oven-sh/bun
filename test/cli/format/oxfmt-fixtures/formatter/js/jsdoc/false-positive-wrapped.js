/**
 * spacing = (max - min) / count Ticks are generated as [min, min
 * + spacing, ..., max] setting is respected in this scenario.
 */
const a = 1;

/**
 * where each value is a relative width to the scale and ranges between 0 and
 * 1. They add extra margins on both sides by scaling down the original scale.
 */
const b = 2;

/**
 * This function calculates Bezier control points in a similar way than
 * |splineCurve|, but preserves monotonicity of the provided data and ensures no
 * local extremums are added between the dataset discrete points.
 */
const c = 3;
