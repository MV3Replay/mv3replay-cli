import { createHash } from "node:crypto";

const asStrings = value => Array.isArray(value)
  ? value.filter(item => typeof item === "string")
  : [];

const presentString = value => typeof value === "string" && value.trim().length > 0;

const unique = values => [...new Set(values)];

const sortedUnique = values => unique(values).sort();

const objectKeys = value => value && typeof value === "object" && !Array.isArray(value)
  ? Object.keys(value)
  : [];

function addLane(lanes, id, priority, reason, checks) {
  lanes.push({ id, priority, reason, checks });
}

function errorWithCode(error, code) {
  error.code = code;
  return error;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, stableValue(value[key])])
    );
  }
  return value;
}

function reportFingerprint(report) {
  const stable = JSON.stringify(stableValue(report));
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

function listDiff(before, after) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: sortedUnique(after.filter(item => !beforeSet.has(item))),
    removed: sortedUnique(before.filter(item => !afterSet.has(item)))
  };
}

const RUN_AT_VALUES = ["document_start", "document_end", "document_idle"];

function normalizeContentScript(script) {
  return {
    matches: sortedUnique(asStrings(script?.matches)),
    excludeMatches: sortedUnique(asStrings(script?.exclude_matches)),
    files: sortedUnique([...asStrings(script?.js), ...asStrings(script?.css)]),
    runAt: RUN_AT_VALUES.includes(script?.run_at) ? script.run_at : null,
    allFrames: script?.all_frames === true,
    world: script?.world === "MAIN" ? "MAIN" : "ISOLATED",
    matchAboutBlank: script?.match_about_blank === true,
    matchOriginAsFallback: script?.match_origin_as_fallback === true
  };
}

function registrationDiff(previousScripts, currentScripts) {
  const serialize = script => JSON.stringify(normalizeContentScript(script));
  const previousKeys = new Set(previousScripts.map(serialize));
  const currentKeys = new Set(currentScripts.map(serialize));
  const collect = (scripts, other) => unique(scripts.map(serialize).filter(key => !other.has(key)))
    .sort()
    .map(key => JSON.parse(key));
  return {
    added: collect(currentScripts, previousKeys),
    removed: collect(previousScripts, currentKeys)
  };
}

function transitions(previousRequired, previousOptional, currentRequired, currentOptional) {
  return {
    optionalToRequired: sortedUnique(previousOptional.filter(item => currentRequired.includes(item))),
    requiredToOptional: sortedUnique(previousRequired.filter(item => currentOptional.includes(item)))
  };
}

function staticRulesetDiff(previousRulesets, currentRulesets) {
  const describe = ruleset => JSON.stringify({
    enabled: ruleset?.enabled === true,
    path: typeof ruleset?.path === "string" ? ruleset.path : null
  });
  const withId = rulesets => new Map(
    rulesets
      .filter(ruleset => presentString(ruleset?.id))
      .map(ruleset => [ruleset.id, ruleset])
  );
  const previousById = withId(previousRulesets);
  const currentById = withId(currentRulesets);
  return {
    added: sortedUnique([...currentById.keys()].filter(id => !previousById.has(id))),
    removed: sortedUnique([...previousById.keys()].filter(id => !currentById.has(id))),
    changed: sortedUnique([...previousById.keys()].filter(id =>
      currentById.has(id) && describe(previousById.get(id)) !== describe(currentById.get(id))
    ))
  };
}

function normalizeWebAccessibleResource(entry) {
  return {
    resources: sortedUnique(asStrings(entry?.resources)),
    matches: sortedUnique(asStrings(entry?.matches)),
    extensionIds: sortedUnique(asStrings(entry?.extension_ids)),
    useDynamicUrl: entry?.use_dynamic_url === true
  };
}

function declarationDiff(previousDeclarations, currentDeclarations) {
  const serialize = entry => JSON.stringify(normalizeWebAccessibleResource(entry));
  const previousKeys = new Set(previousDeclarations.map(serialize));
  const currentKeys = new Set(currentDeclarations.map(serialize));
  const collect = (declarations, other) => unique(declarations.map(serialize).filter(key => !other.has(key)))
    .sort()
    .map(key => JSON.parse(key));
  return {
    added: collect(currentDeclarations, previousKeys),
    removed: collect(previousDeclarations, currentKeys)
  };
}

