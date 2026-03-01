(function () {
    'use strict';

    var SETUP_PROFILE_KEY = 'openhaldex.fw.setupProfile';

    function byId(id) {
        return document.getElementById(id);
    }

    function pageKey() {
        return String((document.body && document.body.dataset && document.body.dataset.fwPage) || '').trim().toLowerCase();
    }

    function normalizeSignalKey(value) {
        return String(value || '').trim().toLowerCase();
    }

    function clampHaldexGeneration(value, fallback) {
        var n = Math.round(Number(value));
        if (n === 1 || n === 2 || n === 4) {
            return n;
        }
        return fallback || 2;
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function readSetupProfile() {
        try {
            var raw = localStorage.getItem(SETUP_PROFILE_KEY);
            if (!raw) {
                return null;
            }
            var parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (_) {
            return null;
        }
    }

    function writeSetupProfile(profile) {
        try {
            localStorage.setItem(SETUP_PROFILE_KEY, JSON.stringify(profile || {}));
        } catch (_) {
            // ignore
        }
    }

    function normalizeSignalDisplayValue(value, unit, signalName) {
        var n = Number(value);
        if (!Number.isFinite(n)) {
            return value;
        }

        var normalizedUnit = String(unit || '').trim().toLowerCase();
        var normalizedName = String(signalName || '').trim().toLowerCase();

        if (normalizedUnit === 'rpm' || normalizedName.indexOf('rpm') >= 0) {
            var abs = Math.abs(n);
            if (abs > 0 && abs < 20) {
                var scaled = n * 100;
                if (Math.abs(scaled) >= 100 && Math.abs(scaled) <= 12000) {
                    return scaled;
                }
            }
        }

        return n;
    }

    function formatDecodedValue(value, unit, signalName) {
        if (value === null || value === undefined || value === '') {
            return '--';
        }

        var n = Number(normalizeSignalDisplayValue(value, unit, signalName));
        if (!Number.isFinite(n)) {
            return String(value);
        }

        var normalizedUnit = String(unit || '').trim().toLowerCase();
        if (normalizedUnit === 'rpm') {
            return Math.abs(n) >= 20 ? String(Math.round(n)) : n.toFixed(2).replace(/\.?0+$/, '');
        }

        if (Math.abs(n) >= 1000) {
            return String(Math.round(n));
        }
        if (Math.abs(n) >= 100) {
            return n.toFixed(1).replace(/\.?0+$/, '');
        }
        return n.toFixed(2).replace(/\.?0+$/, '');
    }

    function formatDecodedSignalRecord(item) {
        var bus = String(item && item.bus || 'all').toLowerCase();
        var id = Number(item && item.id);
        var frame = Number.isFinite(id)
            ? ('0x' + id.toString(16).toUpperCase())
            : String(item && item.id || '');
        var signal = String(item && item.name || 'Signal').replace(/_/g, ' ').trim();
        var unit = String(item && item.unit || '').trim();
        var hz = Number(item && item.hz || 0);
        var value = item && item.value;
        var key = normalizeSignalKey(bus + '|' + frame + '|' + signal + '|' + unit);
        return {
            key: key,
            bus: bus,
            frame: frame,
            signal: signal,
            unit: unit,
            hz: hz,
            value: value,
        };
    }

    async function fetchJson(path, options) {
        if (window.openhaldexFirmwareApi && typeof window.openhaldexFirmwareApi.fetchJson === 'function') {
            return window.openhaldexFirmwareApi.fetchJson(path, options || {});
        }

        var response = await fetch(path, options || {});
        if (!response.ok) {
            throw new Error('HTTP ' + response.status);
        }
        return response.json();
    }

    function initSetupOverrides() {
        if (pageKey() !== 'setup') {
            return;
        }

        var speedInput = byId('fwSetupMapSignalSpeed');
        var throttleInput = byId('fwSetupMapSignalThrottle');
        var rpmInput = byId('fwSetupMapSignalRpm');
        var generationSelect = byId('fwSetupHaldexGeneration');

        var signalSearchInput = byId('fwSetupSignalSearch');
        var signalSelect = byId('fwSetupSignalSelect');
        var signalRefreshBtn = byId('fwSetupSignalRefreshBtn');
        var signalSummaryNode = byId('fwSetupSignalSummary');
        var mappedInputsNode = byId('fwSetupMappedInputs');
        var dashSignalsNode = byId('fwSetupDashSignals');
        var mappingStatusNode = byId('fwSetupMappingStatus');
        var assignInputBtn = byId('fwSetupAssignInputBtn');
        var assignDashBtn = byId('fwSetupAssignDashBtn');
        var addDashBtn = byId('fwSetupAddDashBtn');
        var removeDashBtn = byId('fwSetupRemoveDashBtn');
        var saveMappingBtn = byId('fwSetupSaveMappingBtn');
        var behaviorSelectedSignalInput = byId('behavior-selected-signal');

        if (!mappedInputsNode || !dashSignalsNode || !signalSelect || !signalSummaryNode) {
            return;
        }

        var requiredInputs = [
            { key: 'speed', label: 'Speed' },
            { key: 'throttle', label: 'Throttle' },
            { key: 'rpm', label: 'Engine RPM' },
        ];

        var mappings = {
            speed: normalizeSignalKey(speedInput && speedInput.value),
            throttle: normalizeSignalKey(throttleInput && throttleInput.value),
            rpm: normalizeSignalKey(rpmInput && rpmInput.value),
        };

        var dashboardSignals = [
            { key: 'dash_1', label: 'Dashboard 1', signalKey: '' },
            { key: 'dash_2', label: 'Dashboard 2', signalKey: '' },
            { key: 'dash_3', label: 'Dashboard 3', signalKey: '' },
        ];

        var selectedInputKey = 'speed';
        var selectedDashKey = 'dash_1';
        var selectedSignalKey = '';
        var signalSnapshot = [];
        var signalSnapshotMap = new Map();

        function setMappingStatus(message, pending, isError) {
            if (!mappingStatusNode) {
                return;
            }
            mappingStatusNode.textContent = message;
            mappingStatusNode.classList.toggle('pending', Boolean(pending));
            mappingStatusNode.classList.toggle('error', Boolean(isError));
        }

        function ensureDashboardSignals(list) {
            var source = Array.isArray(list) ? list : [];
            var normalized = source.map(function (item, idx) {
                return {
                    key: String(item && item.key || ('dash_' + (idx + 1))).trim(),
                    label: String(item && item.label || ('Dashboard ' + (idx + 1))).trim(),
                    signalKey: normalizeSignalKey(item && (item.signalKey || item.signalId) || ''),
                };
            }).filter(function (item) {
                return Boolean(item.key);
            });

            if (!normalized.length) {
                return [
                    { key: 'dash_1', label: 'Dashboard 1', signalKey: '' },
                    { key: 'dash_2', label: 'Dashboard 2', signalKey: '' },
                    { key: 'dash_3', label: 'Dashboard 3', signalKey: '' },
                ];
            }
            return normalized.slice(0, 24);
        }

        function readSignalSummary(signalKey) {
            var key = normalizeSignalKey(signalKey);
            if (!key) {
                return { name: 'Not Assigned', value: '--' };
            }
            var signal = signalSnapshotMap.get(key);
            if (!signal) {
                return { name: key, value: '--' };
            }
            return {
                name: signal.frame + ' ' + signal.signal,
                value: formatDecodedValue(signal.value, signal.unit, signal.signal) + (signal.unit ? (' ' + signal.unit) : ''),
            };
        }

        function renderSignalSummary() {
            if (!selectedSignalKey) {
                signalSummaryNode.textContent = 'No signal selected.';
                return;
            }
            var summary = readSignalSummary(selectedSignalKey);
            signalSummaryNode.textContent = summary.name + ' | ' + summary.value;
        }

        function syncInputsFromMappings() {
            if (speedInput) speedInput.value = mappings.speed || '';
            if (throttleInput) throttleInput.value = mappings.throttle || '';
            if (rpmInput) rpmInput.value = mappings.rpm || '';
        }

        function syncMappingsFromInputs() {
            mappings.speed = normalizeSignalKey(speedInput && speedInput.value || '');
            mappings.throttle = normalizeSignalKey(throttleInput && throttleInput.value || '');
            mappings.rpm = normalizeSignalKey(rpmInput && rpmInput.value || '');
        }

        function persistProfile() {
            var generation = clampHaldexGeneration(generationSelect && generationSelect.value, 2);
            if (generationSelect) {
                generationSelect.value = String(generation);
            }
            writeSetupProfile({
                version: 2,
                haldexGeneration: generation,
                mappings: {
                    speed: mappings.speed || '',
                    throttle: mappings.throttle || '',
                    rpm: mappings.rpm || '',
                },
                dashboardSignals: dashboardSignals.map(function (item) {
                    return {
                        key: item.key,
                        label: item.label,
                        signalKey: item.signalKey || '',
                    };
                }),
                updatedAt: new Date().toISOString(),
            });
        }

        function renderSignalSelect() {
            var search = String(signalSearchInput && signalSearchInput.value || '').trim().toLowerCase();
            var filtered = signalSnapshot.filter(function (item) {
                if (!search) {
                    return true;
                }
                return (
                    item.signal.toLowerCase().indexOf(search) >= 0 ||
                    item.frame.toLowerCase().indexOf(search) >= 0 ||
                    item.bus.toLowerCase().indexOf(search) >= 0 ||
                    item.unit.toLowerCase().indexOf(search) >= 0
                );
            });

            if (!filtered.length) {
                signalSelect.innerHTML = '<option value="">No decoded signals in snapshot</option>';
                signalSelect.value = '';
                return;
            }

            signalSelect.innerHTML = filtered.map(function (item) {
                var valueText = formatDecodedValue(item.value, item.unit, item.signal);
                var label = item.signal + ' | ' + item.frame + ' | ' + valueText + (item.unit ? (' ' + item.unit) : '');
                var selected = item.key === selectedSignalKey ? ' selected' : '';
                return '<option value="' + escapeHtml(item.key) + '"' + selected + '>' + escapeHtml(label) + '</option>';
            }).join('');

            if (selectedSignalKey) {
                signalSelect.value = selectedSignalKey;
            }
        }

        function renderMappedInputs() {
            mappedInputsNode.innerHTML = requiredInputs.map(function (item) {
                var summary = readSignalSummary(mappings[item.key]);
                var activeClass = selectedInputKey === item.key ? ' active' : '';
                return '<button type="button" class="list-group-item list-group-item-action fw-setup-map-row' + activeClass + '" data-fw-input-key="' + escapeHtml(item.key) + '">' +
                    '<span class="fw-setup-map-main">' + escapeHtml(item.label) + '</span>' +
                    '<small class="fw-setup-map-sub">' + escapeHtml(summary.name) + ' | ' + escapeHtml(summary.value) + '</small>' +
                '</button>';
            }).join('');
        }

        function renderDashSignals() {
            dashSignalsNode.innerHTML = dashboardSignals.map(function (item) {
                var summary = readSignalSummary(item.signalKey);
                var activeClass = selectedDashKey === item.key ? ' active' : '';
                return '<button type="button" class="list-group-item list-group-item-action fw-setup-map-row' + activeClass + '" data-fw-dash-key="' + escapeHtml(item.key) + '">' +
                    '<span class="fw-setup-map-main">' + escapeHtml(item.label) + '</span>' +
                    '<small class="fw-setup-map-sub">' + escapeHtml(summary.name) + ' | ' + escapeHtml(summary.value) + '</small>' +
                '</button>';
            }).join('');
        }

        function refreshBridge() {
            if (behaviorSelectedSignalInput) {
                behaviorSelectedSignalInput.value = selectedSignalKey || '';
            }
            window.openhaldexSetupSignals = {
                getSelectedSignalId: function () {
                    return normalizeSignalKey(selectedSignalKey || (behaviorSelectedSignalInput && behaviorSelectedSignalInput.value));
                },
                getSignalSummary: function (signalId) {
                    return readSignalSummary(signalId);
                },
            };
        }

        function renderAll() {
            renderSignalSelect();
            renderSignalSummary();
            renderMappedInputs();
            renderDashSignals();
            refreshBridge();
        }

        async function refreshSnapshot() {
            setMappingStatus('Refreshing decoded snapshot...', true, false);
            try {
                var payload = await fetchJson('/api/canview?decoded=300&raw=0&bus=all', { timeoutMs: 2600 });
                signalSnapshot = (Array.isArray(payload && payload.decoded) ? payload.decoded : [])
                    .map(formatDecodedSignalRecord)
                    .sort(function (left, right) {
                        var frameSort = left.frame.localeCompare(right.frame);
                        if (frameSort !== 0) {
                            return frameSort;
                        }
                        return left.signal.localeCompare(right.signal);
                    });

                signalSnapshotMap = new Map(signalSnapshot.map(function (item) {
                    return [item.key, item];
                }));

                if (selectedSignalKey && !signalSnapshotMap.has(selectedSignalKey)) {
                    selectedSignalKey = '';
                }

                renderAll();
                setMappingStatus('Snapshot loaded: ' + signalSnapshot.length + ' decoded signals.', false, false);
            } catch (error) {
                setMappingStatus('Snapshot refresh failed: ' + error.message, false, true);
            }
        }

        function assignToInput() {
            if (!selectedSignalKey) {
                setMappingStatus('Select a signal first.', false, true);
                return;
            }
            mappings[selectedInputKey] = selectedSignalKey;
            syncInputsFromMappings();
            persistProfile();
            renderAll();
            setMappingStatus('Assigned signal to input: ' + selectedInputKey + '.', false, false);
        }

        function assignToDashboard() {
            if (!selectedSignalKey) {
                setMappingStatus('Select a signal first.', false, true);
                return;
            }
            var target = dashboardSignals.find(function (item) {
                return item.key === selectedDashKey;
            });
            if (!target) {
                setMappingStatus('Select dashboard slot first.', false, true);
                return;
            }
            target.signalKey = selectedSignalKey;
            persistProfile();
            renderAll();
            setMappingStatus('Assigned signal to ' + target.label + '.', false, false);
        }

        function addDashboardSlot() {
            if (dashboardSignals.length >= 24) {
                setMappingStatus('Dashboard signal limit reached (24).', false, true);
                return;
            }
            var next = dashboardSignals.length + 1;
            var key = 'dash_' + next;
            dashboardSignals.push({ key: key, label: 'Dashboard ' + next, signalKey: '' });
            selectedDashKey = key;
            persistProfile();
            renderAll();
            setMappingStatus('Added dashboard slot ' + next + '.', false, false);
        }

        function removeDashboardSlot() {
            if (dashboardSignals.length <= 1) {
                setMappingStatus('At least one dashboard slot is required.', false, true);
                return;
            }
            var idx = dashboardSignals.findIndex(function (item) {
                return item.key === selectedDashKey;
            });
            if (idx < 0) {
                idx = dashboardSignals.length - 1;
            }
            dashboardSignals.splice(idx, 1);
            selectedDashKey = dashboardSignals[Math.max(0, idx - 1)].key;
            persistProfile();
            renderAll();
            setMappingStatus('Dashboard slot removed.', false, false);
        }

        var profile = readSetupProfile();
        if (profile && profile.mappings) {
            mappings.speed = normalizeSignalKey(profile.mappings.speed || mappings.speed || '');
            mappings.throttle = normalizeSignalKey(profile.mappings.throttle || mappings.throttle || '');
            mappings.rpm = normalizeSignalKey(profile.mappings.rpm || mappings.rpm || '');
        }
        if (profile && Array.isArray(profile.dashboardSignals)) {
            dashboardSignals = ensureDashboardSignals(profile.dashboardSignals);
            selectedDashKey = dashboardSignals[0].key;
        }

        syncInputsFromMappings();
        renderAll();

        mappedInputsNode.addEventListener('click', function (event) {
            var row = event.target.closest('[data-fw-input-key]');
            if (!row) {
                return;
            }
            selectedInputKey = String(row.getAttribute('data-fw-input-key') || selectedInputKey);
            renderMappedInputs();
            setMappingStatus('Target input: ' + selectedInputKey + '.', false, false);
        });

        dashSignalsNode.addEventListener('click', function (event) {
            var row = event.target.closest('[data-fw-dash-key]');
            if (!row) {
                return;
            }
            selectedDashKey = String(row.getAttribute('data-fw-dash-key') || selectedDashKey);
            renderDashSignals();
            setMappingStatus('Target dashboard slot: ' + selectedDashKey + '.', false, false);
        });

        signalSelect.addEventListener('change', function () {
            selectedSignalKey = normalizeSignalKey(signalSelect.value);
            renderSignalSummary();
            refreshBridge();
        });

        if (signalSearchInput) {
            signalSearchInput.addEventListener('input', renderSignalSelect);
        }

        if (signalRefreshBtn) signalRefreshBtn.addEventListener('click', refreshSnapshot);
        if (assignInputBtn) assignInputBtn.addEventListener('click', assignToInput);
        if (assignDashBtn) assignDashBtn.addEventListener('click', assignToDashboard);
        if (addDashBtn) addDashBtn.addEventListener('click', addDashboardSlot);
        if (removeDashBtn) removeDashBtn.addEventListener('click', removeDashboardSlot);

        if (speedInput) speedInput.addEventListener('input', function () {
            syncMappingsFromInputs();
            renderMappedInputs();
            persistProfile();
        });
        if (throttleInput) throttleInput.addEventListener('input', function () {
            syncMappingsFromInputs();
            renderMappedInputs();
            persistProfile();
        });
        if (rpmInput) rpmInput.addEventListener('input', function () {
            syncMappingsFromInputs();
            renderMappedInputs();
            persistProfile();
        });
        if (generationSelect) generationSelect.addEventListener('change', function () {
            generationSelect.value = String(clampHaldexGeneration(generationSelect.value, 2));
            persistProfile();
        });

        if (saveMappingBtn) {
            saveMappingBtn.addEventListener('click', function () {
                persistProfile();
                var setupSaveBtn = byId('fwSetupSaveBtn');
                if (setupSaveBtn) {
                    setupSaveBtn.click();
                }
            });
        }

        refreshSnapshot();
    }

    function initHomeOverrides() {
        if (pageKey() !== 'home') {
            return;
        }

        var modeButtons = Array.prototype.slice.call(document.querySelectorAll('[data-fw-set-mode]'));
        var dashStatusNode = byId('fwHomeDashStatus');
        var dashSignalsNode = byId('fwHomeDashSignals');

        function setActiveMode(modeRaw, disabled) {
            var activeMode = disabled ? 'STOCK' : String(modeRaw || '').toUpperCase();
            modeButtons.forEach(function (button) {
                var mode = String(button.getAttribute('data-fw-set-mode') || '').toUpperCase();
                button.classList.toggle('active', mode === activeMode);
            });
        }

        function getDashboardSignals() {
            var profile = readSetupProfile();
            var list = profile && Array.isArray(profile.dashboardSignals) ? profile.dashboardSignals : [];
            return list
                .map(function (item, idx) {
                    return {
                        key: String(item && item.key || ('dash_' + (idx + 1))).trim(),
                        label: String(item && item.label || ('Dashboard ' + (idx + 1))).trim(),
                        signalKey: normalizeSignalKey(item && (item.signalKey || item.signalId) || ''),
                    };
                })
                .filter(function (item) {
                    return Boolean(item.signalKey);
                });
        }

        function renderEmptyDashboard() {
            if (!dashStatusNode || !dashSignalsNode) {
                return;
            }
            dashStatusNode.textContent = 'No dashboard signals mapped yet. Configure on Setup page.';
            dashSignalsNode.innerHTML = '<div class="fw-kpi-item"><p>Dashboard</p><strong>Not configured</strong></div>';
        }

        async function refreshDashboard() {
            if (!dashStatusNode || !dashSignalsNode) {
                return;
            }

            var dashSignals = getDashboardSignals();
            if (!dashSignals.length) {
                renderEmptyDashboard();
                return;
            }

            try {
                var payload = await fetchJson('/api/canview?decoded=300&raw=0&bus=all', { timeoutMs: 2400 });
                var decoded = (Array.isArray(payload && payload.decoded) ? payload.decoded : []).map(formatDecodedSignalRecord);
                var signalMap = new Map(decoded.map(function (item) {
                    return [item.key, item];
                }));

                dashSignalsNode.innerHTML = dashSignals.map(function (slot) {
                    var signal = signalMap.get(slot.signalKey);
                    if (!signal) {
                        return '<div class="fw-kpi-item"><p>' + escapeHtml(slot.label) + '</p><strong>--</strong></div>';
                    }
                    var value = formatDecodedValue(signal.value, signal.unit, signal.signal) + (signal.unit ? (' ' + signal.unit) : '');
                    return '<div class="fw-kpi-item"><p>' + escapeHtml(slot.label + ' | ' + signal.frame + ' ' + signal.signal) + '</p><strong>' + escapeHtml(value) + '</strong></div>';
                }).join('');

                dashStatusNode.textContent = 'Mapped dashboard signals: ' + dashSignals.length;
            } catch (error) {
                dashStatusNode.textContent = 'Dashboard refresh failed: ' + error.message;
            }
        }

        async function refreshRuntimeMode() {
            try {
                var runtime = await fetchJson('/api/runtime', { timeoutMs: 1500 });
                setActiveMode(runtime.mode, Boolean(runtime.disableController));
            } catch (_) {
                // ignore
            }
        }

        renderEmptyDashboard();
        refreshRuntimeMode();
        refreshDashboard();
        setInterval(refreshRuntimeMode, 1400);
        setInterval(refreshDashboard, 2200);

        window.addEventListener('storage', function (event) {
            if (event.key === SETUP_PROFILE_KEY) {
                refreshDashboard();
            }
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        initSetupOverrides();
        initHomeOverrides();
    });
})();