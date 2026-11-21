#include "sandbox.h"
#include "common.h"

#include <cassert>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <memory>

#ifdef _WIN32
#include <winsock2.h>
#else
#include <arpa/inet.h>
#endif

using namespace v8;

namespace {

inline Local<String> NewUtf8String(Isolate* isolate, const char* value) {
  return String::NewFromUtf8(isolate, value).ToLocalChecked();
}

inline Local<String> NewUtf8String(Isolate* isolate, const std::string& value) {
  return String::NewFromUtf8(isolate, value.c_str(), NewStringType::kNormal, static_cast<int>(value.size())).ToLocalChecked();
}

inline Local<Private> SandboxPrivateKey(Isolate* isolate) {
  return Private::ForApi(isolate, NewUtf8String(isolate, "sandbox"));
}

}  // namespace

Global<Function> Sandbox::constructor;

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

void Sandbox::Init(Local<Object> exports) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);
  Local<Context> context = isolate->GetCurrentContext();

  Local<FunctionTemplate> tpl = FunctionTemplate::New(isolate, New);

  tpl->SetClassName(NewUtf8String(isolate, "Sandbox"));
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  NODE_SET_PROTOTYPE_METHOD(tpl, "initialize", Initialize);
  NODE_SET_PROTOTYPE_METHOD(tpl, "connect", Connect);
  NODE_SET_PROTOTYPE_METHOD(tpl, "disconnect", Disconnect);
  NODE_SET_PROTOTYPE_METHOD(tpl, "execute", Execute);
  NODE_SET_PROTOTYPE_METHOD(tpl, "callback", Callback);
  NODE_SET_PROTOTYPE_METHOD(tpl, "cancel", Cancel);
  NODE_SET_PROTOTYPE_METHOD(tpl, "finish", Finish);

  Local<Function> function = tpl->GetFunction(context).ToLocalChecked();

  constructor.Reset(isolate, function);

  exports->Set(context, NewUtf8String(isolate, "Sandbox"), function).Check();
}

void Sandbox::New(const FunctionCallbackInfo<Value>& info) {
  Isolate* isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (info.IsConstructCall()) {
    NODE_ARG_STRING(0, "socket");

    Sandbox *obj = new Sandbox();
    obj->Wrap(info.This());

    String::Utf8Value socket(isolate, info[0]);

    obj->socket_ = *socket;

    info.GetReturnValue().Set(info.This());
  }
  else {
    const int argc = 1;
    Local<Value> argv[argc] = { info[0] };
    Local<Function> cons = Local<Function>::New(isolate, constructor);
    info.GetReturnValue().Set(cons->NewInstance(context, argc, argv).ToLocalChecked());
  }
}

void Sandbox::Initialize(const FunctionCallbackInfo<Value>& info) {
  Sandbox* sandbox = ObjectWrap::Unwrap<Sandbox>(info.This());

  sandbox->Initialize(info.GetIsolate());

  info.GetReturnValue().Set(info.This());
}

void Sandbox::Connect(const FunctionCallbackInfo<Value>& info) {
  Sandbox* sandbox = ObjectWrap::Unwrap<Sandbox>(info.This());

  sandbox->Connect();
}

void Sandbox::Disconnect(const FunctionCallbackInfo<Value>& info) {
  Sandbox* sandbox = ObjectWrap::Unwrap<Sandbox>(info.This());

  sandbox->Disconnect();
}

void Sandbox::Execute(const FunctionCallbackInfo<Value>& info) {
  NODE_ARG_INTEGER(0, "messageId");
  NODE_ARG_STRING(1, "code");

  Isolate* isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  int messageId = info[0]->Uint32Value(context).FromJust();
  String::Utf8Value code(isolate, info[1]);

  Sandbox* sandbox = ObjectWrap::Unwrap<Sandbox>(info.This());

  sandbox->Execute(isolate, messageId, *code);

  info.GetReturnValue().Set(info.This());
}

