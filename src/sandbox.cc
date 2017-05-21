#include <uv.h>
#include "sandbox.h"
#include "sandbox-wrap.h"
#include <iostream>

void Debug(const char *msg) {
  std::cout << msg << std::endl;
}

Sandbox::Sandbox()
: params_(),
  isolate_(nullptr),
  locker_(nullptr),
  context_(nullptr),
  global_(nullptr),
  loop_(nullptr)
{
  params_.array_buffer_allocator = ArrayBuffer::Allocator::NewDefaultAllocator();

  isolate_ = Isolate::New(params_);
}

Sandbox::~Sandbox() {
  Dispose();
}

void Sandbox::RunIsolate(const char *code) {
  locker_ = new Locker(isolate_);

  isolate_->Enter();

  HandleScope scope(isolate_);

  context_ = new Nan::Persistent<Context>(Context::New(isolate_));

  auto context = Nan::New(context_->As<Context>());

  global_ = new Nan::Persistent<Object>(context->Global());

  context->Enter();

  Nan::SetPrivate(context->Global(), Nan::New("sandbox").ToLocalChecked(), External::New(isolate_, this));

  Nan::Set(context->Global(), Nan::New("global").ToLocalChecked(), context->Global());
  Nan::SetMethod(context->Global(), "_setResult", SetResult);
  Nan::SetMethod(context->Global(), "_setTimeout", SetTimeout);
  Nan::SetMethod(context->Global(), "_httpRequest", HttpRequest);
  Nan::SetMethod(context->Global(), "_log", ConsoleLog);
  Nan::SetMethod(context->Global(), "_error", ConsoleError);

  std::string js = std::string(SandboxRuntime) + code;

  Local<String> source = Nan::New(js.c_str()).ToLocalChecked();

  Local<Script> script = Script::Compile(context, source).ToLocalChecked();

  (void)script->Run(context);
}

std::string Sandbox::RunInSandbox(const char *code, SandboxWrap *wrap) {
  wrap_ = wrap;

  loop_ = (uv_loop_t *)malloc(sizeof(uv_loop_t));

  uv_loop_init(loop_);

  RunIsolate(code);

  uv_run(loop_, UV_RUN_DEFAULT);
  uv_loop_close(loop_);
  free(loop_);

  Dispose();

  return result_;
}

Sandbox *UnwrapSandbox(Isolate *isolate) {
  auto context = isolate->GetCurrentContext();

  auto hidden = Nan::GetPrivate(context->Global(), Nan::New("sandbox").ToLocalChecked()).ToLocalChecked();

  Local<External> field = Local<External>::Cast(hidden);

  Sandbox *sandbox = (Sandbox *)field->Value();

  return sandbox;
}

NAN_METHOD(Sandbox::SetResult) {
  String::Utf8Value value(info[0]->ToString());

  Sandbox *sandbox = UnwrapSandbox(info.GetIsolate());

  sandbox->result_ = *value;
}

void Sandbox::OnHandleClose(uv_handle_t *handle) {
  delete handle;
}

void HandleTimer(uv_timer_t *handle) {
  Baton *baton = (Baton *)handle->data;

  Nan::Persistent<Function> *callback = (Nan::Persistent<Function> *)baton->data_;

  Isolate *isolate = baton->sandbox_->GetIsolate();

  HandleScope scope(isolate);

  Local<Function> cb = Nan::New(callback->As<Function>());
  Local<Context> context = Nan::New(baton->sandbox_->GetContext()->As<Context>());
  Local<Object> global = Nan::New(baton->sandbox_->GetGlobal()->As<Object>());

  delete baton;
  delete handle;

  (void)cb->Call(context, global, 0, 0);

  callback->Reset();
}

NAN_METHOD(Sandbox::SetTimeout) {
  auto timeout = Nan::To<int>(info[1]).FromJust();

  Sandbox *sandbox = UnwrapSandbox(info.GetIsolate());

  uv_timer_t *timer = new uv_timer_t;

  uv_timer_init(sandbox->loop_, timer);

  auto persistentCallback = new Nan::Persistent<Function>(info[0].As<v8::Function>());

  timer->data = new Baton(sandbox, persistentCallback);

  uv_timer_start(timer, HandleTimer, timeout, 0);
}

NAN_METHOD(Sandbox::AsyncNodeCallback) {
  auto object = Nan::To<Object>(info[0]).ToLocalChecked();
  const char *result = *Nan::Utf8String(info[1]);

  auto hidden = Nan::GetPrivate(object, Nan::New("baton").ToLocalChecked()).ToLocalChecked();

  Local<External> field = Local<External>::Cast(hidden);

  AsyncCallBaton *baton = (AsyncCallBaton *)field->Value();

  baton->sandboxResult = result;

  if (baton->condition) {
    // signal the wait condition to end the synchronous call on the other thread
    uv_mutex_lock(baton->mutex);
    uv_cond_signal(baton->condition);
    uv_mutex_unlock(baton->mutex);
  } else {
    // signal the sandbox to wake up to process the result
    uv_async_send(baton->sandboxAsync);
  }
}

void Sandbox::OnEndNodeInvocation(uv_async_t *handle) {
  AsyncCallBaton *baton = (AsyncCallBaton *)handle->data;

  Nan::Persistent<Function> *callback = (Nan::Persistent<Function> *)baton->sandboxCallback;

  // enter the sandbox isolate
  Isolate *sandboxIsolate = baton->sandbox->GetIsolate();

  HandleScope scope(sandboxIsolate);

  Local<Function> cb = Nan::New(callback->As<Function>());

  uv_close((uv_handle_t *)handle, OnHandleClose);

  Local<Value> argv[] = {
    Nan::New(baton->sandboxResult).ToLocalChecked()
  };

  delete baton;

  (void)cb->Call(sandboxIsolate->GetCurrentContext(), sandboxIsolate->GetCurrentContext()->Global(), 1, argv);
}