const SURFACE_NAMES = [
  ["action-popup", "actionPopup"],
  ["options", "optionsPage"],
  ["side-panel", "sidePanel"],
  ["devtools", "devtoolsPage"],
  ["omnibox", "omnibox"],
  ["sandbox-pages", "sandboxPages"],
  ["native-messaging", "nativeMessaging"],
  ["user-scripts", "userScripts"]
];

function surfaceDiff(previousSurfaces, currentSurfaces) {
  const changed = direction => SURFACE_NAMES
    .filter(([, key]) => previousSurfaces[key] !== currentSurfaces[key]
      && (direction === "added" ? currentSurfaces[key] : previousSurfaces[key]))
    .map(([name]) => name)
    .sort();
  return { added: changed("added"), removed: changed("removed") };
}

function normalizeCommandDefinition(definition) {
  const normalized = {};
  if (typeof definition?.description === "string" && definition.description.length > 0) {
    normalized.description = definition.description;
  }
  const suggestedKey = definition?.suggested_key && typeof definition.suggested_key === "object"
    ? definition.suggested_key
    : {};
  for (const platform of sortedUnique(objectKeys(suggestedKey))) {
    if (presentString(suggestedKey[platform])) {
      normalized[`suggestedKey${platform[0].toUpperCase()}${platform.slice(1)}`] = suggestedKey[platform];
    }
  }
  return normalized;
}

function declarationChanges(previousManifest, currentManifest) {
  const stable = value => JSON.stringify(stableValue(value));
  const changed = [];
  const pushIfChanged = (field, previousValue, currentValue) => {
    if (stable(previousValue ?? null) !== stable(currentValue ?? null)) {
      changed.push({ field, previous: previousValue ?? null, current: currentValue ?? null });
    }
  };
  const effectiveOptionsPage = manifest =>
    presentString(manifest.options_ui?.page)
      ? manifest.options_ui.page
      : (presentString(manifest.options_page) ? manifest.options_page : null);

  pushIfChanged(
    "action.default_popup",
    presentString(previousManifest.action?.default_popup) ? previousManifest.action.default_popup : null,
    presentString(currentManifest.action?.default_popup) ? currentManifest.action.default_popup : null
  );
  pushIfChanged(
    "background.service_worker",
    presentString(previousManifest.background?.service_worker) ? previousManifest.background.service_worker : null,
    presentString(currentManifest.background?.service_worker) ? currentManifest.background.service_worker : null
  );
  pushIfChanged(
    "background.type",
    previousManifest.background?.type ?? null,
    currentManifest.background?.type ?? null
  );
  pushIfChanged("devtools_page", previousManifest.devtools_page ?? null, currentManifest.devtools_page ?? null);
  pushIfChanged("options_page", effectiveOptionsPage(previousManifest), effectiveOptionsPage(currentManifest));
  pushIfChanged(
    "side_panel.default_path",
    presentString(previousManifest.side_panel?.default_path) ? previousManifest.side_panel.default_path : null,
    presentString(currentManifest.side_panel?.default_path) ? currentManifest.side_panel.default_path : null
  );
  pushIfChanged(
    "omnibox.keyword",
    presentString(previousManifest.omnibox?.keyword) ? previousManifest.omnibox.keyword : null,
    presentString(currentManifest.omnibox?.keyword) ? currentManifest.omnibox.keyword : null
  );
  pushIfChanged(
    "sandbox.pages",
    sortedUnique(asStrings(previousManifest.sandbox?.pages)),
    sortedUnique(asStrings(currentManifest.sandbox?.pages))
  );

  const previousCommands = previousManifest.commands && typeof previousManifest.commands === "object"
    ? previousManifest.commands
    : {};
  const currentCommands = currentManifest.commands && typeof currentManifest.commands === "object"
    ? currentManifest.commands
    : {};
  for (const name of sortedUnique(objectKeys(previousCommands).filter(id => id in currentCommands))) {
    pushIfChanged(
      `command.${name}`,
      normalizeCommandDefinition(previousCommands[name]),
      normalizeCommandDefinition(currentCommands[name])
    );
  }

  return changed.sort((first, second) => first.field.localeCompare(second.field));
}

