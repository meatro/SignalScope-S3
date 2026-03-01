const dom = {
    frameTable: document.getElementById("frame-table"),
    framePause: document.getElementById("frame-pause"),
    dbcStatus: document.getElementById("dbc-status"),
    mutationCount: document.getElementById("mutation-count"),
    cpuLoad: document.getElementById("cpu-load"),
    busA: document.getElementById("bus-a"),
    busB: document.getElementById("bus-b"),
    rxDepth: document.getElementById("rx-depth"),
    dropped: document.getElementById("dropped"),
    replayStatus: document.getElementById("replay-status"),

    applyBtn: document.getElementById("apply-btn"),
    revertBtn: document.getElementById("revert-btn"),
    clearStagingBtn: document.getElementById("clear-staging-btn"),

    replayPlay: document.getElementById("replay-play"),
    replayStop: document.getElementById("replay-stop"),
    replayLoop: document.getElementById("replay-loop"),
    replayDirection: document.getElementById("replay-direction"),
    replayFile: document.getElementById("replay-file"),

    dbcFile: document.getElementById("dbc-file"),
    dbcUpload: document.getElementById("dbc-upload"),

    activeMutationList: document.getElementById("active-mutation-list"),

    rawEditor: document.getElementById("raw-editor"),
    signalPicker: document.getElementById("mut-signal-picker"),
    mutCanId: document.getElementById("mut-can-id"),
    mutDirection: document.getElementById("mut-direction"),
    mutStartBit: document.getElementById("mut-start-bit"),
    mutLength: document.getElementById("mut-length"),
    mutEndian: document.getElementById("mut-endian"),
    mutSigned: document.getElementById("mut-signed"),
    mutOperation: document.getElementById("mut-operation"),
    mutFactor: document.getElementById("mut-factor"),
    mutOffset: document.getElementById("mut-offset"),
    mutV1: document.getElementById("mut-v1"),
    mutV2: document.getElementById("mut-v2"),
    mutEnabled: document.getElementById("mut-enabled"),

    opParam1Group: document.getElementById("op-param1-group"),
    opParam1Label: document.getElementById("op-param1-label"),
    opParam2Group: document.getElementById("op-param2-group"),
    opParam2Label: document.getElementById("op-param2-label"),
};

let displayedFrames = [];
let latestIncomingFrames = [];
let selectedFrameKey = null;
let selectedSignalIndex = 0;
let framesPaused = false;

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function frameKey(frame) {
    return `${frame.id || ""}|${frame.direction || ""}`;
}

function formatSignalValue(value) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return "-";
    }

    const fixed = value.toFixed(3);
    return fixed.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function findSelectedFrame(frames) {
    if (!selectedFrameKey) {
        return null;
    }

    for (let i = frames.length - 1; i >= 0; i -= 1) {
        const frame = frames[i];
        if (frameKey(frame) === selectedFrameKey) {
            return frame;
        }
    }
    return null;
}

function setSignalPickerDisabled(message) {
    if (!dom.signalPicker) {
        return;
    }

    dom.signalPicker.innerHTML = `<option value="">${escapeHtml(message)}</option>`;
    dom.signalPicker.disabled = true;
}

function applySignalToMutationForm(signal) {
    if (!signal) {
        return;
    }

    if (Number.isFinite(signal.start_bit) && dom.mutStartBit) {
        dom.mutStartBit.value = String(signal.start_bit);
    }
    if (Number.isFinite(signal.length) && dom.mutLength) {
        dom.mutLength.value = String(signal.length);
    }

    if (dom.mutEndian) {
        dom.mutEndian.value = signal.little_endian ? "little" : "big";
    }

    if (dom.mutSigned) {
        dom.mutSigned.value = signal.is_signed ? "true" : "false";
    }

    if (Number.isFinite(signal.factor) && dom.mutFactor) {
        dom.mutFactor.value = String(signal.factor);
    }

    if (Number.isFinite(signal.offset) && dom.mutOffset) {
        dom.mutOffset.value = String(signal.offset);
    }
}

