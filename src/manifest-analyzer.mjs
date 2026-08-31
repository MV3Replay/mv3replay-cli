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

function validFileHandler(handler) {
  if (!handler || typeof handler !== "object" || Array.isArray(handler)) return false;
  if (!presentString(handler.action) || !presentString(handler.name)) return false;
  const acceptedTypes = objectKeys(handler.accept);
  if (acceptedTypes.length === 0) return false;
  if (!acceptedTypes.every(type => presentString(type)
    && Array.isArray(handler.accept[type])
    && handler.accept[type].length > 0
    && handler.accept[type].every(extension => presentString(extension) && extension.startsWith(".")))) return false;
  return handler.launch_type === undefined
    || handler.launch_type === "single-client"
    || handler.launch_type === "multiple-clients";
}

function manifestIconDiagnostics(icons) {
  if (icons === undefined) return { declared: false, invalid: false, unsupportedFormat: false, missingRecommended: false };
  if (!icons || typeof icons !== "object" || Array.isArray(icons)) {
    return { declared: true, invalid: true, unsupportedFormat: false, missingRecommended: true };
  }
  const entries = Object.entries(icons);
  const invalid = entries.length === 0 || entries.some(([size, iconPath]) =>
    !/^\d+$/.test(size) || Number(size) <= 0 || !presentString(iconPath));
  const unsupportedFormat = entries.some(([, iconPath]) =>
    presentString(iconPath) && /\.(?:svg|webp)$/i.test(iconPath.trim()));
  return {
    declared: true,
    invalid,
    unsupportedFormat,
    missingRecommended: !Object.hasOwn(icons, "48") || !Object.hasOwn(icons, "128")
  };
}

function actionIconDiagnostics(icon) {
  if (icon === undefined) return { declared: false, invalid: false, unsupportedFormat: false };
  if (typeof icon === "string") {
    return {
      declared: true,
      invalid: !presentString(icon),
      unsupportedFormat: presentString(icon) && /\.(?:svg|webp)$/i.test(icon.trim())
    };
  }
  const diagnostics = manifestIconDiagnostics(icon);
  return {
    declared: true,
    invalid: diagnostics.invalid,
    unsupportedFormat: diagnostics.unsupportedFormat
  };
}

// Top-level fields whose values currently influence identities, surfaces,
// findings, comparison details, or generated regression lanes. Other fields
// are valid input, but their behavior is deliberately reported as unmodeled.
const MODELED_TOP_LEVEL_KEYS = new Set([
  "action", "background", "chrome_settings_overrides", "chrome_url_overrides",
  "commands", "content_scripts", "content_security_policy", "cross_origin_embedder_policy",
  "cross_origin_opener_policy", "declarative_net_request",
  "default_locale", "description", "devtools_page", "externally_connectable",
  "file_handlers",
  "homepage_url", "host_permissions", "icons", "incognito",
  "key",
  "manifest_version", "mime_types_handler", "minimum_chrome_version", "name", "oauth2", "omnibox",
  "optional_host_permissions", "optional_permissions", "options_page", "options_ui",
  "permissions", "sandbox", "short_name", "side_panel", "storage", "update_url", "version", "version_name",
  "web_accessible_resources"
]);

const unmodeledTopLevelKeys = manifest => objectKeys(manifest)
  .filter(key => !MODELED_TOP_LEVEL_KEYS.has(key))
  .sort();

function keyValueDiff(previousManifest, currentManifest, previousKeys, currentKeys) {
  const previousSet = new Set(previousKeys);
  const currentSet = new Set(currentKeys);
  return {
    added: currentKeys.filter(key => !previousSet.has(key)),
    removed: previousKeys.filter(key => !currentSet.has(key)),
    changed: previousKeys.filter(key => currentSet.has(key)
      && JSON.stringify(stableValue(previousManifest[key])) !== JSON.stringify(stableValue(currentManifest[key])))
  };
}

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

function parseChromeExtensionVersion(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+){0,3}$/.test(value)) return null;
  const parts = value.split(".");
  if (parts.some(part => (part.length > 1 && part.startsWith("0")) || Number(part) > 65535)) return null;
  const numbers = parts.map(Number);
  if (numbers.every(part => part === 0)) return null;
  return [...numbers, ...Array(4 - numbers.length).fill(0)];
}