void Sandbox::Callback(const FunctionCallbackInfo<Value>& info) {
  NODE_ARG_INTEGER(0, "messageId");
  NODE_ARG_INTEGER(1, "callbackId");
  NODE_ARG_STRING(2, "args");

  Isolate* isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  String::Utf8Value args(isolate, info[2]);

  Sandbox* sandbox = ObjectWrap::Unwrap<Sandbox>(info.This());

  int messageId = info[0]->Uint32Value(context).FromJust();
  int callbackId = info[1]->Uint32Value(context).FromJust();

  sandbox->Callback(isolate, messageId, callbackId, *args);
}

void Sandbox::Cancel(const FunctionCallbackInfo<Value>& info) {
  NODE_ARG_INTEGER(0, "messageId");
  NODE_ARG_INTEGER(1, "callbackId");

  Isolate* isolate = info.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  int messageId = info[0]->Uint32Value(context).FromJust();
  int callbackId = info[1]->Uint32Value(context).FromJust();

  Sandbox* sandbox = ObjectWrap::Unwrap<Sandbox>(info.This());

  sandbox->Cancel(messageId, callbackId);
}

void Sandbox::Dispatch(const FunctionCallbackInfo<Value>& info) {
  NODE_ARG_STRING(0, "name");
  NODE_ARG_STRING(1, "parameters");
  NODE_ARG_FUNCTION_OPTIONAL(2, "callback");

  Isolate* isolate = info.GetIsolate();

  String::Utf8Value name(isolate, info[0]);
  String::Utf8Value arguments(isolate, info[1]);

  Sandbox* sandbox = GetSandboxFromContext(isolate);

  std::string result;

  if (info[2]->IsNull()) {
    result = sandbox->Dispatch(isolate, *name, *arguments, nullptr);
  }
  else {
    Local<Function> callback = info[2].As<Function>();

    result = sandbox->Dispatch(isolate, *name, *arguments, &callback);
  }

  info.GetReturnValue().Set(NewUtf8String(isolate, result));
}

void Sandbox::Finish(const FunctionCallbackInfo<Value>& info) {
  Sandbox* sandbox = ObjectWrap::Unwrap<Sandbox>(info.This());

  sandbox->Finish(info.GetIsolate());

  info.GetReturnValue().Set(info.This());
}

