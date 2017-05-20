#include <uv.h>
#include "sandbox.h"
#include <iostream>

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
  Nan::SetMethod(context->Global(), "setResult", SetResult);
  Nan::SetMethod(context->Global(), "setTimeout", SetTimeout);

  Local<String> source = Nan::New(code).ToLocalChecked();

  Local<Script> script = Script::Compile(context, source).ToLocalChecked();

  (void)script->Run(context);
}

std::string Sandbox::RunInSandbox(const char *code) {
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
