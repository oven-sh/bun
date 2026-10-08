foo = 1.0000;<<<PRETTIER_RANGE_START>>>bar = 1.0000;<<<PRETTIER_RANGE_END>>>baz=1.0000;
// The range will be 13~26
// `foo` ends at 13, should not format
// `bar` ends at 26, should format
