{
  "targets": [
    {
      "target_name": "test_rapid_throws",
      "sources": ["test_rapid_throws.cpp"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ]
    }
  ]
}