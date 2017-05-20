#ifndef __SANDBOX_H__
#define __SANDBOX_H__

#include <nan.h>

using namespace v8;

class Sandbox {
public:
  Sandbox();

  ~Sandbox();

  std::string RunInSandbox(const char *code);

  NAN_METHOD(SetTimeout);

private:
  Isolate::CreateParams params_;

  Isolate *isolate_;
};

#endif