void Sandbox::Initialize(Isolate* isolate) {
  Local<Context> context = Context::New(isolate);
  sandboxContext_.Reset(isolate, context);

  Context::Scope context_scope(context);

  Local<Object> global = context->Global();

#if V8_MAJOR_VERSION >= 14
  Local<External> external = External::New(isolate, this, v8::kExternalPointerTypeTagDefault);
#else
  Local<External> external = External::New(isolate, this);
#endif

  global->SetPrivate(context, SandboxPrivateKey(isolate), external).Check();
  global->Set(context, NewUtf8String(isolate, "global"), global).Check();

  Local<Function> dispatchFn = FunctionTemplate::New(isolate, Dispatch)
    ->GetFunction(context)
    .ToLocalChecked();
  global->Set(context, NewUtf8String(isolate, "_dispatch"), dispatchFn).Check();
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

MaybeLocal<Value> Sandbox::PrepareStackTrace(
  Local<Context> context,
  Local<Value> error,
  Local<Array> sites)
{
  Isolate* isolate = Isolate::GetCurrent();
  EscapableHandleScope scope(isolate);

  std::string result;

  Local<String> errorStr;
  if (error->ToString(context).ToLocal(&errorStr)) {
    String::Utf8Value utf8(isolate, errorStr);
    if (*utf8) {
      result = *utf8;
    }
  }

  Local<String> getFileNameKey = NewUtf8String(isolate, "getFileName");
  Local<String> isEvalKey = NewUtf8String(isolate, "isEval");

  uint32_t length = sites->Length();
  for (uint32_t i = 0; i < length; ++i) {
    Local<Value> siteVal;
    if (!sites->Get(context, i).ToLocal(&siteVal) || !siteVal->IsObject()) {
      continue;
    }

    Local<Object> site = siteVal.As<Object>();

    bool isSandboxFrame = false;

    Local<Value> getFileNameVal;
    if (site->Get(context, getFileNameKey).ToLocal(&getFileNameVal) && getFileNameVal->IsFunction()) {
      Local<Value> fileNameVal;
      if (getFileNameVal.As<Function>()->Call(context, site, 0, nullptr).ToLocal(&fileNameVal) && fileNameVal->IsString()) {
        String::Utf8Value fileName(isolate, fileNameVal);
        if (*fileName && std::strcmp(*fileName, "script") == 0) {
          isSandboxFrame = true;
        }
      }
    }

    if (!isSandboxFrame) {
      Local<Value> isEvalVal;
      if (site->Get(context, isEvalKey).ToLocal(&isEvalVal) && isEvalVal->IsFunction()) {
        Local<Value> evalResult;
        if (isEvalVal.As<Function>()->Call(context, site, 0, nullptr).ToLocal(&evalResult) && evalResult->BooleanValue(isolate)) {
          isSandboxFrame = true;
        }
      }
    }

    // Stop at the first host/Node.js frame so sandbox stack traces never leak host paths.
    if (!isSandboxFrame) {
      break;
    }

    Local<String> siteStr;
    if (site->ToString(context).ToLocal(&siteStr)) {
      String::Utf8Value utf8(isolate, siteStr);
      if (*utf8) {
        result += "\n    at ";
        result += *utf8;
      }
    }
  }

  return scope.Escape(NewUtf8String(isolate, result));
}

void Sandbox::Execute(Isolate* isolate, int messageId, const char *code) {
  assert(messageId_ == 0 || messageId_ == messageId);

  messageId_ = messageId;

  Local<Context> context = Local<Context>::New(isolate, sandboxContext_);

  Context::Scope context_scope(context);

  TryCatch tryCatch(isolate);

  ScriptOrigin origin(NewUtf8String(isolate, "script"));

  isolate->SetPrepareStackTraceCallback(PrepareStackTrace);

  MaybeLocal<Script> script = Script::Compile(context, NewUtf8String(isolate, code), &origin);

  if (!tryCatch.HasCaught()) {
    (void)script.ToLocalChecked()->Run(context);
  }

  MaybeHandleError(isolate, tryCatch, context);

  isolate->SetPrepareStackTraceCallback(node::PrepareStackTraceCallback);
}

void Sandbox::Callback(Isolate* isolate, int messageId, int callbackId, const char *args) {
  assert(messageId_ == 0 || messageId_ == messageId);
  assert(callbackId > 0);
  assert(pendingOperations_[callbackId]);

  messageId_ = messageId;

  auto operation = pendingOperations_[callbackId];

  Local<Context> context = Local<Context>::New(isolate, sandboxContext_);

  Local<Object> global = context->Global();

  Context::Scope context_scope(context);

  TryCatch tryCatch(isolate);

  Local<Function> callback = Local<Function>::New(isolate, *operation->callback);

  isolate->SetPrepareStackTraceCallback(PrepareStackTrace);

  if (callback->IsFunction()) {
    Local<Value> argv[] = {
      NewUtf8String(isolate, args)
    };

    (void)callback->Call(context, global, 1, argv);
  }

  pendingOperations_.erase(callbackId);

  MaybeHandleError(isolate, tryCatch, context);

  isolate->SetPrepareStackTraceCallback(node::PrepareStackTraceCallback);
}

void Sandbox::Cancel(int messageId, int callbackId) {
  assert(messageId_ == 0 || messageId_ == messageId);
  assert(callbackId > 0);
  assert(pendingOperations_[callbackId]);

  messageId_ = messageId;

  pendingOperations_.erase(callbackId);
}

std::string Sandbox::Dispatch(Isolate* isolate, const char *name, const char *arguments, Local<Function> *callback) {
  int callbackId = 0;

  if (callback) {
    auto cb = std::make_shared<Global<Function>>(isolate, *callback);
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

void Sandbox::Finish(Isolate* isolate) {
  if (pendingOperations_.size() > 0) {
    return;
  }

  std::string invocation(
    std::string("{\"name\":\"finish\",\"args\":[") + std::to_string(messageId_) + std::string("]}")
  );

  Dispatch(isolate, "finish", invocation.c_str(), nullptr);

  messageId_ = 0;
}

void Sandbox::SetResult(Isolate* isolate, Local<Context> &context, Local<Object> result) {
  Local<Object> invocation = Object::New(isolate);
  Local<Array> arguments = Array::New(isolate, 1);

  arguments->Set(context, 0, result).Check();

  invocation->Set(context, NewUtf8String(isolate, "name"), NewUtf8String(isolate, "setResult")).Check();
  invocation->Set(context, NewUtf8String(isolate, "args"), arguments).Check();

  Local<String> json = JSON::Stringify(context, invocation).ToLocalChecked();

  String::Utf8Value utf8(isolate, json);
  std::string args(*utf8, utf8.length());

  Dispatch(isolate, "setResult", args.c_str(), nullptr);
}

void Sandbox::MaybeHandleError(Isolate* isolate, TryCatch &tryCatch, Local<Context> &context) {
  if (!tryCatch.HasCaught()) {
    return;
  }

  Local<Object> result = Object::New(isolate);
  Local<Object> error = Object::New(isolate);

  Local<Value> exception = tryCatch.Exception();
  Local<Message> msg = tryCatch.Message();

  String::Utf8Value message(isolate, msg->Get());
  String::Utf8Value sourceLine(isolate, msg->GetSourceLine(context).ToLocalChecked());

  int lineNumber = msg->GetLineNumber(context).FromJust();
  int startColumn = msg->GetStartColumn(context).FromJust();
  int endColumn = msg->GetEndColumn(context).FromJust();
  int startPosition = msg->GetStartPosition();
  int endPosition = msg->GetEndPosition();

  result->Set(context, NewUtf8String(isolate, "error"), error).Check();

  Local<Value> stackTrace;
  if (tryCatch.StackTrace(context).ToLocal(&stackTrace)) {
    error->Set(context, NewUtf8String(isolate, "stack"), stackTrace).Check();
  }
  else {
    error->Set(context, NewUtf8String(isolate, "stack"), NewUtf8String(isolate, "")).Check();
  }

  error->Set(context, NewUtf8String(isolate, "exception"), exception).Check();
  error->Set(context, NewUtf8String(isolate, "message"), NewUtf8String(isolate, *message)).Check();
  error->Set(context, NewUtf8String(isolate, "lineNumber"), Integer::New(isolate, lineNumber)).Check();
  error->Set(context, NewUtf8String(isolate, "startColumn"), Integer::New(isolate, startColumn)).Check();
  error->Set(context, NewUtf8String(isolate, "endColumn"), Integer::New(isolate, endColumn)).Check();
  error->Set(context, NewUtf8String(isolate, "startPosition"), Integer::New(isolate, startPosition)).Check();
  error->Set(context, NewUtf8String(isolate, "endPosition"), Integer::New(isolate, endPosition)).Check();
  error->Set(context, NewUtf8String(isolate, "sourceLine"), NewUtf8String(isolate, *sourceLine)).Check();

  SetResult(isolate, context, result);
}

Sandbox *Sandbox::GetSandboxFromContext(Isolate* isolate) {
  Local<Context> context = isolate->GetCurrentContext();

  Local<Value> hidden;
  if (!context->Global()->GetPrivate(context, SandboxPrivateKey(isolate)).ToLocal(&hidden) || !hidden->IsExternal()) {
    return nullptr;
  }

  Local<External> field = Local<External>::Cast(hidden);

#if V8_MAJOR_VERSION >= 14
  Sandbox *sandbox = (Sandbox *)field->Value(v8::kExternalPointerTypeTagDefault);
#else
  Sandbox *sandbox = (Sandbox *)field->Value();
#endif

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
      uint32_t rawExpected = 0;
      std::memcpy(&rawExpected, chunk, sizeof(rawExpected));
      sandbox->bytesExpected_ = static_cast<int32_t>(ntohl(rawExpected));
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

  uint32_t header[3] = {
    htonl(static_cast<uint32_t>(messageId)),
    htonl(static_cast<uint32_t>(callbackId)),
    htonl(static_cast<uint32_t>(messageLength)),
  };

  std::memcpy(data, header, sizeof(header));
  std::memcpy(data + sizeof(header), message.c_str(), messageLength);

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

