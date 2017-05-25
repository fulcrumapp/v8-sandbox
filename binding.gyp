{
  "targets": [
    {
      "target_name": "sandbox",
      "sources": [ "src/addon.cc",
                   "src/timer.cc",
                   "src/sandbox.cc",
                   "src/sandbox-runtime.cc",
                   "src/sandbox-execute-worker.cc",
                   "src/sandbox-terminate-worker.cc",
                   "src/sandbox-wrap.cc" ],
      "include_dirs": [
        "<!(node -e \"require('nan')\")"
			],
      "defines": [
      ],
      'conditions': [
      ]
    }
  ],
}
