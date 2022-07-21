#ifndef __SANDBOX_WRAP_H__
#define __SANDBOX_WRAP_H__

#include <nan.h>
#include <vector>
#include <map>
#include "baton.h"

using namespace v8;

class Sandbox;

typedef Baton<Sandbox> AsyncOperation;

class Sandbox : public Nan::ObjectWrap {
public:
  static void Init(v8::Local<v8::Object> exports);

private:
  explicit Sandbox();

  ~Sandbox();

  static NAN_METHOD(New);

  static NAN_METHOD(Initialize);

  static NAN_METHOD(Connect);

  static NAN_METHOD(Disconnect);

  static NAN_METHOD(Execute);

  static NAN_METHOD(Callback);

  static NAN_METHOD(Cancel);

  static NAN_METHOD(Dispatch);

  static NAN_METHOD(Finish);

  void Initialize();

  void Connect();

  void Disconnect();

  void Execute(const char *code);

  void Callback(int id, const char *args);

  void Cancel(int id);

  std::string Dispatch(const char *name, const char *arguments, Local<Function> *callback);

  void Finish();

  void SetResult(Local<Context> &context, Local<Object> result);

  void MaybeHandleError(Nan::TryCatch &tryCatch, Local<Context> &context);

  static Sandbox *GetSandboxFromContext();

  Nan::Global<Context> sandboxContext_;

  std::string result_;

  std::vector<std::string> buffers_;

  int32_t bytesRead_;

  int32_t bytesExpected_;

  std::string socket_;

  uv_pipe_t *pipe_;

  uv_loop_t *loop_;

  std::map<int, std::shared_ptr<AsyncOperation>> pendingOperations_;

  static Nan::Persistent<v8::Function> constructor;

  static void AllocateBuffer(uv_handle_t *handle, size_t size, uv_buf_t *buffer);

  static void OnConnected(uv_connect_t *request, int status);

  static void OnRead(uv_stream_t *pipe, ssize_t bytesRead, const uv_buf_t *buffer);

  static void OnClose(uv_handle_t *pipe);

  static void WriteData(uv_stream_t *pipe, int id, std::string &message);

  static void OnWriteComplete(uv_write_t *request, int status);
};

#endif
