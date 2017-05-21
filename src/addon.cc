#include "sandbox-wrap.h"

using v8::FunctionTemplate;

NAN_MODULE_INIT(Init) {
  SandboxWrap::Init(target);
}

NODE_MODULE(sandbox, Init)
