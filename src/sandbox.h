#ifndef __SANDBOX_H__
#define __SANDBOX_H__

#include <map>
#include <nan.h>
#include "baton.h"

#if NODE_MAJOR_VERSION < 9
#error "Node version must be >= 9"
#endif

extern const char *SandboxRuntime;

using namespace v8;

class Sandbox;
class SandboxWrap;

typedef Baton<Sandbox> SandboxBaton;
typedef NodeInvocationBaton<Sandbox> SandboxNodeInvocationBaton;

class Sandbox {
public:
  Sandbox();

  ~Sandbox();

  void Initialize(SandboxWrap *wrap);

  std::string RunInSandbox(const char *code);

  void Finalize();

private:
  static NAN_METHOD(SetResult);

  static NAN_METHOD(DispatchSync);

  static NAN_METHOD(DispatchAsync);

  static NAN_METHOD(SetTimeout);

  static NAN_METHOD(ClearTimeout);

  static NAN_METHOD(HttpRequest);

  static NAN_METHOD(ConsoleLog);

  static NAN_METHOD(ConsoleError);

  static NAN_METHOD(AsyncNodeCallback);

  static void OnStartNodeInvocation(uv_async_t *handle);

  static void OnEndNodeInvocation(uv_async_t *handle);

  static void OnHandleClose(uv_handle_t *handle);

  static void OnCancelPendingOperations(uv_async_t *handle);

  static void OnTimer(uv_timer_t *handle);

  static void OnTimerClose(uv_handle_t *handle);

  void DispatchAsync(const char *name, const char *arguments, Local<Function> callback);

  std::string DispatchSync(const char *name, const char *arguments);

  void Dispose();

  void CancelPendingOperations();

  void RunIsolate(const char *code);

  inline Local<Context> GetContext() {
    return Nan::New(context_);
  }

  Isolate::CreateParams params_;

  Isolate *isolate_;

  Nan::Global<Context> context_;

  Nan::Global<Object> global_;

  std::string result_;

  uv_loop_t *loop_;

  SandboxWrap *wrap_;

  typedef std::map<int, std::shared_ptr<uv_timer_t>> TimerMap;

  typedef std::map<int, std::shared_ptr<SandboxNodeInvocationBaton>> InvocationMap;

  // active timers are ones that are currently running
  TimerMap activeTimers_;

  // all timers, including ones that are still in the process of closing/shutting down
  TimerMap timers_;

  // need to clean up pending operations on abrupt termination
  InvocationMap pendingOperations_;

  node::IsolateData *isolateData_;
};

#endif