void Sandbox::OnStartNodeInvocation(uv_async_t *handle) {
  AsyncCallBaton *baton = (AsyncCallBaton *)handle->data;

  // enter the node isolate
  Isolate *nodeIsolate = Isolate::GetCurrent();

  HandleScope scope(nodeIsolate);

  Local<Function> cb = Nan::New(baton->sandbox->GetWrap()->GetBridge().As<Function>());

  uv_close((uv_handle_t *)handle, OnHandleClose);

  auto argumentObject = Nan::New<v8::Object>();

  Nan::SetPrivate(argumentObject, Nan::New("baton").ToLocalChecked(), External::New(nodeIsolate, baton));
  Nan::SetMethod(argumentObject, "callback", AsyncNodeCallback);
  Nan::Set(argumentObject, Nan::New("args").ToLocalChecked(), Nan::New(baton->sandboxArguments.c_str()).ToLocalChecked());
  Nan::Set(argumentObject, Nan::New("name").ToLocalChecked(), Nan::New(baton->name.c_str()).ToLocalChecked());

  Local<Value> argv[] = {
    argumentObject
  };

  (void)cb->Call(nodeIsolate->GetCurrentContext(), nodeIsolate->GetCurrentContext()->Global(), 1, argv);
}

NAN_METHOD(Sandbox::HttpRequest) {
  const char *arguments = *Nan::Utf8String(info[0]);

  Sandbox *sandbox = UnwrapSandbox(info.GetIsolate());

  bool synchronous = info[1]->IsNull() || info[1]->IsUndefined();

  if (synchronous) {
    std::string result = sandbox->DispatchSync("httpRequest", arguments);
    info.GetReturnValue().Set(Nan::New(result.c_str()).ToLocalChecked());
  } else {
    sandbox->DispatchAsync("httpRequest", arguments, info[1].As<v8::Function>());
  }
}

void Sandbox::DispatchAsync(const char *name, const char *arguments, Local<Function> callback) {
  auto persistentCallback = new Nan::Persistent<Function>(callback);

  auto baton = new AsyncCallBaton();

  baton->name = name;
  baton->sandbox = this;
  baton->sandboxCallback = persistentCallback;
  baton->sandboxArguments = arguments;
  baton->mutex = nullptr;
  baton->condition = nullptr;

  // wake up the nodejs loop
  uv_async_t *async = new uv_async_t;
  uv_async_init(uv_default_loop(), async, OnStartNodeInvocation);
  async->data = baton;

  uv_async_t *sandboxAsync = new uv_async_t;
  uv_async_init(loop_, sandboxAsync, OnEndNodeInvocation);
  baton->sandboxAsync = sandboxAsync;
  sandboxAsync->data = baton;

  uv_async_send(async);
}

std::string Sandbox::DispatchSync(const char *name, const char *arguments) {
  auto baton = new AsyncCallBaton();

  baton->name = name;
  baton->sandbox = this;
  baton->sandboxArguments = arguments;

  // wake up the nodejs loop
  uv_async_t *async = new uv_async_t;

  async->data = baton;

  uv_async_init(uv_default_loop(), async, OnStartNodeInvocation);

  baton->sandboxAsync = nullptr;
  baton->mutex = new uv_mutex_t;
  baton->condition = new uv_cond_t;

  uv_mutex_init(baton->mutex);
  uv_cond_init(baton->condition);

  // dispatch the actual call on the node message loop
  uv_async_send(async);

  uv_mutex_lock(baton->mutex);
  uv_cond_wait(baton->condition, baton->mutex);
  uv_mutex_unlock(baton->mutex);

  uv_mutex_destroy(baton->mutex);
  uv_cond_destroy(baton->condition);

  std::string result = baton->sandboxResult;

  delete baton;

  return result;
}

NAN_METHOD(Sandbox::ConsoleError) {
  const char *arguments = *Nan::Utf8String(info[0]);

  Sandbox *sandbox = UnwrapSandbox(info.GetIsolate());

  std::string result = sandbox->DispatchSync("error", arguments);

  info.GetReturnValue().Set(Nan::New(result.c_str()).ToLocalChecked());
}

NAN_METHOD(Sandbox::ConsoleLog) {
  const char *arguments = *Nan::Utf8String(info[0]);

  Sandbox *sandbox = UnwrapSandbox(info.GetIsolate());

  std::string result = sandbox->DispatchSync("log", arguments);

  info.GetReturnValue().Set(Nan::New(result.c_str()).ToLocalChecked());
}

void Sandbox::Dispose() {
  if (isolate_) {
    {
      HandleScope scope(isolate_);

      isolate_->GetCurrentContext()->Exit();
    }

    if (global_) {
      global_->Reset();
      global_ = nullptr;
    }

    if (context_) {
      context_->Reset();
      context_ = nullptr;
    }

    isolate_->Exit();

    if (locker_) {
      delete locker_;
      locker_ = nullptr;
    }

    isolate_->Dispose();

    isolate_ = nullptr;
  }

  delete params_.array_buffer_allocator;

  params_.array_buffer_allocator = nullptr;
}
