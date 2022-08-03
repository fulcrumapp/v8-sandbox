#include "sandbox.h"
#include "common.h"

#include <iostream>
#include <memory>
#include <v8.h>
#include <node.h>

// #include <unistd.h>
// void Debug(const char *msg) {
//   std::cout << getpid() << " : " << msg << std::endl;
// }

// void Debug(std::string message) {
//   Debug(message.c_str());
// }

using namespace v8;

Nan::Persistent<v8::Function> Sandbox::constructor;

Sandbox::Sandbox()
  : messageId_(0),
    result_(""),
    buffers_(),
    bytesRead_(-1),
    bytesExpected_(-1),
    socket_(""),
    pipe_(nullptr),
    loop_(nullptr)
{
}

Sandbox::~Sandbox() {
}

void Sandbox::Init(v8::Local<v8::Object> exports) {
  Nan::HandleScope scope;

  v8::Local<v8::FunctionTemplate> tpl = Nan::New<v8::FunctionTemplate>(New);

  tpl->SetClassName(Nan::New("Sandbox").ToLocalChecked());
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  Nan::SetPrototypeMethod(tpl, "initialize", Initialize);
  Nan::SetPrototypeMethod(tpl, "connect", Connect);
  Nan::SetPrototypeMethod(tpl, "disconnect", Disconnect);
  Nan::SetPrototypeMethod(tpl, "execute", Execute);
  Nan::SetPrototypeMethod(tpl, "callback", Callback);
  Nan::SetPrototypeMethod(tpl, "cancel", Cancel);
  Nan::SetPrototypeMethod(tpl, "finish", Finish);

  auto function = Nan::GetFunction(tpl).ToLocalChecked();

  constructor.Reset(function);

  Nan::Set(exports, Nan::New("Sandbox").ToLocalChecked(), function);
}

NAN_METHOD(Sandbox::New) {
  if (info.IsConstructCall()) {
    Sandbox *obj = new Sandbox();
    obj->Wrap(info.This());

    NODE_ARG_STRING(0, "socket");

    Nan::Utf8String socket(info[0]);

    obj->socket_ = *socket;

    info.GetReturnValue().Set(info.This());
  }
  else {
    const int argc = 1;
    v8::Local<v8::Value> argv[argc] = { info[0] };
    v8::Local<v8::Function> cons = Nan::New<v8::Function>(constructor);
    info.GetReturnValue().Set(Nan::NewInstance(cons, argc, argv).ToLocalChecked());
  }
}

NAN_METHOD(Sandbox::Initialize) {
  Sandbox* sandbox = ObjectWrap::Unwrap<Sandbox>(info.Holder());

  sandbox->Initialize();

  info.GetReturnValue().Set(info.This());
}

NAN_METHOD(Sandbox::Connect) {
  Sandbox* sandbox = ObjectWrap::Unwrap<Sandbox>(info.Holder());

  sandbox->Connect();
}

NAN_METHOD(Sandbox::Disconnect) {
  Sandbox* sandbox = ObjectWrap::Unwrap<Sandbox>(info.Holder());

  sandbox->Disconnect();
}

NAN_METHOD(Sandbox::Execute) {
  NODE_ARG_INTEGER(0, "messageId");
  NODE_ARG_STRING(1, "code");

  int messageId = Nan::To<uint32_t>(info[0]).FromJust();
  Nan::Utf8String code(info[1]);

  Sandbox* sandbox = ObjectWrap::Unwrap<Sandbox>(info.Holder());

  sandbox->Execute(messageId, *code);

  info.GetReturnValue().Set(info.This());
}

NAN_METHOD(Sandbox::Callback) {
  NODE_ARG_INTEGER(0, "messageId");
  NODE_ARG_INTEGER(1, "callbackId");
  NODE_ARG_STRING(2, "args");

  Nan::Utf8String args(info[2]);

  Sandbox* sandbox = ObjectWrap::Unwrap<Sandbox>(info.Holder());

  int messageId = Nan::To<uint32_t>(info[0]).FromJust();
  int callbackId = Nan::To<uint32_t>(info[1]).FromJust();

  sandbox->Callback(messageId, callbackId, *args);
}

