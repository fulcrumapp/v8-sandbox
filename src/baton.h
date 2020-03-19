#ifndef __BATON_H__
#define __BATON_H__

#include <nan.h>

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

#endif
