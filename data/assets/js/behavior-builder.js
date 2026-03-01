
(() => {
  function safeFilename(value) {
    return String(value || "profile")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || "profile";
  }

  window.openhaldexBehaviorBuilderInit = function openhaldexBehaviorBuilderInit() {
    const root = document.getElementById("behavior-builder");
    if (!root) {
      return;
    }
    if (root.dataset.behaviorBuilderInit === "1") {
      return;
    }

    const byId = (id) => document.getElementById(id);
    const firmwareApi = window.openhaldexFirmwareApi || null;
    const statusNode = byId("behavior-status");
    const metaNode = byId("behavior-meta");
    const headingNode = byId("behavior-heading");
    const enabledToggle = byId("behavior-enabled");
    const advancedActionsNode = byId("behavior-advanced-actions");
    const selectedSignalPanelNode = byId("behavior-selected-signal-panel");
    const loadBtn = byId("behavior-load");
    const downloadBtn = byId("behavior-download");
    const uploadBtn = byId("behavior-upload");
    const uploadFileInput = byId("behavior-upload-file");
    const saveBtn = byId("behavior-save");
    const addProfileBtn = byId("behavior-profile-add");
    const profilesNode = byId("behavior-profiles");
    const alertsNode = byId("behavior-alerts");
    const advancedPanel = byId("behavior-advanced-panel");
    const alertsPane = byId("behavior-alerts-pane");
    const basicPanel = byId("behavior-basic-panel");
    const basicStatusNode = byId("behavior-basic-status");
    const basicDisengageInput = byId("behavior-basic-disengage");
    const basicDisableSpeedInput = byId("behavior-basic-disable-speed");
    const basicDisableThrottleInput = byId("behavior-basic-disable-throttle");
    const basicReleaseRateInput = byId("behavior-basic-release-rate");
    const basicControllerEnabled = byId("behavior-basic-controller-enabled");
    const basicBroadcastEnabled = byId("behavior-basic-broadcast-enabled");
    const basicLoadBtn = byId("behavior-basic-load");
    const basicSaveBtn = byId("behavior-basic-save");
    const manualSignalInput = byId("behavior-selected-signal");

    if (!statusNode || !enabledToggle || !loadBtn || !saveBtn || !addProfileBtn || !profilesNode || !alertsNode) {
      return;
    }
    root.dataset.behaviorBuilderInit = "1";

    const apiJson = async (path, options = {}) => {
      if (firmwareApi && typeof firmwareApi.fetchJson === "function") {
        return firmwareApi.fetchJson(path, options);
      }

      const timeoutMs = Number(options.timeoutMs || 2500);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const fetchOptions = { ...options, signal: controller.signal };
        if (!fetchOptions.headers) {
          fetchOptions.headers = { Accept: "application/json" };
        }
        const response = await fetch(path, fetchOptions);
        const text = await response.text();
        if (!response.ok) {
          throw new Error(text || `HTTP ${response.status}`);
        }
        const json = JSON.parse(text || "{}");
        if (json && json.error) {
          throw new Error(json.error);
        }
        return json;
      } catch (error) {
        if (error && error.name === "AbortError") {
          throw new Error("Request timeout");
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    };
    const hasBasicUi = Boolean(
      basicPanel &&
      basicStatusNode &&
      basicDisengageInput &&
      basicDisableSpeedInput &&
      basicDisableThrottleInput &&
      basicReleaseRateInput &&
      basicControllerEnabled &&
      basicBroadcastEnabled &&
      basicLoadBtn &&
      basicSaveBtn
    );

    const modeOptions = [
      "INHERIT",
      "STOCK",
      "FWD",
      "5050",
      "6040",
      "7030",
      "8020",
      "9010",
      "SPEED",
      "THROTTLE",
      "RPM",
      "MAP",
    ];
    const operatorOptions = [
      ["greater_than", "Greater Than"],
      ["less_than", "Less Than"],
      ["equal_to", "Equal To"],
      ["not_equal_to", "Not Equal To"],
      ["becomes_active", "Becomes Active (0->1)"],
      ["becomes_inactive", "Becomes Inactive (1->0)"],
      ["changes", "Changes"],
      ["increases", "Increases"],
      ["decreases", "Decreases"],
    ];
    const ruleConditionSourceOptions = [
      ["selected", "Selected Signal (Use button)"],
      ["virtual|mapped_speed", "Mapped Speed"],
      ["virtual|mapped_throttle", "Mapped Throttle"],
      ["virtual|mapped_rpm", "Mapped RPM"],
      ["virtual|alert_1", "Alert 1 Active"],
      ["virtual|alert_2", "Alert 2 Active"],
      ["virtual|alert_3", "Alert 3 Active"],
    ];
    const alertConditionSourceOptions = [
      ...ruleConditionSourceOptions,
      ["virtual|diag_mode", "Diag Control: Mode"],
      ["virtual|diag_controller_enabled", "Diag Control: Controller Enabled"],
      ["virtual|diag_broadcast_enabled", "Diag Control: Broadcast Enabled"],
      ["virtual|diag_spec_lock", "Diag Spec: Specified Lock"],
      ["virtual|diag_act_lock", "Diag Actual: Measured Lock"],
      ["virtual|diag_haldex_state", "Diag Actual: Haldex State"],
      ["virtual|diag_haldex_engagement", "Diag Actual: Engagement"],
      ["virtual|diag_vehicle_speed", "Diag Vehicle: Speed"],
      ["virtual|diag_vehicle_rpm", "Diag Vehicle: RPM"],
      ["virtual|diag_vehicle_throttle", "Diag Vehicle: Throttle"],
      ["virtual|diag_vehicle_boost", "Diag Vehicle: Boost"],
      ["virtual|diag_clutch1_report", "Diag Vehicle: Clutch 1 Report"],
      ["virtual|diag_clutch2_report", "Diag Vehicle: Clutch 2 Report"],
      ["virtual|diag_coupling_open", "Diag Vehicle: Coupling Open"],
      ["virtual|diag_can_ready", "Diag CAN: Ready"],
      ["virtual|diag_can_chassis", "Diag CAN: Chassis Ready"],
      ["virtual|diag_can_haldex", "Diag CAN: Haldex Ready"],
      ["virtual|diag_can_failure", "Diag CAN: Bus Failure"],
      ["virtual|diag_can_last_chassis_ms", "Diag CAN: Last Chassis ms"],
      ["virtual|diag_can_last_haldex_ms", "Diag CAN: Last Haldex ms"],
    ];
    const deltaOperators = new Set(["changes", "increases", "decreases"]);

    const maxProfiles = 8;
    const maxRules = 24;
    const maxAlerts = 3;
    const collapseStoreKey = "openhaldex:behavior:profile-collapsed";

    let state = null;
    let collapsed = {};
    let availableMaps = [];
    let currentMapPath = "";
    let basicLoadedOnce = false;

    const clampInt = (value, min, max, fallback = min) => {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        return fallback;
      }
      return Math.max(min, Math.min(max, Math.round(n)));
    };

    const clampFloat = (value, min, max, fallback = min) => {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        return fallback;
      }
      return Math.max(min, Math.min(max, n));
    };

    const escapeHtml = (value) =>
      String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");

    const setStatus = (message, pending = false) => {
      statusNode.textContent = message;
      statusNode.classList.toggle("pending", Boolean(pending));
    };

    const setBasicStatus = (message, pending = false) => {
      if (!hasBasicUi) {
        return;
      }
      basicStatusNode.textContent = message;
      basicStatusNode.classList.toggle("pending", Boolean(pending));
    };

    const normalizeSignalKey = (value) =>
      String(value || "")
        .trim()
        .toLowerCase();

    const getSignalBridge = () => {
      const bridge = window.openhaldexSetupSignals;
      if (!bridge || typeof bridge !== "object") {
        return null;
      }
      return bridge;
    };

    const getSelectedSignalKey = () => {
      const bridge = getSignalBridge();
      if (!bridge || typeof bridge.getSelectedSignalId !== "function") {
        return normalizeSignalKey(manualSignalInput ? manualSignalInput.value : "");
      }
      const picked = normalizeSignalKey(bridge.getSelectedSignalId());
      if (picked) return picked;
      return normalizeSignalKey(manualSignalInput ? manualSignalInput.value : "");
    };

    const signalKeyDisplay = (signalKey) => {
      const key = normalizeSignalKey(signalKey);
      if (!key) return "No signal selected";
      if (key === "virtual|mapped_speed") return "Mapped Speed";
      if (key === "virtual|mapped_throttle") return "Mapped Throttle";
      if (key === "virtual|mapped_rpm") return "Mapped RPM";
      if (key === "virtual|alert_1") return "Alert 1 Active";
      if (key === "virtual|alert_2") return "Alert 2 Active";
      if (key === "virtual|alert_3") return "Alert 3 Active";
      if (key === "virtual|diag_mode") return "Diag Control: Mode";
      if (key === "virtual|diag_controller_enabled")
        return "Diag Control: Controller Enabled";
      if (key === "virtual|diag_broadcast_enabled")
        return "Diag Control: Broadcast Enabled";
      if (key === "virtual|diag_spec_lock") return "Diag Spec: Specified Lock";
      if (key === "virtual|diag_act_lock") return "Diag Actual: Measured Lock";
      if (key === "virtual|diag_haldex_state") return "Diag Actual: Haldex State";
      if (key === "virtual|diag_haldex_engagement")
        return "Diag Actual: Engagement";
      if (key === "virtual|diag_vehicle_speed") return "Diag Vehicle: Speed";
      if (key === "virtual|diag_vehicle_rpm") return "Diag Vehicle: RPM";
      if (key === "virtual|diag_vehicle_throttle")
        return "Diag Vehicle: Throttle";
      if (key === "virtual|diag_vehicle_boost") return "Diag Vehicle: Boost";
      if (key === "virtual|diag_clutch1_report")
        return "Diag Vehicle: Clutch 1 Report";
      if (key === "virtual|diag_clutch2_report")
        return "Diag Vehicle: Clutch 2 Report";
      if (key === "virtual|diag_coupling_open")
        return "Diag Vehicle: Coupling Open";
      if (key === "virtual|diag_can_ready") return "Diag CAN: Ready";
      if (key === "virtual|diag_can_chassis") return "Diag CAN: Chassis Ready";
      if (key === "virtual|diag_can_haldex") return "Diag CAN: Haldex Ready";
      if (key === "virtual|diag_can_failure") return "Diag CAN: Bus Failure";
      if (key === "virtual|diag_can_last_chassis_ms")
        return "Diag CAN: Last Chassis ms";
      if (key === "virtual|diag_can_last_haldex_ms")
        return "Diag CAN: Last Haldex ms";

      const bridge = getSignalBridge();
      if (bridge && typeof bridge.getSignalSummary === "function") {
        const summary = bridge.getSignalSummary(key);
        if (summary && summary.name && summary.name !== "Not Assigned") {
          return `${summary.name} ${summary.value ? `| ${summary.value}` : ""}`.trim();
        }
      }

      const parts = key.split("|");
      if (parts.length >= 4) {
        const bus = String(parts[0] || "").toUpperCase();
        const frame = String(parts[1] || "").toUpperCase();
        const signal = String(parts[2] || "").trim();
        const unit = String(parts[3] || "").trim();
        return unit ? `${bus} ${frame} ${signal} (${unit})` : `${bus} ${frame} ${signal}`;
      }
      return key;
    };

    const isVirtualSignalKey = (signalKey) => normalizeSignalKey(signalKey).startsWith("virtual|");

    const sourceValue = (signalKey, options = ruleConditionSourceOptions) => {
      const key = normalizeSignalKey(signalKey);
      return options.some(([value]) => value === key) ? key : "selected";
    };

    const sourceOptionsMarkup = (selected, options = ruleConditionSourceOptions) => {
      const selectedValue = sourceValue(selected, options);
      return options
        .map(([value, label]) => `<option value="${value}" ${value === selectedValue ? "selected" : ""}>${label}</option>`)
        .join("");
    };

    const optionMarkup = (options, selected) =>
      options
        .map(([value, label]) => `<option value="${value}" ${String(value) === String(selected) ? "selected" : ""}>${label}</option>`)
        .join("");

    const usesDeltaThreshold = (operator) => deltaOperators.has(String(operator || "").toLowerCase());

    const valueLabelForOperator = (operator, baseLabel = "Value") =>
      usesDeltaThreshold(operator) ? `${baseLabel} (Min Delta)` : baseLabel;

    const normalizeConditionValue = (operator, rawValue, fallback = 0) => {
      const min = usesDeltaThreshold(operator) ? 0 : -1000000;
      return clampFloat(rawValue, min, 1000000, fallback);
    };

    const sanitizeProfileName = (name, id) => {
      const fallback = `Profile ${id}`;
      const sanitized = String(name || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 23);
      return sanitized || fallback;
    };

    const normalizeCondition = (raw) => {
      const operators = operatorOptions.map((item) => item[0]);
      const operator = operators.includes(String(raw?.operator || ""))
        ? String(raw.operator)
        : "greater_than";
      return {
        signalKey: normalizeSignalKey(raw?.signalKey || raw?.signal || ""),
        operator,
        value: normalizeConditionValue(operator, raw?.value, 0),
        enabled: raw?.enabled !== false,
      };
    };

    const normalizeProfile = (raw, fallbackId = 0) => {
      const id = clampInt(raw?.id, 0, 254, fallbackId);
      const mode = String(raw?.mode || "INHERIT").toUpperCase();
      const releaseRate = clampFloat(raw?.lockReleaseRatePctPerSec, 0, 1000, 120);
      const releaseRateEnabled =
        typeof raw?.releaseRateEnabled === "boolean" ? Boolean(raw.releaseRateEnabled) : releaseRate > 0;
      const mapPath = String(raw?.mapPath || "")
        .trim()
        .slice(0, 95);
      const disengageSource =
        raw && typeof raw.disengageUnderSpeed === "object"
          ? raw?.disengageUnderSpeed?.map
          : raw?.disengageUnderSpeed;
      return {
        id,
        name: sanitizeProfileName(raw?.name, id),
        enabled: raw?.enabled !== false,
        interpolationEnabled: raw?.interpolationEnabled !== false,
        exclusive: Boolean(raw?.exclusive),
        releaseRateEnabled,
        controllerEnabled: raw?.controllerEnabled !== false,
        broadcastEnabled: raw?.broadcastEnabled !== false,
        mode: modeOptions.includes(mode) ? mode : "INHERIT",
        mapPath,
        disableThrottle: clampInt(raw?.disableThrottle, 0, 100, 0),
        disableSpeed: clampInt(raw?.disableSpeed, 0, 300, 0),
        disengageUnderSpeed: clampInt(disengageSource, 0, 300, 0),
        lockReleaseRatePctPerSec: releaseRate > 0 ? releaseRate : 120,
      };
    };

    const normalizeRule = (raw, profileIdFallback = 0) => ({
      enabled: raw?.enabled !== false,
      hasSecondCondition: Boolean(raw?.hasSecondCondition),
      profileId: clampInt(raw?.profileId, 0, 254, profileIdFallback),
      conditionA: normalizeCondition(raw?.conditionA),
      conditionB: normalizeCondition(raw?.conditionB),
    });

    const normalizeAlert = (raw, fallbackId) => {
      const label = String(raw?.label || `Alert ${fallbackId + 1}`)
        .trim()
        .slice(0, 15);
      return {
        id: clampInt(raw?.id, 0, 254, fallbackId),
        enabled: Boolean(raw?.enabled),
        label: label || `Alert ${fallbackId + 1}`,
        condition: normalizeCondition(raw?.condition),
      };
    };

    const normalizeBuilder = (payload) => {
      const profilesRaw = Array.isArray(payload?.profiles) ? payload.profiles.slice(0, maxProfiles) : [];
      const profiles = profilesRaw.map((profile, idx) => normalizeProfile(profile, idx));
      if (!profiles.length) profiles.push(normalizeProfile({}, 0));

      const validProfileIds = new Set(profiles.map((profile) => profile.id));
      const rulesRaw = Array.isArray(payload?.rules) ? payload.rules.slice(0, maxRules) : [];
      const rules = rulesRaw.map((rule) => {
        const normalized = normalizeRule(rule, profiles[0].id);
        if (!validProfileIds.has(normalized.profileId)) {
          normalized.profileId = profiles[0].id;
        }
        return normalized;
      });

      const alertsRaw = Array.isArray(payload?.alerts) ? payload.alerts.slice(0, maxAlerts) : [];
      const alerts = [];
      for (let i = 0; i < maxAlerts; i += 1) {
        alerts.push(normalizeAlert(alertsRaw[i], i));
      }

      const defaultProfileId = validProfileIds.has(Number(payload?.defaultProfileId))
        ? Number(payload.defaultProfileId)
        : profiles[0].id;
      const defaultProfile = profiles.find((profile) => Number(profile.id) === Number(defaultProfileId));
      if (defaultProfile) {
        defaultProfile.exclusive = true;
      }

      return {
        schemaVersion: Number(payload?.schemaVersion) || 5,
        revision: Number(payload?.revision) || 0,
        enabled: Boolean(payload?.enabled),
        defaultProfileId,
        profiles,
        rules,
        alerts,
      };
    };

    const isLegacySingleRuleDefault = (builder) => {
      if (!builder || !Array.isArray(builder.profiles) || !Array.isArray(builder.rules)) return false;
      if (builder.profiles.length !== 2 || builder.rules.length !== 1) return false;
      const rule = builder.rules[0];
      const cond = normalizeCondition(rule?.conditionA);
      return (
        Number(rule?.profileId) === 1 &&
        normalizeSignalKey(cond.signalKey) === "virtual|mapped_speed" &&
        cond.operator === "less_than" &&
        Math.abs(Number(cond.value) - 20) <= 0.001
      );
    };

    const seedStarterDefaultsIfEmpty = (builder) => {
      if (!builder || !Array.isArray(builder.profiles) || !Array.isArray(builder.rules)) return false;
      const freshBuilder = builder.profiles.length === 1 && builder.rules.length === 0;
      const legacyBuilder = isLegacySingleRuleDefault(builder);
      if (!freshBuilder && !legacyBuilder) return false;

      builder.profiles = [
        normalizeProfile({ id: 0, name: "Base Profile", mode: "INHERIT", exclusive: true }, 0),
        normalizeProfile({ id: 1, name: "Disable Below Speed", mode: "FWD" }, 1),
        normalizeProfile({ id: 2, name: "Disable Above Speed", mode: "FWD" }, 2),
        normalizeProfile({ id: 3, name: "Disable Below Throttle", mode: "FWD" }, 3),
      ];
      builder.defaultProfileId = 0;
      builder.rules = [
        normalizeRule({
          enabled: true,
          hasSecondCondition: false,
          profileId: 1,
          conditionA: { signalKey: "virtual|mapped_speed", operator: "less_than", value: 20, enabled: true },
          conditionB: { signalKey: "", operator: "greater_than", value: 0, enabled: false },
        }, 1),
        normalizeRule({
          enabled: true,
          hasSecondCondition: false,
          profileId: 2,
          conditionA: { signalKey: "virtual|mapped_speed", operator: "greater_than", value: 120, enabled: true },
          conditionB: { signalKey: "", operator: "greater_than", value: 0, enabled: false },
        }, 2),
        normalizeRule({
          enabled: true,
          hasSecondCondition: false,
          profileId: 3,
          conditionA: { signalKey: "virtual|mapped_throttle", operator: "less_than", value: 5, enabled: true },
          conditionB: { signalKey: "", operator: "greater_than", value: 0, enabled: false },
        }, 3),
      ];
      return true;
    };

    const renderMeta = () => {
      metaNode.textContent = state ? `Schema ${state.schemaVersion} | Revision ${state.revision}` : "Schema - | Revision -";
    };

    const rulesForProfile = (profileId) =>
      state.rules
        .map((rule, idx) => ({ idx, rule }))
        .filter((item) => Number(item.rule?.profileId) === Number(profileId));

    const mapOptionsMarkup = (selectedPath) => {
      const selected = String(selectedPath || "");
      const seen = new Set();
      const options = [];
      const pushOption = (path, label) => {
        const p = String(path || "");
        if (!p || seen.has(p)) return;
        seen.add(p);
        options.push(`<option value="${escapeHtml(p)}" ${p === selected ? "selected" : ""}>${escapeHtml(label || p)}</option>`);
      };

      pushOption("", "Use Current Active Map");
      if (selected) {
        const selectedName = selected.split("/").pop() || selected;
        pushOption(selected, selectedName);
      }

      availableMaps.forEach((entry) => {
        const path = String(entry?.path || "");
        const label = String(entry?.name || "").trim() || (path.split("/").pop() || path);
        pushOption(path, label);
      });

      return options.join("");
    };

    const nextProfileId = () => {
      const used = new Set(state.profiles.map((profile) => Number(profile.id)));
      for (let id = 0; id <= 254; id += 1) {
        if (!used.has(id)) return id;
      }
      return clampInt(state.profiles.length, 0, 254, 0);
    };
    const renderRuleRows = (profileId) => {
      const profileRules = rulesForProfile(profileId);
      if (!profileRules.length) {
        return '<div class="setup-subtle">No rules on this profile. Add a rule to start.</div>';
      }

      return profileRules
        .map(({ rule, idx }, localIdx) => {
          const condA = normalizeCondition(rule?.conditionA);
          const condB = normalizeCondition(rule?.conditionB);
          const condASource = sourceValue(condA.signalKey, ruleConditionSourceOptions);
          const condBSource = sourceValue(condB.signalKey, ruleConditionSourceOptions);
          const condAUsesSelected = condASource === "selected";
          const condBUsesSelected = condBSource === "selected";
          const condAValueLabel = valueLabelForOperator(condA.operator, "Condition A Value");
          const condBValueLabel = valueLabelForOperator(condB.operator, "Condition B Value");
          return `
            <div class="behavior-rule-row" data-rule-index="${idx}">
              <div class="behavior-rule-top">
                <label class="curve-inline-toggle">
                  <input type="checkbox" data-key="enabled" ${rule.enabled ? "checked" : ""} />
                  Rule ${localIdx + 1}
                </label>
                <label class="curve-inline-toggle">
                  <input type="checkbox" data-key="hasSecondCondition" ${rule.hasSecondCondition ? "checked" : ""} />
                  Use Condition B
                </label>
                <button type="button" class="setup-btn secondary" data-action="remove-rule">Remove</button>
              </div>
              <div class="behavior-rule-conditions">
                <div class="behavior-condition-row" data-cond="A">
                  <label class="behavior-field">
                    <span>Condition A Source</span>
                    <select class="setup-select" data-key="source" data-cond="A">
                      ${sourceOptionsMarkup(condASource, ruleConditionSourceOptions)}
                    </select>
                  </label>
                  <label class="behavior-field behavior-field-wide">
                    <span>Condition A Signal</span>
                    <div class="behavior-signal-control">
                      <input class="curve-disengage-input" type="text" value="${escapeHtml(signalKeyDisplay(condA.signalKey))}" readonly />
                      <button type="button" class="setup-btn secondary" data-action="assign-selected-signal" data-cond="A" ${condAUsesSelected ? "" : "disabled"}>
                        Use Selected
                      </button>
                    </div>
                  </label>
                  <label class="behavior-field">
                    <span>Condition A Operator</span>
                    <select class="setup-select" data-key="operator" data-cond="A">
                      ${optionMarkup(operatorOptions, condA.operator)}
                    </select>
                  </label>
                  <label class="behavior-field">
                    <span>${condAValueLabel}</span>
                    <input class="curve-disengage-input" type="number" step="0.1" data-key="value" data-cond="A" value="${condA.value}" />
                  </label>
                  <label class="curve-inline-toggle">
                    <input type="checkbox" data-key="enabled" data-cond="A" ${condA.enabled ? "checked" : ""} />
                    Enabled
                  </label>
                </div>
                ${rule.hasSecondCondition ? `
                  <div class="behavior-condition-row" data-cond="B">
                    <label class="behavior-field">
                      <span>Condition B Source</span>
                      <select class="setup-select" data-key="source" data-cond="B">
                        ${sourceOptionsMarkup(condBSource, ruleConditionSourceOptions)}
                      </select>
                    </label>
                    <label class="behavior-field behavior-field-wide">
                      <span>Condition B Signal</span>
                      <div class="behavior-signal-control">
                        <input class="curve-disengage-input" type="text" value="${escapeHtml(signalKeyDisplay(condB.signalKey))}" readonly />
                        <button type="button" class="setup-btn secondary" data-action="assign-selected-signal" data-cond="B" ${condBUsesSelected ? "" : "disabled"}>
                          Use Selected
                        </button>
                      </div>
                    </label>
                    <label class="behavior-field">
                      <span>Condition B Operator</span>
                      <select class="setup-select" data-key="operator" data-cond="B">
                        ${optionMarkup(operatorOptions, condB.operator)}
                      </select>
                    </label>
                    <label class="behavior-field">
                      <span>${condBValueLabel}</span>
                      <input class="curve-disengage-input" type="number" step="0.1" data-key="value" data-cond="B" value="${condB.value}" />
                    </label>
                    <label class="curve-inline-toggle">
                      <input type="checkbox" data-key="enabled" data-cond="B" ${condB.enabled ? "checked" : ""} />
                      Enabled
                    </label>
                  </div>
                ` : ""}
              </div>
            </div>
          `;
        })
        .join("");
    };

    const renderProfiles = () => {
      profilesNode.innerHTML = state.profiles
        .map((profile, profileIndex) => {
          const defaultChecked = Number(profile.id) === Number(state.defaultProfileId);
          const modeMarkup = optionMarkup(modeOptions.map((mode) => [mode, mode]), profile.mode);
          const mapModeSelected = String(profile.mode || "").toUpperCase() === "MAP";
          const mapMarkup = mapOptionsMarkup(profile.mapPath);
          const releaseRateEnabled = Boolean(profile.releaseRateEnabled);
          const releaseRate = clampFloat(profile.lockReleaseRatePctPerSec, 0, 1000, 120);
          const open = collapsed[String(Number(profile.id))] !== true;

          return `
            <details class="behavior-profile-card" data-profile-index="${profileIndex}" ${open ? "open" : ""}>
              <summary class="behavior-profile-summary">
                <span class="behavior-profile-title">${escapeHtml(profile.name)}</span>
                <span class="behavior-profile-meta">ID ${profile.id} | ${escapeHtml(profile.mode)}${defaultChecked ? " | Default" : ""}${profile.enabled ? "" : " | Disabled"}</span>
              </summary>
              <div class="behavior-profile-body">
                <div class="behavior-row behavior-row-3">
                  <label class="behavior-field">
                    <span>Profile Name</span>
                    <input class="curve-disengage-input" type="text" maxlength="23" data-profile-field="name" value="${escapeHtml(profile.name)}" placeholder="Street, Track, Rain..." />
                  </label>
                  <label class="behavior-field">
                    <span>Mode</span>
                    <select class="setup-select" data-profile-field="mode">${modeMarkup}</select>
                  </label>
                  <label class="behavior-field">
                    <span>Release Rate %/s</span>
                    <input class="curve-disengage-input" type="number" min="0" max="1000" step="1" data-profile-field="releaseRate" value="${Math.round(releaseRate)}" ${releaseRateEnabled ? "" : "disabled"} />
                  </label>
                </div>
                <div class="behavior-row behavior-row-3">
                  <label class="behavior-field">
                    <span>Disengage Under Speed (km/h)</span>
                    <input class="curve-disengage-input" type="number" min="0" max="300" step="1" data-profile-field="disengageUnderSpeed" value="${clampInt(profile.disengageUnderSpeed, 0, 300, 0)}" />
                  </label>
                  <label class="behavior-field">
                    <span>Disable Above Speed (km/h)</span>
                    <input class="curve-disengage-input" type="number" min="0" max="300" step="1" data-profile-field="disableSpeed" value="${clampInt(profile.disableSpeed, 0, 300, 0)}" />
                  </label>
                  <label class="behavior-field">
                    <span>Disable Below Throttle (%)</span>
                    <input class="curve-disengage-input" type="number" min="0" max="100" step="1" data-profile-field="disableThrottle" value="${clampInt(profile.disableThrottle, 0, 100, 0)}" />
                  </label>
                </div>
                <div class="behavior-row behavior-profile-toggles">
                  <label class="curve-inline-toggle">
                    <input type="radio" name="behavior-default-profile" data-profile-field="isDefault" ${defaultChecked ? "checked" : ""} />
                    Default Profile
                  </label>
                  <label class="curve-inline-toggle">
                    <input type="checkbox" data-profile-field="enabled" ${profile.enabled ? "checked" : ""} />
                    Profile Enabled
                  </label>
                  <label class="curve-inline-toggle">
                    <input type="checkbox" data-profile-field="interpolationEnabled" ${profile.interpolationEnabled ? "checked" : ""} />
                    Interpolation
                  </label>
                  <label class="curve-inline-toggle">
                    <input type="checkbox" data-profile-field="exclusive" ${profile.exclusive ? "checked" : ""} ${defaultChecked ? "disabled" : ""} />
                    Exclusive ${defaultChecked ? "(forced for default)" : "(ignore other profile rules)"}
                  </label>
                  <label class="curve-inline-toggle">
                    <input type="checkbox" data-profile-field="releaseRateEnabled" ${releaseRateEnabled ? "checked" : ""} />
                    Release Rate
                  </label>
                  <label class="curve-inline-toggle">
                    <input type="checkbox" data-profile-field="controllerEnabled" ${profile.controllerEnabled ? "checked" : ""} />
                    Controller Enabled
                  </label>
                  <label class="curve-inline-toggle">
                    <input type="checkbox" data-profile-field="broadcastEnabled" ${profile.broadcastEnabled ? "checked" : ""} />
                    Broadcast Haldex
                  </label>
                </div>
                <div class="behavior-row behavior-row-2">
                  <label class="behavior-field">
                    <span>Map File (MAP mode)</span>
                    <select class="setup-select" data-profile-field="mapPath" ${mapModeSelected ? "" : "disabled"}>
                      ${mapMarkup}
                    </select>
                  </label>
                  <div class="setup-subtle">
                    ${mapModeSelected
                      ? `Active map source for this profile${currentMapPath ? ` (current: ${escapeHtml(currentMapPath.split("/").pop() || currentMapPath)})` : ""}.`
                      : "Set mode to MAP to assign a map file."}
                  </div>
                </div>
                <div class="behavior-profile-actions">
                  <button type="button" class="setup-btn secondary" data-action="add-rule">Add Rule</button>
                  <button type="button" class="setup-btn secondary" data-action="remove-profile" ${state.profiles.length <= 1 ? "disabled" : ""}>Remove Profile</button>
                </div>
                <div class="behavior-rules">${renderRuleRows(profile.id)}</div>
              </div>
            </details>
          `;
        })
        .join("");
    };

    const renderAlerts = () => {
      alertsNode.innerHTML = state.alerts
        .map((alert, idx) => {
          const cond = normalizeCondition(alert.condition);
          const source = sourceValue(cond.signalKey, alertConditionSourceOptions);
          const usesSelected = source === "selected";
          const alertValueLabel = valueLabelForOperator(cond.operator, "Value");
          return `
            <div class="behavior-alert-row" data-alert-index="${idx}">
              <label class="behavior-field">
                <span>Label</span>
                <input class="curve-disengage-input" type="text" maxlength="15" data-key="label" value="${String(alert.label || "").replace(/\"/g, "&quot;")}" />
              </label>
              <label class="curve-inline-toggle">
                <input type="checkbox" data-key="enabled" ${alert.enabled ? "checked" : ""} />
                Enabled
              </label>
              <label class="behavior-field">
                <span>Source</span>
                <select class="setup-select" data-key="source">${sourceOptionsMarkup(source, alertConditionSourceOptions)}</select>
              </label>
              <label class="behavior-field behavior-field-wide">
                <span>Signal</span>
                <div class="behavior-signal-control">
                  <input class="curve-disengage-input" type="text" value="${escapeHtml(signalKeyDisplay(cond.signalKey))}" readonly />
                  <button type="button" class="setup-btn secondary" data-action="assign-alert-signal" ${usesSelected ? "" : "disabled"}>Use Selected</button>
                </div>
              </label>
              <label class="behavior-field">
                <span>Operator</span>
                <select class="setup-select" data-key="operator">${optionMarkup(operatorOptions, cond.operator)}</select>
              </label>
              <label class="behavior-field">
                <span>${alertValueLabel}</span>
                <input class="curve-disengage-input" type="number" step="0.1" data-key="value" value="${cond.value}" />
              </label>
            </div>
          `;
        })
        .join("");
    };

    const readBasicSettingsFromStatus = (status) => {
      if (!hasBasicUi) {
        return;
      }
      const disengage = clampInt(status?.disengageUnderSpeed?.map, 0, 300, 0);
      basicDisengageInput.value = String(disengage);
      basicDisableSpeedInput.value = String(clampInt(status?.disableSpeed, 0, 300, 0));
      basicDisableThrottleInput.value = String(clampInt(status?.disableThrottle, 0, 100, 0));
      basicReleaseRateInput.value = String(Math.round(clampFloat(status?.lockReleaseRatePctPerSec, 0, 1000, 120)));
      basicControllerEnabled.checked = !Boolean(status?.disableController);
      basicBroadcastEnabled.checked = status?.broadcastOpenHaldexOverCAN !== false;
    };

    const loadBasicSettings = async () => {
      if (!hasBasicUi) {
        return;
      }
      setBasicStatus("Loading basic settings...", true);
      try {
        const status = await apiJson("/api/status");
        readBasicSettingsFromStatus(status);
        basicLoadedOnce = true;
        setBasicStatus("Basic settings loaded.");
      } catch (error) {
        setBasicStatus(`Basic settings load failed: ${error.message}`, true);
      }
    };

    const saveBasicSettings = async () => {
      if (!hasBasicUi) {
        return;
      }
      const disengage = clampInt(basicDisengageInput.value, 0, 300, 0);
      const disableSpeed = clampInt(basicDisableSpeedInput.value, 0, 300, 0);
      const disableThrottle = clampInt(basicDisableThrottleInput.value, 0, 100, 0);
      const releaseRate = clampFloat(basicReleaseRateInput.value, 0, 1000, 120);
      const controllerEnabled = Boolean(basicControllerEnabled.checked);
      const broadcastEnabled = Boolean(basicBroadcastEnabled.checked);

      setBasicStatus("Saving basic settings...", true);
      try {
        await apiJson("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            disableController: !controllerEnabled,
            broadcastOpenHaldexOverCAN: broadcastEnabled,
            disableThrottle,
            disableSpeed,
            lockReleaseRatePctPerSec: releaseRate,
            disengageUnderSpeed: {
              map: disengage,
              speed: disengage,
              throttle: disengage,
              rpm: disengage,
            },
          }),
        });
        await loadBasicSettings();
        setBasicStatus("Basic settings saved.");
      } catch (error) {
        setBasicStatus(`Basic settings save failed: ${error.message}`, true);
      }
    };

    const renderAll = () => {
      const advancedModeEnabled = Boolean(state.enabled);
      enabledToggle.checked = advancedModeEnabled;
      if (headingNode) {
        headingNode.textContent = advancedModeEnabled ? "Behavior Engine Builder" : "Basic Settings";
      }
      if (metaNode) {
        metaNode.hidden = !advancedModeEnabled;
      }
      if (advancedActionsNode) {
        advancedActionsNode.hidden = !advancedModeEnabled;
      }
      if (selectedSignalPanelNode) {
        selectedSignalPanelNode.hidden = !advancedModeEnabled;
      }
      if (advancedPanel) {
        advancedPanel.hidden = !advancedModeEnabled;
      }
      if (alertsPane) {
        alertsPane.hidden = false;
      }
      if (basicPanel) {
        basicPanel.hidden = advancedModeEnabled;
      }
      if (statusNode) {
        statusNode.hidden = !advancedModeEnabled;
      }
      [loadBtn, downloadBtn, uploadBtn, saveBtn].forEach((button) => {
        if (button) {
          button.disabled = !advancedModeEnabled;
        }
      });
      if (addProfileBtn) {
        addProfileBtn.disabled = !advancedModeEnabled;
      }
      renderMeta();
      renderProfiles();
      renderAlerts();
      if (!advancedModeEnabled && hasBasicUi && !basicLoadedOnce) {
        loadBasicSettings().catch(() => {
          // explicit error message already emitted
        });
      }
    };

    const normalizeConditionPayload = (condition) => {
      const normalized = normalizeCondition(condition);
      return {
        signalKey: normalizeSignalKey(normalized.signalKey),
        operator: normalized.operator,
        value: normalized.value,
        enabled: Boolean(normalized.enabled),
      };
    };

    const validateBeforeSave = () => {
      for (let i = 0; i < state.rules.length; i += 1) {
        const rule = state.rules[i];
        if (!rule.enabled) continue;
        const condA = normalizeCondition(rule.conditionA);
        if (condA.enabled && !condA.signalKey) return `Rule ${i + 1} condition A is enabled but has no signal.`;
        if (rule.hasSecondCondition) {
          const condB = normalizeCondition(rule.conditionB);
          if (condB.enabled && !condB.signalKey) return `Rule ${i + 1} condition B is enabled but has no signal.`;
        }
      }
      for (let i = 0; i < state.alerts.length; i += 1) {
        const alert = state.alerts[i];
        if (!alert.enabled) continue;
        const cond = normalizeCondition(alert.condition);
        if (cond.enabled && !cond.signalKey) return `Alert ${i + 1} is enabled but has no signal.`;
      }
      return "";
    };

    const serializeBehaviorPayload = () => {
      const validProfileIds = new Set(state.profiles.map((profile) => clampInt(profile.id, 0, 254, 0)));
      const fallbackDefaultId = clampInt(state.profiles[0]?.id, 0, 254, 0);
      const selectedDefaultId = clampInt(state.defaultProfileId, 0, 254, fallbackDefaultId);
      const defaultProfileId = validProfileIds.has(selectedDefaultId) ? selectedDefaultId : fallbackDefaultId;

      return {
        schemaVersion: 5,
        enabled: Boolean(state.enabled),
        defaultProfileId,
        profiles: state.profiles.map((profile) => ({
          id: clampInt(profile.id, 0, 254, 0),
          name: sanitizeProfileName(profile.name, clampInt(profile.id, 0, 254, 0)),
          enabled: Boolean(profile.enabled),
          interpolationEnabled: Boolean(profile.interpolationEnabled),
          exclusive:
            Boolean(profile.exclusive) || clampInt(profile.id, 0, 254, 0) === Number(defaultProfileId),
          controllerEnabled: Boolean(profile.controllerEnabled),
          broadcastEnabled: Boolean(profile.broadcastEnabled),
          mode: modeOptions.includes(String(profile.mode).toUpperCase()) ? String(profile.mode).toUpperCase() : "INHERIT",
          mapPath: String(profile.mapPath || "").trim().slice(0, 95),
          disableThrottle: clampInt(profile.disableThrottle, 0, 100, 0),
          disableSpeed: clampInt(profile.disableSpeed, 0, 300, 0),
          disengageUnderSpeed: clampInt(profile.disengageUnderSpeed, 0, 300, 0),
          lockReleaseRatePctPerSec: Boolean(profile.releaseRateEnabled)
            ? clampFloat(profile.lockReleaseRatePctPerSec, 0, 1000, 120)
            : 0,
        })),
        rules: state.rules.map((rule) => ({
          enabled: Boolean(rule.enabled),
          hasSecondCondition: Boolean(rule.hasSecondCondition),
          profileId: validProfileIds.has(clampInt(rule.profileId, 0, 254, defaultProfileId))
            ? clampInt(rule.profileId, 0, 254, defaultProfileId)
            : defaultProfileId,
          conditionA: normalizeConditionPayload(rule.conditionA),
          conditionB: normalizeConditionPayload(rule.conditionB),
        })),
        alerts: state.alerts.map((alert, idx) => ({
          id: clampInt(alert.id, 0, 254, idx),
          enabled: Boolean(alert.enabled),
          label: String(alert.label || `Alert ${idx + 1}`).trim().slice(0, 15),
          condition: normalizeConditionPayload(alert.condition),
        })),
      };
    };

    const serializeBehaviorProfilePayload = () => {
      const payload = serializeBehaviorPayload();
      delete payload.alerts;
      return payload;
    };

    const loadBuilder = async () => {
      setStatus("Loading behavior builder...", true);
      try {
        const [payload, mapsPayload] = await Promise.all([
          apiJson("/api/behavior"),
          apiJson("/api/maps").catch(() => ({ maps: [], current: "" })),
        ]);
        availableMaps = Array.isArray(mapsPayload?.maps) ? mapsPayload.maps : [];
        currentMapPath = String(mapsPayload?.current || "");
        state = normalizeBuilder(payload);
        basicLoadedOnce = false;
        const seeded = seedStarterDefaultsIfEmpty(state);
        renderAll();
        setStatus(seeded ? "Starter defaults loaded. Save Builder to apply them." : "Builder loaded.");
      } catch (error) {
        setStatus(`Builder load failed: ${error.message}`, true);
      }
    };

    const saveBuilder = async () => {
      if (!state) return;
      setStatus("Saving builder...", true);
      try {
        const validationError = validateBeforeSave();
        if (validationError) {
          setStatus(validationError, true);
          return;
        }
        await apiJson("/api/behavior", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(serializeBehaviorPayload()),
        });
        await loadBuilder();
        setStatus("Builder saved to device.");
      } catch (error) {
        setStatus(`Builder save failed: ${error.message}`, true);
      }
    };

    const downloadBuilderProfile = () => {
      if (!state) {
        setStatus("Builder not loaded yet.", true);
        return;
      }
      try {
        const defaultProfile = state.profiles.find((profile) => Number(profile.id) === Number(state.defaultProfileId));
        const profileName = safeFilename((defaultProfile && defaultProfile.name) || state.profiles[0]?.name || "profile");
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `openhaldex-behavior-${profileName}-${stamp}.txt`;
        const text = `${JSON.stringify(serializeBehaviorProfilePayload(), null, 2)}\n`;
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        setStatus("Profile exported (.txt JSON).");
      } catch (error) {
        setStatus(`Export failed: ${error.message}`, true);
      }
    };
    const importBuilderProfileFromText = async (text) => {
      let parsed;
      try {
        parsed = JSON.parse(String(text || ""));
      } catch {
        throw new Error("invalid JSON file");
      }
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.profiles)) {
        throw new Error("profile file missing profiles array");
      }
      const preservedAlerts = state && Array.isArray(state.alerts) ? state.alerts : null;
      state = normalizeBuilder(parsed);
      if (preservedAlerts && preservedAlerts.length) {
        state.alerts = preservedAlerts;
      }
      renderAll();
      setStatus("Profile imported (alerts unchanged). Saving to device...", true);
      await saveBuilder();
    };

    enabledToggle.addEventListener("change", async () => {
      if (!state) return;
      const nextEnabled = Boolean(enabledToggle.checked);
      state.enabled = nextEnabled;
      renderAll();
      setStatus(`Updating behavior engine: ${nextEnabled ? "enabled" : "disabled"}...`, true);
      try {
        await apiJson("/api/behavior", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: nextEnabled }),
        });
        basicLoadedOnce = false;
        await loadBuilder();
        setStatus(`Behavior engine ${nextEnabled ? "enabled" : "disabled"}.`);
      } catch (error) {
        state.enabled = !nextEnabled;
        enabledToggle.checked = !nextEnabled;
        renderAll();
        setStatus(`Behavior engine update failed: ${error.message}`, true);
      }
    });

    profilesNode.addEventListener(
      "toggle",
      (event) => {
        if (!state) return;
        const details = event.target;
        if (!details || String(details.tagName || "").toLowerCase() !== "details") return;
        const card = details.closest("[data-profile-index]");
        if (!card) return;
        const idx = clampInt(card.dataset.profileIndex, 0, state.profiles.length - 1, -1);
        if (idx < 0) return;
        collapsed[String(Number(state.profiles[idx].id))] = !Boolean(details.open);
        try {
          window.localStorage.setItem(collapseStoreKey, JSON.stringify(collapsed));
        } catch {
          // ignore storage failures
        }
      },
      true
    );

    profilesNode.addEventListener("input", (event) => {
      if (!state) return;
      const card = event.target.closest("[data-profile-index]");
      if (!card) return;
      const idx = clampInt(card.dataset.profileIndex, 0, state.profiles.length - 1, -1);
      if (idx < 0) return;
      const profile = state.profiles[idx];
      const field = event.target.getAttribute("data-profile-field");
      if (field === "name") {
        profile.name = String(event.target.value || "").slice(0, 23);
        const title = card.querySelector(".behavior-profile-title");
        if (title) {
          title.textContent = profile.name || `Profile ${profile.id}`;
        }
      }
      if (field === "releaseRate") {
        profile.lockReleaseRatePctPerSec = clampFloat(event.target.value, 0, 1000, 120);
      }
      if (field === "disengageUnderSpeed") {
        profile.disengageUnderSpeed = clampInt(event.target.value, 0, 300, 0);
      }
      if (field === "disableSpeed") {
        profile.disableSpeed = clampInt(event.target.value, 0, 300, 0);
      }
      if (field === "disableThrottle") {
        profile.disableThrottle = clampInt(event.target.value, 0, 100, 0);
      }
    });

    profilesNode.addEventListener("change", (event) => {
      if (!state) return;

      const card = event.target.closest("[data-profile-index]");
      const profileIdx = card ? clampInt(card.dataset.profileIndex, 0, state.profiles.length - 1, -1) : -1;
      const profile = profileIdx >= 0 ? state.profiles[profileIdx] : null;
      const profileField = event.target.getAttribute("data-profile-field");

      if (profile && profileField) {
        if (profileField === "name") {
          profile.name = sanitizeProfileName(event.target.value, profile.id);
          event.target.value = profile.name;
          renderProfiles();
          return;
        }
        if (profileField === "mode") {
          const mode = String(event.target.value || "INHERIT").toUpperCase();
          profile.mode = modeOptions.includes(mode) ? mode : "INHERIT";
          renderProfiles();
          return;
        }
        if (profileField === "releaseRate") {
          profile.lockReleaseRatePctPerSec = clampFloat(event.target.value, 0, 1000, 120);
          event.target.value = String(Math.round(profile.lockReleaseRatePctPerSec));
          return;
        }
        if (profileField === "disengageUnderSpeed") {
          profile.disengageUnderSpeed = clampInt(event.target.value, 0, 300, 0);
          event.target.value = String(profile.disengageUnderSpeed);
          return;
        }
        if (profileField === "disableSpeed") {
          profile.disableSpeed = clampInt(event.target.value, 0, 300, 0);
          event.target.value = String(profile.disableSpeed);
          return;
        }
        if (profileField === "disableThrottle") {
          profile.disableThrottle = clampInt(event.target.value, 0, 100, 0);
          event.target.value = String(profile.disableThrottle);
          return;
        }
        if (profileField === "isDefault") {
          if (event.target.checked) {
            profile.exclusive = true;
            state.defaultProfileId = profile.id;
            renderProfiles();
          }
          return;
        }
        if (profileField === "enabled") {
          profile.enabled = Boolean(event.target.checked);
          renderProfiles();
          return;
        }
        if (profileField === "interpolationEnabled") {
          profile.interpolationEnabled = Boolean(event.target.checked);
          return;
        }
        if (profileField === "exclusive") {
          if (Number(profile.id) === Number(state.defaultProfileId)) {
            profile.exclusive = true;
            renderProfiles();
            return;
          }
          profile.exclusive = Boolean(event.target.checked);
          return;
        }
        if (profileField === "releaseRateEnabled") {
          profile.releaseRateEnabled = Boolean(event.target.checked);
          if (profile.releaseRateEnabled && profile.lockReleaseRatePctPerSec <= 0) {
            profile.lockReleaseRatePctPerSec = 120;
          }
          renderProfiles();
          return;
        }
        if (profileField === "controllerEnabled") {
          profile.controllerEnabled = Boolean(event.target.checked);
          return;
        }
        if (profileField === "broadcastEnabled") {
          profile.broadcastEnabled = Boolean(event.target.checked);
          return;
        }
        if (profileField === "mapPath") {
          profile.mapPath = String(event.target.value || "").trim().slice(0, 95);
          return;
        }
      }

      const ruleRow = event.target.closest("[data-rule-index]");
      if (!ruleRow) return;
      const ruleIdx = clampInt(ruleRow.dataset.ruleIndex, 0, state.rules.length - 1, -1);
      if (ruleIdx < 0) return;

      const rule = state.rules[ruleIdx];
      const key = event.target.getAttribute("data-key") || "";
      const cond = String(event.target.getAttribute("data-cond") || "").toUpperCase();

      if (!cond) {
        if (key === "enabled") {
          rule.enabled = Boolean(event.target.checked);
        } else if (key === "hasSecondCondition") {
          rule.hasSecondCondition = Boolean(event.target.checked);
        }
        renderProfiles();
        return;
      }

      const targetCondition = cond === "A" ? rule.conditionA : rule.conditionB;
      if (key === "source") {
        const source = normalizeSignalKey(event.target.value || "selected");
        if (source === "selected") {
          if (isVirtualSignalKey(targetCondition.signalKey)) {
            targetCondition.signalKey = "";
            targetCondition.enabled = false;
          }
        } else {
          targetCondition.signalKey = source;
          targetCondition.enabled = true;
        }
        renderProfiles();
        return;
      }
      if (key === "operator") {
        targetCondition.operator = String(event.target.value || "greater_than");
        if (usesDeltaThreshold(targetCondition.operator) && targetCondition.value < 0) {
          targetCondition.value = 0;
        }
        renderProfiles();
        return;
      } else if (key === "value") {
        targetCondition.value = normalizeConditionValue(targetCondition.operator, event.target.value, 0);
      } else if (key === "enabled") {
        targetCondition.enabled = Boolean(event.target.checked);
      }
    });

    profilesNode.addEventListener("click", (event) => {
      if (!state) return;

      const assignBtn = event.target.closest("[data-action='assign-selected-signal']");
      if (assignBtn) {
        const row = assignBtn.closest("[data-rule-index]");
        if (!row) return;
        const ruleIdx = clampInt(row.dataset.ruleIndex, 0, state.rules.length - 1, -1);
        if (ruleIdx < 0) return;

        const cond = String(assignBtn.getAttribute("data-cond") || "A").toUpperCase();
        const rule = state.rules[ruleIdx];
        if (cond === "B" && !rule.hasSecondCondition) return;

        const selectedSignalKey = getSelectedSignalKey();
        if (!selectedSignalKey) {
          setStatus("Pick a signal in Signal Snapshot Picker, then click Use Selected.", true);
          return;
        }

        const targetCondition = cond === "A" ? rule.conditionA : rule.conditionB;
        targetCondition.signalKey = selectedSignalKey;
        if (!targetCondition.enabled) targetCondition.enabled = true;
        renderProfiles();
        setStatus(`Rule ${ruleIdx + 1} condition ${cond} signal assigned.`);
        return;
      }

      const card = event.target.closest("[data-profile-index]");
      const profileIdx = card ? clampInt(card.dataset.profileIndex, 0, state.profiles.length - 1, -1) : -1;
      const profile = profileIdx >= 0 ? state.profiles[profileIdx] : null;

      const addRuleAction = event.target.closest("[data-action='add-rule']");
      if (addRuleAction) {
        if (!profile) {
          setStatus("Could not find profile for new rule.", true);
          return;
        }
        if (state.rules.length >= maxRules) {
          setStatus(`Rule limit reached (${maxRules}).`, true);
          return;
        }
        const selectedSignalKey = getSelectedSignalKey();
        state.rules.push(
          normalizeRule(
            {
              enabled: true,
              hasSecondCondition: false,
              profileId: profile.id,
              conditionA: {
                signalKey: selectedSignalKey,
                operator: "greater_than",
                value: 0,
                enabled: Boolean(selectedSignalKey),
              },
              conditionB: {
                signalKey: selectedSignalKey,
                operator: "greater_than",
                value: 0,
                enabled: false,
              },
            },
            profile.id
          )
        );
        renderProfiles();
        setStatus("Rule added. Use Signal Snapshot Picker to assign signal conditions.");
        return;
      }

      const removeProfileAction = event.target.closest("[data-action='remove-profile']");
      if (removeProfileAction) {
        if (!profile) {
          setStatus("Could not find profile to remove.", true);
          return;
        }
        if (state.profiles.length <= 1) {
          setStatus("At least one profile is required.", true);
          return;
        }
        const removed = state.profiles.splice(profileIdx, 1)[0];
        if (Number(state.defaultProfileId) === Number(removed?.id)) {
          state.defaultProfileId = state.profiles[0]?.id ?? 0;
        }
        state.rules = state.rules.filter((rule) => Number(rule.profileId) !== Number(removed?.id));
        delete collapsed[String(Number(removed?.id))];
        try {
          window.localStorage.setItem(collapseStoreKey, JSON.stringify(collapsed));
        } catch {
          // ignore storage failures
        }
        renderProfiles();
        setStatus(`Profile ${removed?.id ?? "-"} removed.`);
        return;
      }

      const removeRuleAction = event.target.closest("[data-action='remove-rule']");
      if (!removeRuleAction) return;
      const row = removeRuleAction.closest("[data-rule-index]");
      if (!row) return;
      const ruleIdx = clampInt(row.dataset.ruleIndex, 0, state.rules.length - 1, -1);
      if (ruleIdx < 0) return;
      state.rules.splice(ruleIdx, 1);
      renderProfiles();
      setStatus("Rule removed.");
    });

    alertsNode.addEventListener("change", (event) => {
      if (!state) return;
      const row = event.target.closest("[data-alert-index]");
      if (!row) return;
      const idx = clampInt(row.dataset.alertIndex, 0, state.alerts.length - 1, -1);
      if (idx < 0) return;
      const alert = state.alerts[idx];
      const key = event.target.getAttribute("data-key") || "";
      if (key === "label") {
        alert.label = String(event.target.value || `Alert ${idx + 1}`).trim().slice(0, 15);
        event.target.value = alert.label;
        return;
      }
      if (key === "enabled") {
        alert.enabled = Boolean(event.target.checked);
        if (alert.enabled) alert.condition.enabled = true;
        return;
      }
      if (key === "source") {
        const source = normalizeSignalKey(event.target.value || "selected");
        if (source === "selected") {
          if (isVirtualSignalKey(alert.condition.signalKey)) {
            alert.condition.signalKey = "";
            alert.condition.enabled = false;
          }
        } else {
          alert.condition.signalKey = source;
          alert.condition.enabled = true;
        }
        renderAlerts();
        return;
      }
      if (key === "operator") {
        alert.condition.operator = String(event.target.value || "greater_than");
        if (usesDeltaThreshold(alert.condition.operator) && alert.condition.value < 0) {
          alert.condition.value = 0;
        }
        renderAlerts();
        return;
      }
      if (key === "value") {
        alert.condition.value = normalizeConditionValue(alert.condition.operator, event.target.value, 0);
      }
    });

    alertsNode.addEventListener("click", (event) => {
      if (!state) return;
      const assignBtn = event.target.closest("[data-action='assign-alert-signal']");
      if (!assignBtn) return;
      const row = assignBtn.closest("[data-alert-index]");
      if (!row) return;
      const idx = clampInt(row.dataset.alertIndex, 0, state.alerts.length - 1, -1);
      if (idx < 0) return;

      const selectedSignalKey = getSelectedSignalKey();
      if (!selectedSignalKey) {
        setStatus("Pick a signal in Signal Snapshot Picker, then click Use Selected.", true);
        return;
      }
      const alert = state.alerts[idx];
      alert.condition.signalKey = selectedSignalKey;
      if (!alert.condition.enabled) alert.condition.enabled = true;
      renderAlerts();
      setStatus(`Alert ${idx + 1} signal assigned.`);
    });

    addProfileBtn.addEventListener("click", () => {
      if (!state) {
        setStatus("Builder not loaded yet.", true);
        return;
      }
      if (state.profiles.length >= maxProfiles) {
        setStatus(`Profile limit reached (${maxProfiles}).`, true);
        return;
      }
      const id = nextProfileId();
      state.profiles.push(
        normalizeProfile(
          {
            id,
            name: `Profile ${id}`,
            enabled: true,
            interpolationEnabled: true,
            exclusive: false,
            releaseRateEnabled: true,
            controllerEnabled: true,
            broadcastEnabled: true,
            mode: "INHERIT",
            mapPath: "",
            disableThrottle: 0,
            disableSpeed: 0,
            disengageUnderSpeed: 0,
            lockReleaseRatePctPerSec: 120,
          },
          id
        )
      );
      collapsed[String(id)] = false;
      try {
        window.localStorage.setItem(collapseStoreKey, JSON.stringify(collapsed));
      } catch {
        // ignore storage failures
      }
      renderProfiles();
      setStatus(`Profile ${id} added.`);
    });

    loadBtn.addEventListener("click", loadBuilder);
    if (downloadBtn) {
      downloadBtn.addEventListener("click", downloadBuilderProfile);
    }
    if (uploadBtn && uploadFileInput) {
      uploadBtn.addEventListener("click", () => {
        uploadFileInput.click();
      });
    }
    if (uploadFileInput) {
      uploadFileInput.addEventListener("change", async () => {
        const file = uploadFileInput.files && uploadFileInput.files[0] ? uploadFileInput.files[0] : null;
        uploadFileInput.value = "";
        if (!file) return;
        try {
          const text = await file.text();
          await importBuilderProfileFromText(text);
        } catch (error) {
          setStatus(`Upload failed: ${error.message}`, true);
        }
      });
    }
    saveBtn.addEventListener("click", saveBuilder);
    if (hasBasicUi) {
      basicLoadBtn.addEventListener("click", () => {
        loadBasicSettings();
      });
      basicSaveBtn.addEventListener("click", () => {
        saveBasicSettings();
      });
    }

    try {
      const raw = window.localStorage.getItem(collapseStoreKey);
      collapsed = raw ? JSON.parse(raw) || {} : {};
    } catch {
      collapsed = {};
    }

    loadBuilder();
  };
})();