NAN_METHOD(Sandbox::Cancel) {
  NODE_ARG_INTEGER(0, "messageId");
  NODE_ARG_INTEGER(1, "callbackId");

  int messageId = Nan::To<uint32_t>(info[0]).FromJust();
  int callbackId = Nan::To<uint32_t>(info[1]).FromJust();

  Sandbox* sandbox = ObjectWrap::Unwrap<Sandbox>(info.Holder());

  sandbox->Cancel(messageId, callbackId);
}

NAN_METHOD(Sandbox::Dispatch) {
  NODE_ARG_STRING(0, "name");
  NODE_ARG_STRING(1, "parameters");
  NODE_ARG_FUNCTION_OPTIONAL(2, "callback");

  Nan::Utf8String name(info[0]);
  Nan::Utf8String arguments(info[1]);

  Sandbox* sandbox = GetSandboxFromContext();

  std::string result;

  if (info[2]->IsNull()) {
    result = sandbox->Dispatch(*name, *arguments, nullptr);
  }
  else {
    Local<Function> callback = info[2].As<Function>();

    result = sandbox->Dispatch(*name, *arguments, &callback);
  }

  info.GetReturnValue().Set(Nan::New(result.c_str()).ToLocalChecked());
}

NAN_METHOD(Sandbox::Finish) {
  Sandbox* sandbox = ObjectWrap::Unwrap<Sandbox>(info.Holder());

  sandbox->Finish();

  info.GetReturnValue().Set(info.This());
}

void Sandbox::Initialize() {
  sandboxContext_.Reset(Context::New(Isolate::GetCurrent()));

  auto context = Nan::New(sandboxContext_);

  Context::Scope context_scope(context);

  auto global = context->Global();

  Nan::SetPrivate(global, Nan::New("sandbox").ToLocalChecked(), External::New(Isolate::GetCurrent(), this));
  Nan::Set(global, Nan::New("global").ToLocalChecked(), context->Global());
  Nan::SetMethod(global, "_dispatch", Dispatch);
}

void Sandbox::Connect() {
  if (loop_) {
    return;
  }

  loop_ = (uv_loop_t *)malloc(sizeof(uv_loop_t));

  uv_loop_init(loop_);

  uv_connect_t *request = (uv_connect_t *)malloc(sizeof(uv_connect_t));

  pipe_ = (uv_pipe_t *)malloc(sizeof(uv_pipe_t));

  uv_pipe_init(loop_, pipe_, 0);

  pipe_->data = (void *)this;

  uv_pipe_connect(request, pipe_, socket_.c_str(), OnConnected);

  uv_run(loop_, UV_RUN_DEFAULT);
}

void Sandbox::Disconnect() {
  if (!loop_) {
    return;
  }

  uv_close((uv_handle_t *)pipe_, nullptr);

  uv_loop_close(loop_);

  free(pipe_);
  free(loop_);

  loop_ = nullptr;
  pipe_ = nullptr;
}

void Sandbox::Execute(int messageId, const char *code) {
  assert(messageId_ == 0 || messageId_ == messageId);

  messageId_ = messageId;

  auto context = Nan::New(sandboxContext_);

  Context::Scope context_scope(context);

  Nan::TryCatch tryCatch;

  ScriptOrigin origin(Isolate::GetCurrent(), Nan::New("script").ToLocalChecked());

  Isolate::GetCurrent()->SetPrepareStackTraceCallback(nullptr);

  MaybeLocal<Script> script = Script::Compile(context, Nan::New(code).ToLocalChecked(), &origin);

  if (!tryCatch.HasCaught()) {
    (void)script.ToLocalChecked()->Run(context);
  }

  MaybeHandleError(tryCatch, context);

  Isolate::GetCurrent()->SetPrepareStackTraceCallback(node::PrepareStackTraceCallback);
}

