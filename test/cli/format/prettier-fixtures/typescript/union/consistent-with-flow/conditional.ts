// https://github.com/excalidraw/excalidraw/blob/f12ae80ba1e1364952c6c6c440ac4212acd06eab/packages/excalidraw/tests/helpers/api.ts#L208C1-L210C15
type A = T extends "arrow"
    ? ExcalidrawArrowElement["startBinding"] | ExcalidrawElbowArrowElement["startBinding"]
    : never;
