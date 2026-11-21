#ifndef __SANDBOX_WRAP_H__
#define __SANDBOX_WRAP_H__

#include <map>
#include <memory>
#include <string>
#include <vector>
#include <node.h>
#include <node_object_wrap.h>
#include <uv.h>
#include <v8.h>
#include "baton.h"

class Sandbox;

typedef Baton<Sandbox> AsyncOperation;

class Sandbox : public node::ObjectWrap {
public:
  static void Init(v8::Local<v8::Object> exports);

private:
  explicit Sandbox();

  ~Sandbox();

  static void New(const v8::FunctionCallbackInfo<v8::Value>& info);

  static void Initialize(const v8::FunctionCallbackInfo<v8::Value>& info);

  static void Connect(const v8::FunctionCallbackInfo<v8::Value>& info);

  static void Disconnect(const v8::FunctionCallbackInfo<v8::Value>& info);

  static void Execute(const v8::FunctionCallbackInfo<v8::Value>& info);

  static void Callback(const v8::FunctionCallbackInfo<v8::Value>& info);

  static void Cancel(const v8::FunctionCallbackInfo<v8::Value>& info);

  static void Dispatch(const v8::FunctionCallbackInfo<v8::Value>& info);

  static void Finish(const v8::FunctionCallbackInfo<v8::Value>& info);

  void Initialize(v8::Isolate* isolate);

  void Connect();

  void Disconnect();

  void Execute(v8::Isolate* isolate, int messageId, const char *code);

  void Callback(v8::Isolate* isolate, int messageId, int callbackId, const char *args);

  void Cancel(int messageId, int callbackId);

  std::string Dispatch(v8::Isolate* isolate, const char *name, const char *arguments, v8::Local<v8::Function> *callback);

  void Finish(v8::Isolate* isolate);

  bool IsActiveContext(v8::Isolate* isolate, v8::Local<v8::Context> context) const;

  void SetResult(v8::Isolate* isolate, v8::Local<v8::Context> &context, v8::Local<v8::Object> result);

  void MaybeHandleError(v8::Isolate* isolate, v8::TryCatch &tryCatch, v8::Local<v8::Context> &context);

  static v8::MaybeLocal<v8::Value> PrepareStackTrace(
    v8::Local<v8::Context> context,
    v8::Local<v8::Value> error,
    v8::Local<v8::Array> sites);

  static Sandbox *GetSandboxFromContext(v8::Isolate* isolate);

  v8::Global<v8::Context> sandboxContext_;

  int messageId_;

  std::string result_;

  std::string readBuffer_;

  bool hasExpected_;

  uint32_t bytesExpected_;

  std::string socket_;

  uv_pipe_t *pipe_;

  uv_loop_t *loop_;

  std::map<int, std::shared_ptr<AsyncOperation>> pendingOperations_;

  static v8::Global<v8::Function> constructor;

  static void AllocateBuffer(uv_handle_t *handle, size_t size, uv_buf_t *buffer);

  static void OnConnected(uv_connect_t *request, int status);

  static void OnRead(uv_stream_t *pipe, ssize_t bytesRead, const uv_buf_t *buffer);

  static void OnClose(uv_handle_t *pipe);

  static void WriteData(uv_stream_t *pipe, int messageId, int callbackId, std::string &message);

  static void OnWriteComplete(uv_write_t *request, int status);
};

#endif
