#define NODE_ARG_STRING(num, name)                                                  \
  if (info.Length() < num + 1) {                                                    \
    return Nan::ThrowTypeError((std::string(name) + " must be given").c_str());     \
  }                                                                                 \
  if (!info[num]->IsString()) {                                                     \
    return Nan::ThrowTypeError((std::string(name) + " must be a string").c_str()); \
  }

#define NODE_ARG_NUMBER(num, name)                                                  \
  if (info.Length() < num + 1) {                                                    \
    return Nan::ThrowTypeError((std::string(name) + " must be given").c_str());     \
  }                                                                                 \
  if (!info[num]->IsNumber()) {                                                     \
    return Nan::ThrowTypeError((std::string(name) + " must be a number").c_str());  \
  }

#define NODE_ARG_INTEGER(num, name)                                                  \
  if (info.Length() < num + 1) {                                                     \
    return Nan::ThrowTypeError((std::string(name) + " must be given").c_str());      \
  }                                                                                  \
  if (!info[num]->IsInt32()) {                                                       \
    return Nan::ThrowTypeError((std::string(name) + " must be an integer").c_str()); \
  }

#define NODE_ARG_FUNCTION(num, name)                                                 \
  if (info.Length() < num + 1) {                                                     \
    return Nan::ThrowTypeError((std::string(name) + " must be given").c_str());      \
  }                                                                                  \
  if (!info[num]->IsFunction()) {                                                    \
    return Nan::ThrowTypeError((std::string(name) + " must be a function").c_str()); \
  }

#define NODE_ARG_FUNCTION_OPTIONAL(num, name)                                        \
  if (info.Length() < num + 1) {                                                     \
    return Nan::ThrowTypeError((std::string(name) + " must be given").c_str());      \
  }                                                                                  \
  if (!(info[num]->IsFunction() || info[num]->IsNull())) {                           \
    return Nan::ThrowTypeError((std::string(name) + " must be a function").c_str()); \
  }