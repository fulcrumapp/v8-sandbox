#ifndef __COMMON_H__
#define __COMMON_H__

#include <string>
#include <v8.h>

inline void ThrowTypeError(v8::Isolate* isolate, const std::string& message) {
  isolate->ThrowException(v8::Exception::TypeError(
    v8::String::NewFromUtf8(isolate, message.c_str()).ToLocalChecked()));
}

#define NODE_ARG_STRING(num, name)                                        \
  if (info.Length() < num + 1) {                                          \
    ThrowTypeError(info.GetIsolate(), std::string(name) + " must be given"); \
    return;                                                               \
  }                                                                       \
  if (!info[num]->IsString()) {                                           \
    ThrowTypeError(info.GetIsolate(), std::string(name) + " must be a string"); \
    return;                                                               \
  }

#define NODE_ARG_NUMBER(num, name)                                        \
  if (info.Length() < num + 1) {                                          \
    ThrowTypeError(info.GetIsolate(), std::string(name) + " must be given"); \
    return;                                                               \
  }                                                                       \
  if (!info[num]->IsNumber()) {                                           \
    ThrowTypeError(info.GetIsolate(), std::string(name) + " must be a number"); \
    return;                                                               \
  }

#define NODE_ARG_INTEGER(num, name)                                       \
  if (info.Length() < num + 1) {                                          \
    ThrowTypeError(info.GetIsolate(), std::string(name) + " must be given"); \
    return;                                                               \
  }                                                                       \
  if (!info[num]->IsInt32()) {                                            \
    ThrowTypeError(info.GetIsolate(), std::string(name) + " must be an integer"); \
    return;                                                               \
  }

#define NODE_ARG_FUNCTION(num, name)                                      \
  if (info.Length() < num + 1) {                                          \
    ThrowTypeError(info.GetIsolate(), std::string(name) + " must be given"); \
    return;                                                               \
  }                                                                       \
  if (!info[num]->IsFunction()) {                                         \
    ThrowTypeError(info.GetIsolate(), std::string(name) + " must be a function"); \
    return;                                                               \
  }

#define NODE_ARG_FUNCTION_OPTIONAL(num, name)                             \
  if (info.Length() < num + 1) {                                          \
    ThrowTypeError(info.GetIsolate(), std::string(name) + " must be given"); \
    return;                                                               \
  }                                                                       \
  if (!(info[num]->IsFunction() || info[num]->IsNull())) {                \
    ThrowTypeError(info.GetIsolate(), std::string(name) + " must be a function"); \
    return;                                                               \
  }

#define NODE_ARG_BOOLEAN_OPTIONAL(num, name)                              \
  if (info.Length() < num + 1) {                                          \
    ThrowTypeError(info.GetIsolate(), std::string(name) + " must be given"); \
    return;                                                               \
  }                                                                       \
  if (!(info[num]->IsBoolean() || info[num]->IsNull())) {                 \
    ThrowTypeError(info.GetIsolate(), std::string(name) + " must be a boolean"); \
    return;                                                               \
  }

#endif
