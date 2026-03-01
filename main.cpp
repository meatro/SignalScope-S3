#include <Arduino.h>
#include <LittleFS.h>
#include <SPI.h>
#include <WebServer.h>
#include <WiFi.h>
#include <driver/twai.h>
#include <mcp2515.h>

#include <cstdio>
#include <cstdlib>

#include "core/dbc_parser.hpp"
#include "core/gateway.hpp"
#include "core/signal_codec.hpp"
#include "core/mutation_engine.hpp"
#include "core/replay_engine.hpp"
#include "fs/persistence.hpp"

using namespace bored::signalscope;

namespace {

constexpr const char* kApSsid = "SignalScope-AP";
constexpr const char* kApPassword = "signalscope";
constexpr size_t kRecentFrameCapacity = 40;
constexpr size_t kMaxPollFramesPerBus = 128;
constexpr size_t kMaxDecodedSignalsPerFrame = 24;

constexpr int kBusARxPin = 6;
constexpr int kBusATxPin = 7;
constexpr int kMcpCsPin = 10;
constexpr int kMcpSclkPin = 12;
constexpr int kMcpMosiPin = 11;
constexpr int kMcpMisoPin = 13;
constexpr int kMcpRstPin = 9;

GatewayCore gateway;
MutationEngine mutation_engine;
ReplayEngine replay_engine;
DbcDatabase dbc_database;
PersistenceStore persistence;
WebServer server(80);
MCP2515 can_mcp(kMcpCsPin, 10000000, &SPI);

bool bus_a_ready = false;
bool bus_b_ready = false;
bool fs_mounted = false;
String ui_index_path = "/index.html";
struct UiFrame {
    CanFrame frame{};
    uint16_t rate_hz = 0;
    bool tx_ok = false;
};

UiFrame recent_frames[kRecentFrameCapacity];
size_t recent_head = 0;
size_t recent_count = 0;

uint32_t last_rate_sample_ms = 0;
uint32_t last_sample_forwarded_frames = 0;
uint16_t frame_rate_fps = 0;

const char* directionToString(Direction direction) {
    return (direction == Direction::A_TO_B) ? "A_TO_B" : "B_TO_A";
}

Direction parseDirectionFromText(const String& text, Direction fallback) {
    if (text == "A_TO_B") {
        return Direction::A_TO_B;
    }
    if (text == "B_TO_A") {
        return Direction::B_TO_A;
    }
    return fallback;
}

MutationOperation parseOperationFromText(const String& text) {
    if (text == "REPLACE") return MutationOperation::REPLACE;
    if (text == "ADD_OFFSET") return MutationOperation::ADD_OFFSET;
    if (text == "MULTIPLY") return MutationOperation::MULTIPLY;
    if (text == "CLAMP") return MutationOperation::CLAMP;
    return MutationOperation::PASS_THROUGH;
}

const char* operationToString(MutationOperation op) {
    switch (op) {
    case MutationOperation::REPLACE:
        return "REPLACE";
    case MutationOperation::ADD_OFFSET:
        return "ADD_OFFSET";
    case MutationOperation::MULTIPLY:
        return "MULTIPLY";
    case MutationOperation::CLAMP:
        return "CLAMP";
    case MutationOperation::PASS_THROUGH:
    default:
        return "PASS_THROUGH";
    }
}

bool parseBoolText(const String& text, bool fallback) {
    if (text == "1" || text == "true" || text == "TRUE" || text == "on") {
        return true;
    }
    if (text == "0" || text == "false" || text == "FALSE" || text == "off") {
        return false;
    }
    return fallback;
}

uint32_t parseUIntArg(const char* name, uint32_t fallback) {
    if (!server.hasArg(name)) {
        return fallback;
    }

    const String text = server.arg(name);
    char* end_ptr = nullptr;
    const unsigned long value = std::strtoul(text.c_str(), &end_ptr, 0);
    if (end_ptr == text.c_str()) {
        return fallback;
    }
    return static_cast<uint32_t>(value);
}

float parseFloatArg(const char* name, float fallback) {
    if (!server.hasArg(name)) {
        return fallback;
    }

    const String text = server.arg(name);
    return text.toFloat();
}

String contentTypeForPath(const String& path) {
    if (path.endsWith(".html")) return "text/html";
    if (path.endsWith(".css")) return "text/css";
    if (path.endsWith(".js")) return "application/javascript";
    if (path.endsWith(".json")) return "application/json";
    if (path.endsWith(".png")) return "image/png";
    if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
    if (path.endsWith(".svg")) return "image/svg+xml";
    if (path.endsWith(".woff")) return "font/woff";
    if (path.endsWith(".woff2")) return "font/woff2";
    if (path.endsWith(".ttf")) return "font/ttf";
    if (path.endsWith(".eot")) return "application/vnd.ms-fontobject";
    if (path.endsWith(".ico")) return "image/x-icon";
    return "application/octet-stream";
}

void resolveUiIndexPath() {
    static const char* candidates[] = {
        "/index.html",
        "/index.htm",
    };

    ui_index_path = "/index.html";
    for (size_t i = 0; i < (sizeof(candidates) / sizeof(candidates[0])); ++i) {
        if (LittleFS.exists(candidates[i])) {
            ui_index_path = candidates[i];
            break;
        }
    }

    Serial.printf("[fs] ui index candidate: %s (exists=%d)\n", ui_index_path.c_str(), LittleFS.exists(ui_index_path));
}

void logLittleFsContents() {
    Serial.printf("[fs] total=%lu used=%lu\n", static_cast<unsigned long>(LittleFS.totalBytes()), static_cast<unsigned long>(LittleFS.usedBytes()));

    File root = LittleFS.open("/");
    if (!root || !root.isDirectory()) {
        Serial.println("[fs] failed to open root directory");
        return;
    }

    File file = root.openNextFile();
    size_t shown = 0;
    while (file) {
        Serial.printf("[fs] file: %s (%lu bytes)\n", file.name(), static_cast<unsigned long>(file.size()));
        file = root.openNextFile();
        ++shown;
        if (shown >= 80U) {
            Serial.println("[fs] file list truncated");
            break;
        }
    }

    if (shown == 0U) {
        Serial.println("[fs] root directory is empty");
    }
}

bool serveStaticFile(const String& path) {
    if (!fs_mounted) {
        return false;
    }

    String fs_path = path;
    if (fs_path == "/") {
        fs_path = ui_index_path;
    }

    if (!LittleFS.exists(fs_path) && !fs_path.endsWith("/")) {
        const String maybe_index = fs_path + "/index.html";
        if (LittleFS.exists(maybe_index)) {
            fs_path = maybe_index;
        }
    }

    if (!LittleFS.exists(fs_path)) {
        return false;
    }

    File file = LittleFS.open(fs_path, "r");
    if (!file) {
        return false;
    }

    server.streamFile(file, contentTypeForPath(fs_path));
    file.close();
    return true;
}
void addRecentFrame(const CanFrame& frame, uint16_t rate_hz, bool tx_ok) {
    size_t index = 0;
    if (recent_count < kRecentFrameCapacity) {
        index = (recent_head + recent_count) % kRecentFrameCapacity;
        ++recent_count;
    } else {
        index = recent_head;
        recent_head = (recent_head + 1U) % kRecentFrameCapacity;
    }

    recent_frames[index].frame = frame;
    recent_frames[index].rate_hz = rate_hz;
    recent_frames[index].tx_ok = tx_ok;
}

String frameDataHex(const CanFrame& frame) {
    String out;
    out.reserve(24);

    for (uint8_t i = 0; i < frame.dlc && i < 8U; ++i) {
        if (i > 0U) {
            out += ' ';
        }

        char byte_text[3] = {0};
        std::snprintf(byte_text, sizeof(byte_text), "%02X", frame.data[i]);
        out += byte_text;
    }

    return out;
}

String escapeJsonString(const char* input) {
    String out;
    if (input == nullptr) {
        return out;
    }

    for (size_t i = 0; input[i] != '\0'; ++i) {
        const char c = input[i];
        switch (c) {
        case '\\':
            out += "\\\\";
            break;
        case '"':
            out += "\\\"";
            break;
        case '\b':
            out += "\\b";
            break;
        case '\f':
            out += "\\f";
            break;
        case '\n':
            out += "\\n";
            break;
        case '\r':
            out += "\\r";
            break;
        case '\t':
            out += "\\t";
            break;
        default:
            if (static_cast<unsigned char>(c) < 0x20U) {
                out += ' ';
            } else {
                out += c;
            }
            break;
        }
    }

    return out;
}

const DbcSignalDef* findSignalByLocation(uint32_t can_id, uint16_t start_bit, uint8_t length) {
    const size_t total = dbc_database.signalCount();
    for (size_t i = 0; i < total; ++i) {
        const DbcSignalDef* signal = dbc_database.signalAt(i);
        if (signal == nullptr) {
            continue;
        }

        if (signal->can_id == can_id && signal->start_bit == start_bit && signal->length == length) {
            return signal;
        }
    }

    return nullptr;
}

void appendDecodedSignalsJson(String& json, const CanFrame& frame) {
    const DbcMessageDef* message = dbc_database.findMessage(frame.id);

    json += "\"message_name\":";
    if (message != nullptr && message->name[0] != '\0') {
        json += "\"" + escapeJsonString(message->name) + "\"";
    } else {
        json += "null";
    }
    json += ",";

    json += "\"decoded_signals\":[";
    if (message != nullptr && message->signal_count > 0U) {
        const size_t message_signal_count = static_cast<size_t>(message->signal_count);
        const size_t max_signals = (message_signal_count > kMaxDecodedSignalsPerFrame)
            ? kMaxDecodedSignalsPerFrame
            : message_signal_count;

        bool first_signal = true;
        for (size_t i = 0; i < max_signals; ++i) {
            const size_t signal_index = static_cast<size_t>(message->signal_start) + i;
            const DbcSignalDef* signal = dbc_database.signalAt(signal_index);
            if (signal == nullptr) {
                break;
            }

            float value = 0.0F;
            if (!decodeSignal(frame, *signal, value)) {
                continue;
            }

            const bool mutated = (mutation_engine.lookup(
                frame.id,
                frame.direction,
                signal->start_bit,
                signal->length) != nullptr);

            if (!first_signal) {
                json += ',';
            }
            first_signal = false;

            json += "{";
            json += "\"name\":\"" + escapeJsonString(signal->name) + "\",";
            json += "\"value\":" + String(value, 3) + ",";
            json += "\"start_bit\":" + String(signal->start_bit) + ",";
            json += "\"length\":" + String(signal->length) + ",";
            json += "\"little_endian\":" + String(signal->little_endian ? "true" : "false") + ",";
            json += "\"is_signed\":" + String(signal->is_signed ? "true" : "false") + ",";
            json += "\"factor\":" + String(signal->factor, 6) + ",";
            json += "\"offset\":" + String(signal->offset, 6) + ",";
            json += "\"mutated\":" + String(mutated ? "true" : "false");
            json += "}";
        }
    }
    json += "]";
}

void appendActiveMutationsJson(String& json) {
    json += "\"active_mutation_items\":[";

    bool first = true;
    const size_t count = mutation_engine.activeCount();
    for (size_t i = 0; i < count; ++i) {
        const SignalMutation* mutation = mutation_engine.activeAt(i);
        if (mutation == nullptr) {
            continue;
        }

        char id_text[11] = {0};
        std::snprintf(id_text, sizeof(id_text), "0x%03lX", static_cast<unsigned long>(mutation->can_id));

        const DbcSignalDef* signal = findSignalByLocation(
            mutation->can_id,
            mutation->start_bit,
            mutation->length);

        if (!first) {
            json += ',';
        }
        first = false;

        json += "{";
        json += "\"can_id\":\"" + String(id_text) + "\",";
        json += "\"direction\":\"" + String(directionToString(mutation->direction)) + "\",";
        json += "\"start_bit\":" + String(mutation->start_bit) + ",";
        json += "\"length\":" + String(mutation->length) + ",";
        json += "\"little_endian\":" + String(mutation->little_endian ? "true" : "false") + ",";
        json += "\"is_signed\":" + String(mutation->is_signed ? "true" : "false") + ",";
        json += "\"factor\":" + String(mutation->factor, 6) + ",";
        json += "\"offset\":" + String(mutation->offset, 6) + ",";
        json += "\"operation\":\"" + String(operationToString(mutation->operation)) + "\",";
        json += "\"op_value1\":" + String(mutation->op_value1, 6) + ",";
        json += "\"op_value2\":" + String(mutation->op_value2, 6) + ",";
        json += "\"enabled\":" + String(mutation->enabled ? "true" : "false") + ",";

        json += "\"signal_name\":";
        if (signal != nullptr && signal->name[0] != '\0') {
            json += "\"" + escapeJsonString(signal->name) + "\"";
        } else {
            json += "null";
        }

        json += "}";
    }

    json += "]";
}

bool initBusA() {
    twai_general_config_t g_config = TWAI_GENERAL_CONFIG_DEFAULT(
        static_cast<gpio_num_t>(kBusATxPin),
        static_cast<gpio_num_t>(kBusARxPin),
        TWAI_MODE_NORMAL);
    twai_timing_config_t t_config = TWAI_TIMING_CONFIG_500KBITS();
    twai_filter_config_t f_config = TWAI_FILTER_CONFIG_ACCEPT_ALL();

    g_config.tx_queue_len = 64;
    g_config.rx_queue_len = 128;

    esp_err_t err = twai_driver_install(&g_config, &t_config, &f_config);
    if (err != ESP_OK) {
        Serial.printf("[can-a] driver install failed: %s\n", esp_err_to_name(err));
        return false;
    }

    err = twai_start();
    if (err != ESP_OK) {
        Serial.printf("[can-a] start failed: %s\n", esp_err_to_name(err));
        return false;
    }

    Serial.println("[can-a] TWAI started on pins TX=7 RX=6 @500kbps");
    return true;
}

bool initBusB() {
    pinMode(kMcpRstPin, OUTPUT);
    digitalWrite(kMcpRstPin, HIGH);
    delay(10);
    digitalWrite(kMcpRstPin, LOW);
    delay(10);
    digitalWrite(kMcpRstPin, HIGH);
    delay(10);

    SPI.begin(kMcpSclkPin, kMcpMisoPin, kMcpMosiPin, kMcpCsPin);

    if (can_mcp.reset() != MCP2515::ERROR_OK) {
        Serial.println("[can-b] MCP2515 reset failed");
        return false;
    }
    if (can_mcp.setBitrate(CAN_500KBPS) != MCP2515::ERROR_OK) {
        Serial.println("[can-b] MCP2515 bitrate set failed");
        return false;
    }
    if (can_mcp.setNormalMode() != MCP2515::ERROR_OK) {
        Serial.println("[can-b] MCP2515 normal mode failed");
        return false;
    }

    Serial.println("[can-b] MCP2515 started @500kbps");
    return true;
}

bool readBusA(CanFrame& out_frame) {
    twai_message_t rx = {};
    if (twai_receive(&rx, 0) != ESP_OK) {
        return false;
    }

    out_frame.id = rx.identifier;
    out_frame.dlc = (rx.data_length_code <= 8U) ? rx.data_length_code : 8U;
    for (uint8_t i = 0; i < out_frame.dlc; ++i) {
        out_frame.data[i] = rx.data[i];
    }
    out_frame.timestamp_us = micros();
    out_frame.direction = Direction::A_TO_B;

    return true;
}

bool readBusB(CanFrame& out_frame) {
    struct can_frame frame = {};
    if (can_mcp.readMessage(&frame) != MCP2515::ERROR_OK) {
        return false;
    }

    out_frame.id = frame.can_id & CAN_EFF_MASK;
    out_frame.dlc = (frame.can_dlc <= 8U) ? frame.can_dlc : 8U;
    for (uint8_t i = 0; i < out_frame.dlc; ++i) {
        out_frame.data[i] = frame.data[i];
    }
    out_frame.timestamp_us = micros();
    out_frame.direction = Direction::B_TO_A;

    return true;
}

bool writeBusA(const CanFrame& frame) {
    if (!bus_a_ready) {
        return false;
    }

    twai_message_t tx = {};
    tx.identifier = frame.id;
    tx.extd = (frame.id > 0x7FFU) ? 1 : 0;
    tx.rtr = 0;
    tx.data_length_code = (frame.dlc <= 8U) ? frame.dlc : 8U;

    for (uint8_t i = 0; i < tx.data_length_code; ++i) {
        tx.data[i] = frame.data[i];
    }

    return twai_transmit(&tx, pdMS_TO_TICKS(1)) == ESP_OK;
}

bool writeBusB(const CanFrame& frame) {
    if (!bus_b_ready) {
        return false;
    }

    struct can_frame tx = {};
    tx.can_id = frame.id & CAN_EFF_MASK;
    if (frame.id > 0x7FFU) {
        tx.can_id |= CAN_EFF_FLAG;
    }

    tx.can_dlc = (frame.dlc <= 8U) ? frame.dlc : 8U;
    for (uint8_t i = 0; i < tx.can_dlc; ++i) {
        tx.data[i] = frame.data[i];
    }

    return can_mcp.sendMessage(&tx) == MCP2515::ERROR_OK;
}

bool txDriver(Direction tx_direction, const CanFrame& frame) {
    if (tx_direction == Direction::A_TO_B) {
        return writeBusB(frame);
    }
    return writeBusA(frame);
}

bool replayTxBridge(const CanFrame& frame) {
    return gateway.injectReplayFrame(frame);
}

void pollCanIngress() {
    CanFrame frame;

    size_t processed = 0;
    while (processed < kMaxPollFramesPerBus && bus_a_ready && readBusA(frame)) {
        addRecentFrame(frame, frame_rate_fps, true);
        gateway.onFrameReceivedFromIsr(frame);
        ++processed;
    }

    processed = 0;
    while (processed < kMaxPollFramesPerBus && bus_b_ready && readBusB(frame)) {
        addRecentFrame(frame, frame_rate_fps, true);
        gateway.onFrameReceivedFromIsr(frame);
        ++processed;
    }
}

bool bodyContains(const String& body, const char* token) {
    return body.indexOf(token) >= 0;
}

void handleStatus() {
    const GatewayStats& stats = gateway.stats();

    const uint16_t bus_a = (frame_rate_fps > 1000U) ? 100U : static_cast<uint16_t>(frame_rate_fps / 10U);
    const uint16_t bus_b = bus_a;
    const uint16_t bus_total = (bus_a + bus_b > 100U) ? 100U : static_cast<uint16_t>(bus_a + bus_b);

    String json;
    json.reserve(32000);
    json += "{";
    json += "\"cpu_load_pct\":5,";
    json += "\"bus_a_util_pct\":" + String(bus_a) + ",";
    json += "\"bus_b_util_pct\":" + String(bus_b) + ",";
    json += "\"bus_total_util_pct\":" + String(bus_total) + ",";
    json += "\"bus_a_ready\":" + String(bus_a_ready ? "true" : "false") + ",";
    json += "\"bus_b_ready\":" + String(bus_b_ready ? "true" : "false") + ",";
    json += "\"rx_queue_depth\":" + String(stats.rx_queue_depth) + ",";
    json += "\"dropped_frames\":" + String(stats.dropped_frames) + ",";
    json += "\"active_mutations\":" + String(static_cast<uint32_t>(mutation_engine.activeCount())) + ",";
    json += "\"staging_mutations\":" + String(static_cast<uint32_t>(mutation_engine.stagingCount())) + ",";
    json += "\"dbc_loaded\":" + String(dbc_database.signalCount() > 0U ? "true" : "false") + ",";
    json += "\"dbc_message_count\":" + String(static_cast<uint32_t>(dbc_database.messageCount())) + ",";
    json += "\"dbc_signal_count\":" + String(static_cast<uint32_t>(dbc_database.signalCount())) + ",";
    json += "\"replay_frame_count\":" + String(static_cast<uint32_t>(replay_engine.frameCount())) + ",";
    json += "\"replay_playing\":" + String(replay_engine.isPlaying() ? "true" : "false") + ",";
    json += "\"frame_rate_fps\":" + String(frame_rate_fps) + ",";
    appendActiveMutationsJson(json);
    json += ",";
    json += "\"recent_frames\":[";

    for (size_t i = 0; i < recent_count; ++i) {
        if (i > 0U) {
            json += ',';
        }

        const size_t index = (recent_head + i) % kRecentFrameCapacity;
        const UiFrame& item = recent_frames[index];

        char id_text[11] = {0};
        std::snprintf(id_text, sizeof(id_text), "0x%03lX", static_cast<unsigned long>(item.frame.id));

        json += "{";
        json += "\"id\":\"" + String(id_text) + "\",";
        json += "\"dlc\":" + String(item.frame.dlc) + ",";
        json += "\"direction\":\"" + String(directionToString(item.frame.direction)) + "\",";
        json += "\"data\":\"" + frameDataHex(item.frame) + "\",";
        json += "\"rate_hz\":" + String(item.rate_hz) + ",";
        json += "\"tx_ok\":" + String(item.tx_ok ? "true" : "false") + ",";
        appendDecodedSignalsJson(json, item.frame);
        json += "}";
    }

    json += "]}";

    server.send(200, "application/json", json);
}

void handleMutationStage() {
    SignalMutation mutation{};

    mutation.can_id = parseUIntArg("can_id", 0U);
    mutation.direction = parseDirectionFromText(server.arg("direction"), Direction::A_TO_B);

    const uint32_t start_bit = parseUIntArg("start_bit", 0U);
    const uint32_t length = parseUIntArg("length", 8U);

    mutation.start_bit = static_cast<uint16_t>((start_bit > 63U) ? 63U : start_bit);
    mutation.length = static_cast<uint8_t>((length < 1U) ? 1U : ((length > 64U) ? 64U : length));

    mutation.little_endian = parseBoolText(server.arg("little_endian"), true);
    mutation.is_signed = parseBoolText(server.arg("is_signed"), false);
    mutation.factor = parseFloatArg("factor", 1.0F);
    mutation.offset = parseFloatArg("offset", 0.0F);

    mutation.operation = parseOperationFromText(server.arg("operation"));
    mutation.op_value1 = parseFloatArg("op_value1", 0.0F);
    mutation.op_value2 = parseFloatArg("op_value2", 0.0F);
    mutation.enabled = parseBoolText(server.arg("enabled"), true);

    const bool staged = mutation_engine.stageMutation(mutation);
    if (!staged) {
        server.send(507, "application/json", "{\"ok\":false,\"error\":\"mutation_table_full\"}");
        return;
    }

    const String json = "{\"ok\":true,\"staging_count\":" + String(static_cast<uint32_t>(mutation_engine.stagingCount())) + "}";
    server.send(200, "application/json", json);
}

void handleMutationsAction() {
    const String body = server.arg("plain");

    if (bodyContains(body, "apply_commit")) {
        mutation_engine.applyCommit();
        server.send(200, "application/json", "{\"ok\":true,\"action\":\"apply_commit\"}");
        return;
    }

    if (bodyContains(body, "revert")) {
        mutation_engine.revertStagingToActive();
        server.send(200, "application/json", "{\"ok\":true,\"action\":\"revert\"}");
        return;
    }

    if (bodyContains(body, "clear_staging")) {
        mutation_engine.clearStaging();
        server.send(200, "application/json", "{\"ok\":true,\"action\":\"clear_staging\"}");
        return;
    }

    server.send(400, "application/json", "{\"ok\":false,\"error\":\"unknown_mutation_action\"}");
}

void handleMutationToggle() {
    const uint32_t can_id = parseUIntArg("can_id", 0U);
    const Direction direction = parseDirectionFromText(server.arg("direction"), Direction::A_TO_B);
    const uint32_t start_bit_u32 = parseUIntArg("start_bit", 0U);
    const uint32_t length_u32 = parseUIntArg("length", 0U);
    const bool enabled = parseBoolText(server.arg("enabled"), true);

    if (length_u32 < 1U || length_u32 > 64U) {
        server.send(400, "application/json", "{\"ok\":false,\"error\":\"invalid_length\"}");
        return;
    }

    const bool changed = mutation_engine.setMutationEnabled(
        can_id,
        direction,
        static_cast<uint16_t>((start_bit_u32 > 63U) ? 63U : start_bit_u32),
        static_cast<uint8_t>(length_u32),
        enabled);

    if (!changed) {
        server.send(404, "application/json", "{\"ok\":false,\"error\":\"mutation_not_found\"}");
        return;
    }

    server.send(200, "application/json", "{\"ok\":true}");
}

void handleReplayLoad() {
    const String csv_text = server.arg("plain");
    if (csv_text.length() == 0) {
        server.send(400, "application/json", "{\"ok\":false,\"error\":\"empty_replay_body\"}");
        return;
    }

    const Direction replay_direction = parseDirectionFromText(server.arg("direction"), Direction::A_TO_B);
    const bool loaded = replay_engine.loadLogCsv(csv_text.c_str(), static_cast<size_t>(csv_text.length()), replay_direction);

    const String json = "{\"ok\":" + String(loaded ? "true" : "false") +
                        ",\"frames\":" + String(static_cast<uint32_t>(replay_engine.frameCount())) + "}";
    server.send(loaded ? 200 : 422, "application/json", json);
}

void handleReplayControl() {
    const String body = server.arg("plain");

    if (bodyContains(body, "start")) {
        if (replay_engine.frameCount() == 0U) {
            server.send(409, "application/json", "{\"ok\":false,\"error\":\"replay_empty\"}");
            return;
        }

        ReplayLoopMode loop_mode = ReplayLoopMode::PLAY_ONCE;
        if (bodyContains(body, "LOOP_RAW")) {
            loop_mode = ReplayLoopMode::LOOP_RAW;
        } else if (bodyContains(body, "LOOP_WITH_COUNTER_CONTINUATION")) {
            loop_mode = ReplayLoopMode::LOOP_WITH_COUNTER_CONTINUATION;
        }

        replay_engine.start(loop_mode, micros());
        server.send(200, "application/json", "{\"ok\":true,\"action\":\"start\"}");
        return;
    }

    if (bodyContains(body, "stop")) {
        replay_engine.stop();
        server.send(200, "application/json", "{\"ok\":true,\"action\":\"stop\"}");
        return;
    }

    server.send(400, "application/json", "{\"ok\":false,\"error\":\"unknown_replay_action\"}");
}

void handleDbcUpload() {
    const String dbc_text = server.arg("plain");
    if (dbc_text.length() == 0) {
        server.send(400, "application/json", "{\"ok\":false,\"error\":\"empty_dbc_body\"}");
        return;
    }

    const bool parsed = dbc_database.parseFromText(dbc_text.c_str(), static_cast<size_t>(dbc_text.length()));

    const String json = "{\"ok\":" + String(parsed ? "true" : "false") +
                        ",\"messages\":" + String(static_cast<uint32_t>(dbc_database.messageCount())) +
                        ",\"signals\":" + String(static_cast<uint32_t>(dbc_database.signalCount())) + "}";

    server.send(parsed ? 200 : 422, "application/json", json);
}

void handleNotFound() {
    const String uri = server.uri();

    if (uri.startsWith("/api/")) {
        server.send(404, "application/json", "{\"ok\":false,\"error\":\"api_not_found\"}");
        return;
    }

    if (serveStaticFile(uri)) {
        return;
    }

    if (serveStaticFile(ui_index_path)) {
        return;
    }

    server.send(404, "text/plain", "SignalScope file not found");
}
void configureHttpServer() {
    server.on("/", HTTP_GET, []() {
        if (!fs_mounted) {
            server.send(500, "text/plain", "LittleFS not mounted. Check board flash/partitions, then run uploadfs again.");
            return;
        }

        if (!serveStaticFile(ui_index_path)) {
            const String msg = "UI index missing in LittleFS at " + ui_index_path + ". Ensure data/index.html exists, then run uploadfs.";
            server.send(500, "text/plain", msg);
            return;
        }
    });

    server.on("/api/status", HTTP_GET, handleStatus);
    server.on("/api/mutations", HTTP_POST, handleMutationsAction);
    server.on("/api/mutations/stage", HTTP_POST, handleMutationStage);
    server.on("/api/mutations/toggle", HTTP_POST, handleMutationToggle);
    server.on("/api/replay", HTTP_POST, handleReplayControl);
    server.on("/api/replay/load", HTTP_POST, handleReplayLoad);
    server.on("/api/dbc", HTTP_POST, handleDbcUpload);

    server.onNotFound(handleNotFound);
    server.begin();
}
void startAccessPoint() {
    WiFi.mode(WIFI_MODE_AP);
    const bool started = WiFi.softAP(kApSsid, kApPassword);
    if (!started) {
        Serial.println("[wifi] AP start failed");
        return;
    }

    const IPAddress ap_ip = WiFi.softAPIP();
    Serial.printf("[wifi] AP started: SSID=%s PASS=%s IP=%s\n", kApSsid, kApPassword, ap_ip.toString().c_str());
}

}  // namespace

