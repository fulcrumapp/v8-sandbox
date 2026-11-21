#ifndef __BATON_H__
#define __BATON_H__

#include <memory>
#include <v8.h>

typedef std::shared_ptr<v8::Global<v8::Function>> PersistentCallback;

extern int nextBatonID;

template<class T>
class Baton {
public:
  Baton(T *object, PersistentCallback callback)
    : id(++nextBatonID),
      instance(object),
      callback(callback)
  {}

  virtual ~Baton() {
    if (callback) {
      callback->Reset();
    }
  }

  int id;

  T *instance;

  PersistentCallback callback;
};

#endif
