#include "sandbox-wrap.h"
#include "common.h"

#include <iostream>
#include <memory>
#include <v8.h>

#include <unistd.h>
#include <iostream>

void Debug(const char *msg) {
  std::cout << getpid() << " : " << msg << std::endl;
}

using namespace v8;

Nan::Persistent<v8::Function> SandboxWrap::constructor;

SandboxWrap::SandboxWrap()
  : callback_(nullptr),
    result_(""),
    dispatchResult_(""),
    buffers_(),
    bytesRead_(-1),
    bytesExpected_(-1),
    message_(""),
    socket_(""),
    pipe_(nullptr),
    loop_(nullptr)
{
}

SandboxWrap::~SandboxWrap() {
}

void SandboxWrap::Init(v8::Local<v8::Object> exports) {
  Nan::HandleScope scope;

  v8::Local<v8::FunctionTemplate> tpl = Nan::New<v8::FunctionTemplate>(New);
  tpl->SetClassName(Nan::New("Sandbox").ToLocalChecked());
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  Nan::SetPrototypeMethod(tpl, "initialize", Initialize);
  Nan::SetPrototypeMethod(tpl, "execute", Execute);
  Nan::SetPrototypeMethod(tpl, "callback", Callback);
  Nan::SetPrototypeMethod(tpl, "connect", Connect);
  Nan::SetPrototypeMethod(tpl, "disconnect", Disconnect);

  auto function = Nan::GetFunction(tpl).ToLocalChecked();

  constructor.Reset(function);

  Nan::Set(exports, Nan::New("Sandbox").ToLocalChecked(), function);
}

NAN_METHOD(SandboxWrap::New) {
  if (info.IsConstructCall()) {
    SandboxWrap *obj = new SandboxWrap();
    obj->Wrap(info.This());

    NODE_ARG_STRING(0, "socket");

    Nan::Utf8String socket(info[0]);

    obj->socket_ = *socket;
    obj->nodeContext_ = Nan::GetCurrentContext();
    obj->nodeContext_.Reset(Nan::New(obj->nodeContext_));

    info.GetReturnValue().Set(info.This());
  } else {
    const int argc = 1;
    v8::Local<v8::Value> argv[argc] = { info[0] };
    v8::Local<v8::Function> cons = Nan::New<v8::Function>(constructor);
    info.GetReturnValue().Set(Nan::NewInstance(cons, argc, argv).ToLocalChecked());
  }
}

NAN_METHOD(SandboxWrap::Initialize) {
  SandboxWrap* sandbox = ObjectWrap::Unwrap<SandboxWrap>(info.Holder());

  sandbox->Initialize();

  info.GetReturnValue().Set(info.This());
}

NAN_METHOD(SandboxWrap::Execute) {
  NODE_ARG_STRING(0, "code");
  NODE_ARG_FUNCTION(1, "callback");

  Nan::Utf8String code(info[0]);

  SandboxWrap* sandbox = ObjectWrap::Unwrap<SandboxWrap>(info.Holder());

  sandbox->Execute(*code);

  info.GetReturnValue().Set(info.This());
}

void SandboxWrap::Initialize() {
  sandboxContext_.Reset(Context::New(Isolate::GetCurrent()));

  auto context = Nan::New(sandboxContext_);
  
  Context::Scope context_scope(context);

  auto global = context->Global();

  sandboxGlobal_.Reset(global);

  Nan::SetPrivate(global, Nan::New("sandbox").ToLocalChecked(), External::New(Isolate::GetCurrent(), this));
  Nan::Set(global, Nan::New("global").ToLocalChecked(), context->Global());
  Nan::SetMethod(global, "_dispatch", Dispatch);
}

void SandboxWrap::Execute(const char *code) {  
  auto context = Nan::New(sandboxContext_);

  Context::Scope context_scope(context);

  Nan::TryCatch tryCatch;

  MaybeLocal<Script> script = Script::Compile(context, Nan::New(code).ToLocalChecked());

  if (!tryCatch.HasCaught()) {
    (void)script.ToLocalChecked()->Run(context);
  }

  MaybeHandleError(tryCatch, context);
}

