#include "mutation_engine.hpp"

#include <cstring>

#include "signal_codec.hpp"

namespace bored::signalscope {

void MutationEngine::init() {
    staging_count_ = 0;
    active_count_ = 0;
    std::memset(bucket_head_, 0xFF, sizeof(bucket_head_));
    std::memset(next_, 0xFF, sizeof(next_));
}

bool MutationEngine::stageMutation(const SignalMutation& mutation) {
    for (size_t i = 0; i < staging_count_; ++i) {
        SignalMutation& existing = staging_[i];
        if (existing.can_id == mutation.can_id &&
            existing.direction == mutation.direction &&
            existing.start_bit == mutation.start_bit &&
            existing.length == mutation.length) {
            existing = mutation;
            return true;
        }
    }

    if (staging_count_ >= kMaxMutations) {
        return false;
    }

    staging_[staging_count_] = mutation;
    ++staging_count_;
    return true;
}

void MutationEngine::clearStaging() {
    staging_count_ = 0;
}

void MutationEngine::revertStagingToActive() {
    staging_count_ = active_count_;
    if (active_count_ > 0U) {
        std::memcpy(staging_, active_, active_count_ * sizeof(SignalMutation));
    }
}

bool MutationEngine::applyCommit() {
    active_count_ = staging_count_;
    if (staging_count_ > 0U) {
        std::memcpy(active_, staging_, staging_count_ * sizeof(SignalMutation));
    }

    rebuildIndex();
    return true;
}

size_t MutationEngine::stagingCount() const {
    return staging_count_;
}

size_t MutationEngine::activeCount() const {
    return active_count_;
}

const SignalMutation* MutationEngine::lookup(
    uint32_t can_id,
    Direction direction,
    uint16_t start_bit,
    uint8_t length) const {

    const uint32_t bucket = keyHash(can_id, direction) % kBucketCount;
    int16_t idx = bucket_head_[bucket];
    while (idx >= 0) {
        const SignalMutation& mutation = active_[idx];
        if (mutation.can_id == can_id &&
            mutation.direction == direction &&
            mutation.start_bit == start_bit &&
            mutation.length == length &&
            mutation.enabled) {
            return &mutation;
        }
        idx = next_[idx];
    }

    return nullptr;
}

const SignalMutation* MutationEngine::activeAt(size_t index) const {
    if (index >= active_count_) {
        return nullptr;
    }
    return &active_[index];
}

bool MutationEngine::setMutationEnabled(
    uint32_t can_id,
    Direction direction,
    uint16_t start_bit,
    uint8_t length,
    bool enabled) {

    bool found = false;

    for (size_t i = 0; i < active_count_; ++i) {
        SignalMutation& mutation = active_[i];
        if (mutation.can_id == can_id &&
            mutation.direction == direction &&
            mutation.start_bit == start_bit &&
            mutation.length == length) {
            mutation.enabled = enabled;
            found = true;
        }
    }

    for (size_t i = 0; i < staging_count_; ++i) {
        SignalMutation& mutation = staging_[i];
        if (mutation.can_id == can_id &&
            mutation.direction == direction &&
            mutation.start_bit == start_bit &&
            mutation.length == length) {
            mutation.enabled = enabled;
        }
    }

    if (found) {
        rebuildIndex();
    }

    return found;
}

size_t MutationEngine::applyFrameMutations(CanFrame& frame) const {
    size_t applied = 0;
    const uint32_t bucket = keyHash(frame.id, frame.direction) % kBucketCount;
    int16_t idx = bucket_head_[bucket];
    while (idx >= 0) {
        const SignalMutation& mutation = active_[idx];
        if (mutation.can_id == frame.id && mutation.direction == frame.direction && mutation.enabled) {
            if (applyMutationToFrame(frame, mutation)) {
                ++applied;
            }
        }
        idx = next_[idx];
    }

    return applied;
}

uint32_t MutationEngine::keyHash(uint32_t can_id, Direction direction) {
    const uint32_t seed = can_id ^ (static_cast<uint32_t>(direction) * 0x9E3779B9U);
    return seed ^ (seed >> 16U);
}

void MutationEngine::rebuildIndex() {
    std::memset(bucket_head_, 0xFF, sizeof(bucket_head_));
    std::memset(next_, 0xFF, sizeof(next_));

    for (size_t i = 0; i < active_count_; ++i) {
        const uint32_t bucket = keyHash(active_[i].can_id, active_[i].direction) % kBucketCount;
        next_[i] = bucket_head_[bucket];
        bucket_head_[bucket] = static_cast<int16_t>(i);
    }
}

}  // namespace bored::signalscope
