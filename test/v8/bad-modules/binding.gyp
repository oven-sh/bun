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
    }
  ],
  "conditions": [
    # Its sockets are those of Linux: accept4() and MSG_NOSIGNAL.
    ["OS=='linux'", {
      "targets": [
        {
          "target_name": "uws_shaped",
          "sources": ["uws_shaped.cpp"],
        }
      ],
    }],
  ]
}