function manifestSignals(manifest) {
  const permissions = sortedUnique(asStrings(manifest.permissions));
  const optionalPermissions = sortedUnique(asStrings(manifest.optional_permissions));
  const hostPermissions = sortedUnique(asStrings(manifest.host_permissions));
  const optionalHostPermissions = sortedUnique(asStrings(manifest.optional_host_permissions));
  const contentScripts = Array.isArray(manifest.content_scripts)
    ? manifest.content_scripts.filter(item => item && typeof item === "object")
    : [];
  const matchPatterns = sortedUnique(contentScripts.flatMap(script => asStrings(script.matches)));
  const commands = sortedUnique(objectKeys(manifest.commands));
  const staticRulesets = Array.isArray(manifest.declarative_net_request?.rule_resources)
    ? manifest.declarative_net_request.rule_resources.filter(item => item && typeof item === "object")
    : [];
  const webAccessibleResources = Array.isArray(manifest.web_accessible_resources)
    ? manifest.web_accessible_resources.filter(item => item && typeof item === "object")
    : [];
  const externalMatches = sortedUnique(asStrings(manifest.externally_connectable?.matches));
  const externalExtensionIds = sortedUnique(asStrings(manifest.externally_connectable?.ids));

  return {
    permissions,
    optionalPermissions,
    hostPermissions,
    optionalHostPermissions,
    contentScripts,
    matchPatterns,
    commands,
    staticRulesets,
    webAccessibleResources,
    externalMatches,
    externalExtensionIds
  };
}

