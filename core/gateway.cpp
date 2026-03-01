#include "gateway.hpp"

#include "mutation_engine.hpp"

namespace bored::signalscope {

void GatewayCore::init() {
    queue_head_ = 0;
    queue_tail_ = 0;
    stats_ = {};
}

void GatewayCore::setMutationEngine(MutationEngine* engine) {
    mutation_engine_ = engine;
}

void GatewayCore::setReplayEngine(ReplayEngine* engine) {
    replay_engine_ = engine;
}

void GatewayCore::setTxDriver(TxDriver driver) {
    tx_driver_ = driver;
}

bool GatewayCore::onFrameReceivedFromIsr(const CanFrame& frame) {
    const uint16_t next_head = nextIndex(queue_head_);
    if (next_head == queue_tail_) {
        ++stats_.dropped_frames;
        return false;
    }

    rx_queue_[queue_head_] = frame;
    queue_head_ = next_head;

    const uint16_t depth = (queue_head_ >= queue_tail_)
        ? static_cast<uint16_t>(queue_head_ - queue_tail_)
        : static_cast<uint16_t>((kRxQueueSize - queue_tail_) + queue_head_);
    stats_.rx_queue_depth = depth;

    return true;
}

bool GatewayCore::injectReplayFrame(const CanFrame& frame) {
    CanFrame mutable_frame = frame;
    forwardFrame(mutable_frame, true);
    return true;
}

void GatewayCore::pollRx(uint32_t now_us) {
    while (queue_tail_ != queue_head_) {
        CanFrame frame = rx_queue_[queue_tail_];
        frame.timestamp_us = now_us;
        queue_tail_ = nextIndex(queue_tail_);
        forwardFrame(frame, false);
    }

    const uint16_t depth = (queue_head_ >= queue_tail_)
        ? static_cast<uint16_t>(queue_head_ - queue_tail_)
        : static_cast<uint16_t>((kRxQueueSize - queue_tail_) + queue_head_);
    stats_.rx_queue_depth = depth;
}

const GatewayStats& GatewayCore::stats() const {
    return stats_;
}

void GatewayCore::forwardFrame(CanFrame& frame, bool from_replay) {
    if (mutation_engine_ != nullptr) {
        stats_.mutation_applied_frames += static_cast<uint32_t>(mutation_engine_->applyFrameMutations(frame));
    }

    if (tx_driver_ != nullptr) {
        static_cast<void>(tx_driver_(frame.direction, frame));
    }

    ++stats_.forwarded_frames;
    if (from_replay) {
        ++stats_.replay_injected_frames;
    }
}

uint16_t GatewayCore::nextIndex(uint16_t index) {
    return static_cast<uint16_t>((index + 1U) % kRxQueueSize);
}

}  // namespace bored::signalscope