void setup() {
    Serial.begin(115200);
    delay(250);

    gateway.init();
    mutation_engine.init();
    replay_engine.init();
    persistence.begin();

    gateway.setMutationEngine(&mutation_engine);
    gateway.setReplayEngine(&replay_engine);
    gateway.setTxDriver(txDriver);
    replay_engine.setTxCallback(replayTxBridge);

    const uint32_t flash_size_bytes = ESP.getFlashChipSize();
    Serial.printf("[flash] detected flash size: %lu bytes\n", static_cast<unsigned long>(flash_size_bytes));

    fs_mounted = LittleFS.begin(false, "/littlefs", 10, "littlefs");
    if (!fs_mounted) {
        Serial.println("[fs] LittleFS mount failed; formatting once and retrying");
        fs_mounted = LittleFS.begin(true, "/littlefs", 10, "littlefs");
    }

    if (!fs_mounted) {
        Serial.println("[fs] LittleFS mount failed after format retry");
    } else {
        Serial.println("[fs] LittleFS mounted");
        resolveUiIndexPath();
        logLittleFsContents();
    }

    bus_a_ready = initBusA();
    bus_b_ready = initBusB();

    startAccessPoint();
    configureHttpServer();

    last_rate_sample_ms = millis();
    last_sample_forwarded_frames = 0;
}
void loop() {
    const uint32_t now_us = micros();

    pollCanIngress();
    gateway.pollRx(now_us);
    replay_engine.tick(now_us);

    server.handleClient();

    const uint32_t now_ms = millis();
    if (now_ms - last_rate_sample_ms >= 1000U) {
        const uint32_t forwarded = gateway.stats().forwarded_frames;
        frame_rate_fps = static_cast<uint16_t>(forwarded - last_sample_forwarded_frames);
        last_sample_forwarded_frames = forwarded;
        last_rate_sample_ms = now_ms;
    }
}





















