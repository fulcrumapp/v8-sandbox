#include "sandbox.h"
#include "common.h"

#include <cassert>
#include <cstdio>
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

constexpr uint32_t kMaxIpcFrameBytes = 64 * 1024 * 1024;

inline Local<String> NewUtf8String(Isolate* isolate, const char* value) {
  return String::NewFromUtf8(isolate, value ? value : "").ToLocalChecked();
}

inline Local<String> NewUtf8String(Isolate* isolate, const std::string& value) {
  return String::NewFromUtf8(isolate, value.c_str(), NewStringType::kNormal, static_cast<int>(value.size())).ToLocalChecked();
}

inline Local<Private> SandboxPrivateKey(Isolate* isolate) {
  return Private::ForApi(isolate, NewUtf8String(isolate, "sandbox"));
}

inline Local<Private> SandboxContextMarkerKey(Isolate* isolate) {
  return Private::ForApi(isolate, NewUtf8String(isolate, "sandbox_context"));
}

struct SandboxAddonData {
  Global<Function> constructor;
};

void DeleteAddonData(void* arg) {
  delete static_cast<SandboxAddonData*>(arg);
}

inline std::string JsonEscape(const std::string& input) {
  std::string out;
  out.reserve(input.size() + 8);
  for (unsigned char c : input) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof(buf), "\\u%04x", c);
          out += buf;
        } else {
          out += static_cast<char>(c);
        }
    }
  }
  return out;
}

}  // namespace

Sandbox::Sandbox()
  : messageId_(0),
    result_(""),
    readBuffer_(""),
    hasExpected_(false),
    bytesExpected_(0),
    socket_(""),
    pipe_(nullptr),
    loop_(nullptr)
{
}

Sandbox::~Sandbox() {
  Disconnect();
}

void Sandbox::Init(Local<Object> exports, Local<Context> context) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  auto* addonData = new SandboxAddonData();

#if V8_MAJOR_VERSION >= 14
  Local<External> externalData = External::New(isolate, addonData, v8::kExternalPointerTypeTagDefault);
#else
  Local<External> externalData = External::New(isolate, addonData);
#endif

  Local<FunctionTemplate> tpl = FunctionTemplate::New(isolate, New, externalData);

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

  addonData->constructor.Reset(isolate, function);
  node::AddEnvironmentCleanupHook(isolate, DeleteAddonData, addonData);

  isolate->SetPrepareStackTraceCallback(PrepareStackTrace);

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
    Local<External> externalData = info.Data().As<External>();
#if V8_MAJOR_VERSION >= 14
    auto* addonData = static_cast<SandboxAddonData*>(externalData->Value(v8::kExternalPointerTypeTagDefault));
#else
    auto* addonData = static_cast<SandboxAddonData*>(externalData->Value());
#endif
    Local<Function> cons = Local<Function>::New(isolate, addonData->constructor);
    Local<Object> instance;
    if (cons->NewInstance(context, argc, argv).ToLocal(&instance)) {
      info.GetReturnValue().Set(instance);
    }
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

  if (!sandbox || !sandbox->IsActiveContext(isolate, isolate->GetCurrentContext())) {
    isolate->ThrowException(Exception::Error(NewUtf8String(isolate, "sandbox context is no longer active")));
    return;
  }

  if (arguments.length() > static_cast<int>(kMaxIpcFrameBytes)) {
    isolate->ThrowException(Exception::RangeError(NewUtf8String(isolate, "IPC frame exceeds maximum size")));
    return;
  }

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
  if (!sandboxContext_.IsEmpty()) {
    Local<Context> prevContext = Local<Context>::New(isolate, sandboxContext_);
    (void)prevContext->Global()->DeletePrivate(prevContext, SandboxPrivateKey(isolate));
  }

  pendingOperations_.clear();

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
  global->SetPrivate(context, SandboxContextMarkerKey(isolate), True(isolate)).Check();
  global->Set(context, NewUtf8String(isolate, "global"), global).Check();

  Local<Function> dispatchFn = FunctionTemplate::New(isolate, Dispatch)
    ->GetFunction(context)
    .ToLocalChecked();
  global->Set(context, NewUtf8String(isolate, "_dispatch"), dispatchFn).Check();
}

