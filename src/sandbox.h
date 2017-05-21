#ifndef __SANDBOX_H__
#define __SANDBOX_H__

#include <nan.h>

extern const char *SandboxRuntime;

using namespace v8;

class Sandbox;
class SandboxWrap;

struct Baton {
  Baton(Sandbox *sandbox, void *data) {
    sandbox_ = sandbox;
    data_ = data;
  }

  Sandbox *sandbox_;
  void *data_;
};

struct AsyncCallBaton {
  Sandbox *sandbox;
  uv_async_t *sandboxAsync;
  uv_mutex_t *mutex;
  uv_cond_t *condition;
  void *sandboxCallback;
  std::string name;
  std::string sandboxArguments;
  std::string sandboxResult;
};

class Sandbox {
public:
  Sandbox();

  ~Sandbox();

  std::string RunInSandbox(const char *code, SandboxWrap *wrap);

  Isolate *GetIsolate() { return isolate_; }

  Nan::Persistent<Context> *GetContext() { return context_; }

  Nan::Persistent<Object> *GetGlobal() { return global_; }

  SandboxWrap *GetWrap() { return wrap_; }

private:
  static NAN_METHOD(SetResult);

  static NAN_METHOD(SetTimeout);

  static NAN_METHOD(HttpRequest);

  static NAN_METHOD(ConsoleLog);

  static NAN_METHOD(ConsoleError);

  static NAN_METHOD(AsyncNodeCallback);

  static void OnStartNodeInvocation(uv_async_t *handle);

  static void OnEndNodeInvocation(uv_async_t *handle);

  static void OnHandleClose(uv_handle_t *handle);

  void DispatchAsync(const char *name, const char *arguments, Local<Function> callback);

  std::string DispatchSync(const char *name, const char *arguments);

  void Dispose();

  void RunIsolate(const char *code);

  Isolate::CreateParams params_;

  Isolate *isolate_;

  Locker *locker_;

  Nan::Persistent<Context> *context_;

  Nan::Persistent<Object> *global_;

  std::string result_;

  uv_loop_t *loop_;

  SandboxWrap *wrap_;
};

#endif