void Sandbox::Callback(int messageId, int callbackId, const char *args) {
  assert(messageId_ == 0 || messageId_ == messageId);
  assert(callbackId > 0);
  assert(pendingOperations_[callbackId]);

  messageId_ = messageId;

  auto operation = pendingOperations_[callbackId];

  auto context = Nan::New(sandboxContext_);

  auto global = context->Global();

  Context::Scope context_scope(context);

  Nan::TryCatch tryCatch;

  Local<Function> callback = Nan::New(operation->callback->As<Function>());

  Isolate::GetCurrent()->SetPrepareStackTraceCallback(nullptr);

  if (callback->IsFunction()) {
    v8::Local<v8::Value> argv[] = {
      Nan::New(args).ToLocalChecked()
    };

    Nan::Call(callback, global, 1, argv);
  }

  pendingOperations_.erase(callbackId);

  MaybeHandleError(tryCatch, context);

  Isolate::GetCurrent()->SetPrepareStackTraceCallback(node::PrepareStackTraceCallback);
}

void Sandbox::Cancel(int messageId, int callbackId) {
  assert(messageId_ == 0 || messageId_ == messageId);
  assert(callbackId > 0);
  assert(pendingOperations_[callbackId]);

  messageId_ = messageId;

  pendingOperations_.erase(callbackId);
}

std::string Sandbox::Dispatch(const char *name, const char *arguments, Local<Function> *callback) {
  int callbackId = 0;

  if (callback) {
    auto cb = std::make_shared<Nan::Persistent<Function>>(*callback);
    auto operation = std::make_shared<AsyncOperation>(this, cb);

    callbackId = operation->id;

    pendingOperations_[operation->id] = operation;
  }

  bytesRead_ = -1;
  bytesExpected_ = -1;

  buffers_.clear();
  result_.clear();

  std::string message(arguments);

  WriteData((uv_stream_t *)pipe_, messageId_, callbackId, message);

  uv_run(loop_, UV_RUN_DEFAULT);

  return result_;
}

void Sandbox::Finish() {
  if (pendingOperations_.size() > 0) {
    return;
  }

  std::string invocation(
    std::string("{\"name\":\"finish\",\"args\":[") + std::to_string(messageId_) + std::string("]}")
  );

  Dispatch("finish", invocation.c_str(), nullptr);

  messageId_ = 0;
}

void Sandbox::SetResult(Local<Context> &context, Local<Object> result) {
  auto invocation = Nan::New<Object>();
  auto arguments = Nan::New<Array>();

  Nan::Set(arguments, 0, result);

  Nan::Set(invocation, Nan::New("name").ToLocalChecked(), Nan::New("setResult").ToLocalChecked());
  Nan::Set(invocation, Nan::New("args").ToLocalChecked(), arguments);

  auto json = JSON::Stringify(context, invocation).ToLocalChecked();

  std::string args = *Nan::Utf8String(json);

  Dispatch("setResult", args.c_str(), nullptr);
}

void Sandbox::MaybeHandleError(Nan::TryCatch &tryCatch, Local<Context> &context) {
  if (!tryCatch.HasCaught()) {
    return;
  }

  auto result = Nan::New<Object>();
  auto error = Nan::New<Object>();

  auto exception = tryCatch.Exception();

  Nan::Utf8String message(tryCatch.Message()->Get());
  Nan::Utf8String sourceLine(tryCatch.Message()->GetSourceLine(context).ToLocalChecked());

  int lineNumber = tryCatch.Message()->GetLineNumber(context).FromJust();
  int startColumn = tryCatch.Message()->GetStartColumn(context).FromJust();
  int endColumn = tryCatch.Message()->GetEndColumn(context).FromJust();
  int startPosition = tryCatch.Message()->GetStartPosition();
  int endPosition = tryCatch.Message()->GetEndPosition();

  Nan::Set(result, Nan::New("error").ToLocalChecked(), error);

  if (!tryCatch.StackTrace().IsEmpty()) {
    Nan::Set(error, Nan::New("stack").ToLocalChecked(), tryCatch.StackTrace().ToLocalChecked());
  }
  else {
    Nan::Set(error, Nan::New("stack").ToLocalChecked(), Nan::New("").ToLocalChecked());
  }

  Nan::Set(error, Nan::New("exception").ToLocalChecked(), exception);
  Nan::Set(error, Nan::New("message").ToLocalChecked(), Nan::New(*message).ToLocalChecked());
  Nan::Set(error, Nan::New("lineNumber").ToLocalChecked(), Nan::New(lineNumber));
  Nan::Set(error, Nan::New("startColumn").ToLocalChecked(), Nan::New(startColumn));
  Nan::Set(error, Nan::New("endColumn").ToLocalChecked(), Nan::New(endColumn));
  Nan::Set(error, Nan::New("startPosition").ToLocalChecked(), Nan::New(startPosition));
  Nan::Set(error, Nan::New("endPosition").ToLocalChecked(), Nan::New(endPosition));
  Nan::Set(error, Nan::New("sourceLine").ToLocalChecked(), Nan::New(*sourceLine).ToLocalChecked());

  SetResult(context, result);
}

