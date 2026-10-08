export type IntersectionType =
  & FirstPart
  // Presence of comment makes this non-idempotent
  & {
    an: string,
    object: string,
    type: string,
  }


export type IntersectionType =
  & FirstPart
  // Comment Line 1
  // Comment Line 2
  & {
    an: string,
    object: string,
    type: string,
  }

export type IntersectionType =
  | FirstPart
  // Presence of comment is not a problem
  | {
      an: string;
      object: string;
      type: string;
    };

export type IntersectionType =
  | FirstPart
  // Comment Line 1
  // Comment Line 2
  | {
      an: string;
      object: string;
      type: string;
    };
