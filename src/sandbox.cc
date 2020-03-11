#include <uv.h>
#include "sandbox.h"
#include "sandbox-wrap.h"
#include "common.h"
#include <unistd.h>
#include <iostream>

void Debug(const char *msg) {
  std::cout << getpid() << " : " << msg << std::endl;
}

Sandbox::Sandbox()
: params_(),
  isolate_(nullptr),
  nodeIsolate_(nullptr),
  result_("null"),
  loop_(nullptr),
  timers_(),
  isolateData_(nullptr)
{
  uv_mutex_init(&timerLock_);
  uv_mutex_init(&pendingOperationsLock_);
}

Sandbox::~Sandbox() {
  Dispose();
  uv_mutex_destroy(&timerLock_);
  uv_mutex_destroy(&pendingOperationsLock_);
}

void Sandbox::RunIsolate(const char *code) {
  HandleScope scope(isolate_);

  Local<Context> context = Nan::New(context_);

  Context::Scope context_scope(context);

  Nan::TryCatch tryCatch;

  MaybeLocal<Script> script = Script::Compile(context, Nan::New(code).ToLocalChecked());

  if (!tryCatch.HasCaught()) {
    (void)script.ToLocalChecked()->Run(context);
  }

  MaybeHandleError(tryCatch, context);
}

std::string Sandbox::Initialize(SandboxWrap *wrap, const char *runtime) {
  wrap_ = wrap;

  loop_ = (uv_loop_t *)malloc(sizeof(uv_loop_t));

  uv_loop_init(loop_);

#if NODE_MAJOR_VERSION >= 11
  auto allocator = node::CreateArrayBufferAllocator();

  params_.array_buffer_allocator = (ArrayBuffer::Allocator *)allocator;

  isolate_ = node::NewIsolate(allocator,
                              loop_,
                              node::GetMainThreadMultiIsolatePlatform());

  {
    Locker locker(isolate_);
    Isolate::Scope isolate_scope(isolate_);
    HandleScope handle_scope(isolate_);

    isolateData_ = node::CreateIsolateData(isolate_,
                                           loop_,
                                           node::GetMainThreadMultiIsolatePlatform(),
                                           allocator);

    isolate_->SetMicrotasksPolicy(v8::MicrotasksPolicy::kAuto);
  }
#elif NODE_MAJOR_VERSION >= 9
  auto allocator = node::CreateArrayBufferAllocator();

  params_.array_buffer_allocator = (ArrayBuffer::Allocator *)allocator;

  isolate_ = node::NewIsolate(allocator);

  {
    Locker locker(isolate_);
    Isolate::Scope isolate_scope(isolate_);
    HandleScope handle_scope(isolate_);

    isolateData_ = node::CreateIsolateData(isolate_,
                                           loop_,
                                           node::GetMainThreadMultiIsolatePlatform(),
                                           allocator);

    isolate_->SetMicrotasksPolicy(v8::MicrotasksPolicy::kAuto);
  }
#endif

  Locker locker(isolate_);
  Isolate::Scope isolate_scope(isolate_);
  HandleScope scope(isolate_);

  context_.Reset(Context::New(isolate_));
  nodeContext_.Reset(Nan::New(wrap->GetNodeContext()));
  nodeIsolate_ = wrap->GetNodeIsolate();

  auto context = GetContext();

  Context::Scope context_scope(context);

  isolate_->GetCurrentContext()->SetAlignedPointerInEmbedderData(
    32 /* ContextEmbedderIndex::kEnvironment */, wrap->GetEnvironment());

  // // Used by EnvPromiseHook to know that we are on a node context.
  isolate_->GetCurrentContext()->SetAlignedPointerInEmbedderData(
    35 /* ContextEmbedderIndex::kContextTag */, wrap->GetContextTag());

  global_.Reset(context->Global());

  Nan::SetPrivate(context->Global(), Nan::New("sandbox").ToLocalChecked(), External::New(isolate_, this));

  Nan::Set(context->Global(), Nan::New("global").ToLocalChecked(), context->Global());
  Nan::SetMethod(context->Global(), "_setResult", SetResult);
  Nan::SetMethod(context->Global(), "_dispatchSync", DispatchSync);
  Nan::SetMethod(context->Global(), "_dispatchAsync", DispatchAsync);
  Nan::SetMethod(context->Global(), "_setTimeout", SetTimeout);
  Nan::SetMethod(context->Global(), "_clearTimeout", ClearTimeout);
  Nan::SetMethod(context->Global(), "_httpRequest", HttpRequest);
  Nan::SetMethod(context->Global(), "_log", ConsoleLog);
  Nan::SetMethod(context->Global(), "_error", ConsoleError);

  result_= "";

  RunIsolate(runtime);

  return result_;
}