function refreshSignalPicker(frame, preserveSelection) {
    if (!dom.signalPicker) {
        return;
    }

    const decoded = frame && Array.isArray(frame.decoded_signals) ? frame.decoded_signals : [];
    if (decoded.length === 0) {
        setSignalPickerDisabled("No decoded signals for selected frame");
        return;
    }

    const previousName = preserveSelection && decoded[selectedSignalIndex]
        ? decoded[selectedSignalIndex].name
        : null;

    dom.signalPicker.disabled = false;
    dom.signalPicker.innerHTML = "";

    decoded.forEach((signal, idx) => {
        const option = document.createElement("option");
        option.value = String(idx);
        option.textContent = `${signal.name} (${formatSignalValue(signal.value)})`;
        dom.signalPicker.appendChild(option);
    });

    if (previousName) {
        const idxByName = decoded.findIndex((sig) => sig.name === previousName);
        selectedSignalIndex = idxByName >= 0 ? idxByName : 0;
    } else if (selectedSignalIndex >= decoded.length) {
        selectedSignalIndex = 0;
    }

    dom.signalPicker.value = String(selectedSignalIndex);
}

function loadFrameIntoEditors(frame, preserveSignalSelection = false) {
    if (!frame) {
        return;
    }

    if (dom.rawEditor) {
        dom.rawEditor.value = frame.data || "";
    }

    if (dom.mutCanId) {
        dom.mutCanId.value = frame.id || "0x000";
    }

    if (dom.mutDirection && (frame.direction === "A_TO_B" || frame.direction === "B_TO_A")) {
        dom.mutDirection.value = frame.direction;
    }

    refreshSignalPicker(frame, preserveSignalSelection);

    const decoded = Array.isArray(frame.decoded_signals) ? frame.decoded_signals : [];
    if (decoded.length > 0) {
        const safeIndex = Number(dom.signalPicker ? dom.signalPicker.value : selectedSignalIndex);
        selectedSignalIndex = Number.isFinite(safeIndex) ? Math.max(0, Math.min(decoded.length - 1, safeIndex)) : 0;
        applySignalToMutationForm(decoded[selectedSignalIndex]);
        dom.replayStatus.textContent = `Selected ${frame.id} ${frame.direction} (${decoded[selectedSignalIndex].name})`;
    } else {
        dom.replayStatus.textContent = `Selected ${frame.id} ${frame.direction}`;
    }
}

function renderFrames(frames) {
    displayedFrames = Array.isArray(frames) ? frames : [];
    dom.frameTable.innerHTML = "";

    const visibleFrames = displayedFrames.slice(-40);
    if (visibleFrames.length === 0) {
        dom.frameTable.innerHTML = '<tr><td colspan="5" class="text-muted">Waiting for CAN frames...</td></tr>';
        return;
    }

    visibleFrames.forEach((frame) => {
        const row = document.createElement("tr");
        const key = frameKey(frame);
        const decoded = Array.isArray(frame.decoded_signals) ? frame.decoded_signals : [];
        const hasMutatedSignal = decoded.some((sig) => sig && sig.mutated === true);

        const decodedPreview = decoded.slice(0, 3).map((sig) => {
            const chipClass = sig.mutated ? "signal-chip signal-chip-mut" : "signal-chip";
            const label = `${escapeHtml(sig.name || "signal")}=${escapeHtml(formatSignalValue(sig.value))}`;
            return `<span class="${chipClass}">${label}</span>`;
        });

        let decodedLine = "";
        if ((frame.message_name && frame.message_name.length > 0) || decodedPreview.length > 0) {
            const messagePrefix = frame.message_name ? `<span class="text-muted me-1">${escapeHtml(frame.message_name)}:</span>` : "";
            const moreSuffix = decoded.length > 3 ? `<span class="text-muted small">+${decoded.length - 3}</span>` : "";
            decodedLine = `<div class="small mt-1">${messagePrefix}${decodedPreview.join("")}${moreSuffix}</div>`;
        }

        row.innerHTML = `
            <td>${escapeHtml(frame.id || "-")}</td>
            <td>${escapeHtml(frame.dlc ?? "-")}</td>
            <td>${escapeHtml(frame.direction || "-")}</td>
            <td><div class="fw-semibold">${escapeHtml(frame.data || "")}</div>${decodedLine}</td>
            <td>${escapeHtml(frame.rate_hz || "-")}</td>
        `;

        row.style.cursor = "pointer";
        row.title = "Click to load this frame into editors";

        if (hasMutatedSignal) {
            row.classList.add("frame-has-mutation");
        }

        if (selectedFrameKey && selectedFrameKey === key) {
            row.classList.add("table-active");
        }

        row.addEventListener("click", () => {
            selectedFrameKey = key;
            selectedSignalIndex = 0;
            loadFrameIntoEditors(frame);
            renderFrames(displayedFrames);
        });

        dom.frameTable.appendChild(row);
    });
}

