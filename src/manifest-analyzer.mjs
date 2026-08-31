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

function validFileBrowserHandler(handler) {
  if (!handler || typeof handler !== "object" || Array.isArray(handler)) return false;
  if (!presentString(handler.id) || !presentString(handler.default_title)) return false;
  const filters = handler.file_filters;
  if (!Array.isArray(filters) || filters.length === 0) return false;
  if (!filters.every(filter => presentString(filter) && filter.startsWith("filesystem:"))) return false;
  return new Set(filters).size === filters.length;
}

function fileBrowserHandlersDiagnostics(value) {
  if (value === undefined) return { declared: false, invalid: false };
  if (!Array.isArray(value) || value.length === 0) return { declared: true, invalid: true };
  const ids = value.filter(validFileBrowserHandler).map(handler => handler.id);
  return { declared: true, invalid: ids.length !== value.length || new Set(ids).size !== ids.length };
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

function validWebAccessibleResource(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const resources = asStrings(entry.resources);
  const matches = asStrings(entry.matches);
  const extensionIds = asStrings(entry.extension_ids);
  if (!Array.isArray(entry.resources) || resources.length === 0 || resources.length !== entry.resources.length
    || resources.some(resource => !presentString(resource))) return false;
  const hasMatches = Array.isArray(entry.matches) && matches.length > 0 && matches.length === entry.matches.length
    && matches.every(pattern => presentString(pattern));
  const hasExtensionIds = Array.isArray(entry.extension_ids) && extensionIds.length > 0
    && extensionIds.length === entry.extension_ids.length && extensionIds.every(id => presentString(id));
  if (!hasMatches && !hasExtensionIds) return false;
  return entry.use_dynamic_url === undefined || typeof entry.use_dynamic_url === "boolean";
}

function webAccessibleMatchHasInvalidPath(pattern) {
  if (pattern === "<all_urls>") return false;
  if (!presentString(pattern) || !pattern.includes("://")) return false;
  return !/^[^:]+:\/\/[^/]*\/\*$/.test(pattern);
}

const WEB_HOST_PATTERN_REGEX = /^(?:https?|\*):\/\/(?:\*|\*\.[^*/\s]+|[^*/\s]+)\/.*$/;
const FILE_HOST_PATTERN_REGEX = /^file:\/\/\/.*$/;

function validHostPermissionPattern(pattern) {
  if (pattern === "<all_urls>") return true;
  if (!presentString(pattern)) return false;
  return WEB_HOST_PATTERN_REGEX.test(pattern) || FILE_HOST_PATTERN_REGEX.test(pattern);
}

function namedPermissionListDiagnostics(value) {
  if (value === undefined) return { declared: false, invalid: false, misplacedHostPattern: false };
  if (!Array.isArray(value)) return { declared: true, invalid: true, misplacedHostPattern: false };
  const invalid = value.some(item => typeof item !== "string" || !presentString(item));
  const misplacedHostPattern = value.some(item =>
    typeof item === "string" && (item === "<all_urls>" || item.includes("://")));
  return { declared: true, invalid, misplacedHostPattern };
}

function hostPermissionListDiagnostics(value) {
  if (value === undefined) return { declared: false, invalid: false };
  if (!Array.isArray(value)) return { declared: true, invalid: true };
  const invalid = value.some(item => typeof item !== "string" || !presentString(item)
    || !validHostPermissionPattern(item));
  return { declared: true, invalid };
}

function externallyConnectableDiagnostics(value) {
  if (value === undefined) return { declared: false, invalid: false, invalidAllUrls: false, wildcardIds: false, acceptsTlsChannelId: false };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { declared: true, invalid: true, invalidAllUrls: false, wildcardIds: false, acceptsTlsChannelId: false };
  }
  const ids = value.ids === undefined ? [] : asStrings(value.ids);
  const matches = value.matches === undefined ? [] : asStrings(value.matches);
  const invalidIds = value.ids !== undefined && (!Array.isArray(value.ids)
    || ids.length !== value.ids.length || ids.some(id => id !== "*" && !/^[a-p]{32}$/.test(id)));
  const invalidMatches = value.matches !== undefined && (!Array.isArray(value.matches)
    || matches.length !== value.matches.length || matches.some(pattern => !presentString(pattern)));
  const invalidTls = value.accepts_tls_channel_id !== undefined && typeof value.accepts_tls_channel_id !== "boolean";
  return {
    declared: true,
    invalid: invalidIds || invalidMatches || invalidTls,
    invalidAllUrls: matches.includes("<all_urls>"),
    wildcardIds: ids.includes("*"),
    acceptsTlsChannelId: value.accepts_tls_channel_id === true
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
  "export",
  "file_browser_handlers",
  "file_handlers",
  "file_system_provider_capabilities", "input_components",
  "homepage_url", "host_permissions", "icons", "import", "incognito",
  "key",
  "manifest_version", "mime_types_handler", "minimum_chrome_version", "name", "oauth2", "omnibox",
  "optional_host_permissions", "optional_permissions", "options_page", "options_ui",
  "permissions", "requirements", "sandbox", "short_name", "side_panel", "storage", "tts_engine",
  "update_url", "version", "version_name", "web_accessible_resources"
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
const CONTENT_SCRIPT_WORLDS = ["ISOLATED", "MAIN"];
const COMMAND_PLATFORMS = new Set(["default", "chromeos", "linux", "mac", "windows"]);
const COMMAND_KEYS = new Set([
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  "Comma", "Period", "Home", "End", "PageUp", "PageDown", "Space", "Insert", "Delete",
  "Up", "Down", "Left", "Right",
  "MediaNextTrack", "MediaPlayPause", "MediaPrevTrack", "MediaStop"
]);
const COMMAND_MODIFIERS = new Set(["Ctrl", "Alt", "Shift", "MacCtrl", "Option", "Command", "Search"]);

function validCommandShortcut(shortcut, platform) {
  if (!presentString(shortcut)) return false;
  const parts = shortcut.split("+");
  if (parts.some(part => !presentString(part)) || new Set(parts).size !== parts.length) return false;
  const keys = parts.filter(part => COMMAND_KEYS.has(part));
  const modifiers = parts.filter(part => COMMAND_MODIFIERS.has(part));
  if (keys.length !== 1 || keys.length + modifiers.length !== parts.length) return false;
  const mediaKey = keys[0].startsWith("Media");
  if (mediaKey) return modifiers.length === 0;
  if (modifiers.includes("Ctrl") && modifiers.includes("Alt")) return false;
  if (["MacCtrl", "Option", "Command"].some(item => modifiers.includes(item)) && platform !== "mac") return false;
  if (modifiers.includes("Search") && platform !== "chromeos") return false;
  return modifiers.some(item => ["Ctrl", "Alt", "MacCtrl", "Option", "Command"].includes(item));
}

function commandDiagnostics(value) {
  if (value === undefined) {
    return { invalid: false, missingDescription: false, tooManySuggested: false, deprecatedAction: false };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { invalid: true, missingDescription: false, tooManySuggested: false, deprecatedAction: false };
  }
  let invalid = Object.keys(value).length === 0;
  let missingDescription = false;
  let suggestedCount = 0;
  let deprecatedAction = false;
  for (const [name, declaration] of Object.entries(value)) {
    if (!presentString(name) || !declaration || typeof declaration !== "object" || Array.isArray(declaration)) {
      invalid = true;
      continue;
    }
    const actionCommand = name === "_execute_action";
    const legacyActionCommand = name === "_execute_browser_action" || name === "_execute_page_action";
    deprecatedAction ||= legacyActionCommand;
    missingDescription ||= !actionCommand && !legacyActionCommand && !presentString(declaration.description);
    if (declaration.description !== undefined && typeof declaration.description !== "string") invalid = true;
    if (declaration.global !== undefined && typeof declaration.global !== "boolean") invalid = true;
    if (declaration.suggested_key === undefined) continue;
    suggestedCount += 1;
    if (typeof declaration.suggested_key === "string") {
      invalid ||= !validCommandShortcut(declaration.suggested_key, "default");
      continue;
    }
    if (!declaration.suggested_key || typeof declaration.suggested_key !== "object"
      || Array.isArray(declaration.suggested_key)) {
      invalid = true;
      continue;
    }
    const shortcuts = Object.entries(declaration.suggested_key);
    invalid ||= shortcuts.length === 0 || shortcuts.some(([platform, shortcut]) =>
      !COMMAND_PLATFORMS.has(platform) || !validCommandShortcut(shortcut, platform));
  }
  return {
    invalid,
    missingDescription,
    tooManySuggested: suggestedCount > 4,
    deprecatedAction
  };
}

function contentScriptDiagnostics(value) {
  if (value === undefined) return { invalid: false, invalidOriginFallbackPath: false };
  if (!Array.isArray(value) || value.length === 0) {
    return { invalid: true, invalidOriginFallbackPath: false };
  }
  let invalid = false;
  let invalidOriginFallbackPath = false;
  const stringArray = entry => Array.isArray(entry) && entry.every(item => presentString(item));
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      invalid = true;
      continue;
    }
    const matchesValid = stringArray(entry.matches) && entry.matches.length > 0;
    const jsValid = entry.js === undefined || stringArray(entry.js);
    const cssValid = entry.css === undefined || stringArray(entry.css);
    const hasFiles = (Array.isArray(entry.js) && entry.js.length > 0)
      || (Array.isArray(entry.css) && entry.css.length > 0);
    const optionalArraysValid = ["exclude_matches", "include_globs", "exclude_globs"]
      .every(field => entry[field] === undefined || stringArray(entry[field]));
    const optionalBooleansValid = ["all_frames", "match_about_blank", "match_origin_as_fallback"]
      .every(field => entry[field] === undefined || typeof entry[field] === "boolean");
    const runAtValid = entry.run_at === undefined || RUN_AT_VALUES.includes(entry.run_at);
    const worldValid = entry.world === undefined || CONTENT_SCRIPT_WORLDS.includes(entry.world);
    invalid ||= !matchesValid || !jsValid || !cssValid || !hasFiles
      || !optionalArraysValid || !optionalBooleansValid || !runAtValid || !worldValid;
    if (entry.match_origin_as_fallback === true
      && (!matchesValid || entry.matches.some(pattern => !pattern.endsWith("/*")))) {
      invalidOriginFallbackPath = true;
    }
  }
  return { invalid, invalidOriginFallbackPath };
}

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

