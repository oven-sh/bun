export type TransformedSource = {
  code: string;
  map?:
    // copied from https://github.com/DefinitelyTyped/DefinitelyTyped/blob/363cdf403a74e0372e87bbcd15eb1668f4c5230b/types/babel__core/index.d.ts#L371-L379
    | {
        version: number;
        sources: string[];
        names: string[];
        sourceRoot?: string;
        sourcesContent?: string[];
        mappings: string;
        file: string;
      }
    | string
    | null;
};

export type TransformedSource2 = {
  code: string,
  map?: // copied from https://github.com/DefinitelyTyped/DefinitelyTyped/blob/363cdf403a74e0372e87bbcd15eb1668f4c5230b/types/babel__core/index.d.ts#L371-L379
  | {
        version: number,
        sources: string[],
        names: string[],
        sourceRoot?: string,
        sourcesContent?: string[],
        mappings: string,
        file: string
      }
    | string
    | null
};
