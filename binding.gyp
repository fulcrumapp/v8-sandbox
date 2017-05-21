{
  "targets": [
    {
      "target_name": "sandbox",
      "sources": [ "addon.cc",
                   "sandbox.cc",
                   "sandbox-runtime.cc",
                   "sandbox-worker.cc",
                   "sandbox-wrap.cc" ],
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
