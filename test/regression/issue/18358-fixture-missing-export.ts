// This module intentionally does NOT export 'myExportedFunction'.
// The test verifies that mock.module() prevents the real module from
// being loaded, so the missing export doesn't cause a link error.
export const someOtherExport = "real-value";
