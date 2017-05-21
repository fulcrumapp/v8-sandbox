echo 'const char *SandboxRuntime = R"JSRUNTIME(\n(function() {' > sandbox-runtime.cc
cat src/runtime.js >> sandbox-runtime.cc
echo '})();\n)JSRUNTIME";' >> sandbox-runtime.cc

