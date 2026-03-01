# SignalScope

SignalScope is a deterministic inline dual-CAN gateway firmware for ESP32-S3 + MCP2515 with an on-device web UI served from LittleFS.

## Current Features

- AP mode UI (`SignalScope-AP`, password `signalscope`)
- Live frame table with pause/resume
- DBC upload + runtime decode (message/signal values shown in live view)
- Frame select -> editor preload
- Signal picker autofill for mutation parameters (start bit, length, endian, signed, factor, offset)
- Operation-aware mutation inputs (replace/add/multiply/clamp)
- Active mutation list with quick enable/disable toggles
- Replay load/start/stop controls

## Project Layout

- `main.cpp` firmware wiring, HTTP API, CAN IO
- `core/` gateway, mutation engine, replay engine, DBC parser, signal codec
- `fs/` persistence abstraction
- `data/` LittleFS payload (single source of UI files)
- `boards/esp32-s3-devkitc1-n16r8.json` custom 16MB board definition
- `partitions.csv` partition layout (LittleFS partition label `littlefs`)

## Build Configuration

Pinned in `platformio.ini`:

- Platform: `https://github.com/pioarduino/platform-espressif32.git#55.03.36`
- Library: `autowp/autowp-mcp2515@1.3.1`

No floating (`^`) dependency ranges are used.

## Flash

From `\SignalScope`:

```powershell
platformio run -t upload
platformio run -t uploadfs
```

First-time full reset (or if partition/filesystem state is suspect):

```powershell
platformio run -t erase
platformio run -t upload
platformio run -t uploadfs
```

## Connect

- SSID: `SignalScope-AP`
- Password: `signalscope`
- URL: `http://192.168.4.1/`

## Troubleshooting

- `LittleFS not mounted`: run `erase`, then `upload`, then `uploadfs`.
- `partition "spiffs" could not be found`: do not rename the LittleFS partition label; firmware mounts label `littlefs` explicitly.
- UI missing/stale: ensure `data/index.html` exists and run `uploadfs` again.

![Screenshot](screenshot.png)