function unsafeRulesetPath(path) {
  if (!presentString(path)) return true;
  const trimmed = path.trim();
  if (trimmed.startsWith("/") || trimmed.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(trimmed)) return true;
  return trimmed.split(/[\\/]/).some(segment => segment === "..");
}

function actionDiagnostics(action) {
  if (action === undefined) return { declared: false, invalid: false };
  if (!action || typeof action !== "object" || Array.isArray(action)) return { declared: true, invalid: true };
  if (action.default_title !== undefined && typeof action.default_title !== "string") {
    return { declared: true, invalid: true };
  }
  if (action.default_popup !== undefined && unsafeRulesetPath(action.default_popup)) {
    return { declared: true, invalid: true };
  }
  return { declared: true, invalid: false };
}

function optionsDiagnostics(manifest) {
  const pageDeclared = manifest.options_page !== undefined;
  const uiDeclared = manifest.options_ui !== undefined;
  let invalid = false;
  if (pageDeclared && unsafeRulesetPath(manifest.options_page)) invalid = true;
  if (uiDeclared) {
    const ui = manifest.options_ui;
    if (!ui || typeof ui !== "object" || Array.isArray(ui)) {
      invalid = true;
    } else {
      if (unsafeRulesetPath(ui.page)) invalid = true;
      if (ui.open_in_tab !== undefined && typeof ui.open_in_tab !== "boolean") invalid = true;
    }
  }
  return { declared: pageDeclared || uiDeclared, invalid };
}

function sidePanelDiagnostics(sidePanel) {
  if (sidePanel === undefined) return { declared: false, invalid: false };
  if (!sidePanel || typeof sidePanel !== "object" || Array.isArray(sidePanel)) return { declared: true, invalid: true };
  if (unsafeRulesetPath(sidePanel.default_path)) return { declared: true, invalid: true };
  return { declared: true, invalid: false };
}

function devtoolsPageDiagnostics(devtoolsPage) {
  if (devtoolsPage === undefined) return { declared: false, invalid: false };
  if (unsafeRulesetPath(devtoolsPage)) return { declared: true, invalid: true };
  return { declared: true, invalid: false };
}

function omniboxDiagnostics(omnibox) {
  if (omnibox === undefined) return { declared: false, invalid: false };
  if (!omnibox || typeof omnibox !== "object" || Array.isArray(omnibox)) return { declared: true, invalid: true };
  const keys = Object.keys(omnibox);
  if (keys.length !== 1 || keys[0] !== "keyword" || !presentString(omnibox.keyword)) {
    return { declared: true, invalid: true };
  }
  return { declared: true, invalid: false };
}