function setOffline() {
    dom.cpuLoad.textContent = "offline";
    dom.busA.textContent = "offline";
    dom.busB.textContent = "offline";
    dom.rxDepth.textContent = "offline";
    dom.dropped.textContent = "offline";
    dom.dbcStatus.textContent = "No backend connection";
}

function updatePauseUi() {
    if (!dom.framePause) {
        return;
    }

    if (framesPaused) {
        dom.framePause.textContent = "Resume";
        dom.framePause.classList.remove("btn-outline-secondary");
        dom.framePause.classList.add("btn-outline-success");
    } else {
        dom.framePause.textContent = "Pause";
        dom.framePause.classList.remove("btn-outline-success");
        dom.framePause.classList.add("btn-outline-secondary");
    }
}

function updateOperationControls() {
    const operation = dom.mutOperation ? dom.mutOperation.value : "PASS_THROUGH";

    if (!dom.opParam1Group || !dom.opParam2Group || !dom.opParam1Label || !dom.opParam2Label) {
        return;
    }

    const hideParam1 = () => { dom.opParam1Group.style.display = "none"; };
    const hideParam2 = () => { dom.opParam2Group.style.display = "none"; };
    const showParam1 = () => { dom.opParam1Group.style.display = ""; };
    const showParam2 = () => { dom.opParam2Group.style.display = ""; };

    // Start from a hidden state so each operation enables only what it needs.
    hideParam1();
    hideParam2();

    switch (operation) {
    case "REPLACE":
        dom.opParam1Label.textContent = "Value";
        showParam1();
        break;
    case "ADD_OFFSET":
        dom.opParam1Label.textContent = "Offset";
        showParam1();
        break;
    case "MULTIPLY":
        dom.opParam1Label.textContent = "Multiplier";
        showParam1();
        break;
    case "CLAMP":
        dom.opParam1Label.textContent = "Min";
        dom.opParam2Label.textContent = "Max";
        showParam1();
        showParam2();
        break;
    case "PASS_THROUGH":
    default:
        break;
    }
}

async function postJson(url, payload) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    let body = null;
    try {
        body = await response.json();
    } catch (_error) {
        body = null;
    }

    return { ok: response.ok, status: response.status, body };
}

async function postForm(url, params) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
    });

    let body = null;
    try {
        body = await response.json();
    } catch (_error) {
        body = null;
    }

    return { ok: response.ok, status: response.status, body };
}

function mutationFormParams() {
    const params = new URLSearchParams();
    params.set("can_id", dom.mutCanId.value || "0x000");
    params.set("direction", dom.mutDirection.value || "A_TO_B");
    params.set("start_bit", dom.mutStartBit.value || "0");
    params.set("length", dom.mutLength.value || "8");
    params.set("little_endian", dom.mutEndian && dom.mutEndian.value === "big" ? "false" : "true");
    params.set("is_signed", dom.mutSigned && dom.mutSigned.value === "true" ? "true" : "false");
    params.set("factor", dom.mutFactor.value || "1");
    params.set("offset", dom.mutOffset.value || "0");
    params.set("operation", dom.mutOperation.value || "PASS_THROUGH");
    params.set("op_value1", dom.mutV1.value || "0");
    params.set("op_value2", dom.mutV2.value || "0");
    params.set("enabled", dom.mutEnabled.checked ? "true" : "false");
    return params;
}