function versionChange(previousVersion, currentVersion) {
  const previousParts = parseChromeExtensionVersion(previousVersion);
  const currentParts = parseChromeExtensionVersion(currentVersion);
  let relation = "invalid";
  if (previousParts && currentParts) {
    relation = "same";
    for (let index = 0; index < 4; index += 1) {
      if (currentParts[index] === previousParts[index]) continue;
      relation = currentParts[index] > previousParts[index] ? "newer" : "older";
      break;
    }
  }
  return { previous: previousVersion, current: currentVersion, relation };
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
  ["toolbar-action", "action"],
  ["action-popup", "actionPopup"],
  ["options", "optionsPage"],
  ["side-panel", "sidePanel"],
  ["devtools", "devtoolsPage"],
  ["omnibox", "omnibox"],
  ["sandbox-pages", "sandboxPages"],
  ["native-messaging", "nativeMessaging"],
  ["user-scripts", "userScripts"],
  ["debugger", "debuggerAccess"],
  ["extension-management", "management"],
  ["identity", "identityAccess"],
  ["downloads", "downloads"],
  ["clipboard", "clipboard"],
  ["cookies", "cookies"],
  ["history", "historyAccess"],
  ["bookmarks", "bookmarksAccess"],
  ["web-request", "webRequestAccess"],
  ["browsing-data", "browsingDataAccess"],
  ["navigation-metadata", "navigationMetadataAccess"],
  ["content-settings", "contentSettingsAccess"],
  ["privacy-settings", "privacySettingsAccess"],
  ["proxy-settings", "proxyAccess"],
  ["geolocation", "geolocationAccess"],
  ["desktop-capture", "desktopCaptureAccess"],
  ["page-capture", "pageCaptureAccess"],
  ["active-tab", "activeTabAccess"],
  ["programmatic-injection", "scriptingAccess"],
  ["context-menus", "contextMenusAccess"],
  ["alarms", "alarmsAccess"],
  ["cross-origin-policies", "crossOriginPolicies"],
  ["managed-storage-schema", "managedStorageSchema"],
  ["extension-identity-key", "extensionKeyDeclared"],
  ["file-handling", "fileHandling"],
  ["mime-type-handling", "mimeTypeHandling"],
  ["browser-page-override", "chromeUrlOverrides"],
  ["browser-settings-override", "chromeSettingsOverrides"]
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
  pushIfChanged(
    "minimum_chrome_version",
    presentString(previousManifest.minimum_chrome_version) ? previousManifest.minimum_chrome_version : null,
    presentString(currentManifest.minimum_chrome_version) ? currentManifest.minimum_chrome_version : null
  );
  pushIfChanged(
    "cross_origin_embedder_policy.value",
    presentString(previousManifest.cross_origin_embedder_policy?.value)
      ? previousManifest.cross_origin_embedder_policy.value
      : null,
    presentString(currentManifest.cross_origin_embedder_policy?.value)
      ? currentManifest.cross_origin_embedder_policy.value
      : null
  );
  pushIfChanged(
    "cross_origin_opener_policy.value",
    presentString(previousManifest.cross_origin_opener_policy?.value)
      ? previousManifest.cross_origin_opener_policy.value
      : null,
    presentString(currentManifest.cross_origin_opener_policy?.value)
      ? currentManifest.cross_origin_opener_policy.value
      : null
  );
  pushIfChanged(
    "storage.managed_schema",
    presentString(previousManifest.storage?.managed_schema)
      ? previousManifest.storage.managed_schema
      : null,
    presentString(currentManifest.storage?.managed_schema)
      ? currentManifest.storage.managed_schema
      : null
  );
  pushIfChanged(
    "file_handlers",
    Array.isArray(previousManifest.file_handlers) ? stableValue(previousManifest.file_handlers) : [],
    Array.isArray(currentManifest.file_handlers) ? stableValue(currentManifest.file_handlers) : []
  );
  pushIfChanged(
    "mime_types_handler",
    previousManifest.mime_types_handler && typeof previousManifest.mime_types_handler === "object" && !Array.isArray(previousManifest.mime_types_handler)
      ? stableValue(previousManifest.mime_types_handler)
      : null,
    currentManifest.mime_types_handler && typeof currentManifest.mime_types_handler === "object" && !Array.isArray(currentManifest.mime_types_handler)
      ? stableValue(currentManifest.mime_types_handler)
      : null
  );
  for (const field of ["default_locale", "description", "homepage_url", "name", "short_name", "version_name"]) {
    pushIfChanged(
      field,
      presentString(previousManifest[field]) ? previousManifest[field] : null,
      presentString(currentManifest[field]) ? currentManifest[field] : null
    );
  }
  pushIfChanged(
    "icons",
    previousManifest.icons && typeof previousManifest.icons === "object"
      ? stableValue(previousManifest.icons)
      : null,
    currentManifest.icons && typeof currentManifest.icons === "object"
      ? stableValue(currentManifest.icons)
      : null
  );
  pushIfChanged(
    "action.default_title",
    presentString(previousManifest.action?.default_title) ? previousManifest.action.default_title : null,
    presentString(currentManifest.action?.default_title) ? currentManifest.action.default_title : null
  );
  pushIfChanged(
    "action.default_icon",
    previousManifest.action?.default_icon && typeof previousManifest.action.default_icon === "object"
      ? stableValue(previousManifest.action.default_icon)
      : (presentString(previousManifest.action?.default_icon) ? previousManifest.action.default_icon : null),
    currentManifest.action?.default_icon && typeof currentManifest.action.default_icon === "object"
      ? stableValue(currentManifest.action.default_icon)
      : (presentString(currentManifest.action?.default_icon) ? currentManifest.action.default_icon : null)
  );
  pushIfChanged(
    "update_url",
    presentString(previousManifest.update_url) ? previousManifest.update_url : null,
    presentString(currentManifest.update_url) ? currentManifest.update_url : null
  );
  pushIfChanged(
    "incognito",
    presentString(previousManifest.incognito) ? previousManifest.incognito : null,
    presentString(currentManifest.incognito) ? currentManifest.incognito : null
  );
  for (const page of ["bookmarks", "history", "newtab"]) {
    pushIfChanged(
      `chrome_url_overrides.${page}`,
      presentString(previousManifest.chrome_url_overrides?.[page])
        ? previousManifest.chrome_url_overrides[page]
        : null,
      presentString(currentManifest.chrome_url_overrides?.[page])
        ? currentManifest.chrome_url_overrides[page]
        : null
    );
  }
  pushIfChanged(
    "chrome_settings_overrides",
    previousManifest.chrome_settings_overrides && typeof previousManifest.chrome_settings_overrides === "object"
      ? stableValue(previousManifest.chrome_settings_overrides)
      : null,
    currentManifest.chrome_settings_overrides && typeof currentManifest.chrome_settings_overrides === "object"
      ? stableValue(currentManifest.chrome_settings_overrides)
      : null
  );
  pushIfChanged(
    "content_security_policy.extension_pages",
    presentString(previousManifest.content_security_policy?.extension_pages)
      ? previousManifest.content_security_policy.extension_pages
      : null,
    presentString(currentManifest.content_security_policy?.extension_pages)
      ? currentManifest.content_security_policy.extension_pages
      : null
  );
  pushIfChanged(
    "content_security_policy.sandbox",
    presentString(previousManifest.content_security_policy?.sandbox)
      ? previousManifest.content_security_policy.sandbox
      : null,
    presentString(currentManifest.content_security_policy?.sandbox)
      ? currentManifest.content_security_policy.sandbox
      : null
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
  const unmodeledKeys = unmodeledTopLevelKeys(manifest);

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
    externalExtensionIds,
    unmodeledKeys
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
    externalExtensionIds,
    unmodeledKeys
  } = manifestSignals(manifest);

  const action = Boolean(manifest.action && typeof manifest.action === "object" && !Array.isArray(manifest.action));
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
  const debuggerAccess = permissions.includes("debugger") || optionalPermissions.includes("debugger");
  const management = permissions.includes("management") || optionalPermissions.includes("management");
  const identityAccess = permissions.some(permission => permission === "identity" || permission === "identity.email")
    || optionalPermissions.some(permission => permission === "identity" || permission === "identity.email")
    || Boolean(manifest.oauth2 && typeof manifest.oauth2 === "object");
  const downloads = permissions.includes("downloads") || optionalPermissions.includes("downloads");
  const clipboard = ["clipboardRead", "clipboardWrite"].some(permission =>
    permissions.includes(permission) || optionalPermissions.includes(permission));
  const cookies = permissions.includes("cookies") || optionalPermissions.includes("cookies");
  const historyAccess = permissions.includes("history") || optionalPermissions.includes("history");
  const bookmarksAccess = permissions.includes("bookmarks") || optionalPermissions.includes("bookmarks");
  const webRequestAccess = ["webRequest", "webRequestBlocking"].some(permission =>
    permissions.includes(permission) || optionalPermissions.includes(permission));
  const browsingDataAccess = permissions.includes("browsingData") || optionalPermissions.includes("browsingData");
  const navigationMetadataAccess = ["tabs", "topSites", "webNavigation"].some(permission =>
    permissions.includes(permission) || optionalPermissions.includes(permission));
  const contentSettingsAccess = permissions.includes("contentSettings") || optionalPermissions.includes("contentSettings");
  const privacySettingsAccess = permissions.includes("privacy") || optionalPermissions.includes("privacy");
  const proxyAccess = permissions.includes("proxy") || optionalPermissions.includes("proxy");
  const geolocationAccess = permissions.includes("geolocation") || optionalPermissions.includes("geolocation");
  const desktopCaptureAccess = permissions.includes("desktopCapture") || optionalPermissions.includes("desktopCapture");
  const pageCaptureAccess = permissions.includes("pageCapture") || optionalPermissions.includes("pageCapture");
  const activeTabAccess = permissions.includes("activeTab") || optionalPermissions.includes("activeTab");
  const scriptingAccess = permissions.includes("scripting") || optionalPermissions.includes("scripting");
  const contextMenusAccess = permissions.includes("contextMenus") || optionalPermissions.includes("contextMenus");
  const alarmsAccess = permissions.includes("alarms") || optionalPermissions.includes("alarms");
  const chromeUrlOverridePages = ["bookmarks", "history", "newtab"].filter(page =>
    presentString(manifest.chrome_url_overrides?.[page]));
  const chromeSettingsOverrides = Boolean(
    manifest.chrome_settings_overrides
    && typeof manifest.chrome_settings_overrides === "object"
    && !Array.isArray(manifest.chrome_settings_overrides)
    && Object.keys(manifest.chrome_settings_overrides).length > 0
  );
  const manifestIconSizes = sortedUnique(objectKeys(manifest.icons));
  const iconDiagnostics = manifestIconDiagnostics(manifest.icons);
  const actionIconStatus = actionIconDiagnostics(manifest.action?.default_icon);
  const crossOriginPolicies = presentString(manifest.cross_origin_embedder_policy?.value)
    || presentString(manifest.cross_origin_opener_policy?.value);
  const managedStorageSchema = presentString(manifest.storage?.managed_schema);
  const extensionKeyDeclared = presentString(manifest.key);
  const presentationMetadata = [
    "default_locale", "description", "homepage_url", "icons", "short_name", "version_name"
  ].some(key => manifest[key] !== undefined);
  const manifestNameDeclared = presentString(manifest.name);
  const validManifestName = manifestNameDeclared && manifest.name.trim().length <= 75;
  const validManifestVersion = parseChromeExtensionVersion(manifest.version) !== null;
  const fileHandlersDeclared = manifest.file_handlers !== undefined;
  const fileHandlers = Array.isArray(manifest.file_handlers) ? manifest.file_handlers : [];
  const fileHandling = fileHandlers.length > 0;
  const invalidFileHandlerCount = fileHandlers.filter(handler => !validFileHandler(handler)).length
    + (fileHandlersDeclared && !Array.isArray(manifest.file_handlers) ? 1 : 0);
  const mimeHandlersDeclared = manifest.mime_types_handler !== undefined;
  const mimeHandlers = manifest.mime_types_handler && typeof manifest.mime_types_handler === "object"
    && !Array.isArray(manifest.mime_types_handler) ? manifest.mime_types_handler : {};
  const mimeTypes = sortedUnique(objectKeys(mimeHandlers));
  const mimeTypeHandling = mimeTypes.length > 0;
  const invalidMimeHandlerCount = mimeTypes.filter(type => {
    const handler = mimeHandlers[type];
    return !presentString(type)
      || !handler || typeof handler !== "object" || Array.isArray(handler)
      || !presentString(handler.handler_url)
      || (handler.can_embed !== undefined && typeof handler.can_embed !== "boolean");
  }).length + (mimeHandlersDeclared && Object.keys(mimeHandlers).length === 0 ? 1 : 0);

  const surfaces = {
    action,
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
    debuggerAccess,
    management,
    identityAccess,
    downloads,
    clipboard,
    cookies,
    historyAccess,
    bookmarksAccess,
    webRequestAccess,
    browsingDataAccess,
    navigationMetadataAccess,
    contentSettingsAccess,
    privacySettingsAccess,
    proxyAccess,
    geolocationAccess,
    desktopCaptureAccess,
    pageCaptureAccess,
    activeTabAccess,
    scriptingAccess,
    contextMenusAccess,
    alarmsAccess,
    crossOriginPolicies,
    managedStorageSchema,
    extensionKeyDeclared,
    fileHandling,
    mimeTypeHandling,
    chromeUrlOverrides: chromeUrlOverridePages.length > 0,
    chromeSettingsOverrides,
    incognitoMode
  };

  const lanes = [];
  addLane(lanes, "install-and-upgrade", "critical",
    "Every release can change manifest wiring, permissions, or persisted state.",
    ["Load the exact shipping build", "Verify a clean install", "Verify an upgrade from the previous version"]);

  if (!validManifestName || !validManifestVersion) {
    addLane(lanes, "manifest-identity-validation", "critical",
      "The manifest identity is incomplete or its package version is not valid for browser installation and update ordering.",
      ["Provide a non-empty manifest name", "Use a non-zero version with one to four dot-separated integers from 0 to 65535 and no leading zeros", "Re-run inspection before attempting a clean install or update"]);
  }

  if (unmodeledKeys.length > 0) {
    addLane(lanes, "unmodeled-manifest-keys", "high",
      `The analyzer does not interpret these top-level manifest keys: ${unmodeledKeys.join(", ")}.`,
      ["Review each unmodeled key against its browser documentation", "Add manual checks for every behavior the key enables or changes", "Do not treat this report as complete until those checks are covered"]);
  }
  if (presentationMetadata) {
    const checks = [
      "Verify the displayed name, description, version label, and homepage in the extension management page as applicable",
      "Check every declared icon at representative browser sizes and high-contrast backgrounds without assuming the files exist",
      "If default_locale is declared, verify the default language plus a missing-message and fallback-language path manually"
    ];
    addLane(lanes, "extension-presentation", "medium",
      "Manifest presentation metadata affects browser management UI, installation surfaces, icons, and localization.",
      checks);
  }
  if (crossOriginPolicies) {
    addLane(lanes, "extension-page-isolation", "high",
      "COEP or COOP changes response headers across the extension origin and can alter embedding, opener relationships, and cross-origin isolation.",
      ["Open every extension page type used by the release and verify intended cross-origin resources still load", "Verify popup, options, extension tabs, and worker behavior without assuming every context becomes cross-origin isolated", "Exercise opener, embedded-frame, and SharedArrayBuffer-dependent paths as applicable before and after upgrade"]);
  }
  if (managedStorageSchema) {
    addLane(lanes, "managed-storage-policy", "high",
      "The manifest points to an enterprise managed-storage schema that Chrome validates before exposing read-only policy values.",
      ["Verify the referenced schema file exists and passes Chrome validation without reading it through this tool", "Test missing, valid, invalid, updated, and absent enterprise-policy values in a disposable managed test profile", "Confirm policy values remain read-only, enforcement is explicit, and no policy data is logged or exported"]);
  }
  if (extensionKeyDeclared) {
    addLane(lanes, "extension-identity-continuity", "high",
      "A packaged identity key is declared and can affect stable extension identity across installation and update paths.",
      ["Verify the exact packaged extension ID matches the expected release identity", "Test a clean install and an update from the previous shipping package through the intended distribution path", "Treat an unexpected identity mismatch as a replacement install and verify user-visible recovery without exposing the key"]);
  }
  if (fileHandlersDeclared) {
    addLane(lanes, "chromeos-file-handling", "high",
      "The extension registers one or more ChromeOS file handlers that open user-selected files in extension pages.",
      ["On ChromeOS 120 or later, verify every declared MIME type and extension appears only for matching synthetic files", "Verify each declared action page opens and receives single-client and repeated launches as configured", "Test cancellation, unsupported files, malformed synthetic content, and confirm file contents are neither uploaded nor retained unexpectedly"]);
  }
  if (mimeHandlersDeclared) {
    addLane(lanes, "mime-document-handling", "critical",
      "The extension can replace the built-in document viewer for registered full-frame MIME documents.",
      ["On browser version 151 or later, open a synthetic PDF as a top-level navigation and verify rendering plus the original address", "If embedding is enabled, test synthetic PDF documents in embed, object, and iframe contexts without retaining document data", "Force parsing and rendering failures, then verify the document safely returns to the native handler without a retry loop"]);
  }

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
  if (action && !actionPopup) {
    addLane(lanes, "toolbar-action", "high",
      "The extension declares a toolbar action without a popup, so activation depends on its click-event path.",
      ["Pin or open the extension action from the browser toolbar", "Trigger the action on an allowed tab", "Verify disabled, unsupported, and repeated-click behavior"]);
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
  if (chromeUrlOverridePages.length > 0) {
    addLane(lanes, "browser-page-override", "high",
      `The extension replaces a built-in Chrome page (${chromeUrlOverridePages.join(", ")}).`,
      ["Open the overridden page from its normal browser entry point", "Verify fast loading and a clear page title", "Test normal and incognito behavior where supported"]);
  }
  if (chromeSettingsOverrides) {
    addLane(lanes, "browser-settings-override", "critical",
      "The extension declares browser homepage, startup-page, or search-provider overrides.",
      ["Verify the fresh-install confirmation and the exact resulting settings", "Test every declared homepage, startup, and search path", "Remove or disable the extension and verify settings recover as expected"]);
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
  if (debuggerAccess) {
    addLane(lanes, "debugger-protocol", "critical",
      "The debugger API can attach to tabs and expose protocol-level browser capabilities.",
      ["Attach only after the intended user action", "Handle an occupied or denied debugging target", "Detach cleanly and verify no session remains active"]);
  }
  if (management) {
    addLane(lanes, "extension-management", "critical",
      "The management API can inspect or change the state of other installed extensions.",
      ["Exercise read-only listing separately from state changes", "Require explicit confirmation before a reversible state change", "Verify protected or unsupported targets fail safely"]);
  }
  if (identityAccess) {
    addLane(lanes, "identity-flow", "high",
      "Identity flows depend on user choice, token lifetime, and provider failure states.",
      ["Complete the intended interactive sign-in", "Cancel or deny the flow", "Verify expired or revoked access returns to a recoverable state"]);
  }
  if (downloads) {
    addLane(lanes, "downloads", "high",
      "Download behavior crosses browser prompts, filenames, conflicts, and local filesystem state.",
      ["Download a harmless test file", "Exercise filename conflict and cancellation", "Verify failure behavior without exposing local paths"]);
  }
  if (clipboard) {
    addLane(lanes, "clipboard-boundary", "high",
      "Clipboard access handles data outside the extension and can fail without focus or user activation.",
      ["Exercise the intended user-initiated clipboard action", "Handle unavailable or denied clipboard access", "Verify copied or read content is not retained unexpectedly"]);
  }
  if (cookies) {
    addLane(lanes, "cookie-boundary", "high",
      "Cookie access depends on host grants, cookie stores, and partition keys.",
      ["Use only synthetic cookies on an explicitly authorized test host", "Verify denied-host, session, persistent, and partitioned-cookie behavior", "Confirm test cookies are removed and no unrelated cookie values are recorded"]);
  }
  if (historyAccess) {
    addLane(lanes, "history-boundary", "high",
      "Browsing-history access can read, add, and remove visited URLs.",
      ["Use a disposable browser profile containing only synthetic history entries", "Exercise query, add, and narrowly scoped removal behavior", "Verify unrelated history is never exported, logged, or modified"]);
  }
  if (bookmarksAccess) {
    addLane(lanes, "bookmarks-boundary", "high",
      "Bookmark access can read and modify the browser bookmark tree.",
      ["Use a disposable folder containing only synthetic bookmarks", "Exercise create, update, move, and removal without touching protected roots", "Verify unrelated bookmarks are never exported, logged, or modified"]);
  }
  if (webRequestAccess) {
    addLane(lanes, "web-request-boundary", "critical",
      "Web-request access observes network traffic within granted host scope and may have restricted blocking behavior in MV3.",
      ["Use only an explicitly authorized synthetic host and request set", "Verify requested URL and initiator host boundaries", "Confirm observed request details are not persisted and unsupported blocking paths fail safely"]);
  }
  if (browsingDataAccess) {
    addLane(lanes, "browsing-data-removal", "critical",
      "Browsing-data access can remove multiple classes of stored browser data.",
      ["Use only a disposable profile populated with synthetic browsing data", "Exercise the narrowest supported data types, origins, and time range", "Verify cancellation, unsupported combinations, and that unrelated data remains intact"]);
  }
  if (navigationMetadataAccess) {
    addLane(lanes, "navigation-metadata", "high",
      "Tab, top-site, or navigation access can expose visited URLs and navigation behavior.",
      ["Use a disposable profile containing only synthetic tabs and visits", "Verify event and query results stay within the intended feature scope", "Confirm URLs and titles are not persisted, exported, or logged"]);
  }
  if (contentSettingsAccess) {
    addLane(lanes, "content-settings-control", "critical",
      "Content-setting access can change per-site controls such as cookies, JavaScript, location, camera, and microphone.",
      ["Use only a disposable profile and explicitly authorized synthetic origins", "Record the synthetic baseline, apply the narrowest primary and secondary patterns, then verify the effective setting", "Clear the test rule and verify the exact baseline is restored"]);
  }
  if (privacySettingsAccess) {
    addLane(lanes, "privacy-settings-control", "critical",
      "Privacy-setting access can read or change browser-wide privacy controls and may be superseded by policy or another extension.",
      ["Use only a disposable profile and record the synthetic baseline", "Check levelOfControl before setting a reversible test value", "Clear the test value and verify baseline restoration plus policy and competing-extension behavior"]);
  }
  if (proxyAccess) {
    addLane(lanes, "proxy-control", "critical",
      "Proxy access can redirect browser traffic and can be controlled by policy or another extension.",
      ["Use only a disposable profile with a local synthetic endpoint and no real credentials", "Verify direct, unavailable, invalid, and controlled-by-policy states without bypassing failures", "Clear the test configuration and verify exact network restoration"]);
  }
  if (geolocationAccess) {
    addLane(lanes, "geolocation-boundary", "critical",
      "Geolocation access can reveal physical location without a separate web permission prompt.",
      ["Use only mocked or synthetic coordinates in a disposable profile", "Verify unavailable, timeout, stale, and changed-position behavior", "Confirm coordinates are never logged, exported, uploaded, or retained"]);
  }
  if (desktopCaptureAccess) {
    addLane(lanes, "desktop-capture-boundary", "critical",
      "Desktop capture can expose screen, window, tab, and optional audio content through a user picker.",
      ["Use only a synthetic window with no accounts, notifications, or personal content visible", "Exercise explicit selection, cancellation, expired one-time stream IDs, and audio excluded", "Stop every track and verify frames, audio, and identifiers are never retained or uploaded"]);
  }
  if (pageCaptureAccess) {
    addLane(lanes, "page-capture-boundary", "critical",
      "Page capture can serialize a complete tab and its resources into an MHTML file.",
      ["Capture only a synthetic local page containing no personal or account data", "Verify failure and unsupported-tab behavior before saving", "Confirm the artifact is created only by explicit user action and is never uploaded or retained automatically"]);
  }
  if (activeTabAccess) {
    addLane(lanes, "active-tab-gesture", "high",
      "activeTab grants temporary access to the current tab only after an explicit user gesture and loses access on cross-origin navigation or close.",
      ["Use an explicitly authorized synthetic page and verify access is absent before the user gesture", "Invoke the intended action, command, context menu, or omnibox gesture and verify only the active origin is accessible", "Navigate to a different origin or close the tab and verify temporary access is revoked"]);
  }
  if (scriptingAccess) {
    addLane(lanes, "programmatic-injection", "high",
      "Programmatic script or style injection requires scripting plus temporary or persistent host access and explicit targeting.",
      ["Inject only packaged test code into an explicitly authorized synthetic page", "Verify main-frame, selected-frame, all-frame, isolated-world, and rejected-target behavior as applicable", "Confirm injection fails safely without activeTab or host access and does not persist after navigation"]);
  }
  if (contextMenusAccess) {
    addLane(lanes, "context-menu-registration", "medium",
      "Context-menu items depend on registration lifecycle, page context, and click routing.",
      ["Register the expected items without creating duplicates after a service-worker restart", "Verify visibility and enabled state on representative synthetic page, selection, link, image, and extension contexts", "Trigger each supported item and confirm unsupported or stale targets fail safely"]);
  }
  if (alarmsAccess) {
    addLane(lanes, "alarm-lifecycle", "high",
      "Alarm delivery can wake the service worker and must tolerate delayed, restarted, or cleared state.",
      ["Create a short synthetic alarm and verify the intended handler after the worker has stopped", "Restart the browser and verify the extension recreates any alarm it requires instead of assuming persistence", "Clear the alarm and confirm repeated, delayed, and unexpected names do not duplicate work"]);
  }

  const riskFlags = [];
  if (!manifestNameDeclared) {
    riskFlags.push({ id: "manifest-name-invalid", level: "critical", message: "The required manifest name is missing or empty; provide a non-empty name before packaging." });
  }
  if (manifestNameDeclared && !validManifestName) {
    riskFlags.push({ id: "manifest-name-too-long", level: "critical", message: "The manifest name exceeds the documented 75-character maximum; shorten it before packaging." });
  }
  if (!validManifestVersion) {
    riskFlags.push({ id: "manifest-version-invalid", level: "critical", message: "The required manifest version is invalid; use one to four dot-separated integers from 0 to 65535, without leading zeros, and not all zero." });
  }
  const minimumBrowserVersion = parseChromeExtensionVersion(manifest.minimum_chrome_version);
  if (fileHandling && (!minimumBrowserVersion || minimumBrowserVersion[0] < 120)) {
    riskFlags.push({ id: "file-handlers-minimum-version", level: "high", message: "File handling requires ChromeOS 120 or later; declare a compatible minimum browser version or document and test the unsupported-install path." });
  }
  if (invalidFileHandlerCount > 0 || (fileHandlersDeclared && fileHandlers.length === 0)) {
    riskFlags.push({ id: "file-handlers-invalid", level: "critical", message: "At least one file-handler declaration is invalid or the declared list is empty; verify action, name, accepted MIME mappings, dot-prefixed extensions, and launch type before packaging." });
  }
  if (invalidMimeHandlerCount > 0) {
    riskFlags.push({ id: "mime-types-handler-invalid", level: "critical", message: "The MIME-handler declaration is empty or malformed; each type needs a non-empty handler URL and an optional boolean embedding flag." });
  }
  if (mimeTypes.some(type => type !== "application/pdf")) {
    riskFlags.push({ id: "mime-type-unsupported", level: "critical", message: "A public MIME handler declares a type other than application/pdf, the only publicly supported type as of browser version 151." });
  }
  if (mimeHandlersDeclared && (!minimumBrowserVersion || minimumBrowserVersion[0] < 151)) {
    riskFlags.push({ id: "mime-handler-minimum-version", level: "high", message: "MIME document handling requires browser version 151 or later; declare a compatible minimum or test and document the inactive fallback path." });
  }
  if (iconDiagnostics.invalid) {
    riskFlags.push({ id: "manifest-icons-invalid", level: "critical", message: "The manifest icons declaration is empty or malformed; use positive integer size keys and non-empty relative image paths." });
  }
  if (iconDiagnostics.unsupportedFormat) {
    riskFlags.push({ id: "manifest-icon-format-unsupported", level: "high", message: "At least one manifest icon uses SVG or WebP, which is not supported for declared extension icons; use a supported raster format." });
  }
  if (iconDiagnostics.declared && !iconDiagnostics.invalid && iconDiagnostics.missingRecommended) {
    riskFlags.push({ id: "manifest-icon-sizes-incomplete", level: "medium", message: "The manifest icons declaration omits the recommended 48px or 128px size; verify management-page and installation rendering." });
  }
  if (actionIconStatus.invalid) {
    riskFlags.push({ id: "action-icon-invalid", level: "critical", message: "The action default icon is malformed; use a non-empty relative image path or a non-empty positive-size-to-path mapping." });
  }
  if (actionIconStatus.unsupportedFormat) {
    riskFlags.push({ id: "action-icon-format-unsupported", level: "high", message: "The action default icon uses SVG or WebP, which is not supported for declared extension icons; use a supported raster format." });
  }
  if (unmodeledKeys.length > 0) {
    riskFlags.push({
      id: "unmodeled-manifest-keys",
      level: "high",
      message: `Coverage gap: top-level manifest keys are present but not interpreted: ${unmodeledKeys.join(", ")}. Add manual coverage before relying on this plan.`
    });
  }
  if (presentString(manifest.description) && manifest.description.length > 132) {
    riskFlags.push({ id: "description-too-long", level: "medium", message: "The manifest description exceeds Chrome's documented 132-character limit." });
  }
  if (presentString(manifest.short_name) && manifest.short_name.length > 12) {
    riskFlags.push({ id: "short-name-too-long", level: "medium", message: "The manifest short_name exceeds Chrome's documented 12-character maximum." });
  }
  if (managedStorageSchema && !storage) {
    riskFlags.push({ id: "managed-schema-without-storage-permission", level: "high", message: "A managed storage schema is declared without the storage permission required to use the extension storage API." });
  }
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
  if (permissions.includes("debugger")) {
    riskFlags.push({ id: "required-debugger-access", level: "critical", message: "debugger is required; verify explicit user intent, target selection, protocol error handling, and reliable detachment." });
  }
  if (permissions.includes("management")) {
    riskFlags.push({ id: "required-extension-management", level: "critical", message: "management is required; verify that actions affecting other extensions are explicit, reversible where possible, and safely rejected for protected targets." });
  }
  if (permissions.includes("clipboardRead")) {
    riskFlags.push({ id: "required-clipboard-read", level: "high", message: "clipboardRead is required; verify user expectations, unavailable states, and that clipboard content is not retained unexpectedly." });
  }
  if (chromeUrlOverridePages.length > 0) {
    riskFlags.push({ id: "browser-page-override", level: "high", message: "A built-in Chrome page is replaced; verify navigation, performance, focus, and incognito behavior." });
  }
  if (chromeSettingsOverrides) {
    riskFlags.push({ id: "browser-settings-override", level: "critical", message: "Browser settings are overridden; verify explicit user confirmation, the exact resulting settings, and recovery after disable or removal." });
  }
  if (permissions.includes("cookies")) {
    riskFlags.push({ id: "required-cookie-access", level: "high", message: "Cookie access is required; test only synthetic cookie values on authorized hosts and verify store and partition isolation." });
  }
  if (permissions.includes("history")) {
    riskFlags.push({ id: "required-history-access", level: "critical", message: "Browsing-history access is required; use a disposable profile with synthetic entries and verify unrelated history is untouched." });
  }
  if (permissions.includes("bookmarks")) {
    riskFlags.push({ id: "required-bookmarks-access", level: "high", message: "Bookmark access is required; use a disposable synthetic folder and verify unrelated bookmarks are untouched." });
  }
  if (permissions.includes("webRequest")) {
    riskFlags.push({ id: "required-web-request-access", level: "high", message: "Web-request observation is required; constrain testing to authorized synthetic hosts and do not retain request details." });
  }
  if (permissions.includes("webRequestBlocking")) {
    riskFlags.push({ id: "mv3-web-request-blocking", level: "critical", message: "webRequestBlocking is restricted for most MV3 extensions; verify the intended policy-installed context or replace the blocking path." });
  }
  if (permissions.includes("browsingData")) {
    riskFlags.push({ id: "required-browsing-data-removal", level: "critical", message: "Browsing-data removal is required; use only a disposable synthetic profile and verify narrowly scoped deletion." });
  }
  const requiredNavigationMetadata = ["tabs", "topSites", "webNavigation"].filter(permission => permissions.includes(permission));
  if (requiredNavigationMetadata.length > 0) {
    riskFlags.push({ id: "required-navigation-metadata", level: "high", message: `Navigation metadata permissions are required: ${requiredNavigationMetadata.join(", ")}. Use only synthetic tabs and visits, and do not retain URLs or titles.` });
  }
  if (permissions.includes("contentSettings")) {
    riskFlags.push({ id: "required-content-settings-control", level: "critical", message: "Content-setting control is required; use a disposable profile, narrow synthetic patterns, and verify exact restoration." });
  }
  if (permissions.includes("privacy")) {
    riskFlags.push({ id: "required-privacy-settings-control", level: "critical", message: "Privacy-setting control is required; verify levelOfControl, policy conflicts, reversible changes, and exact restoration." });
  }
  if (permissions.includes("proxy")) {
    riskFlags.push({ id: "required-proxy-control", level: "critical", message: "Proxy control is required; use only a local synthetic endpoint without credentials and verify exact network restoration." });
  }
  if (permissions.includes("geolocation")) {
    riskFlags.push({ id: "required-geolocation", level: "critical", message: "Geolocation is required and may run without a separate web prompt; use only synthetic coordinates and retain nothing." });
  }
  if (permissions.includes("desktopCapture")) {
    riskFlags.push({ id: "required-desktop-capture", level: "critical", message: "Desktop capture is required; verify explicit picker consent, cancellation, one-time stream expiry, track shutdown, and zero retention." });
  }
  if (permissions.includes("pageCapture")) {
    riskFlags.push({ id: "required-page-capture", level: "critical", message: "Page capture is required; capture only synthetic local content and verify explicit saving with no upload or automatic retention." });
  }
  if (permissions.includes("scripting")) {
    riskFlags.push({ id: "required-programmatic-injection", level: "high", message: "Programmatic injection is required; verify explicit targets, execution worlds, host grants, navigation cleanup, and rejection without access." });
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
      sandboxPages: sandboxPages.length,
      unmodeledTopLevelKeys: unmodeledKeys.length,
      manifestIcons: manifestIconSizes.length,
      fileHandlerDeclarations: fileHandlers.length,
      mimeTypeHandlers: mimeTypes.length
    },
    coverage: { unmodeledTopLevelKeys: unmodeledKeys },
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
  const uiDeclarationFields = [
    "action.default_icon",
    "action.default_popup",
    "action.default_title",
    "devtools_page",
    "omnibox.keyword",
    "options_page",
    "sandbox.pages",
    "side_panel.default_path"
  ];
  const uiDeclarationsChanged = declarations.some(item => uiDeclarationFields.includes(item.field));
  const version = versionChange(previousReport.identity.version, currentReport.identity.version);
  const unmodeledKeyChanges = keyValueDiff(
    previousManifest,
    currentManifest,
    previous.unmodeledKeys,
    current.unmodeledKeys
  );
  const extensionKey = {
    previousDeclared: presentString(previousManifest.key),
    currentDeclared: presentString(currentManifest.key),
    changed: (presentString(previousManifest.key) || presentString(currentManifest.key))
      && previousManifest.key !== currentManifest.key
  };
  const manifestChanged = previousReport.fingerprint !== currentReport.fingerprint
    || extensionKey.changed
    || unmodeledKeyChanges.added.length > 0
    || unmodeledKeyChanges.removed.length > 0
    || unmodeledKeyChanges.changed.length > 0;

  const changes = {
    version,
    requiredPermissions: listDiff(previous.permissions, current.permissions),
    optionalPermissions: listDiff(previous.optionalPermissions, current.optionalPermissions),
    requiredHosts: listDiff(previous.hostPermissions, current.hostPermissions),
    optionalHosts: listDiff(previous.optionalHostPermissions, current.optionalHostPermissions),
    oauthScopes: listDiff(asStrings(previousManifest.oauth2?.scopes), asStrings(currentManifest.oauth2?.scopes)),
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
    declarations,
    extensionKey,
    unmodeledTopLevelKeys: unmodeledKeyChanges
  };

  const findings = [];
  if (changes.extensionKey.changed) {
    findings.push({
      id: "extension-identity-key-change",
      level: "critical",
      message: "The packaged extension identity key changed. Verify the expected extension ID and the real update path before release; this report intentionally omits the key value."
    });
  }
  if (
    changes.unmodeledTopLevelKeys.added.length > 0
    || changes.unmodeledTopLevelKeys.removed.length > 0
    || changes.unmodeledTopLevelKeys.changed.length > 0
  ) {
    findings.push({
      id: "unmodeled-manifest-key-change",
      level: "high",
      message: `Unmodeled top-level manifest keys changed (added: ${changes.unmodeledTopLevelKeys.added.join(", ") || "none"}; removed: ${changes.unmodeledTopLevelKeys.removed.join(", ") || "none"}; changed: ${changes.unmodeledTopLevelKeys.changed.join(", ") || "none"}). Review their browser behavior manually.`
    });
  }
  const metadataFields = new Set(["description", "homepage_url", "icons", "name", "short_name", "version_name"]);
  const changedMetadataFields = declarations.filter(change => metadataFields.has(change.field));
  if (changedMetadataFields.length > 0) {
    findings.push({
      id: "extension-presentation-change",
      level: "medium",
      message: `Extension presentation metadata changed: ${changedMetadataFields.map(change => change.field).join(", ")}. Verify the management UI, installation surfaces, and icons as applicable.`
    });
  }
  if (declarations.some(change => change.field === "default_locale")) {
    findings.push({
      id: "default-locale-change",
      level: "high",
      message: "The default locale changed. Verify localized manifest strings, missing-message behavior, and language fallback manually."
    });
  }
  if (declarations.some(change => change.field.startsWith("cross_origin_"))) {
    findings.push({
      id: "cross-origin-policy-change",
      level: "high",
      message: "An extension-origin COEP or COOP value changed. Verify embedded resources, opener relationships, extension pages, workers, and cross-origin-isolated features across the update."
    });
  }
  if (declarations.some(change => change.field === "storage.managed_schema")) {
    findings.push({
      id: "managed-storage-schema-change",
      level: "high",
      message: "The managed-storage schema path changed. Verify Chrome schema validation plus missing, valid, invalid, and upgraded enterprise-policy behavior manually."
    });
  }
  if (declarations.some(change => change.field === "file_handlers")) {
    findings.push({
      id: "file-handlers-change",
      level: "high",
      message: "ChromeOS file-handler declarations changed. Verify matching types, action pages, launch behavior, unsupported files, and update behavior on ChromeOS 120 or later."
    });
  }
  if (declarations.some(change => change.field === "mime_types_handler")) {
    findings.push({
      id: "mime-types-handler-change",
      level: "critical",
      message: "MIME document-handler declarations changed. Verify top-level and embedded synthetic PDFs, original-address behavior, update continuity, and safe fallback to the native viewer."
    });
  }
  if (version.relation === "older") {
    findings.push({
      id: "extension-version-decreased",
      level: "critical",
      message: `The extension version decreased from ${version.previous} to ${version.current}. Chrome will not treat this package as a newer automatic update.`
    });
  }
  if (version.relation === "same" && manifestChanged) {
    findings.push({
      id: "extension-version-not-increased",
      level: "high",
      message: `The manifest changed but the extension version remains ${version.current}. Increase it before testing the real update path.`
    });
  }
  if (version.relation === "invalid") {
    findings.push({
      id: "extension-version-invalid",
      level: "high",
      message: "At least one extension version cannot be compared using Chrome's one-to-four integer version rules. Correct it before testing an update."
    });
  }
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
  if (changes.oauthScopes.added.length > 0) {
    findings.push({
      id: "oauth-scope-expansion",
      level: "critical",
      message: `OAuth scopes added: ${changes.oauthScopes.added.join(", ")}. Test explicit user consent, denial, token refresh, and revocation before release.`
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
  if (declarations.some(item => item.field.startsWith("content_security_policy."))) {
    findings.push({
      id: "content-security-policy-change",
      level: "high",
      message: "An extension or sandbox content security policy changed. Verify every affected page loads only intended resources and that blocked-resource failures remain recoverable."
    });
  }
  if (declarations.some(item => item.field === "minimum_chrome_version")) {
    findings.push({
      id: "minimum-browser-version-change",
      level: "medium",
      message: "The minimum Chrome version changed. Verify install and update behavior at the old and new support boundaries."
    });
  }
  if (declarations.some(item => item.field === "update_url")) {
    findings.push({
      id: "update-source-change",
      level: "critical",
      message: "The extension update URL changed. Verify the intended distribution source and test an authentic upgrade before release."
    });
  }
  if (declarations.some(item => item.field.startsWith("action."))) {
    findings.push({
      id: "toolbar-action-change",
      level: "high",
      message: "The toolbar action declaration changed. Verify its icon and accessible title, then exercise either the popup or click-event path on allowed and unsupported tabs."
    });
  }
  if (declarations.some(item => item.field === "incognito")) {
    findings.push({
      id: "incognito-mode-change",
      level: "high",
      message: "The declared incognito mode changed. Test access disabled and enabled, then verify that state does not cross profile boundaries."
    });
  }
  if (declarations.some(item => item.field.startsWith("chrome_url_overrides."))) {
    findings.push({
      id: "browser-page-override-change",
      level: "high",
      message: "A built-in Chrome page override changed. Test the affected browser entry point, loading speed, title, focus, navigation, and supported incognito behavior."
    });
  }
  if (declarations.some(item => item.field === "chrome_settings_overrides")) {
    findings.push({
      id: "browser-settings-override-change",
      level: "critical",
      message: "Browser setting overrides changed. Verify the install confirmation, every affected homepage, startup, and search path, plus recovery after disable or removal."
    });
  }
  if (changes.surfaces.added.length > 0 || changes.surfaces.removed.length > 0 || uiDeclarationsChanged) {
    findings.push({
      id: "extension-surface-change",
      level: "medium",
      message: `Extension surfaces changed (added: ${changes.surfaces.added.join(", ") || "none"}; removed: ${changes.surfaces.removed.join(", ") || "none"}${uiDeclarationsChanged ? "; declarations changed" : ""}). Verify each affected surface through its browser entry point.`
    });
  }
  const addedBrowserDataSurfaces = changes.surfaces.added.filter(surface =>
    ["bookmarks", "browsing-data", "cookies", "history", "navigation-metadata"].includes(surface));
  if (addedBrowserDataSurfaces.length > 0) {
    findings.push({
      id: "browser-data-surface-expansion",
      level: "high",
      message: `Sensitive browser-data surfaces added: ${addedBrowserDataSurfaces.join(", ")}. Use only a disposable profile with synthetic data and verify unrelated data remains untouched.`
    });
  }
  if (changes.surfaces.added.includes("web-request")) {
    findings.push({
      id: "web-request-surface-expansion",
      level: "high",
      message: "Web-request observation was added. Test only authorized synthetic hosts, verify URL and initiator boundaries, and do not persist request details."
    });
  }
  const addedSettingControlSurfaces = changes.surfaces.added.filter(surface =>
    ["content-settings", "privacy-settings", "proxy-settings"].includes(surface));
  if (addedSettingControlSurfaces.length > 0) {
    findings.push({
      id: "browser-setting-control-expansion",
      level: "critical",
      message: `Browser-setting control surfaces added: ${addedSettingControlSurfaces.join(", ")}. Use a disposable profile, test policy conflicts, and verify exact restoration before release.`
    });
  }
  const addedCaptureSurfaces = changes.surfaces.added.filter(surface =>
    ["desktop-capture", "geolocation", "page-capture"].includes(surface));
  if (addedCaptureSurfaces.length > 0) {
    findings.push({
      id: "capture-or-location-expansion",
      level: "critical",
      message: `Capture or location surfaces added: ${addedCaptureSurfaces.join(", ")}. Require explicit user intent, synthetic inputs, cancellation coverage, and zero retention before release.`
    });
  }
  const addedInjectionSurfaces = changes.surfaces.added.filter(surface =>
    ["active-tab", "programmatic-injection"].includes(surface));
  if (addedInjectionSurfaces.length > 0) {
    findings.push({
      id: "injection-surface-expansion",
      level: "high",
      message: `Temporary tab or injection surfaces added: ${addedInjectionSurfaces.join(", ")}. Verify explicit user gestures, target frames and worlds, host boundaries, and revocation after navigation.`
    });
  }
  if (changes.contentScripts.added.length > 0 || changes.contentScripts.removed.length > 0) {
    findings.push({
      id: "content-script-registration-change",
      level: "high",
      message: `Content-script registrations changed (added: ${changes.contentScripts.added.length}; removed: ${changes.contentScripts.removed.length}). Verify timing, frame coverage, execution world, matched pages, and injected files.`
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