export function analyzeManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw errorWithCode(
      new TypeError("The manifest must be a JSON object."),
      "MANIFEST_NOT_OBJECT"
    );
  }
  if (manifest.manifest_version !== 3) {
    throw errorWithCode(
      new Error("MV3 Replay currently supports Manifest V3 only."),
      "UNSUPPORTED_MANIFEST_VERSION"
    );
  }

  const {
    permissions,
    optionalPermissions,
    hostPermissions,
    optionalHostPermissions,
    contentScripts,
    matchPatterns,
    commands,
    staticRulesets,
    webAccessibleResources,
    externalMatches,
    externalExtensionIds
  } = manifestSignals(manifest);

  const actionPopup = presentString(manifest.action?.default_popup);
  const optionsPage = presentString(manifest.options_page)
    || presentString(manifest.options_ui?.page);
  const serviceWorker = presentString(manifest.background?.service_worker);
  const sidePanel = presentString(manifest.side_panel?.default_path);
  const devtoolsPage = presentString(manifest.devtools_page);
  const storage = permissions.includes("storage") || optionalPermissions.includes("storage");
  const offscreen = permissions.includes("offscreen") || optionalPermissions.includes("offscreen");
  const notifications = permissions.includes("notifications") || optionalPermissions.includes("notifications");
  const tabCapture = permissions.includes("tabCapture") || optionalPermissions.includes("tabCapture");
  const incognitoMode = ["spanning", "split", "not_allowed"].includes(manifest.incognito)
    ? manifest.incognito
    : "unspecified";
  const omnibox = presentString(manifest.omnibox?.keyword);
  const sandboxPages = sortedUnique(asStrings(manifest.sandbox?.pages));
  const nativeMessaging = permissions.includes("nativeMessaging") || optionalPermissions.includes("nativeMessaging");
  const userScripts = permissions.includes("userScripts") || optionalPermissions.includes("userScripts");

  const surfaces = {
    actionPopup,
    optionsPage,
    serviceWorker,
    contentScripts: contentScripts.length,
    sidePanel,
    devtoolsPage,
    storage,
    offscreen,
    notifications,
    tabCapture,
    commands: commands.length,
    staticRulesets: staticRulesets.length,
    webAccessibleResourceDeclarations: webAccessibleResources.length,
    externallyConnectable: externalMatches.length > 0 || externalExtensionIds.length > 0,
    omnibox,
    sandboxPages: sandboxPages.length,
    nativeMessaging,
    userScripts,
    incognitoMode
  };

  const lanes = [];
  addLane(lanes, "install-and-upgrade", "critical",
    "Every release can change manifest wiring, permissions, or persisted state.",
    ["Load the exact shipping build", "Verify a clean install", "Verify an upgrade from the previous version"]);

  if (contentScripts.length > 0) {
    addLane(lanes, "host-page-safety", "critical",
      "Content scripts share behavior and layout boundaries with host pages.",
      ["Force a host re-render", "Verify extension-owned nodes remain valid", "Check overlap at representative viewport widths"]);
  }
  if (serviceWorker) {
    addLane(lanes, "service-worker-lifecycle", "critical",
      "MV3 service workers can stop and restart between user actions.",
      ["Terminate the worker", "Trigger the next expected event", "Verify state recovery and inspect worker errors"]);
  }
  if (storage) {
    addLane(lanes, "storage-persistence", "high",
      "The manifest requests storage access.",
      ["Write representative settings", "Restart the relevant context", "Verify values and migration behavior"]);
  }
  if (actionPopup) {
    addLane(lanes, "action-popup", "high",
      "The extension declares an action popup.",
      ["Open the popup through the browser action", "Exercise its critical path", "Reopen it and verify persisted state"]);
  }
  if (optionsPage) {
    addLane(lanes, "options", "medium",
      "The extension declares an options surface.",
      ["Open options from the browser", "Change a reversible setting", "Verify the change in another extension context"]);
  }
  if (sidePanel) {
    addLane(lanes, "side-panel", "medium",
      "The extension declares a side panel.",
      ["Open the side panel", "Verify its critical state", "Switch tabs and verify expected lifecycle behavior"]);
  }
  if (devtoolsPage) {
    addLane(lanes, "devtools", "medium",
      "The extension declares a DevTools page.",
      ["Open DevTools on a supported host", "Verify panel registration", "Reload DevTools and inspect errors"]);
  }
  if (hostPermissions.length > 0 || optionalHostPermissions.length > 0) {
    addLane(lanes, "permission-boundaries", "high",
      "The extension declares host access that can vary by site and grant state.",
      ["Test a granted host", "Test a non-granted host", "Verify behavior after permission removal"]);
  }

  if (optionalPermissions.length > 0 || optionalHostPermissions.length > 0) {
    addLane(lanes, "optional-permissions", "high",
      "Optional access creates granted, denied, removed, and upgrade states.",
      ["Exercise the feature before access is granted", "Grant access from an explicit user action", "Remove access and verify graceful fallback"]);
  }
  if (commands.length > 0) {
    addLane(lanes, "keyboard-commands", "medium",
      "Declared keyboard commands may be unbound, remapped, or unavailable on a platform.",
      ["Inspect the effective shortcut", "Exercise each user-facing command", "Verify an unbound or remapped command path"]);
  }
  if (staticRulesets.length > 0) {
    addLane(lanes, "network-rules", "critical",
      "Static declarative network rules can change blocking, redirects, and headers.",
      ["Load every enabled ruleset", "Exercise one representative rule per action type", "Verify disabled and upgraded ruleset state"]);
  }
  if (offscreen) {
    addLane(lanes, "offscreen-document", "high",
      "Offscreen documents have a distinct lifecycle and limited extension API access.",
      ["Create the document from a supported user flow", "Verify runtime-message recovery", "Close and recreate the document"]);
  }
  if (notifications) {
    addLane(lanes, "notifications", "medium",
      "Notification delivery and interaction depend on browser and operating-system state.",
      ["Create a representative notification", "Exercise its click and close paths", "Verify behavior when notifications are unavailable"]);
  }
  if (tabCapture) {
    addLane(lanes, "tab-capture", "critical",
      "Tab capture combines a user-invoked flow with sensitive required access.",
      ["Start capture from the intended user gesture", "Stop and restart capture", "Test upgrade and reapproval behavior when this permission is newly required"]);
  }
  if (externalMatches.length > 0 || externalExtensionIds.length > 0) {
    addLane(lanes, "external-messaging", "high",
      "The extension accepts messages from declared web pages or extensions.",
      ["Accept a valid sender", "Reject an undeclared sender", "Validate every externally supplied message before acting"]);
  }
  if (webAccessibleResources.length > 0) {
    addLane(lanes, "web-accessible-resources", "high",
      "Declared extension files are exposed to matching web pages or extensions.",
      ["Load every intentionally exposed resource", "Reject an undeclared origin", "Verify redirects target resources that are declared accessible"]);
  }
  if (incognitoMode === "spanning" || incognitoMode === "split") {
    addLane(lanes, "incognito-boundary", "medium",
      "Incognito access is user-controlled and can change context isolation.",
      ["Verify behavior with incognito access disabled", `Verify the declared ${incognitoMode} behavior when enabled`, "Confirm no unintended state crosses the profile boundary"]);
  }
  if (omnibox) {
    addLane(lanes, "omnibox-input", "medium",
      "Omnibox input is user-controlled and the keyword can conflict with normal navigation.",
      ["Activate the declared keyword", "Exercise empty and unexpected input", "Verify navigation and suggestion behavior after an upgrade"]);
  }
  if (sandboxPages.length > 0) {
    addLane(lanes, "sandboxed-pages", "high",
      "Sandboxed extension pages run with a distinct origin and restricted extension API access.",
      ["Open every declared sandbox page", "Verify messaging across the sandbox boundary", "Confirm restricted extension APIs fail safely"]);
  }
  if (nativeMessaging) {
    addLane(lanes, "native-messaging", "critical",
      "Native messaging crosses from the extension into a separately installed host process.",
      ["Test with the intended host installed", "Handle a missing or disconnected host", "Reject malformed or unexpected host messages"]);
  }
  if (userScripts) {
    addLane(lanes, "user-scripts", "critical",
      "User scripts introduce dynamically registered code and separate permission state.",
      ["Register and execute a minimal user script", "Verify allowed and denied host states", "Remove registered scripts and confirm no stale execution"]);
  }

  const riskFlags = [];
  if (matchPatterns.includes("<all_urls>") || hostPermissions.includes("<all_urls>")) {
    riskFlags.push({ id: "broad-host-scope", level: "high", message: "The manifest includes <all_urls>; use synthetic or explicitly authorized hosts for testing." });
  }
  if (contentScripts.some(script => script.all_frames === true)) {
    riskFlags.push({ id: "all-frames", level: "high", message: "A content script runs in all frames; include iframe and frame-navigation checks." });
  }
  if (contentScripts.some(script => script.world === "MAIN")) {
    riskFlags.push({ id: "main-world", level: "high", message: "A content script runs in the MAIN world; verify host-page isolation and collisions." });
  }
  if (contentScripts.some(script => script.match_about_blank === true || script.match_origin_as_fallback === true)) {
    riskFlags.push({ id: "derived-frame-matching", level: "high", message: "A content script can match derived frames; include about:, data:, blob:, and origin-fallback cases that apply." });
  }
  if (serviceWorker) {
    riskFlags.push({ id: "ephemeral-worker", level: "high", message: "The background service worker is ephemeral; cold-restart coverage is required." });
  }
  if (contentScripts.length > 0 && hostPermissions.length === 0 && matchPatterns.length === 0) {
    riskFlags.push({ id: "missing-host-scope", level: "medium", message: "Content scripts were detected without an obvious host match scope." });
  }
  if (permissions.includes("tabCapture")) {
    riskFlags.push({ id: "required-tab-capture", level: "critical", message: "tabCapture is required rather than optional; review its user-facing permission warning and update reapproval path." });
  }
  if (webAccessibleResources.some(entry => asStrings(entry.matches).includes("<all_urls>"))) {
    riskFlags.push({ id: "broad-web-accessible-resources", level: "high", message: "Web-accessible resources are exposed to <all_urls>; verify that every exposed file and origin is necessary." });
  }
  if (externalMatches.includes("<all_urls>")) {
    riskFlags.push({ id: "broad-external-messaging", level: "critical", message: "External messaging accepts <all_urls>; treat every message as untrusted input." });
  }
  if (permissions.includes("nativeMessaging")) {
    riskFlags.push({ id: "required-native-messaging", level: "critical", message: "nativeMessaging is required; verify the installed-host boundary, failure states, and user-facing disclosure." });
  }
  if (permissions.includes("userScripts")) {
    riskFlags.push({ id: "required-user-scripts", level: "high", message: "userScripts is required; verify explicit user control, host scope, and removal of dynamically registered scripts." });
  }

  const report = {
    schemaVersion: 1,
    identity: {
      name: presentString(manifest.name) ? manifest.name.trim() : "Unnamed extension",
      version: presentString(manifest.version) ? manifest.version.trim() : "unknown",
      manifestVersion: 3
    },
    surfaces,
    counts: {
      permissions: unique(permissions).length,
      optionalPermissions: unique(optionalPermissions).length,
      hostPermissions: unique(hostPermissions).length,
      optionalHostPermissions: unique(optionalHostPermissions).length,
      contentScriptRegistrations: contentScripts.length,
      contentScriptMatchPatterns: matchPatterns.length,
      commands: commands.length,
      staticRulesets: staticRulesets.length,
      webAccessibleResourceDeclarations: webAccessibleResources.length,
      externalMatchPatterns: externalMatches.length,
      externalExtensionIds: externalExtensionIds.length,
      sandboxPages: sandboxPages.length
    },
    lanes,
    riskFlags,
    privacy: {
      localOnly: true,
      sourceFilesRead: false,
      browserConnected: false,
      dataUploaded: false
    }
  };

  return { ...report, fingerprint: reportFingerprint(report) };
}

