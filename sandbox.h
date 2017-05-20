#ifndef __SANDBOX_H__
#define __SANDBOX_H__

#include <nan.h>

using namespace v8;

class Sandbox;

struct Baton {
  Baton(Sandbox *sandbox, void *data) {
    sandbox_ = sandbox;
    data_ = data;
  }

  Sandbox *sandbox_;
  void *data_;
};

class Sandbox {
public:
  Sandbox();

  ~Sandbox();

  std::string RunInSandbox(const char *code);

  Isolate *GetIsolate() { return isolate_; }

  Nan::Persistent<Context> *GetContext() { return context_; }

  Nan::Persistent<Object> *GetGlobal() { return global_; }

private:
  static NAN_METHOD(SetResult);

  static NAN_METHOD(SetTimeout);

  void Dispose();

  void RunIsolate(const char *code);

  Isolate::CreateParams params_;

  Isolate *isolate_;

  Locker *locker_;

  Nan::Persistent<Context> *context_;

  Nan::Persistent<Object> *global_;

  std::string result_;

  uv_loop_t *loop_;
};

#endif