async function toggleMutationEnabled(item, enabled) {
    const params = new URLSearchParams();
    params.set("can_id", item.can_id);
    params.set("direction", item.direction);
    params.set("start_bit", String(item.start_bit));
    params.set("length", String(item.length));
    params.set("enabled", enabled ? "true" : "false");

    const response = await postForm("/api/mutations/toggle", params);
    if (!response.ok) {
        dom.replayStatus.textContent = "Mutation toggle failed";
        return;
    }

    dom.replayStatus.textContent = enabled ? "Mutation enabled" : "Mutation disabled";
    refreshStatus();
}

function renderActiveMutations(items) {
    if (!dom.activeMutationList) {
        return;
    }

    dom.activeMutationList.innerHTML = "";

    if (!Array.isArray(items) || items.length === 0) {
        dom.activeMutationList.innerHTML = '<div class="text-muted small">No active mutations</div>';
        return;
    }

    items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "list-group-item d-flex justify-content-between align-items-center px-0";

        const signalName = item.signal_name ? item.signal_name : `${item.start_bit}|${item.length}`;
        const left = document.createElement("div");
        left.innerHTML = `
            <div class="fw-semibold">${escapeHtml(item.can_id)} ${escapeHtml(item.direction)}</div>
            <div class="small text-muted">${escapeHtml(signalName)} ${escapeHtml(item.operation || "")}</div>
        `;

        const toggleWrap = document.createElement("div");
        toggleWrap.className = "form-check form-switch m-0";

        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.className = "form-check-input";
        toggle.checked = !!item.enabled;
        toggle.addEventListener("change", () => {
            toggleMutationEnabled(item, toggle.checked);
        });

        toggleWrap.appendChild(toggle);
        row.appendChild(left);
        row.appendChild(toggleWrap);
        dom.activeMutationList.appendChild(row);
    });
}

async function refreshStatus() {
    try {
        const response = await fetch("/api/status");
        if (!response.ok) {
            throw new Error("status unavailable");
        }

        const status = await response.json();
        dom.cpuLoad.textContent = `${status.cpu_load_pct}%`;
        dom.busA.textContent = status.bus_a_ready ? `${status.bus_a_util_pct}%` : "not ready";
        dom.busB.textContent = status.bus_b_ready ? `${status.bus_b_util_pct}%` : "not ready";
        dom.rxDepth.textContent = `${status.rx_queue_depth}`;
        dom.dropped.textContent = `${status.dropped_frames}`;
        dom.mutationCount.textContent = `${status.active_mutations} active / ${status.staging_mutations} staging`;
        dom.dbcStatus.textContent = status.dbc_loaded
            ? `DBC loaded (${status.dbc_message_count} msgs / ${status.dbc_signal_count} signals)`
            : "No DBC loaded";

        renderActiveMutations(status.active_mutation_items || []);

        latestIncomingFrames = status.recent_frames || [];
        if (!framesPaused) {
            renderFrames(latestIncomingFrames);

            const selectedFrame = findSelectedFrame(displayedFrames);
            if (selectedFrame) {
                refreshSignalPicker(selectedFrame, true);
            } else if (dom.signalPicker) {
                setSignalPickerDisabled("Select a frame with decoded DBC signals");
            }
        }
    } catch (_error) {
        setOffline();
    }
}

dom.dbcUploadBusy = false;
dom.dbcUpload.addEventListener("click", async () => {
    if (dom.dbcUploadBusy) {
        return;
    }

    const file = dom.dbcFile.files && dom.dbcFile.files[0];
    if (!file) {
        dom.dbcStatus.textContent = "Select a .dbc file first";
        return;
    }

    dom.dbcUploadBusy = true;
    dom.dbcStatus.textContent = `Uploading ${file.name}...`;

    try {
        const text = await file.text();
        const response = await fetch("/api/dbc", {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: text,
        });

        const body = await response.json();
        if (response.ok && body.ok) {
            dom.dbcStatus.textContent = `DBC loaded (${body.messages} msgs / ${body.signals} signals)`;
        } else {
            dom.dbcStatus.textContent = "DBC parse failed";
        }
    } catch (_error) {
        dom.dbcStatus.textContent = "DBC upload failed";
    } finally {
        dom.dbcUploadBusy = false;
    }

    refreshStatus();
});

