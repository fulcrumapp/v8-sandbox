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
  result_("null"),
  loop_(nullptr),
  timers_()
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
  Nan::SetMethod(context->Global(), "_clearTimeout", ClearTimeout);
  Nan::SetMethod(context->Global(), "_httpRequest", HttpRequest);
  Nan::SetMethod(context->Global(), "_log", ConsoleLog);
  Nan::SetMethod(context->Global(), "_error", ConsoleError);

  std::string prologue = "global._tryCallback(() => {\n";
  std::string epilogue = "\n});";

  std::string js = std::string(SandboxRuntime) + prologue + code + epilogue;

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
  loop_ = nullptr;

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

void Sandbox::OnTimer(uv_timer_t *timer) {
  SandboxBaton *baton = (SandboxBaton *)timer->data;

  Isolate *isolate = baton->instance->isolate_;

  HandleScope scope(isolate);

  Local<Function> cb = Nan::New(baton->callback->As<Function>());
  Local<Context> context = Nan::New(baton->instance->context_->As<Context>());
  Local<Object> global = Nan::New(baton->instance->global_->As<Object>());

  uv_timer_stop(timer);

  uv_close((uv_handle_t *)timer, OnTimerClose);

  /* TryCatch tryCatch(isolate); */

  (void)cb->Call(context, global, 0, 0);
}

void Sandbox::OnTimerClose(uv_handle_t *timer) {
  SandboxBaton *baton = (SandboxBaton *)timer->data;

  for (auto& item : baton->instance->timers_) {
    if (item.second.get() == (uv_timer_t *)timer) {
      baton->instance->timers_.erase(item.first);
      break;
    }
  }

  delete baton;
}

NAN_METHOD(Sandbox::SetTimeout) {
  auto timeout = Nan::To<int>(info[1]).FromJust();

  Sandbox *sandbox = UnwrapSandbox(info.GetIsolate());

  auto persistentCallback = std::make_shared<Nan::Persistent<Function>>(info[0].As<v8::Function>());

  auto baton = new SandboxBaton(sandbox, persistentCallback);

  std::shared_ptr<uv_timer_t> timer = std::make_shared<uv_timer_t>();
  uv_timer_init(sandbox->loop_, timer.get());
  timer->data = baton;

  sandbox->timers_[baton->id] = timer;
  sandbox->activeTimers_[baton->id] = timer;

  uv_timer_start(timer.get(), OnTimer, timeout, 0);

  info.GetReturnValue().Set(Nan::New(baton->id));
}

NAN_METHOD(Sandbox::ClearTimeout) {
  if (!info[0]->IsInt32()) {
    Nan::ThrowTypeError("first argument must be an integer");
    return;
  }

  auto timerID = Nan::To<int>(info[0]).FromJust();

  Sandbox *sandbox = UnwrapSandbox(info.GetIsolate());

  TimerMap &timers = sandbox->activeTimers_;

  auto iter = timers.find(timerID);

  if (iter != timers.end()) {
    timers.erase((*iter).first);
    uv_timer_stop((*iter).second.get());
    uv_close((uv_handle_t *)((*iter).second.get()), OnTimerClose);
  }
}

NAN_METHOD(Sandbox::AsyncNodeCallback) {
  auto object = Nan::To<Object>(info[0]).ToLocalChecked();
  const char *result = *Nan::Utf8String(info[1]);

  auto hidden = Nan::GetPrivate(object, Nan::New("baton").ToLocalChecked()).ToLocalChecked();

  Local<External> field = Local<External>::Cast(hidden);

  SandboxNodeInvocationBaton *baton = (SandboxNodeInvocationBaton *)field->Value();

  baton->result = result;

  if (baton->condition) {
    // signal the wait condition to end the synchronous call on the other thread
    uv_mutex_lock(baton->mutex);
    uv_cond_signal(baton->condition);
    uv_mutex_unlock(baton->mutex);
  } else {
    // signal the sandbox to wake up to process the result
    uv_async_send(baton->dispatchAsync);
  }
}

void Sandbox::OnEndNodeInvocation(uv_async_t *handle) {
  SandboxNodeInvocationBaton *baton = (SandboxNodeInvocationBaton *)handle->data;

  // enter the sandbox isolate
  Isolate *sandboxIsolate = baton->instance->isolate_;

  HandleScope scope(sandboxIsolate);

  Local<Function> cb = Nan::New(baton->callback->As<Function>());

  Local<Value> argv[] = {
    Nan::New(baton->result).ToLocalChecked()
  };

  baton->instance->pendingOperations_.erase(baton->id);

  (void)cb->Call(sandboxIsolate->GetCurrentContext(), sandboxIsolate->GetCurrentContext()->Global(), 1, argv);
}