std::string Sandbox::RunInSandbox(const char *code) {
  ENTER_ISOLATE(isolate_, context_);

  // Locker locker(isolate_);
  // Isolate::Scope isolate_scope(isolate_);
  // HandleScope scope(isolate_);
  // Local<Context> context = Nan::New(context_);
  // Context::Scope context_scope(context);

  RunIsolate(code);

  uv_run(loop_, UV_RUN_DEFAULT);

  return result_;
}

void Sandbox::Finalize() {
  Dispose();
}

void Sandbox::MaybeHandleError(Nan::TryCatch &tryCatch, Local<Context> &context) {
  if (!tryCatch.HasCaught()) {
    return;
  }

  auto result = Nan::New<Object>();
  auto error = Nan::New<Object>();

  Nan::Utf8String message(tryCatch.Message()->Get());
  Nan::Utf8String stack(tryCatch.StackTrace().ToLocalChecked());
  int lineNumber = tryCatch.Message()->GetLineNumber(context).FromJust();

  Nan::Set(result, Nan::New("error").ToLocalChecked(), error);

  Nan::Set(error, Nan::New("message").ToLocalChecked(), Nan::New(*message).ToLocalChecked());
  Nan::Set(error, Nan::New("stack").ToLocalChecked(), Nan::New(*stack).ToLocalChecked());
  Nan::Set(error, Nan::New("lineNumber").ToLocalChecked(), Nan::New(lineNumber));

  auto json = JSON::Stringify(context, result).ToLocalChecked();

  result_ = *Nan::Utf8String(json);
}

Sandbox *UnwrapSandbox(Isolate *isolate) {
  auto context = isolate->GetCurrentContext();

  auto hidden = Nan::GetPrivate(context->Global(), Nan::New("sandbox").ToLocalChecked()).ToLocalChecked();

  Local<External> field = Local<External>::Cast(hidden);

  Sandbox *sandbox = (Sandbox *)field->Value();

  return sandbox;
}

NAN_METHOD(Sandbox::SetResult) {
  NODE_ARG_STRING(0, "result");

  Nan::Utf8String value(info[0]);

  Sandbox *sandbox = UnwrapSandbox(info.GetIsolate());

  sandbox->result_ = *value;
}

NAN_METHOD(Sandbox::DispatchSync) {
  NODE_ARG_STRING(0, "parameters");

  Nan::Utf8String arguments(info[0]);

  Sandbox *sandbox = UnwrapSandbox(info.GetIsolate());

  std::string result = sandbox->DispatchSync("dispatchSync", *arguments);
  info.GetReturnValue().Set(Nan::New(result.c_str()).ToLocalChecked());
}

NAN_METHOD(Sandbox::DispatchAsync) {
  NODE_ARG_STRING(0, "parameters");
  NODE_ARG_FUNCTION(1, "callback");

  Nan::Utf8String arguments(info[0]);

  Sandbox *sandbox = UnwrapSandbox(info.GetIsolate());

  sandbox->DispatchAsync("dispatchAsync", *arguments, info[1].As<Function>());
}

void Sandbox::OnHandleClose(uv_handle_t *handle) {
  delete handle;
}

void Sandbox::OnTimer(uv_timer_t *timer) {
  SandboxBaton *baton = (SandboxBaton *)timer->data;

  Isolate *isolate = baton->instance->isolate_;

  // ENTER_ISOLATE(isolate, baton->instance->context_);

  Locker locker(isolate);
  Isolate::Scope isolate_scope(isolate);
  HandleScope scope(isolate);

  Local<Function> cb = Nan::New(baton->callback->As<Function>());
  Local<Context> context = Nan::New(baton->instance->context_);
  Local<Object> global = Nan::New(baton->instance->global_);

  uv_timer_stop(timer);

  uv_close((uv_handle_t *)timer, OnTimerClose);

  Context::Scope context_scope(context);

  Nan::TryCatch tryCatch;

  (void)cb->Call(context, global, 0, 0);

  baton->instance->MaybeHandleError(tryCatch, context);
}

void Sandbox::OnTimerClose(uv_handle_t *timer) {
  SandboxBaton *baton = (SandboxBaton *)timer->data;

  baton->instance->LockTimers();

  for (auto& item : baton->instance->timers_) {
    if (item.second.get() == (uv_timer_t *)timer) {
      baton->instance->timers_.erase(item.first);
      break;
    }
  }

  baton->instance->UnlockTimers();

  delete baton;
}

