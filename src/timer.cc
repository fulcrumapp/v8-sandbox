#include "timer.h"
#include <iostream>

Timer::Timer(uv_loop_t *loop, void *data)
    : data_(data),
      callback_(nullptr),
      closing_(false)
{
  uv_timer_init(loop, &timer_);
  timer_.data = this;
}

int Timer::Start(TimerCallback callback, uint64_t timeout, uint64_t repeat) {
  callback_ = callback;
  return uv_timer_start(&timer_, OnTimer, timeout, repeat);
}

int Timer::Stop(TimerCallback callback) {
  if (closing_) {
    if (callback) {
      callback(this);
    }

    return 0;
  }

  closing_ = true;

  closeCallback_ = callback;

  int status = uv_timer_stop(&timer_);

  uv_close((uv_handle_t *)&timer_, OnTimerClose);

  return status;
}

Timer::~Timer() {
  /* if (uv_is_active((uv_handle_t *)&timer_)) { */
  /*   Stop(nullptr); */
  /* } */
}

void *Timer::GetData() {
  return data_;
}

void Timer::OnTimer(uv_timer_t *handle) {
  Timer *timer = (Timer *)handle->data;

  if (timer->callback_) {
    timer->callback_(timer);
  }
}

void Timer::OnTimerClose(uv_handle_t *handle) {
  Timer *timer = (Timer *)handle->data;

  if (timer->closeCallback_) {
    timer->closeCallback_(timer);
  }
}
