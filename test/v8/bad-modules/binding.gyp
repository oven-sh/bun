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
      "target_name": "initializer_only",
      "sources": ["initializer_only.cpp"],
    },
    {
      "target_name": "registered_other_version",
      "sources": ["registered_other_version.cpp"],
    }
  ],
  "conditions": [
    # Its sockets are those of Linux: accept4() and MSG_NOSIGNAL.
    ["OS=='linux'", {
      "targets": [
        {
          "target_name": "uws_shaped",
          "sources": ["uws_shaped.cpp"],
        },
        # It imports zlib from the host, which opens only with lazy binding, and that is not the default of every compiler.
        {
          "target_name": "uws_shaped_deflate",
          "sources": ["uws_shaped.cpp"],
          "defines": ["DEFLATE_RESPONSE"],
          "ldflags": ["-Wl,-z,lazy"],
        }
      ],
    }],
  ]
}