void SandboxWrap::Callback(int id, const char *args) {
  assert(id > 0);

  auto baton = pendingOperations_[id];

  assert(baton);

  auto context = Nan::New(sandboxContext_);

  auto global = context->Global();

  Context::Scope context_scope(context);

  Nan::TryCatch tryCatch;

  Local<Function> callback = Nan::New(baton->callback->As<Function>());

  if (callback->IsFunction()) {
    v8::Local<v8::Value> argv[] = {
      Nan::New(args).ToLocalChecked()
    };

    Nan::Call(callback, global, 1, argv);
  }

  MaybeHandleError(tryCatch, context);

  pendingOperations_.erase(id);
}

NAN_METHOD(SandboxWrap::Callback) {
  NODE_ARG_INTEGER(0, "id");
  NODE_ARG_STRING(1, "args");

  Nan::Utf8String args(info[1]);

  SandboxWrap* sandbox = ObjectWrap::Unwrap<SandboxWrap>(info.Holder());

  sandbox->Callback(Nan::To<uint32_t>(info[0]).FromJust(), *args);
}

NAN_METHOD(SandboxWrap::Dispatch) {
  NODE_ARG_STRING(0, "parameters");
  NODE_ARG_FUNCTION_OPTIONAL(1, "callback");

  Nan::Utf8String arguments(info[0]);

  SandboxWrap* sandbox = GetSandboxFromContext();

  std::string result;

  if (info[1]->IsNull()) {
    result = sandbox->Dispatch(*arguments, nullptr);
  }
  else {
    Local<Function> callback = info[1].As<Function>();

    result = sandbox->Dispatch(*arguments, &callback);
  }
  
  info.GetReturnValue().Set(Nan::New(result.c_str()).ToLocalChecked());
}

NAN_METHOD(SandboxWrap::Connect) {
  SandboxWrap* sandbox = ObjectWrap::Unwrap<SandboxWrap>(info.Holder());

  if (sandbox->loop_) {
    return;
  }

  sandbox->loop_ = (uv_loop_t *)malloc(sizeof(uv_loop_t));

  uv_loop_init(sandbox->loop_);

  uv_connect_t *request = (uv_connect_t *)malloc(sizeof(uv_connect_t));

  sandbox->pipe_ = (uv_pipe_t *)malloc(sizeof(uv_pipe_t));

  uv_pipe_init(sandbox->loop_, sandbox->pipe_, 0);

  sandbox->pipe_->data = (void *)sandbox;

  uv_pipe_connect(request, sandbox->pipe_, sandbox->socket_.c_str(), OnConnected);

  uv_run(sandbox->loop_, UV_RUN_DEFAULT);
}

NAN_METHOD(SandboxWrap::Disconnect) {
  SandboxWrap* sandbox = ObjectWrap::Unwrap<SandboxWrap>(info.Holder());

  if (!sandbox->loop_) {
    return;
  }

  Debug("disconnect");

  uv_loop_close(sandbox->loop_);

  // free(request);
  // free(pipe);
  free(sandbox->loop_);
}

void SandboxWrap::MaybeHandleError(Nan::TryCatch &tryCatch, Local<Context> &context) {
  if (!tryCatch.HasCaught()) {
    return;
  }

  auto invocation = Nan::New<Object>();
  auto result = Nan::New<Object>();
  auto error = Nan::New<Object>();
  auto arguments = Nan::New<Array>();

  Nan::Utf8String message(tryCatch.Message()->Get());
  Nan::Utf8String stack(tryCatch.StackTrace().ToLocalChecked());

  int lineNumber = tryCatch.Message()->GetLineNumber(context).FromJust();

  Nan::Set(result, Nan::New("error").ToLocalChecked(), error);

  Nan::Set(error, Nan::New("message").ToLocalChecked(), Nan::New(*message).ToLocalChecked());
  Nan::Set(error, Nan::New("stack").ToLocalChecked(), Nan::New(*stack).ToLocalChecked());
  Nan::Set(error, Nan::New("lineNumber").ToLocalChecked(), Nan::New(lineNumber));

  Nan::Set(arguments, 0, result);

  Nan::Set(invocation, Nan::New("name").ToLocalChecked(), Nan::New("setResult").ToLocalChecked());
  Nan::Set(invocation, Nan::New("args").ToLocalChecked(), arguments);

  auto json = JSON::Stringify(context, invocation).ToLocalChecked();

  std::string args = *Nan::Utf8String(json);

  // std::cout << getpid() << " MaybeHandleError: " << args << std::endl;
  // result_ = *Nan::Utf8String(json);

  Dispatch(args.c_str(), nullptr);
}

