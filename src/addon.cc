#include "sandbox.h"

static void Init(
  v8::Local<v8::Object> exports,
  v8::Local<v8::Value>,
  v8::Local<v8::Context>,
  void*
) {
  Sandbox::Init(exports);
}

NODE_MODULE_CONTEXT_AWARE(sandbox, Init)
