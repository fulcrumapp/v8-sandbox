#ifndef __BATON_H__
#define __BATON_H__

#include <nan.h>
#include <iostream>

using namespace v8;

typedef std::shared_ptr<Nan::Persistent<Function>> PersistentCallback;

extern int nextBatonID;

template<class T>
class Baton {
public:
  Baton(T *object, PersistentCallback callback)
    : id(++nextBatonID),
      instance(object),
      callback(callback)
  {}

  virtual ~Baton() {}

  int id;

  T *instance;

  PersistentCallback callback;
};

template<class T>
class NodeInvocationBaton : public Baton<T> {
public:
  NodeInvocationBaton(T *object, PersistentCallback callback)
    : Baton<T>(object, callback),
      name(),
      arguments(),
      result(),
      dispatchNode(nullptr),
      dispatchAsync(nullptr),
      mutex(nullptr),
      condition(nullptr)
  {}

  virtual ~NodeInvocationBaton() {
    Dispose();
  }

  // function name, arguments, and its result
  std::string name;
  std::string arguments;
  std::string result;

  // node dispatch
  uv_async_t *dispatchNode;

  // async mode, used to signal the sandbox loop to wake up after the node call finishes
  uv_async_t *dispatchAsync;

  // sync mode, used to synchronously wait for the nodejs thread to provide a result
  uv_mutex_t *mutex;
  uv_cond_t *condition;

  void Dispose() {
    if (dispatchNode) {
      uv_close((uv_handle_t *)dispatchNode, OnClose);
      dispatchNode = nullptr;
    }

    if (dispatchAsync) {
      uv_close((uv_handle_t *)dispatchAsync, OnClose);
      dispatchAsync = nullptr;
    }

    if (mutex) {
      uv_mutex_destroy(mutex);
      mutex = nullptr;
    }

    if (condition) {
      uv_cond_destroy(condition);
      condition = nullptr;
    }
  }

  static void OnClose(uv_handle_t *handle) { delete handle; }
};

#endif