Sandbox *Sandbox::GetSandboxFromContext() {
  auto context = Isolate::GetCurrent()->GetCurrentContext();

  auto hidden = Nan::GetPrivate(context->Global(), Nan::New("sandbox").ToLocalChecked());

  if (hidden.IsEmpty()) {
    return nullptr;
  }

  Local<External> field = Local<External>::Cast(hidden.ToLocalChecked());

  Sandbox *sandbox = (Sandbox *)field->Value();

  return sandbox;
}

void Sandbox::AllocateBuffer(uv_handle_t *handle, size_t size, uv_buf_t *buffer) {
  buffer->base = (char *)malloc(size);
  buffer->len = size;
}

void Sandbox::OnConnected(uv_connect_t *request, int status) {
  free(request);

  if (status != 0) {
    std::cout << " OnConnected failed, status: " << status << " : " << uv_strerror(status) << std::endl;
  }

  assert(status == 0);
}

void Sandbox::OnRead(uv_stream_t *pipe, ssize_t bytesRead, const uv_buf_t *buffer) {
  Sandbox *sandbox = (Sandbox *)pipe->data;

  if (bytesRead > 0) {
    char *chunk = (char *)buffer->base;
    int chunkLength = bytesRead;

    if (sandbox->bytesExpected_ == -1) {
      sandbox->bytesExpected_ = ntohl(((int32_t *)chunk)[0]);
      sandbox->bytesRead_ = 0;
      sandbox->result_ = "";

      chunk += sizeof(sandbox->bytesExpected_);
      chunkLength -= sizeof(sandbox->bytesExpected_);
    }

    std::string chunkString(chunk, chunkLength);

    sandbox->buffers_.push_back(chunkString);
    sandbox->bytesRead_ += chunkLength;

    if (sandbox->bytesRead_ == sandbox->bytesExpected_) {
      for (const auto &chunk : sandbox->buffers_) {
        sandbox->result_ += chunk;
      }

      uv_read_stop(pipe);
    }
  }
  else if (bytesRead < 0) {
    uv_close((uv_handle_t *)pipe, OnClose);
  }

  free(buffer->base);
}

void Sandbox::OnClose(uv_handle_t *pipe) {
  free(pipe);
}

void Sandbox::WriteData(uv_stream_t *pipe, int messageId, int callbackId, std::string &message) {
  uv_write_t *write = (uv_write_t *)malloc(sizeof(uv_write_t));

  size_t messageLength = message.length();

  size_t bufferLength = sizeof(int32_t) + sizeof(int32_t) + sizeof(int32_t) + messageLength;

  char *data = (char *)malloc(bufferLength);

  uint32_t *base = (uint32_t *)data;

  base[0] = htonl(messageId);
  base[1] = htonl(callbackId);
  base[2] = htonl(messageLength);

  memcpy(&base[3], message.c_str(), messageLength);

  uv_buf_t buffers[] = {
    { .base = data, .len = bufferLength }
  };

  write->data = data;

  uv_write(write, pipe, buffers, 1, OnWriteComplete);

  uv_read_start((uv_stream_t *)pipe, AllocateBuffer, OnRead);
}

void Sandbox::OnWriteComplete(uv_write_t *request, int status) {
  if (status != 0) {
    std::cout << " OnWriteComplete failed, status: " << status << " : " << uv_strerror(status) << " : " << (char *)request->data << std::endl;
  }

  assert(status == 0);

  free(request->data);
  free(request);
}