function sandboxDiagnostics(sandbox) {
  if (sandbox === undefined) return { declared: false, invalid: false };
  if (!sandbox || typeof sandbox !== "object" || Array.isArray(sandbox)) return { declared: true, invalid: true };
  const pages = sandbox.pages;
  if (!Array.isArray(pages) || pages.length === 0) return { declared: true, invalid: true };
  const validPages = pages.every(page => presentString(page) && !unsafeRulesetPath(page));
  const uniquePages = new Set(pages).size === pages.length;
  if (!validPages || !uniquePages) return { declared: true, invalid: true };
  if (sandbox.content_security_policy !== undefined && !presentString(sandbox.content_security_policy)) {
    return { declared: true, invalid: true };
  }
  return { declared: true, invalid: false };
}

function contentSecurityPolicyDiagnostics(csp) {
  if (csp === undefined) {
    return {
      declared: false, invalid: false,
      unsafeEvalExtensionPages: false, sandboxMissingDirective: false, sandboxAllowsSameOrigin: false
    };
  }
  if (!csp || typeof csp !== "object" || Array.isArray(csp)) {
    return {
      declared: true, invalid: true,
      unsafeEvalExtensionPages: false, sandboxMissingDirective: false, sandboxAllowsSameOrigin: false
    };
  }
  const keys = Object.keys(csp);
  const allowedKeys = keys.every(key => key === "extension_pages" || key === "sandbox");
  const extensionPagesValid = csp.extension_pages === undefined || presentString(csp.extension_pages);
  const sandboxValid = csp.sandbox === undefined || presentString(csp.sandbox);
  const invalid = !allowedKeys || !extensionPagesValid || !sandboxValid;
  const unsafeEvalExtensionPages = presentString(csp.extension_pages) && csp.extension_pages.includes("unsafe-eval");
  const sandboxMissingDirective = presentString(csp.sandbox) && !/(?:^|;)\s*sandbox(?:\s|;|$)/.test(csp.sandbox);
  const sandboxAllowsSameOrigin = presentString(csp.sandbox) && csp.sandbox.includes("allow-same-origin");
  return { declared: true, invalid, unsafeEvalExtensionPages, sandboxMissingDirective, sandboxAllowsSameOrigin };
}

function crossOriginPolicyDiagnostics(value) {
  if (value === undefined) return { declared: false, invalid: false };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { declared: true, invalid: true };
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "value" || !presentString(value.value)) {
    return { declared: true, invalid: true };
  }
  return { declared: true, invalid: false };
}

function storageDiagnostics(storage) {
  if (storage === undefined) return { declared: false, invalid: false, invalidManagedSchema: false };
  if (!storage || typeof storage !== "object" || Array.isArray(storage)) {
    return { declared: true, invalid: true, invalidManagedSchema: false };
  }
  const invalidManagedSchema = storage.managed_schema !== undefined && unsafeRulesetPath(storage.managed_schema);
  return { declared: true, invalid: false, invalidManagedSchema };
}

const REQUIREMENTS_3D_FEATURES = new Set(["webgl", "css3d"]);

function requirementsDiagnostics(requirements) {
  if (requirements === undefined) return { declared: false, invalid: false };
  if (!requirements || typeof requirements !== "object" || Array.isArray(requirements)) {
    return { declared: true, invalid: true };
  }
  if (requirements.plugins !== undefined) return { declared: true, invalid: true };
  if (requirements["3D"] !== undefined) {
    const threeD = requirements["3D"];
    if (!threeD || typeof threeD !== "object" || Array.isArray(threeD)) {
      return { declared: true, invalid: true };
    }
    const features = threeD.features;
    if (!Array.isArray(features) || features.length === 0
      || new Set(features).size !== features.length
      || !features.every(feature => REQUIREMENTS_3D_FEATURES.has(feature))) {
      return { declared: true, invalid: true };
    }
  }
  return { declared: true, invalid: false };
}

function validTtsVoice(voice) {
  if (!voice || typeof voice !== "object" || Array.isArray(voice)) return false;
  if (!presentString(voice.voice_name)) return false;
  if (voice.lang !== undefined && !presentString(voice.lang)) return false;
  if (voice.event_types !== undefined) {
    if (!Array.isArray(voice.event_types) || voice.event_types.length === 0) return false;
    if (!voice.event_types.every(type => presentString(type))) return false;
    if (new Set(voice.event_types).size !== voice.event_types.length) return false;
  }
  return true;
}

function ttsEngineDiagnostics(ttsEngine) {
  if (ttsEngine === undefined) return { declared: false, invalid: false };
  if (!ttsEngine || typeof ttsEngine !== "object" || Array.isArray(ttsEngine)) {
    return { declared: true, invalid: true };
  }
  if (!Array.isArray(ttsEngine.voices) || !ttsEngine.voices.every(validTtsVoice)) {
    return { declared: true, invalid: true };
  }
  return { declared: true, invalid: false };
}

function stringOrUniqueStringArray(value) {
  if (value === undefined) return true;
  if (typeof value === "string") return presentString(value);
  if (!Array.isArray(value) || value.length === 0) return false;
  if (!value.every(item => presentString(item))) return false;
  return new Set(value).size === value.length;
}

function validInputComponent(component) {
  if (!component || typeof component !== "object" || Array.isArray(component)) return false;
  if (!presentString(component.name)) return false;
  if (component.id !== undefined && !presentString(component.id)) return false;
  if (!stringOrUniqueStringArray(component.language)) return false;
  if (!stringOrUniqueStringArray(component.layouts)) return false;
  if (component.input_view !== undefined && unsafeRulesetPath(component.input_view)) return false;
  if (component.options_page !== undefined && unsafeRulesetPath(component.options_page)) return false;
  return true;
}

function inputComponentsDiagnostics(value) {
  if (value === undefined) return { declared: false, invalid: false };
  if (!Array.isArray(value) || value.length === 0) return { declared: true, invalid: true };
  let invalid = false;
  const ids = [];
  for (const component of value) {
    if (!validInputComponent(component)) {
      invalid = true;
      continue;
    }
    if (presentString(component.id)) ids.push(component.id);
  }
  if (new Set(ids).size !== ids.length) invalid = true;
  return { declared: true, invalid };
}

const FILE_SYSTEM_PROVIDER_SOURCES = new Set(["file", "device", "network"]);

function fileSystemProviderCapabilitiesDiagnostics(value) {
  if (value === undefined) return { declared: false, invalid: false };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { declared: true, invalid: true };
  }
  if (!FILE_SYSTEM_PROVIDER_SOURCES.has(value.source)) return { declared: true, invalid: true };
  const optionalBooleansValid = ["configurable", "watchable", "multiple_mounts"]
    .every(field => value[field] === undefined || typeof value[field] === "boolean");
  return { declared: true, invalid: !optionalBooleansValid };
}

