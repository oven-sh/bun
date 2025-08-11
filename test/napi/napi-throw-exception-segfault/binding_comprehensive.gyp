{
  "targets": [
    {
      "target_name": "test_comprehensive",
      "sources": ["test_comprehensive.cpp"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ]
    }
  ]
}