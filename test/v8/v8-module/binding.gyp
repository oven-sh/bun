{
  "targets": [
    {
      "target_name": "v8tests",
      "sources": ["main.cpp"],
      "cflags": [
        "-Wno-deprecated-declarations"
      ],
      "cflags_cc": [
        "-Wno-deprecated-declarations"
      ],
      "xcode_settings": {
        "OTHER_CFLAGS": [
          "-Wno-deprecated-declarations"
        ],
        "OTHER_CPLUSPLUSFLAGS": [
          "-Wno-deprecated-declarations"
        ]
      }
    }
  ]
}
