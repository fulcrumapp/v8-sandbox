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
    : id(Baton::nextID()),
      instance(object),
      callback(callback)
  {}

  virtual ~Baton() {}

  int id;

  T *instance;

  PersistentCallback callback;

  static int nextID() {
    return ++nextBatonID;
  }
};

template<class T>
class AsyncOperationBaton : public Baton<T> {
public:
  AsyncOperationBaton(T *object, PersistentCallback callback)
    : Baton<T>(object, callback),
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
