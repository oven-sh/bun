{
  "targets": [
    {
      "target_name": "verify_node_behavior",
      "sources": ["verify_node_behavior.cpp"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ]
    }
  ]
}