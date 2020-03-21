#include "sandbox.h"

using v8::FunctionTemplate;

NAN_MODULE_INIT(Init) {
  Sandbox::Init(target);
}

NODE_MODULE(sandbox, Init)