void Sandbox::OnStartNodeInvocation(uv_async_t *handle) {
  SandboxNodeInvocationBaton *baton = (SandboxNodeInvocationBaton *)handle->data;

  // enter the node isolate
  Isolate *nodeIsolate = Isolate::GetCurrent();

  HandleScope scope(nodeIsolate);

  Local<Function> cb = Nan::New(baton->instance->wrap_->GetBridge().As<Function>());

  /* uv_close((uv_handle_t *)handle, OnHandleClose); */
  /* baton->dispatchNode = nullptr; */

  auto argumentObject = Nan::New<v8::Object>();

  Nan::SetPrivate(argumentObject, Nan::New("baton").ToLocalChecked(), External::New(nodeIsolate, baton));
  Nan::SetMethod(argumentObject, "callback", AsyncNodeCallback);
  Nan::Set(argumentObject, Nan::New("args").ToLocalChecked(), Nan::New(baton->arguments.c_str()).ToLocalChecked());
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
  auto cb = std::make_shared<Nan::Persistent<Function>>(callback);

  auto baton = std::make_shared<SandboxNodeInvocationBaton>(this, cb);

  pendingOperations_[baton->id] = baton;

  baton->name = name;
  baton->arguments = arguments;
  baton->mutex = nullptr;
  baton->condition = nullptr;

  // wake up the nodejs loop
  baton->dispatchNode = new uv_async_t;

  uv_async_init(uv_default_loop(), baton->dispatchNode, OnStartNodeInvocation);

  baton->dispatchNode->data = baton.get();

  uv_async_t *dispatchAsync = new uv_async_t;
  uv_async_init(loop_, dispatchAsync, OnEndNodeInvocation);
  baton->dispatchAsync = dispatchAsync;
  dispatchAsync->data = baton.get();

  uv_async_send(baton->dispatchNode);
}

std::string Sandbox::DispatchSync(const char *name, const char *arguments) {
  auto baton = std::make_shared<SandboxNodeInvocationBaton>(this,  PersistentCallback());

  pendingOperations_[baton->id] = baton;

  baton->name = name;
  baton->arguments = arguments;

  // wake up the nodejs loop
  baton->dispatchNode = new uv_async_t;

  uv_async_init(uv_default_loop(), baton->dispatchNode, OnStartNodeInvocation);

  baton->dispatchNode->data = baton.get();

  baton->dispatchAsync = nullptr;
  baton->mutex = new uv_mutex_t;
  baton->condition = new uv_cond_t;

  uv_mutex_init(baton->mutex);
  uv_cond_init(baton->condition);

  // dispatch the actual call on the node message loop
  uv_async_send(baton->dispatchNode);

  uv_mutex_lock(baton->mutex);
  uv_cond_wait(baton->condition, baton->mutex);
  uv_mutex_unlock(baton->mutex);
  baton->mutex = nullptr;

  baton->Dispose();

  std::string result = baton->result;

  pendingOperations_.erase(baton->id);


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

void Sandbox::Terminate() {
  if (isolate_) {
    isolate_->TerminateExecution();
    /* isolate_->CancelTerminateExecution(); */

    CancelPendingOperations();

    if (loop_) {
      uv_stop(loop_);
    }
  }
}

void Sandbox::OnCancelPendingOperations(uv_async_t *handle) {
  Sandbox *sandbox = (Sandbox *)handle->data;

  sandbox->pendingOperations_.clear();

  for (auto &item : sandbox->timers_) {
    uv_timer_stop(item.second.get());
    if (!uv_is_closing((uv_handle_t *)item.second.get())) {
      uv_close((uv_handle_t *)item.second.get(), OnTimerClose);
    }
  }

  uv_close((uv_handle_t *)handle, OnHandleClose);
}

void Sandbox::CancelPendingOperations() {
  if (!loop_) {
    return;
  }

  uv_async_t *cancel = new uv_async_t;
  uv_async_init(loop_, cancel, OnCancelPendingOperations);
  cancel->data = this;
  uv_async_send(cancel);
}

void Sandbox::Dispose() {
  CancelPendingOperations();

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
