// Fix 6: Multi-line @default values should preserve internal indentation

/**
 * @default
 *
 * {
 *   ui: {
 *     developer_mode: true,
 *   },
 * }
 */
const config = {};

/**
 * @default "simple"
 */
const singleLine = "simple";

/**
 * @default
 *
 * [
 *   "foo",
 *   "bar",
 *   "baz",
 * ]
 */
const list = [];