function oauth2Diagnostics(oauth2) {
  if (oauth2 === undefined) return { declared: false, invalid: false };
  if (!oauth2 || typeof oauth2 !== "object" || Array.isArray(oauth2)) return { declared: true, invalid: true };
  if (!presentString(oauth2.client_id)) return { declared: true, invalid: true };
  const scopes = oauth2.scopes;
  if (!Array.isArray(scopes) || scopes.length === 0) return { declared: true, invalid: true };
  const validScopes = scopes.every(scope => presentString(scope));
  const uniqueScopes = new Set(scopes).size === scopes.length;
  if (!validScopes || !uniqueScopes) return { declared: true, invalid: true };
  return { declared: true, invalid: false };
}

function exportDiagnostics(value) {
  if (value === undefined) return { declared: false, invalid: false };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { declared: true, invalid: true };
  if (value.allowlist !== undefined) {
    const allowlist = value.allowlist;
    if (!Array.isArray(allowlist) || allowlist.length === 0) return { declared: true, invalid: true };
    const validIds = allowlist.every(id => typeof id === "string" && /^[a-p]{32}$/.test(id));
    const uniqueIds = new Set(allowlist).size === allowlist.length;
    if (!validIds || !uniqueIds) return { declared: true, invalid: true };
  }
  return { declared: true, invalid: false };
}

function importDiagnostics(value) {
  if (value === undefined) return { declared: false, invalid: false };
  if (!Array.isArray(value) || value.length === 0) return { declared: true, invalid: true };
  const ids = [];
  let invalid = false;
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      invalid = true;
      continue;
    }
    if (typeof entry.id !== "string" || !/^[a-p]{32}$/.test(entry.id)) {
      invalid = true;
      continue;
    }
    ids.push(entry.id);
    if (entry.minimum_version !== undefined && parseChromeExtensionVersion(entry.minimum_version) === null) {
      invalid = true;
    }
  }
  if (new Set(ids).size !== ids.length) invalid = true;
  return { declared: true, invalid };
}

const LOCALE_TAG_REGEX = /^[a-z]{2,3}(_(?:[A-Za-z]{2}|\d{3}))?$/;

function validLocaleTag(value) {
  return presentString(value) && LOCALE_TAG_REGEX.test(value.trim());
}

function defaultLocaleDiagnostics(defaultLocale) {
  if (defaultLocale === undefined) return { declared: false, invalid: false };
  return { declared: true, invalid: !validLocaleTag(defaultLocale) };
}

function validAbsoluteHttpUrl(value) {
  if (!presentString(value)) return false;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  return true;
}

function absoluteUrlFieldDiagnostics(value) {
  if (value === undefined) return { declared: false, invalid: false };
  return { declared: true, invalid: !validAbsoluteHttpUrl(value) };
}

const INCOGNITO_VALUES = new Set(["spanning", "split", "not_allowed"]);

function incognitoDiagnostics(value) {
  if (value === undefined) return { declared: false, invalid: false };
  return { declared: true, invalid: typeof value !== "string" || !INCOGNITO_VALUES.has(value) };
}

function descriptionDiagnostics(value) {
  if (value === undefined) return { declared: false, invalid: false };
  return { declared: true, invalid: typeof value !== "string" || value.length > 132 };
}

function shortNameDiagnostics(value) {
  if (value === undefined) return { declared: false, invalid: false };
  return { declared: true, invalid: !presentString(value) || value.length > 12 };
}

function versionNameDiagnostics(value) {
  if (value === undefined) return { declared: false, invalid: false };
  return { declared: true, invalid: !presentString(value) };
}

function minimumChromeVersionDiagnostics(value) {
  if (value === undefined) return { declared: false, invalid: false };
  return { declared: true, invalid: parseChromeExtensionVersion(value) === null };
}

const MESSAGE_PLACEHOLDER_REGEX = /__MSG_[A-Za-z0-9_@]+__/;

function localizedFieldsUsingPlaceholders(manifest) {
  const candidates = [
    ["name", manifest.name],
    ["short_name", manifest.short_name],
    ["description", manifest.description],
    ["action.default_title", manifest.action?.default_title],
    ["omnibox.keyword", manifest.omnibox?.keyword]
  ];
  return sortedUnique(
    candidates
      .filter(([, value]) => typeof value === "string" && MESSAGE_PLACEHOLDER_REGEX.test(value))
      .map(([field]) => field)
  );
}

const CHROME_URL_OVERRIDE_KEYS = new Set(["bookmarks", "history", "newtab"]);

function chromeUrlOverridesDiagnostics(overrides) {
  if (overrides === undefined) return { declared: false, invalid: false };
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    return { declared: true, invalid: true };
  }
  const keys = Object.keys(overrides);
  if (keys.length !== 1 || !CHROME_URL_OVERRIDE_KEYS.has(keys[0])) {
    return { declared: true, invalid: true };
  }
  if (unsafeRulesetPath(overrides[keys[0]])) return { declared: true, invalid: true };
  return { declared: true, invalid: false };
}

const CHROME_SETTINGS_OVERRIDE_KEYS = new Set(["homepage", "startup_pages", "search_provider"]);

function chromeSettingsOverridesDiagnostics(value) {
  if (value === undefined) return { declared: false, invalid: false };
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length === 0) {
    return { declared: true, invalid: true };
  }
  const keys = Object.keys(value);
  if (!keys.every(key => CHROME_SETTINGS_OVERRIDE_KEYS.has(key))) {
    return { declared: true, invalid: true };
  }
  if (value.homepage !== undefined && !presentString(value.homepage)) {
    return { declared: true, invalid: true };
  }
  if (value.startup_pages !== undefined) {
    const pages = value.startup_pages;
    if (!Array.isArray(pages) || pages.length !== 1 || !presentString(pages[0])) {
      return { declared: true, invalid: true };
    }
  }
  if (value.homepage === undefined && value.startup_pages === undefined && value.search_provider === undefined) {
    return { declared: true, invalid: true };
  }
  return { declared: true, invalid: false };
}

function backgroundDiagnostics(background) {
  if (background === undefined) return { declared: false, invalid: false };
  if (!background || typeof background !== "object" || Array.isArray(background)
    || Object.keys(background).length === 0) {
    return { declared: true, invalid: true };
  }
  if (!presentString(background.service_worker)) return { declared: true, invalid: true };
  if (background.scripts !== undefined || background.persistent !== undefined) {
    return { declared: true, invalid: true };
  }
  if (unsafeRulesetPath(background.service_worker)) return { declared: true, invalid: true };
  if (background.type !== undefined && background.type !== "module") return { declared: true, invalid: true };
  return { declared: true, invalid: false };
}

