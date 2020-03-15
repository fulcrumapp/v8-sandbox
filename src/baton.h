#ifndef __BATON_H__
#define __BATON_H__

#include <nan.h>
#include <iostream>

using namespace v8;

typedef std::shared_ptr<Nan::Persistent<Function>> PersistentCallback;

template<class T>
class Baton {
public:
  Baton(int id, T *object, PersistentCallback callback)
    : id(id),
      instance(object),
      callback(callback)
  {}

  virtual ~Baton() {}

  int id;

  T *instance;

  PersistentCallback callback;
};

template<class T>
class AsyncOperationBaton : public Baton<T> {
public:
  AsyncOperationBaton(int id, T *object, PersistentCallback callback)
    : Baton<T>(id, object, callback),
      arguments(),
      result()
  {}

  virtual ~AsyncOperationBaton() {
  }

  // function name, arguments, and its result
  std::string arguments;
  std::string result;
};

#endif