export function compareManifests(previousManifest, currentManifest) {
  const previousReport = analyzeManifest(previousManifest);
  const currentReport = analyzeManifest(currentManifest);
  const previous = manifestSignals(previousManifest);
  const current = manifestSignals(currentManifest);

  const declarations = declarationChanges(previousManifest, currentManifest);
  const uiDeclarationsChanged = declarations
    .some(item => item.field !== "background.service_worker"
      && item.field !== "background.type"
      && !item.field.startsWith("command."));

  const changes = {
    requiredPermissions: listDiff(previous.permissions, current.permissions),
    optionalPermissions: listDiff(previous.optionalPermissions, current.optionalPermissions),
    requiredHosts: listDiff(previous.hostPermissions, current.hostPermissions),
    optionalHosts: listDiff(previous.optionalHostPermissions, current.optionalHostPermissions),
    permissionTransitions: transitions(previous.permissions, previous.optionalPermissions, current.permissions, current.optionalPermissions),
    hostTransitions: transitions(previous.hostPermissions, previous.optionalHostPermissions, current.hostPermissions, current.optionalHostPermissions),
    contentScriptMatches: listDiff(previous.matchPatterns, current.matchPatterns),
    contentScripts: registrationDiff(previous.contentScripts, current.contentScripts),
    commands: listDiff(previous.commands, current.commands),
    staticRulesets: staticRulesetDiff(previous.staticRulesets, current.staticRulesets),
    externalMessaging: {
      matches: listDiff(previous.externalMatches, current.externalMatches),
      ids: listDiff(previous.externalExtensionIds, current.externalExtensionIds)
    },
    webAccessibleResources: declarationDiff(previous.webAccessibleResources, current.webAccessibleResources),
    surfaces: surfaceDiff(previousReport.surfaces, currentReport.surfaces),
    declarations
  };

  const findings = [];
  if (changes.requiredPermissions.added.length > 0) {
    findings.push({
      id: "required-permission-expansion",
      level: "critical",
      message: `Required permissions added: ${changes.requiredPermissions.added.join(", ")}. Test the real update and any user reapproval path.`
    });
  }
  if (changes.requiredHosts.added.length > 0) {
    findings.push({
      id: "required-host-expansion",
      level: "critical",
      message: `Required host access added: ${changes.requiredHosts.added.join(", ")}. Test the real update and resulting permission UI.`
    });
  }
  if (changes.permissionTransitions.optionalToRequired.length > 0) {
    findings.push({
      id: "optional-permission-required",
      level: "critical",
      message: `Permissions moved from optional to required: ${changes.permissionTransitions.optionalToRequired.join(", ")}. Test the real update and any user reapproval path.`
    });
  }
  if (changes.permissionTransitions.requiredToOptional.length > 0) {
    findings.push({
      id: "required-permission-optional",
      level: "medium",
      message: `Permissions moved from required to optional: ${changes.permissionTransitions.requiredToOptional.join(", ")}. Verify granted-state fallback behavior.`
    });
  }
  if (changes.hostTransitions.optionalToRequired.length > 0) {
    findings.push({
      id: "optional-host-required",
      level: "critical",
      message: `Host access moved from optional to required: ${changes.hostTransitions.optionalToRequired.join(", ")}. Test the real update and resulting permission UI.`
    });
  }
  if (changes.hostTransitions.requiredToOptional.length > 0) {
    findings.push({
      id: "required-host-optional",
      level: "medium",
      message: `Host access moved from required to optional: ${changes.hostTransitions.requiredToOptional.join(", ")}. Verify granted-state fallback behavior.`
    });
  }
  if (changes.commands.added.length > 0 || changes.commands.removed.length > 0
    || declarations.some(item => item.field.startsWith("command."))) {
    findings.push({
      id: "commands-change",
      level: "medium",
      message: `Keyboard commands changed (added: ${changes.commands.added.join(", ") || "none"}; removed: ${changes.commands.removed.join(", ") || "none"}). Verify effective shortcuts on every supported platform.`
    });
  }
  if (
    changes.staticRulesets.added.length > 0
    || changes.staticRulesets.removed.length > 0
    || changes.staticRulesets.changed.length > 0
  ) {
    findings.push({
      id: "dnr-ruleset-change",
      level: "high",
      message: `Static declarative-net-request rulesets changed (added: ${changes.staticRulesets.added.join(", ") || "none"}; removed: ${changes.staticRulesets.removed.join(", ") || "none"}; changed: ${changes.staticRulesets.changed.join(", ") || "none"}). Exercise one representative rule per action type.`
    });
  }
  if (changes.externalMessaging.matches.added.length > 0 || changes.externalMessaging.ids.added.length > 0) {
    findings.push({
      id: "external-messaging-expansion",
      level: "critical",
      message: `Externally connectable scope added (${[...changes.externalMessaging.matches.added, ...changes.externalMessaging.ids.added].join(", ")}). Test the real update and treat every external message as untrusted input.`
    });
  }
  if (changes.webAccessibleResources.added.length > 0 || changes.webAccessibleResources.removed.length > 0) {
    findings.push({
      id: "web-accessible-resources-change",
      level: "high",
      message: `Web-accessible resource declarations changed. Load every intentionally exposed resource and reject an undeclared origin.`
    });
  }
  if (changes.surfaces.added.length > 0 || changes.surfaces.removed.length > 0 || uiDeclarationsChanged) {
    findings.push({
      id: "extension-surface-change",
      level: "medium",
      message: `Extension surfaces changed (added: ${changes.surfaces.added.join(", ") || "none"}; removed: ${changes.surfaces.removed.join(", ") || "none"}${uiDeclarationsChanged ? "; declarations changed" : ""}). Verify each affected surface through its browser entry point.`
    });
  }
  if (changes.contentScriptMatches.added.length > 0) {
    findings.push({
      id: "content-script-scope-expansion",
      level: "high",
      message: `Content-script match scope added: ${changes.contentScriptMatches.added.join(", ")}. Add authorized-host and isolation coverage.`
    });
  }
  if (
    previousManifest.background?.service_worker !== currentManifest.background?.service_worker
    || previousManifest.background?.type !== currentManifest.background?.type
  ) {
    findings.push({
      id: "service-worker-entry-change",
      level: "high",
      message: "The service-worker entry changed; verify install, update, cold restart, and event registration."
    });
  }

  const report = {
    schemaVersion: 1,
    from: previousReport.identity,
    to: currentReport.identity,
    changes,
    findings,
    requiresManualUpdateValidation: findings.some(item => item.level === "critical"),
    privacy: {
      localOnly: true,
      sourceFilesRead: false,
      browserConnected: false,
      dataUploaded: false
    }
  };

  return { ...report, fingerprint: reportFingerprint(report) };
}