function staticRulesetDiagnostics(declarativeNetRequest) {
  if (declarativeNetRequest === undefined) return { declared: false, invalid: false };
  if (!declarativeNetRequest || typeof declarativeNetRequest !== "object" || Array.isArray(declarativeNetRequest)) {
    return { declared: true, invalid: true };
  }
  const ruleResources = declarativeNetRequest.rule_resources;
  if (!Array.isArray(ruleResources) || ruleResources.length === 0) {
    return { declared: true, invalid: true };
  }
  const ids = [];
  let invalid = false;
  for (const ruleset of ruleResources) {
    if (!ruleset || typeof ruleset !== "object" || Array.isArray(ruleset)) {
      invalid = true;
      continue;
    }
    if (!presentString(ruleset.id)) {
      invalid = true;
      continue;
    }
    ids.push(ruleset.id);
    if (typeof ruleset.enabled !== "boolean") invalid = true;
    if (unsafeRulesetPath(ruleset.path)) invalid = true;
  }
  if (new Set(ids).size !== ids.length) invalid = true;
  return { declared: true, invalid };
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
  pushIfChanged(
    "externally_connectable.declared",
    previousManifest.externally_connectable !== undefined,
    currentManifest.externally_connectable !== undefined
  );
  pushIfChanged(
    "externally_connectable.accepts_tls_channel_id",
    typeof previousManifest.externally_connectable?.accepts_tls_channel_id === "boolean"
      ? previousManifest.externally_connectable.accepts_tls_channel_id : null,
    typeof currentManifest.externally_connectable?.accepts_tls_channel_id === "boolean"
      ? currentManifest.externally_connectable.accepts_tls_channel_id : null
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
  const externalConnectionStatus = externallyConnectableDiagnostics(manifest.externally_connectable);
  const permissionsStatus = namedPermissionListDiagnostics(manifest.permissions);
  const optionalPermissionsStatus = namedPermissionListDiagnostics(manifest.optional_permissions);
  const hostPermissionsStatus = hostPermissionListDiagnostics(manifest.host_permissions);
  const optionalHostPermissionsStatus = hostPermissionListDiagnostics(manifest.optional_host_permissions);
  const staticRulesetStatus = staticRulesetDiagnostics(manifest.declarative_net_request);
  const contentScriptStatus = contentScriptDiagnostics(manifest.content_scripts);
  const commandStatus = commandDiagnostics(manifest.commands);
  const backgroundStatus = backgroundDiagnostics(manifest.background);
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
    externalConnectionStatus,
    permissionsStatus,
    optionalPermissionsStatus,
    hostPermissionsStatus,
    optionalHostPermissionsStatus,
    staticRulesetStatus,
    contentScriptStatus,
    commandStatus,
    backgroundStatus,
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
    externalConnectionStatus,
    permissionsStatus,
    optionalPermissionsStatus,
    hostPermissionsStatus,
    optionalHostPermissionsStatus,
    staticRulesetStatus,
    contentScriptStatus,
    commandStatus,
    backgroundStatus,
    unmodeledKeys
  } = manifestSignals(manifest);

  const action = Boolean(manifest.action && typeof manifest.action === "object" && !Array.isArray(manifest.action));
  const actionPopup = presentString(manifest.action?.default_popup);
  const optionsPage = presentString(manifest.options_page)
    || presentString(manifest.options_ui?.page);
  const serviceWorker = backgroundStatus.declared && !backgroundStatus.invalid;
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
  const actionStatus = actionDiagnostics(manifest.action);
  const optionsStatus = optionsDiagnostics(manifest);
  const sidePanelStatus = sidePanelDiagnostics(manifest.side_panel);
  const devtoolsPageStatus = devtoolsPageDiagnostics(manifest.devtools_page);
  const omniboxStatus = omniboxDiagnostics(manifest.omnibox);
  const chromeUrlOverridesStatus = chromeUrlOverridesDiagnostics(manifest.chrome_url_overrides);
  const chromeSettingsOverridesStatus = chromeSettingsOverridesDiagnostics(manifest.chrome_settings_overrides);
  const sandboxStatus = sandboxDiagnostics(manifest.sandbox);
  const contentSecurityPolicyStatus = contentSecurityPolicyDiagnostics(manifest.content_security_policy);
  const oauth2Status = oauth2Diagnostics(manifest.oauth2);
  const coepStatus = crossOriginPolicyDiagnostics(manifest.cross_origin_embedder_policy);
  const coopStatus = crossOriginPolicyDiagnostics(manifest.cross_origin_opener_policy);
  const storageStatus = storageDiagnostics(manifest.storage);
  const exportStatus = exportDiagnostics(manifest.export);
  const importStatus = importDiagnostics(manifest.import);
  const fileBrowserHandlersStatus = fileBrowserHandlersDiagnostics(manifest.file_browser_handlers);
  const requirementsStatus = requirementsDiagnostics(manifest.requirements);
  const ttsEngineStatus = ttsEngineDiagnostics(manifest.tts_engine);
  const fileSystemProviderCapabilitiesStatus = fileSystemProviderCapabilitiesDiagnostics(manifest.file_system_provider_capabilities);
  const inputComponentsStatus = inputComponentsDiagnostics(manifest.input_components);
  const crossOriginPolicies = presentString(manifest.cross_origin_embedder_policy?.value)
    || presentString(manifest.cross_origin_opener_policy?.value);
  const managedStorageSchema = presentString(manifest.storage?.managed_schema);
  const extensionKeyDeclared = presentString(manifest.key);
  const presentationMetadata = [
    "default_locale", "description", "homepage_url", "icons", "short_name", "version_name"
  ].some(key => manifest[key] !== undefined);
  const defaultLocaleStatus = defaultLocaleDiagnostics(manifest.default_locale);
  const homepageUrlStatus = absoluteUrlFieldDiagnostics(manifest.homepage_url);
  const updateUrlStatus = absoluteUrlFieldDiagnostics(manifest.update_url);
  const incognitoStatus = incognitoDiagnostics(manifest.incognito);
  const descriptionStatus = descriptionDiagnostics(manifest.description);
  const shortNameStatus = shortNameDiagnostics(manifest.short_name);
  const versionNameStatus = versionNameDiagnostics(manifest.version_name);
  const minimumChromeVersionStatus = minimumChromeVersionDiagnostics(manifest.minimum_chrome_version);
  const localizedPlaceholderFields = localizedFieldsUsingPlaceholders(manifest);
  const manifestNameDeclared = presentString(manifest.name);
  const validManifestName = manifestNameDeclared && manifest.name.trim().length <= 75;
  const validManifestVersion = parseChromeExtensionVersion(manifest.version) !== null;
  const webAccessibleResourcesDeclared = manifest.web_accessible_resources !== undefined;
  const invalidWebAccessibleResourceCount = webAccessibleResourcesDeclared && !Array.isArray(manifest.web_accessible_resources)
    ? 1
    : (Array.isArray(manifest.web_accessible_resources)
      ? manifest.web_accessible_resources.filter(entry => !validWebAccessibleResource(entry)).length
      : 0);
  const invalidWebAccessibleMatchPath = webAccessibleResources.some(entry =>
    asStrings(entry.matches).some(webAccessibleMatchHasInvalidPath));
  const exposesEntirePackage = webAccessibleResources.some(entry =>
    asStrings(entry.resources).some(resource => resource === "*" || resource === "/*"));
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
  if (requirementsStatus.declared) {
    addLane(lanes, "hardware-requirements", "high",
      "The extension declares a hardware capability requirement that can affect installation compatibility.",
      ["Test installation with supported graphics acceleration", "Test the documented fallback on unsupported hardware", "Recheck compatibility after changing the requirement"]);
  }
  if (exportStatus.declared) {
    addLane(lanes, "shared-module-export", "high",
      "The extension declares a shared-module export boundary that requires compatibility review.",
      ["Confirm every intended importer remains authorized", "Verify exported resources from an unpacked build", "Use a distribution route that supports shared modules"]);
  }
  if (importStatus.declared) {
    addLane(lanes, "shared-module-import", "high",
      "The extension imports shared-module resources that execute with the importing extension's privileges.",
      ["Verify every required module is installed", "Test the minimum supported module version", "Review imported resources before each release"]);
  }
  if (fileBrowserHandlersStatus.declared) {
    addLane(lanes, "chromeos-file-browser-handlers", "high",
      "The extension registers foreground-only file actions on ChromeOS.",
      ["Test each action with matching files", "Verify non-matching files do not expose the action", "Confirm foreground event handling on ChromeOS"]);
  }
  if (fileSystemProviderCapabilitiesStatus.declared) {
    addLane(lanes, "chromeos-file-system-provider", "high",
      "The extension provides a virtual file system on ChromeOS and must preserve mount and watcher behavior.",
      ["Test mounting and unmounting", "Verify configuration and watcher behavior", "Exercise the declared source type on ChromeOS"]);
  }
  if (inputComponentsStatus.declared) {
    addLane(lanes, "chromeos-input-components", "high",
      "The extension registers an input method on ChromeOS and must preserve composition and keyboard behavior.",
      ["Test focus and composition lifecycle", "Verify each declared language and layout", "Confirm optional input and options pages load locally"]);
  }
  if (ttsEngineStatus.declared) {
    addLane(lanes, "text-to-speech-engine", "high",
      "The extension registers text-to-speech voices and must handle speech lifecycle events safely.",
      ["Confirm each declared voice is discoverable", "Exercise start, stop, and completion behavior", "Verify behavior when the required permission is unavailable"]);
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
  if (defaultLocaleStatus.declared && defaultLocaleStatus.invalid) {
    riskFlags.push({ id: "default-locale-invalid", level: "critical", message: "The declared default_locale is not a valid locale tag; use a supported language, language_REGION, or numeric-region form (for example \"en\", \"en_US\", or \"es_419\")." });
  }
  if (localizedPlaceholderFields.length > 0 && (!defaultLocaleStatus.declared || defaultLocaleStatus.invalid)) {
    riskFlags.push({ id: "localized-placeholders-without-default-locale", level: "critical", message: `Manifest fields use __MSG_ message placeholders (${localizedPlaceholderFields.join(", ")}) without a valid default_locale; declare a valid default_locale so these placeholders resolve.` });
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
  if (invalidWebAccessibleResourceCount > 0) {
    riskFlags.push({ id: "web-accessible-resources-invalid", level: "critical", message: "At least one web-accessible resource rule is malformed; require non-empty resources plus non-empty site matches or extension IDs, with an optional boolean dynamic-URL flag." });
  }
  if (invalidWebAccessibleMatchPath) {
    riskFlags.push({ id: "web-accessible-match-path-invalid", level: "critical", message: "A web-accessible resource match pattern uses a path other than /*, which is invalid for this declaration." });
  }
  if (exposesEntirePackage) {
    riskFlags.push({ id: "entire-package-web-accessible", level: "high", message: "A web-accessible resource rule exposes the entire extension package; narrow the resource list and verify fingerprinting and untrusted-page access boundaries." });
  }
  if (externalConnectionStatus.invalid) {
    riskFlags.push({ id: "externally-connectable-invalid", level: "critical", message: "The external-connectability declaration is malformed; use arrays of valid extension IDs or match patterns and an optional boolean TLS-channel-ID flag." });
  }
  if (externalConnectionStatus.invalidAllUrls) {
    riskFlags.push({ id: "externally-connectable-all-urls-invalid", level: "critical", message: "External web messaging cannot use <all_urls>; replace it with explicit valid site match patterns." });
  }
  if (externalConnectionStatus.wildcardIds) {
    riskFlags.push({ id: "all-extensions-connectable", level: "high", message: "External messaging allows every extension and app ID; authenticate every message and narrow the caller set when possible." });
  }
  if (externalConnectionStatus.acceptsTlsChannelId) {
    riskFlags.push({ id: "tls-channel-id-enabled", level: "high", message: "External web messaging accepts TLS channel IDs; verify explicit need, absent-ID behavior, and that identifiers are never logged or exported." });
  }
  if (permissionsStatus.invalid) {
    riskFlags.push({ id: "permissions-invalid", level: "critical", message: "The permissions declaration is malformed; permissions must be an array containing only non-empty strings." });
  }
  if (permissionsStatus.misplacedHostPattern) {
    riskFlags.push({ id: "permissions-host-pattern-misplaced", level: "critical", message: "The permissions array contains a URL-style or <all_urls> host pattern; move host match patterns to host_permissions instead." });
  }
  if (optionalPermissionsStatus.invalid) {
    riskFlags.push({ id: "optional-permissions-invalid", level: "critical", message: "The optional_permissions declaration is malformed; optional_permissions must be an array containing only non-empty strings." });
  }
  if (optionalPermissionsStatus.misplacedHostPattern) {
    riskFlags.push({ id: "optional-permissions-host-pattern-misplaced", level: "critical", message: "The optional_permissions array contains a URL-style or <all_urls> host pattern; move host match patterns to optional_host_permissions instead." });
  }
  if (hostPermissionsStatus.invalid) {
    riskFlags.push({ id: "host-permissions-invalid", level: "critical", message: "The host_permissions declaration is malformed; host_permissions must be an array containing only non-empty, syntactically valid match patterns or <all_urls>." });
  }
  if (optionalHostPermissionsStatus.invalid) {
    riskFlags.push({ id: "optional-host-permissions-invalid", level: "critical", message: "The optional_host_permissions declaration is malformed; optional_host_permissions must be an array containing only non-empty, syntactically valid match patterns or <all_urls>." });
  }
  if (staticRulesetStatus.invalid) {
    riskFlags.push({ id: "static-rulesets-invalid", level: "critical", message: "The declarative net request rule-resources declaration is malformed; require a non-empty array of rulesets with unique non-empty IDs, boolean enabled flags, and safe relative paths." });
  }
  if (contentScriptStatus.invalid) {
    riskFlags.push({ id: "content-scripts-invalid", level: "critical", message: "At least one static content-script declaration is malformed; require page matches plus a non-empty JavaScript or CSS file list and valid optional fields." });
  }
  if (contentScriptStatus.invalidOriginFallbackPath) {
    riskFlags.push({ id: "content-script-origin-fallback-path-invalid", level: "critical", message: "A content script enables origin fallback without using /* paths for every match pattern; narrow and correct the declaration before packaging." });
  }
  if (commandStatus.invalid) {
    riskFlags.push({ id: "commands-invalid", level: "critical", message: "The keyboard-command declaration is malformed; use valid command objects, platform names, case-sensitive keys, modifiers, descriptions, and optional boolean global flags." });
  }
  if (commandStatus.missingDescription) {
    riskFlags.push({ id: "command-description-missing", level: "critical", message: "A standard keyboard command has no non-empty description and may fail manifest validation; descriptions are optional only for the MV3 action command." });
  }
  if (commandStatus.tooManySuggested) {
    riskFlags.push({ id: "too-many-suggested-shortcuts", level: "critical", message: "More than four commands specify suggested shortcuts, exceeding the documented manifest limit; leave additional commands unbound by default." });
  }
  if (commandStatus.deprecatedAction) {
    riskFlags.push({ id: "deprecated-action-command", level: "critical", message: "The manifest uses a Manifest V2 action-command name; replace it with _execute_action for Manifest V3." });
  }
  if (backgroundStatus.invalid) {
    riskFlags.push({ id: "background-service-worker-invalid", level: "critical", message: "The Manifest V3 background declaration is malformed; declare only a non-empty relative service_worker path, omit Manifest V2 scripts and persistent fields, avoid absolute or parent-traversal worker paths, and use only \"module\" for an optional type." });
  }
  if (actionStatus.invalid) {
    riskFlags.push({ id: "action-popup-invalid", level: "critical", message: "The action declaration is malformed; default_title must be a string and default_popup, when declared, must be a non-empty safe relative path without a leading slash, drive letter, or parent-directory traversal." });
  }
  if (optionsStatus.invalid) {
    riskFlags.push({ id: "options-declaration-invalid", level: "critical", message: "The options declaration is malformed; options_page must be a non-empty safe relative path and options_ui must be an object with a non-empty safe relative page plus an optional boolean open_in_tab." });
  }
  if (sidePanelStatus.invalid) {
    riskFlags.push({ id: "side-panel-invalid", level: "critical", message: "The side panel declaration is malformed; side_panel must be an object with a non-empty safe relative default_path, without a leading slash, drive letter, or parent-directory traversal." });
  }
  if (devtoolsPageStatus.invalid) {
    riskFlags.push({ id: "devtools-page-invalid", level: "critical", message: "The devtools_page declaration is malformed; devtools_page must be a non-empty safe relative path, without a leading slash, drive letter, or parent-directory traversal." });
  }
  if (omniboxStatus.invalid) {
    riskFlags.push({ id: "omnibox-invalid", level: "critical", message: "The omnibox declaration is malformed; omnibox must be a non-array object with exactly a non-empty string keyword." });
  }
  if (chromeUrlOverridesStatus.invalid) {
    riskFlags.push({ id: "browser-page-overrides-invalid", level: "critical", message: "The built-in page override declaration is malformed; declare exactly one of bookmarks, history, or newtab mapped to a non-empty safe relative path, without a leading slash, drive letter, or parent-directory traversal." });
  }
  if (chromeSettingsOverridesStatus.invalid) {
    riskFlags.push({ id: "browser-settings-overrides-invalid", level: "critical", message: "The browser settings override declaration is malformed; provide supported homepage, single startup-page, or search-provider fields with the required structure." });
  }
  if (sandboxStatus.invalid) {
    riskFlags.push({ id: "sandbox-invalid", level: "critical", message: "The sandbox declaration is malformed; sandbox must be a non-array object with a non-empty pages array of unique, non-empty safe relative paths, and content_security_policy, if present, must be a non-empty string." });
  }
  if (contentSecurityPolicyStatus.invalid) {
    riskFlags.push({ id: "content-security-policy-invalid", level: "critical", message: "The content_security_policy declaration is malformed; use an object containing only optional non-empty extension_pages and sandbox strings." });
  }
  if (contentSecurityPolicyStatus.unsafeEvalExtensionPages) {
    riskFlags.push({ id: "extension-pages-csp-unsafe-eval", level: "critical", message: "The extension-pages content security policy allows unsafe string evaluation, which is not permitted by the Manifest V3 minimum policy." });
  }
  if (contentSecurityPolicyStatus.sandboxMissingDirective) {
    riskFlags.push({ id: "sandbox-csp-directive-missing", level: "critical", message: "The sandbox content security policy omits the required sandbox directive." });
  }
  if (contentSecurityPolicyStatus.sandboxAllowsSameOrigin) {
    riskFlags.push({ id: "sandbox-csp-allows-same-origin", level: "critical", message: "The sandbox content security policy enables same-origin access and breaks the required unique-origin isolation boundary." });
  }
  if (oauth2Status.invalid) {
    riskFlags.push({ id: "oauth2-declaration-invalid", level: "critical", message: "The oauth2 declaration is malformed; oauth2 must be a non-array object with a non-empty client_id string and a non-empty array of unique, non-empty scope strings." });
  }
  if (coepStatus.invalid) {
    riskFlags.push({ id: "cross-origin-embedder-policy-invalid", level: "critical", message: "The cross_origin_embedder_policy declaration is malformed; it must be a non-array object with exactly one property named value set to a non-empty string." });
  }
  if (coopStatus.invalid) {
    riskFlags.push({ id: "cross-origin-opener-policy-invalid", level: "critical", message: "The cross_origin_opener_policy declaration is malformed; it must be a non-array object with exactly one property named value set to a non-empty string." });
  }
  if (storageStatus.invalid) {
    riskFlags.push({ id: "storage-declaration-invalid", level: "critical", message: "The storage declaration is malformed; storage must be a non-array object." });
  }
  if (storageStatus.invalidManagedSchema) {
    riskFlags.push({ id: "managed-storage-schema-path-invalid", level: "critical", message: "The storage.managed_schema path is malformed; it must be a non-empty safe relative path without a leading slash, drive letter, or parent-directory traversal." });
  }
  if (requirementsStatus.invalid) {
    riskFlags.push({ id: "requirements-declaration-invalid", level: "critical", message: "The requirements declaration is malformed; use a non-array object and, for a 3D requirement, a non-empty unique feature list containing only supported graphics capabilities. Deprecated plugin requirements are not accepted." });
  }
  if (exportStatus.invalid) {
    riskFlags.push({ id: "shared-module-export-invalid", level: "critical", message: "The export declaration is malformed; use a non-array object with an optional non-empty unique allowlist of valid extension identifiers." });
  }
  if (exportStatus.declared) {
    riskFlags.push({ id: "shared-module-store-incompatible", level: "high", message: "Shared modules cannot be submitted through the Chrome Web Store; confirm the intended distribution route before release." });
  }
  if (importStatus.invalid) {
    riskFlags.push({ id: "shared-module-import-invalid", level: "critical", message: "The import declaration is malformed; use a non-empty array of unique valid module identifiers with optional valid minimum versions." });
  }
  if (importStatus.declared) {
    riskFlags.push({ id: "shared-module-import-compatibility", level: "high", message: "Imported shared modules require a compatible external distribution and installation path; verify availability before release." });
  }
  if (fileBrowserHandlersStatus.invalid) {
    riskFlags.push({ id: "file-browser-handlers-invalid", level: "critical", message: "The file_browser_handlers declaration is malformed; provide unique handlers with non-empty identifiers, titles, and unique filesystem filters." });
  }
  if (fileBrowserHandlersStatus.declared && !permissions.includes("fileBrowserHandler") && !optionalPermissions.includes("fileBrowserHandler")) {
    riskFlags.push({ id: "file-browser-handler-permission-missing", level: "high", message: "File browser handlers are declared without the required fileBrowserHandler permission." });
  }
  if (fileSystemProviderCapabilitiesStatus.invalid) {
    riskFlags.push({ id: "file-system-provider-capabilities-invalid", level: "critical", message: "The file_system_provider_capabilities declaration is malformed; provide a supported source and boolean optional capability flags." });
  }
  if (fileSystemProviderCapabilitiesStatus.declared && !permissions.includes("fileSystemProvider") && !optionalPermissions.includes("fileSystemProvider")) {
    riskFlags.push({ id: "file-system-provider-permission-missing", level: "high", message: "File system provider capabilities are declared without the required fileSystemProvider permission." });
  }
  if (inputComponentsStatus.invalid) {
    riskFlags.push({ id: "input-components-invalid", level: "critical", message: "The input_components declaration is malformed; provide valid named components with correctly typed optional identifiers, languages, layouts, and safe local page paths." });
  }
  if (inputComponentsStatus.declared && !permissions.includes("input") && !optionalPermissions.includes("input")) {
    riskFlags.push({ id: "input-components-permission-missing", level: "high", message: "Input components are declared without the required input permission." });
  }
  if (presentString(manifest.description) && manifest.description.length > 132) {
    riskFlags.push({ id: "description-too-long", level: "medium", message: "The manifest description exceeds the documented 132-character limit." });
  }
  if (presentString(manifest.short_name) && manifest.short_name.length > 12) {
    riskFlags.push({ id: "short-name-too-long", level: "medium", message: "The manifest short_name exceeds the documented 12-character maximum." });
  }
  if (ttsEngineStatus.invalid) {
    riskFlags.push({ id: "tts-engine-declaration-invalid", level: "critical", message: "The tts_engine declaration is malformed; provide a voices array whose entries have a non-empty voice name and correctly typed optional language and unique event declarations." });
  }
  if (ttsEngineStatus.declared && !permissions.includes("ttsEngine") && !optionalPermissions.includes("ttsEngine")) {
    riskFlags.push({ id: "tts-engine-permission-missing", level: "high", message: "A text-to-speech engine is declared without the required ttsEngine permission; add the permission or remove the declaration." });
  }
  if (unmodeledKeys.length > 0) {
    riskFlags.push({
      id: "unmodeled-manifest-keys",
      level: "high",
      message: `Coverage gap: top-level manifest keys are present but not interpreted: ${unmodeledKeys.join(", ")}. Add manual coverage before relying on this plan.`
    });
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
  if (homepageUrlStatus.invalid) {
    riskFlags.push({ id: "homepage-url-invalid", level: "critical", message: "The homepage_url declaration is invalid; when present it must be a non-empty absolute http or https URL without a username or password." });
  }
  if (updateUrlStatus.invalid) {
    riskFlags.push({ id: "update-url-invalid", level: "critical", message: "The update_url declaration is invalid; when present it must be a non-empty absolute http or https URL without a username or password." });
  }
  if (incognitoStatus.invalid) {
    riskFlags.push({ id: "incognito-value-invalid", level: "critical", message: "The incognito declaration is invalid; when present it must be exactly \"spanning\", \"split\", or \"not_allowed\"." });
  }
  if (descriptionStatus.invalid) {
    riskFlags.push({ id: "description-invalid", level: "critical", message: "The description declaration is invalid; when present it must be a string no longer than 132 characters." });
  }
  if (shortNameStatus.invalid) {
    riskFlags.push({ id: "short-name-invalid", level: "critical", message: "The short_name declaration is invalid; when present it must be a non-empty string no longer than 12 characters." });
  }
  if (versionNameStatus.invalid) {
    riskFlags.push({ id: "version-name-invalid", level: "critical", message: "The version_name declaration is invalid; when present it must be a non-empty string." });
  }
  if (minimumChromeVersionStatus.invalid) {
    riskFlags.push({ id: "minimum-browser-version-invalid", level: "critical", message: "The minimum browser version declaration is invalid; use one to four dot-separated integers following browser version syntax." });
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
    || declarations.length > 0
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
  if (declarations.some(change => change.field === "externally_connectable.declared")) {
    findings.push({
      id: "external-connectability-policy-change",
      level: "critical",
      message: "The external-connectability policy was added or removed. Verify cross-extension compatibility because the undeclared default allows extension callers while a declared empty policy allows none."
    });
  }
  if (declarations.some(change => change.field === "externally_connectable.accepts_tls_channel_id")) {
    findings.push({
      id: "tls-channel-id-policy-change",
      level: "high",
      message: "The TLS-channel-ID acceptance policy changed. Verify opt-in callers, missing identifiers, and zero logging or export of identifiers."
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