SandboxWrap *SandboxWrap::GetSandboxFromContext() {
  auto context = Isolate::GetCurrent()->GetCurrentContext();

  auto hidden = Nan::GetPrivate(context->Global(), Nan::New("sandbox").ToLocalChecked()).ToLocalChecked();

  Local<External> field = Local<External>::Cast(hidden);

  SandboxWrap *sandbox = (SandboxWrap *)field->Value();

  return sandbox;
}

// make a single interface with (const char *arguments, Local<Function> callback)
// always dispatch batons the same way, no different with sync or async, just the presence of the callback
std::string SandboxWrap::Dispatch(const char *arguments, Local<Function> *callback) {
  int id = 0;
  
  if (callback) {
    auto cb = std::make_shared<Nan::Persistent<Function>>(*callback);
    auto baton = std::make_shared<AsyncOperationBaton>(this, cb);

    id = baton->id;

    pendingOperations_[baton->id] = baton;
  }

  bytesRead_ = -1;
  bytesExpected_ = -1;
  buffers_.clear();
  message_ = arguments;
  dispatchResult_ = "";

  WriteData((uv_stream_t *)pipe_, id, message_);

  uv_run(loop_, UV_RUN_DEFAULT);

  return dispatchResult_;
}

void SandboxWrap::AllocateBuffer(uv_handle_t *handle, size_t size, uv_buf_t *buffer) {
  buffer->base = (char *)malloc(size);
  buffer->len = size;
}

void SandboxWrap::OnConnected(uv_connect_t *request, int status) {
  if (status != 0) {
    std::cout << getpid() << " OnConnected failed, status: " << status << " : " << uv_strerror(status) << std::endl;
  }

  assert(status == 0);
}

void SandboxWrap::OnRead(uv_stream_t *pipe, ssize_t bytesRead, const uv_buf_t *buffer) {
  SandboxWrap *sandbox = (SandboxWrap *)pipe->data;

  if (bytesRead > 0) {
    char *chunk = (char *)buffer->base;
    int chunkLength = bytesRead;
    
    if (sandbox->bytesExpected_ == -1) {
      sandbox->bytesExpected_ = ntohl(((int32_t *)chunk)[0]);
      sandbox->bytesRead_ = 0;
      sandbox->dispatchResult_ = "";

      chunk += sizeof(int32_t);
      chunkLength -= sizeof(int32_t);
    }

    // std::cout << getpid() << " : reading " << sandbox->bytesExpected_ << " : " << bytesRead << " : " << chunkLength << std::endl;

    std::string chunkString(chunk, chunkLength);

    sandbox->buffers_.push_back(chunkString);
    sandbox->bytesRead_ += chunkLength;

    // std::cout << getpid() << " : expected " << sandbox->bytesExpected_ << " : got " << sandbox->bytesRead_ << std::endl;

    if (sandbox->bytesRead_ == sandbox->bytesExpected_) {
      for (const auto &chunk : sandbox->buffers_) {
        sandbox->dispatchResult_ += chunk;
      }

      uv_read_stop(pipe);
      // uv_close((uv_handle_t *)pipe, OnClose);
    }
  }
  else if (bytesRead < 0) {
    // uv_close((uv_handle_t *)pipe, OnClose);
  }

  free(buffer->base);
}

void SandboxWrap::OnClose(uv_handle_t *pipe) {
  free(pipe);
}

void SandboxWrap::WriteData(uv_stream_t *pipe, int id, std::string &message) {
  uv_write_t *write = (uv_write_t *)malloc(sizeof(uv_write_t));

  size_t bufferLength = sizeof(int32_t) + message.length();

  char *data = (char *)malloc(bufferLength);

  uint32_t *base = (uint32_t *)data;

  base[0] = htonl(id);

  // std::cout << getpid() << " : writing " << message.c_str() << std::endl;

  memcpy(&base[1], message.c_str(), message.length());

  uv_buf_t buffers[] = {
    { .base = data, .len = bufferLength }
  };

  write->data = data;

  // std::cout << getpid() << " WriteData: " << message << std::endl;

  uv_write(write, pipe, buffers, 1, OnWriteComplete);

  uv_read_start((uv_stream_t *)pipe, AllocateBuffer, OnRead);
}

void SandboxWrap::OnWriteComplete(uv_write_t *request, int status) {
  if (status != 0) {
    std::cout << getpid() << " OnWriteComplete failed, status: " << status << " : " << uv_strerror(status) << " : " << (char *)request->data << std::endl;
  }

  assert(status == 0);

  free(request->data);
  free(request);
}