bool Sandbox::IsActiveContext(Isolate* isolate, Local<Context> context) const {
  if (sandboxContext_.IsEmpty() || messageId_ == 0) {
    return false;
  }
  return sandboxContext_.Get(isolate) == context;
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

  if (pipe_ && !uv_is_closing(reinterpret_cast<uv_handle_t *>(pipe_))) {
    uv_close(reinterpret_cast<uv_handle_t *>(pipe_), OnClose);
  }

  uv_run(loop_, UV_RUN_DEFAULT);

  uv_loop_close(loop_);

  free(loop_);

  loop_ = nullptr;
  pipe_ = nullptr;
  readBuffer_.clear();
  hasExpected_ = false;
  bytesExpected_ = 0;
}

MaybeLocal<Value> Sandbox::PrepareStackTrace(
  Local<Context> context,
  Local<Value> error,
  Local<Array> sites)
{
  Isolate* isolate = Isolate::GetCurrent();
  EscapableHandleScope scope(isolate);

  bool isSandboxContext = false;
  if (!context.IsEmpty()) {
    isSandboxContext = context->Global()
      ->HasPrivate(context, SandboxContextMarkerKey(isolate))
      .FromMaybe(false);
  }

  if (!isSandboxContext) {
    Local<Value> hostResult;
    if (node::PrepareStackTraceCallback(context, error, sites).ToLocal(&hostResult)) {
      return scope.Escape(hostResult);
    }
    return MaybeLocal<Value>();
  }

  std::string result;

  Local<String> errorStr;
  if (error->ToString(context).ToLocal(&errorStr)) {
    String::Utf8Value utf8(isolate, errorStr);
    if (*utf8) {
      result.assign(*utf8, utf8.length());
    }
  }

  Local<String> getFileNameKey = NewUtf8String(isolate, "getFileName");

  uint32_t length = sites->Length();
  for (uint32_t i = 0; i < length; ++i) {
    Local<Value> siteVal;
    if (!sites->Get(context, i).ToLocal(&siteVal) || !siteVal->IsObject()) {
      continue;
    }

    Local<Object> site = siteVal.As<Object>();

    bool isHostFrame = false;

    Local<Value> getFileNameVal;
    if (site->Get(context, getFileNameKey).ToLocal(&getFileNameVal) && getFileNameVal->IsFunction()) {
      Local<Value> fileNameVal;
      if (getFileNameVal.As<Function>()->Call(context, site, 0, nullptr).ToLocal(&fileNameVal) && fileNameVal->IsString()) {
        String::Utf8Value fileName(isolate, fileNameVal);
        if (!*fileName || fileName.length() != 6 || std::memcmp(*fileName, "script", 6) != 0) {
          isHostFrame = true;
        }
      }
    }

    // Stop at the first host/Node.js frame so sandbox stack traces never leak host paths.
    // Builtin frames (e.g., Array.map) and eval frames have null/undefined fileName and are preserved.
    if (isHostFrame) {
      break;
    }

    Local<String> siteStr;
    if (site->ToString(context).ToLocal(&siteStr)) {
      String::Utf8Value utf8(isolate, siteStr);
      if (*utf8) {
        result += "\n    at ";
        result.append(*utf8, utf8.length());
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

  MaybeLocal<Script> script = Script::Compile(context, NewUtf8String(isolate, code), &origin);

  if (!tryCatch.HasCaught()) {
    Local<Script> compiled;
    if (script.ToLocal(&compiled)) {
      (void)compiled->Run(context);
    }
  }

  isolate->PerformMicrotaskCheckpoint();

  MaybeHandleError(isolate, tryCatch, context);
}

void Sandbox::Callback(Isolate* isolate, int messageId, int callbackId, const char *args) {
  if (callbackId <= 0) {
    return;
  }

  auto it = pendingOperations_.find(callbackId);
  if (it == pendingOperations_.end() || !it->second) {
    return;
  }

  messageId_ = messageId;

  auto operation = it->second;

  Local<Context> context = Local<Context>::New(isolate, sandboxContext_);

  Local<Object> global = context->Global();

  Context::Scope context_scope(context);

  TryCatch tryCatch(isolate);

  Local<Function> callback = Local<Function>::New(isolate, *operation->callback);

  if (callback->IsFunction()) {
    Local<Value> argv[] = {
      NewUtf8String(isolate, args)
    };

    (void)callback->Call(context, global, 1, argv);
  }

  pendingOperations_.erase(it);

  isolate->PerformMicrotaskCheckpoint();

  MaybeHandleError(isolate, tryCatch, context);
}

void Sandbox::Cancel(int messageId, int callbackId) {
  if (callbackId <= 0) {
    return;
  }

  auto it = pendingOperations_.find(callbackId);
  if (it == pendingOperations_.end()) {
    return;
  }

  messageId_ = messageId;

  pendingOperations_.erase(it);
}

std::string Sandbox::Dispatch(Isolate* isolate, const char *name, const char *arguments, Local<Function> *callback) {
  if (!loop_ || !pipe_) {
    return "";
  }

  int callbackId = 0;

  if (callback) {
    auto cb = std::make_shared<Global<Function>>(isolate, *callback);
    auto operation = std::make_shared<AsyncOperation>(this, cb);

    callbackId = operation->id;

    pendingOperations_[operation->id] = operation;
  }

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
  Local<Object> invocation = Object::New(isolate, Null(isolate), nullptr, nullptr, 0);
  Local<Array> arguments = Array::New(isolate, 1);

  (void)arguments->CreateDataProperty(context, 0, result);
  (void)invocation->CreateDataProperty(context, NewUtf8String(isolate, "name"), NewUtf8String(isolate, "setResult"));
  (void)invocation->CreateDataProperty(context, NewUtf8String(isolate, "args"), arguments);

  TryCatch stringifyCatch(isolate);
  Local<String> json;
  if (JSON::Stringify(context, invocation).ToLocal(&json)) {
    String::Utf8Value utf8(isolate, json);
    if (*utf8) {
      std::string args(*utf8, utf8.length());
      Dispatch(isolate, "setResult", args.c_str(), nullptr);
      return;
    }
  }

  stringifyCatch.Reset();

  // Fallback when exception payload cannot be JSON-stringified (e.g., BigInt, circular object, hostile toJSON)
  std::string fallbackMessage = "Uncaught exception";
  std::string fallbackStack;
  Local<Value> errorVal;
  if (result->Get(context, NewUtf8String(isolate, "error")).ToLocal(&errorVal) && errorVal->IsObject()) {
    Local<Object> errObj = errorVal.As<Object>();
    Local<Value> msgVal;
    if (errObj->Get(context, NewUtf8String(isolate, "message")).ToLocal(&msgVal) && msgVal->IsString()) {
      String::Utf8Value utf8(isolate, msgVal);
      if (*utf8) fallbackMessage.assign(*utf8, utf8.length());
    }
    Local<Value> stackVal;
    if (errObj->Get(context, NewUtf8String(isolate, "stack")).ToLocal(&stackVal) && stackVal->IsString()) {
      String::Utf8Value utf8(isolate, stackVal);
      if (*utf8) fallbackStack.assign(*utf8, utf8.length());
    }
  }

  std::string safeArgs = std::string("{\"name\":\"setResult\",\"args\":[{\"error\":{\"message\":\"")
    + JsonEscape(fallbackMessage)
    + "\",\"stack\":\""
    + JsonEscape(fallbackStack)
    + "\"}}]}";
  Dispatch(isolate, "setResult", safeArgs.c_str(), nullptr);
}

void Sandbox::MaybeHandleError(Isolate* isolate, TryCatch &tryCatch, Local<Context> &context) {
  if (!tryCatch.HasCaught()) {
    return;
  }

  Local<Object> result = Object::New(isolate, Null(isolate), nullptr, nullptr, 0);
  Local<Object> error = Object::New(isolate, Null(isolate), nullptr, nullptr, 0);

  Local<Value> exception = tryCatch.Exception();
  Local<Message> msg = tryCatch.Message();

  std::string messageStr = "Uncaught exception";
  std::string sourceLineStr;
  int lineNumber = 0;
  int startColumn = 0;
  int endColumn = 0;
  int startPosition = 0;
  int endPosition = 0;

  if (!msg.IsEmpty()) {
    String::Utf8Value message(isolate, msg->Get());
    if (*message) {
      messageStr.assign(*message, message.length());
    }

    Local<String> sourceLineVal;
    if (msg->GetSourceLine(context).ToLocal(&sourceLineVal)) {
      String::Utf8Value sourceLine(isolate, sourceLineVal);
      if (*sourceLine) {
        sourceLineStr.assign(*sourceLine, sourceLine.length());
      }
    }

    lineNumber = msg->GetLineNumber(context).FromMaybe(0);
    startColumn = msg->GetStartColumn(context).FromMaybe(0);
    endColumn = msg->GetEndColumn(context).FromMaybe(0);
    startPosition = msg->GetStartPosition();
    endPosition = msg->GetEndPosition();
  }

  (void)result->CreateDataProperty(context, NewUtf8String(isolate, "error"), error);

  Local<Value> stackTrace;
  if (tryCatch.StackTrace(context).ToLocal(&stackTrace)) {
    (void)error->CreateDataProperty(context, NewUtf8String(isolate, "stack"), stackTrace);
  }
  else {
    (void)error->CreateDataProperty(context, NewUtf8String(isolate, "stack"), NewUtf8String(isolate, ""));
  }

  (void)error->CreateDataProperty(context, NewUtf8String(isolate, "exception"), exception);
  (void)error->CreateDataProperty(context, NewUtf8String(isolate, "message"), NewUtf8String(isolate, messageStr));
  (void)error->CreateDataProperty(context, NewUtf8String(isolate, "lineNumber"), Integer::New(isolate, lineNumber));
  (void)error->CreateDataProperty(context, NewUtf8String(isolate, "startColumn"), Integer::New(isolate, startColumn));
  (void)error->CreateDataProperty(context, NewUtf8String(isolate, "endColumn"), Integer::New(isolate, endColumn));
  (void)error->CreateDataProperty(context, NewUtf8String(isolate, "startPosition"), Integer::New(isolate, startPosition));
  (void)error->CreateDataProperty(context, NewUtf8String(isolate, "endPosition"), Integer::New(isolate, endPosition));
  (void)error->CreateDataProperty(context, NewUtf8String(isolate, "sourceLine"), NewUtf8String(isolate, sourceLineStr));

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
    sandbox->readBuffer_.append(buffer->base, static_cast<size_t>(bytesRead));

    if (!sandbox->hasExpected_ && sandbox->readBuffer_.size() >= sizeof(uint32_t)) {
      uint32_t rawExpected = 0;
      std::memcpy(&rawExpected, sandbox->readBuffer_.data(), sizeof(rawExpected));
      uint32_t expected = ntohl(rawExpected);

      if (expected > kMaxIpcFrameBytes) {
        sandbox->readBuffer_.clear();
        uv_read_stop(pipe);
        if (!uv_is_closing(reinterpret_cast<uv_handle_t *>(pipe))) {
          uv_close(reinterpret_cast<uv_handle_t *>(pipe), OnClose);
        }
        free(buffer->base);
        return;
      }

      sandbox->bytesExpected_ = expected;
      sandbox->hasExpected_ = true;
    }

    if (sandbox->hasExpected_ && sandbox->readBuffer_.size() >= sizeof(uint32_t) + sandbox->bytesExpected_) {
      sandbox->result_.assign(sandbox->readBuffer_, sizeof(uint32_t), sandbox->bytesExpected_);
      sandbox->readBuffer_.erase(0, sizeof(uint32_t) + sandbox->bytesExpected_);
      sandbox->hasExpected_ = false;
      sandbox->bytesExpected_ = 0;
      uv_read_stop(pipe);
    }
  }
  else if (bytesRead < 0) {
    if (!uv_is_closing(reinterpret_cast<uv_handle_t *>(pipe))) {
      uv_close(reinterpret_cast<uv_handle_t *>(pipe), OnClose);
    }
  }

  free(buffer->base);
}

void Sandbox::OnClose(uv_handle_t *pipe) {
  Sandbox *sandbox = static_cast<Sandbox *>(pipe->data);
  if (sandbox && reinterpret_cast<uv_handle_t *>(sandbox->pipe_) == pipe) {
    sandbox->pipe_ = nullptr;
  }
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
    std::cout << " OnWriteComplete failed, status: " << status << " : " << uv_strerror(status) << std::endl;
  }

  free(request->data);
  free(request);
}