dom.applyBtn.addEventListener("click", async () => {
    const stage = await postForm("/api/mutations/stage", mutationFormParams());
    if (!stage.ok) {
        dom.replayStatus.textContent = "Mutation stage failed";
        return;
    }

    const apply = await postJson("/api/mutations", { action: "apply_commit" });
    dom.replayStatus.textContent = apply.ok ? "Mutation applied" : "Mutation commit failed";
    refreshStatus();
});

dom.revertBtn.addEventListener("click", async () => {
    const result = await postJson("/api/mutations", { action: "revert" });
    dom.replayStatus.textContent = result.ok ? "Mutation staging reverted" : "Revert failed";
    refreshStatus();
});

dom.clearStagingBtn.addEventListener("click", async () => {
    const clearStage = await postJson("/api/mutations", { action: "clear_staging" });
    if (!clearStage.ok) {
        dom.replayStatus.textContent = "Clear staging failed";
        return;
    }

    // Commit the empty staging table so active mutations are cleared immediately.
    const commit = await postJson("/api/mutations", { action: "apply_commit" });
    dom.replayStatus.textContent = commit.ok ? "All mutations cleared" : "Mutation clear commit failed";
    refreshStatus();
});

dom.replayPlay.addEventListener("click", async () => {
    const file = dom.replayFile.files && dom.replayFile.files[0];
    if (file) {
        dom.replayStatus.textContent = `Loading replay ${file.name}...`;
        try {
            const text = await file.text();
            const loadResponse = await fetch(`/api/replay/load?direction=${encodeURIComponent(dom.replayDirection.value)}`, {
                method: "POST",
                headers: { "Content-Type": "text/plain" },
                body: text,
            });

            const loadBody = await loadResponse.json();
            if (!loadResponse.ok || !loadBody.ok) {
                dom.replayStatus.textContent = "Replay load failed";
                return;
            }
        } catch (_error) {
            dom.replayStatus.textContent = "Replay load failed";
            return;
        }
    }

    const start = await postJson("/api/replay", {
        action: "start",
        loop_mode: dom.replayLoop ? dom.replayLoop.value : "PLAY_ONCE",
    });

    dom.replayStatus.textContent = start.ok ? "Replay running" : "Replay start failed";
    refreshStatus();
});

dom.replayStop.addEventListener("click", async () => {
    const result = await postJson("/api/replay", { action: "stop" });
    dom.replayStatus.textContent = result.ok ? "Replay stopped" : "Replay stop failed";
    refreshStatus();
});

if (dom.signalPicker) {
    dom.signalPicker.addEventListener("change", () => {
        const selectedFrame = findSelectedFrame(displayedFrames);
        if (!selectedFrame) {
            return;
        }

        const decoded = Array.isArray(selectedFrame.decoded_signals) ? selectedFrame.decoded_signals : [];
        const index = Number(dom.signalPicker.value);
        if (!Number.isFinite(index) || index < 0 || index >= decoded.length) {
            return;
        }

        selectedSignalIndex = index;
        applySignalToMutationForm(decoded[index]);
    });
}

if (dom.framePause) {
    dom.framePause.addEventListener("click", () => {
        framesPaused = !framesPaused;
        updatePauseUi();

        if (!framesPaused) {
            renderFrames(latestIncomingFrames);
        }
    });
}

if (dom.mutOperation) {
    dom.mutOperation.addEventListener("change", updateOperationControls);
}

updateOperationControls();
updatePauseUi();
setSignalPickerDisabled("Select a frame with decoded DBC signals");
setOffline();
refreshStatus();
setInterval(() => {
    refreshStatus();
    updateOperationControls();
}, 1000);