NAN_METHOD(Sandbox::SetTimeout) {
  NODE_ARG_FUNCTION(0, "callback");
  NODE_ARG_NUMBER(1, "timeout");

  auto timeout = Nan::To<int64_t>(info[1]).FromJust();

  Sandbox *sandbox = UnwrapSandbox(info.GetIsolate());

  auto persistentCallback = std::make_shared<Nan::Persistent<Function>>(info[0].As<Function>());

  auto baton = new SandboxBaton(sandbox, persistentCallback);

  std::shared_ptr<uv_timer_t> timer = std::make_shared<uv_timer_t>();
  uv_timer_init(sandbox->loop_, timer.get());
  timer->data = baton;

  sandbox->LockTimers();

  sandbox->timers_[baton->id] = timer;
  sandbox->activeTimers_[baton->id] = timer;

  sandbox->UnlockTimers();

  uv_timer_start(timer.get(), OnTimer, timeout, 0);

  info.GetReturnValue().Set(Nan::New(baton->id));
}

NAN_METHOD(Sandbox::ClearTimeout) {
  NODE_ARG_INTEGER(0, "timer id");

  auto timerID = Nan::To<int>(info[0]).FromJust();

  Sandbox *sandbox = UnwrapSandbox(info.GetIsolate());

  sandbox->LockTimers();

  TimerMap &timers = sandbox->activeTimers_;

  auto iter = timers.find(timerID);

  if (iter != timers.end()) {
    timers.erase((*iter).first);
    uv_timer_stop((*iter).second.get());
    uv_close((uv_handle_t *)((*iter).second.get()), OnTimerClose);
  }

  sandbox->UnlockTimers();
}

NAN_METHOD(Sandbox::AsyncNodeCallback) {
  auto object = Nan::To<Object>(info[0]).ToLocalChecked();

  Nan::Utf8String result(info[1]);

  auto hidden = Nan::GetPrivate(object, Nan::New("baton").ToLocalChecked()).ToLocalChecked();

  Local<External> field = Local<External>::Cast(hidden);

  SandboxNodeInvocationBaton *baton = (SandboxNodeInvocationBaton *)field->Value();

  baton->result = *result;

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

  // ENTER_ISOLATE(baton->instance->isolate_, baton->instance->context_);

  // enter the sandbox isolate
  Isolate *sandboxIsolate = baton->instance->isolate_;

  Locker locker(sandboxIsolate);
  Isolate::Scope isolate_scope(sandboxIsolate);
  HandleScope scope(sandboxIsolate);

  Local<Context> context = Nan::New(baton->instance->context_);

  Context::Scope context_scope(context);

  Local<Function> cb = Nan::New(baton->callback->As<Function>());

  Local<Value> argv[] = {
    Nan::New(baton->result).ToLocalChecked()
  };

  Nan::TryCatch tryCatch;

  (void)cb->Call(context, sandboxIsolate->GetCurrentContext()->Global(), 1, argv);

  baton->instance->MaybeHandleError(tryCatch, context);

  baton->instance->LockPendingOperations();

  baton->instance->pendingOperations_.erase(baton->id);

  baton->instance->UnlockPendingOperations();
}

void Sandbox::OnStartNodeInvocation(uv_async_t *handle) {
  SandboxNodeInvocationBaton *baton = (SandboxNodeInvocationBaton *)handle->data;

  // ENTER_ISOLATE(baton->instance->nodeIsolate_, baton->instance->nodeContext_);

  // enter the node isolate
  Isolate *nodeIsolate = Isolate::GetCurrent();

  Locker locker(nodeIsolate);
  Isolate::Scope isolate_scope(nodeIsolate);
  HandleScope scope(nodeIsolate);

  Context::Scope context_scope(nodeIsolate->GetCurrentContext());

  Local<Function> cb = Nan::New(baton->instance->wrap_->GetBridge().As<Function>());

  auto argumentObject = Nan::New<Object>();

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
  NODE_ARG_STRING(0, "parameters");

  Nan::Utf8String arguments(info[0]);

  Sandbox *sandbox = UnwrapSandbox(info.GetIsolate());

  bool synchronous = info[1]->IsNull() || info[1]->IsUndefined();

  if (synchronous) {
    std::string result = sandbox->DispatchSync("httpRequest", *arguments);
    info.GetReturnValue().Set(Nan::New(result.c_str()).ToLocalChecked());
  } else {
    NODE_ARG_FUNCTION(1, "callback");

    sandbox->DispatchAsync("httpRequest", *arguments, info[1].As<Function>());
  }
}

