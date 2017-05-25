echo 'const char *SandboxRuntime = R"JSRUNTIME(\n(function() {' > src/sandbox-runtime.cc
cat lib/runtime.js >> src/sandbox-runtime.cc
echo '})();\n)JSRUNTIME";' >> src/sandbox-runtime.cc

