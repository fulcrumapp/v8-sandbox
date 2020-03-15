#ifndef __SANDBOX_WRAP_H__
#define __SANDBOX_WRAP_H__

#include <nan.h>
#include <vector>
#include <map>
#include "baton.h"
// #include "sandbox.h"

using namespace v8;

class SandboxWrap;

typedef AsyncOperationBaton<SandboxWrap> AsyncSandboxOperationBaton;

class SandboxWrap : public Nan::ObjectWrap {
public:
  static void Init(v8::Local<v8::Object> exports);

private:
  explicit SandboxWrap();

  ~SandboxWrap();

  static NAN_METHOD(New);

  static NAN_METHOD(Connect);

  static NAN_METHOD(Disconnect);

  static NAN_METHOD(Execute);

  static NAN_METHOD(SetResult);

  static NAN_METHOD(Callback);

  static NAN_METHOD(DispatchSync);

  static NAN_METHOD(DispatchAsync);

  static NAN_METHOD(DebugLog);

  void Initialize(const char *runtime);

  void Dispose();

  void Execute(const char *code);

  void Callback(int id, const char *args);

  void MaybeHandleError(Nan::TryCatch &tryCatch, Local<Context> &context);

  std::string DispatchSync(const char *arguments);

  std::string DispatchAsync(int id, const char *arguments, Local<Function> callback);

  static SandboxWrap *GetSandboxFromContext();

  Nan::Callback *callback_;

  Nan::Global<Context> nodeContext_;

  Nan::Global<Context> sandboxContext_;

  Nan::Global<Object> sandboxGlobal_;

  std::string result_;

  std::string dispatchResult_;

  std::vector<std::string> buffers_;

  int32_t bytesRead_;

  int32_t bytesExpected_;

  std::string message_;

  std::string socket_;

  uv_pipe_t *pipe_;

  uv_loop_t *loop_;

  static Nan::Persistent<v8::Function> constructor;

  static void AllocateBuffer(uv_handle_t *handle, size_t size, uv_buf_t *buffer);

  static void OnConnected(uv_connect_t *request, int status);

  static void OnRead(uv_stream_t *pipe, ssize_t bytesRead, const uv_buf_t *buffer);

  static void OnClose(uv_handle_t *pipe);

  static void WriteData(uv_stream_t *pipe, std::string &message);

  static void OnWriteComplete(uv_write_t *request, int status);

  typedef std::map<int, std::shared_ptr<AsyncSandboxOperationBaton>> AsyncOperationMap;

  AsyncOperationMap pendingOperations_;
};

#endif
