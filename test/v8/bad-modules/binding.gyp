{
  "targets": [
    {
      "target_name": "mismatched_abi_version",
      "sources": ["mismatched_abi_version.cpp"],
    },
    {
      "target_name": "no_entrypoint",
      "sources": ["no_entrypoint.cpp"],
    },
    {
      "target_name": "no_registration",
      "sources": ["no_registration.cpp"],
    },
    {
      "target_name": "initializer_only",
      "sources": ["initializer_only.cpp"],
    }
  ],
  "conditions": [
    # These import functions that nothing defines, which only a lazily bound ELF library can do and still be opened.
    ["OS=='linux'", {
      "targets": [
        {
          "target_name": "initializer_missing_import",
          "sources": ["initializer_missing_import.cpp"],
          "ldflags": ["-Wl,-z,lazy"],
        },
        {
          "target_name": "initializer_zlib",
          "sources": ["initializer_zlib.cpp"],
          "ldflags": ["-Wl,-z,lazy"],
        }
      ],
    }],
  ],
}