void Sandbox::DispatchAsync(const char *name, const char *arguments, Local<Function> callback) {
  auto cb = std::make_shared<Nan::Persistent<Function>>(callback);

  auto baton = std::make_shared<SandboxNodeInvocationBaton>(this, cb);

  LockPendingOperations();

  pendingOperations_[baton->id] = baton;

  UnlockPendingOperations();

  baton->name = name;
  baton->arguments = arguments;

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

  LockPendingOperations();

  pendingOperations_[baton->id] = baton;

  UnlockPendingOperations();

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

  // lock the mutex before entering the node context to avoid a race condition
  uv_mutex_lock(baton->mutex);

  // dispatch the actual call on the node message loop
  uv_async_send(baton->dispatchNode);

  uv_cond_wait(baton->condition, baton->mutex);
  uv_mutex_unlock(baton->mutex);

  std::string result = baton->result;

  LockPendingOperations();

  pendingOperations_.erase(baton->id);

  UnlockPendingOperations();

  return result;
}

NAN_METHOD(Sandbox::ConsoleError) {
  NODE_ARG_STRING(0, "parameters");

  Nan::Utf8String arguments(info[0]);

  Sandbox *sandbox = UnwrapSandbox(info.GetIsolate());

  std::string result = sandbox->DispatchSync("error", *arguments);

  info.GetReturnValue().Set(Nan::New(result.c_str()).ToLocalChecked());
}

NAN_METHOD(Sandbox::ConsoleLog) {
  NODE_ARG_STRING(0, "parameters");

  Nan::Utf8String arguments(info[0]);

  Sandbox *sandbox = UnwrapSandbox(info.GetIsolate());

  std::string result = sandbox->DispatchSync("log", *arguments);

  info.GetReturnValue().Set(Nan::New(result.c_str()).ToLocalChecked());
}

void Sandbox::OnCancelPendingOperations(uv_async_t *handle) {
  Sandbox *sandbox = (Sandbox *)handle->data;

  sandbox->LockPendingOperations();

  sandbox->pendingOperations_.clear();

  sandbox->UnlockPendingOperations();

  sandbox->LockTimers();

  for (auto &item : sandbox->timers_) {
    uv_timer_stop(item.second.get());

    if (!uv_is_closing((uv_handle_t *)item.second.get())) {
      uv_close((uv_handle_t *)item.second.get(), OnTimerClose);
    }
  }

  uv_close((uv_handle_t *)handle, OnHandleClose);

  sandbox->UnlockTimers();
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

    /* Let the main node process handle this

    {
      Locker locker(isolate_);
      Isolate::Scope isolate_scope(isolate_);
      HandleScope scope(isolate_);

#if NODE_MAJOR_VERSION >= 11
      node::GetMainThreadMultiIsolatePlatform()->DrainTasks(isolate_);
#elif NODE_MAJOR_VERSION >= 9
      node::GetMainThreadMultiIsolatePlatform()->DrainBackgroundTasks(isolate_);
#endif

#if NODE_MAJOR_VERSION >= 9
      node::GetMainThreadMultiIsolatePlatform()->CancelPendingDelayedTasks(isolate_);
#endif
    }

    */

    global_.Reset();
    context_.Reset();
    nodeContext_.Reset();

    isolate_->Dispose();

#if NODE_MAJOR_VERSION >= 11
    node::GetMainThreadMultiIsolatePlatform()->UnregisterIsolate(isolate_);
#endif
    node::FreeIsolateData(isolateData_);
    isolateData_ = nullptr;

    isolate_ = nullptr;
  }

  if (params_.array_buffer_allocator) {
#if NODE_MAJOR_VERSION >= 9
    node::FreeArrayBufferAllocator((node::ArrayBufferAllocator *)params_.array_buffer_allocator);
#endif

    params_.array_buffer_allocator = nullptr;
  }

  if (loop_) {
    uv_loop_close(loop_);
    free(loop_);
    loop_ = nullptr;
  }
}

void Sandbox::LockTimers() {
  uv_mutex_lock(&timerLock_);
}

void Sandbox::UnlockTimers() {
  uv_mutex_unlock(&timerLock_);
}

void Sandbox::LockPendingOperations() {
  uv_mutex_lock(&pendingOperationsLock_);
}

void Sandbox::UnlockPendingOperations() {
  uv_mutex_unlock(&pendingOperationsLock_);
}
