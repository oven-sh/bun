// Note: TSC doesn't support string module specifiers yet,
// but it's easier for us to support them than not.
export type * as "ns2" from './mod';
