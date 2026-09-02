// Small, hard-coded, valid MV3 manifests used only for the built-in
// "try an example" flows below. These never leave the browser except via
// the same local /api/analyze and /api/compare requests used for real files.
const EXAMPLE_ANALYSIS_MANIFEST = {
  manifest_version: 3,
  name: "Built-in example extension",
  version: "1.0.0",
  permissions: ["storage", "notifications"],
  optional_permissions: ["nativeMessaging", "userScripts"],
  host_permissions: ["https://example.com/*"],
  background: { service_worker: "worker.js" },
  action: { default_popup: "popup.html" },
  options_page: "options.html",
  content_scripts: [
    { matches: ["https://example.com/*"], js: ["content.js"] }
  ],
  commands: {
    "toggle-feature": {
      suggested_key: { default: "Ctrl+Shift+Y" },
      description: "Toggle the example feature"
    }
  },
  omnibox: { keyword: "mv3" },
  sandbox: { pages: ["sandbox.html"] }
};

const EXAMPLE_PREVIOUS_MANIFEST = {
  manifest_version: 3,
  name: "Built-in example extension",
  version: "1.0.0",
  permissions: ["storage"],
  host_permissions: ["https://example.com/*"],
  background: { service_worker: "worker.js" },
  action: { default_popup: "popup.html" }
};

const EXAMPLE_CANDIDATE_MANIFEST = {
  manifest_version: 3,
  name: "Built-in example extension",
  version: "2.0.0",
  permissions: ["storage", "tabCapture"],
  host_permissions: ["https://example.com/*", "<all_urls>"],
  background: { service_worker: "worker.js" },
  action: { default_popup: "popup.html" }
};

const form = document.getElementById("analyze-form");
const feedbackTemplateButton = document.getElementById("download-feedback-template");
const feedbackTemplateStatusEl = document.getElementById("feedback-template-status");
const analyzeSubmitButton = document.getElementById("analyze-submit");
const analyzeExampleButton = document.getElementById("analyze-example-button");
const fileInput = document.getElementById("manifest-file");
const folderInput = document.getElementById("manifest-folder");
const statusEl = document.getElementById("status");
const reportEl = document.getElementById("report");
const reportSummaryEl = document.getElementById("report-summary");
const analysisReadinessEl = document.getElementById("analysis-readiness");
const reportDetailsEl = document.getElementById("report-details");
const analysisFilterControlsEl = document.getElementById("analysis-filter-controls");
const analysisSeverityFilterEl = document.getElementById("analysis-severity-filter");
const analysisFilterStatusEl = document.getElementById("analysis-filter-status");
const analysisFindingSearchEl = document.getElementById("analysis-finding-search");
const analysisTriageControlsEl = document.getElementById("analysis-triage-controls");
const analysisTriageFilterEl = document.getElementById("analysis-triage-filter");
const analysisTriageFilterStatusEl = document.getElementById("analysis-triage-filter-status");
const resetAnalysisTriageButton = document.getElementById("reset-analysis-triage");
const reportExpandAllButton = document.getElementById("report-expand-all");
const reportCollapseAllButton = document.getElementById("report-collapse-all");
const printReportButton = document.getElementById("print-report-button");
const recentRunsEl = document.getElementById("recent-runs");
const recentRunsListEl = document.getElementById("recent-runs-list");

const mainHeadingEl = document.getElementById("main-heading");
const backToTopButton = document.getElementById("back-to-top-button");
const modeTabInspectButton = document.getElementById("mode-tab-inspect");
const modeTabCompareButton = document.getElementById("mode-tab-compare");
const inspectPanelEl = document.getElementById("inspect-panel");
const comparePanelEl = document.getElementById("compare-panel");
const reportHeadingEl = document.getElementById("report-heading");
const compareReportHeadingEl = document.getElementById("compare-report-heading");
const reportJumpNavEl = document.getElementById("report-jump-nav");
const compareJumpNavEl = document.getElementById("compare-jump-nav");
const jumpFindingsLink = document.getElementById("jump-findings");
const jumpChecklistLink = document.getElementById("jump-checklist");
const compareJumpFindingsLink = document.getElementById("compare-jump-findings");
const compareJumpChecklistLink = document.getElementById("compare-jump-checklist");

const checklistEl = document.getElementById("checklist");
const checklistListEl = document.getElementById("checklist-list");
const checklistProgressEl = document.getElementById("checklist-progress");
const checklistControlsEl = document.getElementById("checklist-controls");
const checklistFilterEl = document.getElementById("checklist-filter");
const checklistFilterStatusEl = document.getElementById("checklist-filter-status");
const resetChecklistButton = document.getElementById("reset-checklist");
const checklistAddInputEl = document.getElementById("checklist-add-input");
const checklistAddButtonEl = document.getElementById("checklist-add-button");
const checklistAddStatusEl = document.getElementById("checklist-add-status");
const exportButton = document.getElementById("export-checklist");
const exportMarkdownButton = document.getElementById("export-checklist-markdown");
const exportAnalysisSafeSummaryButton = document.getElementById("export-analysis-safe-summary");
const exportStatusEl = document.getElementById("export-status");

// Checklist state exists only for the lifetime of this page.
let currentReport = null;
let checklistState = [];
let checklistCustomCounter = 0;
let analysisFindingNodes = [];
let analysisCollapsibleSections = [];
let analysisFindingsContentEl = null;

// In-memory-only recent run history: at most five structural, timestamp-free
// summaries. Rerun replays an already-held manifest reference; nothing is
// re-read from disk or persisted across page reloads.
const MAX_RECENT_RUNS = 5;
let recentRuns = [];

const manifestFileFieldEl = document.getElementById("manifest-file-field");
const manifestFileStatusEl = document.getElementById("manifest-file-status");
const manifestFolderStatusEl = document.getElementById("manifest-folder-status");
const pasteJsonButton = document.getElementById("analyze-paste-button");
const pasteJsonPanelEl = document.getElementById("paste-json-panel");
const pasteJsonTargetEl = document.getElementById("paste-json-target");
const pasteJsonTextareaEl = document.getElementById("paste-json-textarea");
const pasteJsonConfirmButton = document.getElementById("paste-json-confirm");
const pasteJsonCancelButton = document.getElementById("paste-json-cancel");
const pasteJsonStatusEl = document.getElementById("paste-json-status");
const clearWorkspaceButton = document.getElementById("clear-workspace-button");
const clearWorkspaceStatusEl = document.getElementById("clear-workspace-status");

const preferenceThemeEl = document.getElementById("preference-theme");
const preferenceDensityEl = document.getElementById("preference-density");
const preferenceTextSizeEl = document.getElementById("preference-text-size");
const preferenceReducedMotionEl = document.getElementById("preference-reduced-motion");
const preferenceHighContrastEl = document.getElementById("preference-high-contrast");
const displayPreferencesStatusEl = document.getElementById("display-preferences-status");

// Display preferences are applied as documented attributes on the root
// element only. They are never persisted (no storage, cookies, or network
// calls) and never affect report or export data; they reset to defaults on
// clear workspace or page reload.
const systemReducedMotionQuery = typeof window.matchMedia === "function"
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : null;

function applyDisplayPreferences() {
  const root = document.documentElement;
  root.setAttribute("data-theme", preferenceThemeEl.value);
  root.setAttribute("data-density", preferenceDensityEl.value);
  root.setAttribute("data-text-size", preferenceTextSizeEl.value);
  root.setAttribute("data-reduced-motion", String(preferenceReducedMotionEl.checked));
  root.setAttribute("data-high-contrast", String(preferenceHighContrastEl.checked));
}

function resetDisplayPreferences() {
  preferenceThemeEl.value = "system";
  preferenceDensityEl.value = "comfortable";
  preferenceTextSizeEl.value = "normal";
  preferenceReducedMotionEl.checked = Boolean(systemReducedMotionQuery && systemReducedMotionQuery.matches);
  preferenceHighContrastEl.checked = false;
  applyDisplayPreferences();
  displayPreferencesStatusEl.textContent = "";
}

[preferenceThemeEl, preferenceDensityEl, preferenceTextSizeEl].forEach(select => {
  select.addEventListener("change", () => {
    applyDisplayPreferences();
    displayPreferencesStatusEl.textContent = "Display preference applied for this tab only.";
  });
});
[preferenceReducedMotionEl, preferenceHighContrastEl].forEach(checkbox => {
  checkbox.addEventListener("change", () => {
    applyDisplayPreferences();
    displayPreferencesStatusEl.textContent = "Display preference applied for this tab only.";
  });
});

resetDisplayPreferences();

// Manifests imported via the paste-JSON panel for the compare sides. These
// live only in memory for the lifetime of this page and are never rendered
// back as raw text once imported.
let pastedPreviousManifest = null;
let pastedCurrentManifest = null;

const compareForm = document.getElementById("compare-form");
const compareSubmitButton = document.getElementById("compare-submit");
const compareExampleButton = document.getElementById("compare-example-button");
const previousFileInput = document.getElementById("previous-manifest-file");
const previousFolderInput = document.getElementById("previous-manifest-folder");
const candidateFileInput = document.getElementById("candidate-manifest-file");
const candidateFolderInput = document.getElementById("candidate-manifest-folder");
const compareStatusEl = document.getElementById("compare-status");
const compareReportEl = document.getElementById("compare-report");
const compareReportSummaryEl = document.getElementById("compare-report-summary");
const comparisonReadinessEl = document.getElementById("comparison-readiness");
const compareReportDetailsEl = document.getElementById("compare-report-details");
const comparisonFilterControlsEl = document.getElementById("comparison-filter-controls");
const comparisonSeverityFilterEl = document.getElementById("comparison-severity-filter");
const comparisonFilterStatusEl = document.getElementById("comparison-filter-status");
const comparisonChangeFilterControlsEl = document.getElementById("comparison-change-filter-controls");
const comparisonChangeFilterEl = document.getElementById("comparison-change-filter");
const comparisonChangedOnlyEl = document.getElementById("comparison-changed-only");
const comparisonChangeFilterStatusEl = document.getElementById("comparison-change-filter-status");
const comparisonFindingSearchEl = document.getElementById("comparison-finding-search");
const comparisonTriageControlsEl = document.getElementById("comparison-triage-controls");
const comparisonTriageFilterEl = document.getElementById("comparison-triage-filter");
const comparisonTriageFilterStatusEl = document.getElementById("comparison-triage-filter-status");
const resetComparisonTriageButton = document.getElementById("reset-comparison-triage");
const compareReportExpandAllButton = document.getElementById("compare-report-expand-all");
const compareReportCollapseAllButton = document.getElementById("compare-report-collapse-all");

const previousManifestFileFieldEl = document.getElementById("previous-manifest-file-field");
const candidateManifestFileFieldEl = document.getElementById("candidate-manifest-file-field");
const previousManifestFileStatusEl = document.getElementById("previous-manifest-file-status");
const previousManifestFolderStatusEl = document.getElementById("previous-manifest-folder-status");
const candidateManifestFileStatusEl = document.getElementById("candidate-manifest-file-status");
const candidateManifestFolderStatusEl = document.getElementById("candidate-manifest-folder-status");
const swapCompareButton = document.getElementById("swap-compare-button");

const candidateChecklistEl = document.getElementById("candidate-checklist");
const candidateChecklistListEl = document.getElementById("candidate-checklist-list");
const candidateChecklistProgressEl = document.getElementById("candidate-checklist-progress");
const candidateChecklistControlsEl = document.getElementById("candidate-checklist-controls");
const candidateChecklistFilterEl = document.getElementById("candidate-checklist-filter");
const candidateChecklistFilterStatusEl = document.getElementById("candidate-checklist-filter-status");
const resetCandidateChecklistButton = document.getElementById("reset-candidate-checklist");
const candidateChecklistAddInputEl = document.getElementById("candidate-checklist-add-input");
const candidateChecklistAddButtonEl = document.getElementById("candidate-checklist-add-button");
const candidateChecklistAddStatusEl = document.getElementById("candidate-checklist-add-status");
const exportComparisonButton = document.getElementById("export-comparison");
const exportComparisonMarkdownButton = document.getElementById("export-comparison-markdown");
const exportComparisonSafeSummaryButton = document.getElementById("export-comparison-safe-summary");
const exportComparisonStatusEl = document.getElementById("export-comparison-status");

// Candidate checklist state exists only for the lifetime of this page.
let currentCompareReport = null;
let currentCandidateAnalysis = null;
let candidateChecklistState = [];
let candidateChecklistCustomCounter = 0;
let comparisonFindingNodes = [];
let comparisonChangeSectionNodes = [];
let comparisonCollapsibleSections = [];
let comparisonFindingsContentEl = null;

// Both result panels start hidden until their respective local analysis or
// comparison has actually run, so shortcuts and other visibility checks never
// mistake an untouched panel for a rendered one.
reportEl.hidden = true;
compareReportEl.hidden = true;

function setStatus(message) {
  statusEl.textContent = message;
}

// Focuses a status/heading element that is programmatically focusable
// (tabindex="-1") without adding a history entry or changing the URL, since
// focus() never touches location.hash or the history API.
function focusElement(target) {
  if (target && target.focus) target.focus();
}

// Moves keyboard/document focus back to the page's single top-level heading
// without scrolling via a URL fragment (which would add a history entry),
// so back-to-top behaves like a plain in-page focus move.
backToTopButton.addEventListener("click", () => {
  if (typeof window !== "undefined" && window.scrollTo) {
    try {
      window.scrollTo(0, 0);
    } catch {
      // Some test/DOM environments do not implement scrollTo; focus below
      // still moves keyboard focus back to the top heading.
    }
  }
  focusElement(mainHeadingEl);
});

// Inspect/Compare mode tabs show exactly one workflow form at a time. All
// in-memory state (reports, checklists, filters, pasted manifests) lives
// outside these panels and is untouched by switching tabs, so switching
// modes never loses anything already entered or rendered.
function setWorkflowMode(mode) {
  const inspectActive = mode !== "compare";
  modeTabInspectButton.setAttribute("aria-selected", inspectActive ? "true" : "false");
  modeTabInspectButton.tabIndex = inspectActive ? 0 : -1;
  modeTabCompareButton.setAttribute("aria-selected", inspectActive ? "false" : "true");
  modeTabCompareButton.tabIndex = inspectActive ? -1 : 0;
  inspectPanelEl.hidden = !inspectActive;
  comparePanelEl.hidden = inspectActive;
}

function handleModeTabClick(mode) {
  setWorkflowMode(mode);
  const activeTab = mode === "compare" ? modeTabCompareButton : modeTabInspectButton;
  focusElement(activeTab);
}

modeTabInspectButton.addEventListener("click", () => handleModeTabClick("inspect"));
modeTabCompareButton.addEventListener("click", () => handleModeTabClick("compare"));

const workflowModeTabs = [modeTabInspectButton, modeTabCompareButton];
for (const tab of workflowModeTabs) {
  tab.addEventListener("keydown", event => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    if (event.preventDefault) event.preventDefault();
    const currentIndex = workflowModeTabs.indexOf(tab);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const nextTab = workflowModeTabs[(currentIndex + step + workflowModeTabs.length) % workflowModeTabs.length];
    handleModeTabClick(nextTab === modeTabCompareButton ? "compare" : "inspect");
  });
}

setWorkflowMode("inspect");

// Hides a result-specific jump link when its target section is not
// currently meaningful (e.g. no findings, or an empty checklist), so the
// jump navigation only ever offers targets that actually exist right now.
function updateInspectJumpNav() {
  if (!currentReport) {
    reportJumpNavEl.hidden = true;
    return;
  }
  reportJumpNavEl.hidden = false;
  jumpFindingsLink.hidden = !currentReport.riskFlags || currentReport.riskFlags.length === 0;
  jumpChecklistLink.hidden = checklistState.length === 0;
}

function updateCompareJumpNav() {
  if (!currentCompareReport) {
    compareJumpNavEl.hidden = true;
    return;
  }
  compareJumpNavEl.hidden = false;
  compareJumpFindingsLink.hidden = !currentCompareReport.findings || currentCompareReport.findings.length === 0;
  compareJumpChecklistLink.hidden = candidateChecklistState.length === 0;
}

updateInspectJumpNav();
updateCompareJumpNav();

// Keeps a file input and its matching folder input mutually exclusive so the
// selected manifest source is always unambiguous.
function linkMutuallyExclusiveInputs(primaryInput, otherInput) {
  primaryInput.addEventListener("change", () => {
    if (primaryInput.files.length > 0) otherInput.value = "";
  });
}

linkMutuallyExclusiveInputs(fileInput, folderInput);
linkMutuallyExclusiveInputs(folderInput, fileInput);
linkMutuallyExclusiveInputs(previousFileInput, previousFolderInput);
linkMutuallyExclusiveInputs(previousFolderInput, previousFileInput);
linkMutuallyExclusiveInputs(candidateFileInput, candidateFolderInput);
linkMutuallyExclusiveInputs(candidateFolderInput, candidateFileInput);

// Sets an accessible, fixed-wording status for a single input without ever
// revealing the selected filename or any manifest-controlled value.
function setInputStatus(statusEl, state, message) {
  statusEl.setAttribute("data-status", state);
  statusEl.textContent = message;
}

function looksLikeJsonFile(file) {
  if (!file) return false;
  if (file.type === "application/json") return true;
  const name = String(file.name || "").toLowerCase();
  return name.endsWith(".json");
}

// Keeps a file input's status text in sync with selection state, using only
// fixed, non-identifying wording (empty/ready/invalid).
function wireFileInputStatus(input, statusEl, emptyText, kind, onSelected) {
  input.addEventListener("change", () => {
    const file = input.files[0];
    if (!file) {
      setInputStatus(statusEl, "empty", emptyText);
      return;
    }
    if (!looksLikeJsonFile(file)) {
      setInputStatus(statusEl, "invalid", `Selected ${kind} does not look like a .json file.`);
      return;
    }
    if (onSelected) onSelected();
    setInputStatus(statusEl, "ready", `${kind} selected — ready to process.`);
  });
}

wireFileInputStatus(fileInput, manifestFileStatusEl, "No file selected.", "manifest file");
wireFileInputStatus(folderInput, manifestFolderStatusEl, "No folder selected.", "folder");
wireFileInputStatus(previousFileInput, previousManifestFileStatusEl, "No file selected.", "previous manifest file", () => { pastedPreviousManifest = null; });
wireFileInputStatus(previousFolderInput, previousManifestFolderStatusEl, "No folder selected.", "previous folder", () => { pastedPreviousManifest = null; });
wireFileInputStatus(candidateFileInput, candidateManifestFileStatusEl, "No file selected.", "candidate manifest file", () => { pastedCurrentManifest = null; });
wireFileInputStatus(candidateFolderInput, candidateManifestFolderStatusEl, "No folder selected.", "candidate folder", () => { pastedCurrentManifest = null; });

// Wires a drop target so a single dropped .json file is accepted into the
// given file input and any mutually exclusive folder input is cleared.
// Multiple files or non-JSON files fail locally with fixed, accessible text.
function setupDropZone(zoneEl, fileInput, otherInput, statusEl, kind, onAccepted) {
  zoneEl.addEventListener("dragover", event => {
    if (event.preventDefault) event.preventDefault();
  });
  zoneEl.addEventListener("drop", event => {
    if (event.preventDefault) event.preventDefault();
    const dataTransfer = event.dataTransfer;
    const files = dataTransfer && dataTransfer.files ? Array.from(dataTransfer.files) : [];
    if (files.length !== 1) {
      setInputStatus(statusEl, "invalid", "Drop exactly one manifest.json file.");
      return;
    }
    const file = files[0];
    if (!looksLikeJsonFile(file)) {
      setInputStatus(statusEl, "invalid", "Only a .json file can be dropped here.");
      return;
    }
    try {
      fileInput.files = dataTransfer.files;
    } catch {
      // Some environments do not allow programmatic assignment of dropped
      // files; the status below still reflects the drop outcome.
    }
    if (otherInput) otherInput.value = "";
    if (onAccepted) onAccepted();
    setInputStatus(statusEl, "ready", `${kind} dropped — ready to process.`);
  });
}

setupDropZone(manifestFileFieldEl, fileInput, folderInput, manifestFileStatusEl, "Manifest file");
setupDropZone(previousManifestFileFieldEl, previousFileInput, previousFolderInput, previousManifestFileStatusEl, "Previous manifest file", () => { pastedPreviousManifest = null; });
setupDropZone(candidateManifestFileFieldEl, candidateFileInput, candidateFolderInput, candidateManifestFileStatusEl, "Candidate manifest file", () => { pastedCurrentManifest = null; });

// Disables a submit control, marks it and its form as busy, and shows a
// plain-language loading label. Callers must always pass isLoading=false in
// a finally block so controls are restored after success or failure.
function setSubmitLoading(button, formEl, isLoading, loadingLabel, defaultLabel) {
  button.disabled = isLoading;
  button.setAttribute("aria-busy", isLoading ? "true" : "false");
  formEl.setAttribute("aria-busy", isLoading ? "true" : "false");
  button.textContent = isLoading ? loadingLabel : defaultLabel;
}

function setActionGroupLoading(primaryButton, exampleButton, formEl, isLoading, loadingLabel, defaultLabel) {
  setSubmitLoading(primaryButton, formEl, isLoading, loadingLabel, defaultLabel);
  exampleButton.disabled = isLoading;
  exampleButton.setAttribute("aria-busy", isLoading ? "true" : "false");
}

function countByLevel(items) {
  const counts = {};
  for (const item of items) {
    counts[item.level] = (counts[item.level] || 0) + 1;
  }
  return counts;
}

function renderCountBadges(container, counts) {
  const levels = Object.keys(counts);
  if (levels.length === 0) {
    container.appendChild(el("span", { className: "badge badge-ok", text: "0 findings" }));
    return;
  }
  for (const level of levels) {
    container.appendChild(el("span", {
      className: `badge badge-${level}`,
      text: `${level}: ${counts[level]}`
    }));
  }
}

function renderAnalysisSummary(report) {
  reportSummaryEl.textContent = "";

  const identity = el("p", {
    text: `${report.identity.name} — v${report.identity.version} (MV${report.identity.manifestVersion})`
  });
  reportSummaryEl.appendChild(identity);

  const badgeRow = el("div", { className: "badge-row" });
  renderCountBadges(badgeRow, countByLevel(report.riskFlags));
  reportSummaryEl.appendChild(badgeRow);

  const laneCount = report.lanes.length;
  reportSummaryEl.appendChild(el("p", {
    text: `${laneCount} test lane${laneCount === 1 ? "" : "s"} derived from this manifest.`
  }));

  const requiresManualValidation = report.riskFlags.some(flag => flag.level === "critical");
  const manualBadge = el("span", {
    className: `badge ${requiresManualValidation ? "badge-critical" : "badge-ok"}`,
    text: requiresManualValidation ? "Manual validation required" : "No manual validation required"
  });
  reportSummaryEl.appendChild(el("p", {}, [manualBadge]));
}

function renderComparisonSummary(report) {
  compareReportSummaryEl.textContent = "";

  compareReportSummaryEl.appendChild(el("p", {
    text: `${report.from.name} v${report.from.version} → ${report.to.name} v${report.to.version}`
  }));
  compareReportSummaryEl.appendChild(el("p", {
    text: `Chrome update version status: ${report.changes.version.relation}.`
  }));

  const badgeRow = el("div", { className: "badge-row" });
  renderCountBadges(badgeRow, countByLevel(report.findings));
  compareReportSummaryEl.appendChild(badgeRow);

  const changeCount = countComparisonChanges(report.changes);
  compareReportSummaryEl.appendChild(el("p", {
    text: `${changeCount} structured change record${changeCount === 1 ? "" : "s"} across version, access, scripts, rules, surfaces, and declarations.`
  }));
  const breakdown = comparisonChangeBreakdown(report.changes)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${count}`)
    .join("; ");
  compareReportSummaryEl.appendChild(el("p", {
    text: breakdown ? `Breakdown: ${breakdown}.` : "Breakdown: no structured changes."
  }));

  const manualBadge = el("span", {
    className: `badge ${report.requiresManualUpdateValidation ? "badge-critical" : "badge-ok"}`,
    text: report.requiresManualUpdateValidation
      ? "Manual validation required"
      : "No manual validation required"
  });
  compareReportSummaryEl.appendChild(el("p", {}, [manualBadge]));
}

function countListDiff(diff) {
  return (diff?.added?.length || 0) + (diff?.removed?.length || 0);
}

function countComparisonChanges(changes) {
  return comparisonChangeBreakdown(changes)
    .reduce((total, [, count]) => total + count, 0);
}

function comparisonChangeBreakdown(changes) {
  let access = 0;
  for (const key of [
    "requiredPermissions", "optionalPermissions", "requiredHosts", "optionalHosts",
    "oauthScopes"
  ]) {
    access += countListDiff(changes[key]);
  }
  access += countListDiff({
    added: changes.permissionTransitions?.optionalToRequired,
    removed: changes.permissionTransitions?.requiredToOptional
  });
  access += countListDiff({
    added: changes.hostTransitions?.optionalToRequired,
    removed: changes.hostTransitions?.requiredToOptional
  });
  const scripts = countListDiff(changes.contentScriptMatches) + countListDiff(changes.contentScripts);
  const rules = (changes.staticRulesets?.added?.length || 0)
    + (changes.staticRulesets?.removed?.length || 0)
    + (changes.staticRulesets?.changed?.length || 0);
  const externalBoundaries = countListDiff(changes.externalMessaging?.matches)
    + countListDiff(changes.externalMessaging?.ids)
    + countListDiff(changes.webAccessibleResources);
  return [
    ["version", changes.version?.previous !== changes.version?.current ? 1 : 0],
    ["access", access],
    ["scripts", scripts],
    ["commands", countListDiff(changes.commands)],
    ["rules", rules],
    ["external boundaries", externalBoundaries],
    ["surfaces", countListDiff(changes.surfaces)],
    ["declarations", changes.declarations?.length || 0],
    ["identity", changes.extensionKey?.changed ? 1 : 0],
    ["coverage gaps", (changes.unmodeledTopLevelKeys?.added?.length || 0)
      + (changes.unmodeledTopLevelKeys?.removed?.length || 0)
      + (changes.unmodeledTopLevelKeys?.changed?.length || 0)]
  ];
}

function setReadiness(container, state, title, detail) {
  container.className = `readiness readiness-${state}`;
  container.textContent = "";
  container.appendChild(el("strong", { text: title }));
  container.appendChild(el("span", { text: detail }));
}

function updateAnalysisReadiness() {
  if (!currentReport) {
    analysisReadinessEl.textContent = "";
    return;
  }
  const criticalEntries = analysisFindingNodes.filter(entry => entry.level === "critical");
  const criticalCount = criticalEntries.length;
  const acknowledgedCriticalCount = criticalEntries.filter(entry => entry.acknowledged).length;
  const remaining = checklistState.filter(item => !item.done).length;
  if (criticalCount > 0 && acknowledgedCriticalCount === criticalCount) {
    setReadiness(
      analysisReadinessEl,
      "acknowledged",
      "Critical findings acknowledged",
      `All ${criticalCount} critical finding${criticalCount === 1 ? "" : "s"} acknowledged. This is not the same as resolved — manual review is still required.`
    );
  } else if (criticalCount > 0) {
    setReadiness(
      analysisReadinessEl,
      "blocked",
      "Review required",
      `${criticalCount} critical finding${criticalCount === 1 ? "" : "s"} must be reviewed before browser testing (${acknowledgedCriticalCount} acknowledged).`
    );
  } else if (remaining > 0) {
    setReadiness(
      analysisReadinessEl,
      "pending",
      "Checklist in progress",
      `${remaining} manual check${remaining === 1 ? "" : "s"} remaining before browser testing.`
    );
  } else {
    setReadiness(
      analysisReadinessEl,
      "ready",
      "Ready for manual browser testing",
      "The static checklist is complete. This does not mean the extension has passed runtime testing."
    );
  }
}

function updateComparisonReadiness() {
  if (!currentCompareReport) {
    comparisonReadinessEl.textContent = "";
    return;
  }
  const remaining = candidateChecklistState.filter(item => !item.done).length;
  const criticalEntries = comparisonFindingNodes.filter(entry => entry.level === "critical");
  const criticalCount = criticalEntries.length;
  const acknowledgedCriticalCount = criticalEntries.filter(entry => entry.acknowledged).length;
  if (currentCompareReport.requiresManualUpdateValidation && criticalCount > 0 && acknowledgedCriticalCount === criticalCount) {
    setReadiness(
      comparisonReadinessEl,
      "acknowledged",
      "Critical comparison findings acknowledged",
      `All ${criticalCount} critical finding${criticalCount === 1 ? "" : "s"} acknowledged. This is not the same as resolved — manual update-path validation is still required.`
    );
  } else if (currentCompareReport.requiresManualUpdateValidation) {
    setReadiness(
      comparisonReadinessEl,
      "blocked",
      "Update-path validation required",
      "A critical comparison finding requires a manual update test before this candidate can move forward."
    );
  } else if (remaining > 0) {
    setReadiness(
      comparisonReadinessEl,
      "pending",
      "Candidate checklist in progress",
      `${remaining} manual check${remaining === 1 ? "" : "s"} remaining before browser testing.`
    );
  } else {
    setReadiness(
      comparisonReadinessEl,
      "ready",
      "Ready for manual browser testing",
      "The static comparison checklist is complete. Runtime and update behavior are still unverified."
    );
  }
}

function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.text !== undefined) node.textContent = options.text;
  if (options.className) node.className = options.className;
  for (const child of children) node.appendChild(child);
  return node;
}

function renderLane(lane) {
  const container = el("div", { className: "lane" });
  container.appendChild(el("strong", { text: `${lane.id} (${lane.priority})` }));
  container.appendChild(el("p", { text: lane.reason }));
  const list = el("ul");
  for (const check of lane.checks) list.appendChild(el("li", { text: check }));
  container.appendChild(list);
  return container;
}

function renderFinding(flag) {
  const container = el("div", { className: "finding" });
  container.appendChild(el("strong", { text: `${flag.id} (${flag.level})` }));
  container.appendChild(el("p", { text: flag.message }));
  return container;
}

// --- Local, memory-only finding triage -------------------------------
//
// Every rendered finding (inspect or compare) supports: pin/unpin, an
// acknowledge/unacknowledge toggle, and a short private local note. None of
// this mutates the underlying report object — it only tracks extra fields on
// a parallel in-memory entry and reorders/hides already-rendered DOM nodes.
function updateFindingNodeClass(entry) {
  let className = "finding";
  if (entry.pinned) className += " finding-pinned";
  if (entry.acknowledged) className += " finding-acknowledged";
  entry.node.className = className;
}

// Reorders a findings container so pinned entries render first, preserving
// relative order within each group. The underlying report/riskFlags array
// passed in elsewhere is never touched — only DOM node order changes.
function sortFindingsContainer(containerEl, entries) {
  if (!containerEl) return;
  const ordered = [...entries].sort((first, second) => (second.pinned === true ? 1 : 0) - (first.pinned === true ? 1 : 0));
  containerEl.textContent = "";
  for (const entry of ordered) containerEl.appendChild(entry.node);
}

// Builds one finding's triage entry: pin, acknowledge, and private note
// controls appended to its already-rendered node. Returns the entry object
// tracked in the relevant findings array (analysisFindingNodes /
// comparisonFindingNodes) for filtering, sorting, and export.
function createFindingEntry(flag, idPrefix, index) {
  const node = renderFinding(flag);
  const id = `${idPrefix}-finding-${index}`;
  const entry = {
    id,
    findingId: flag.id,
    level: flag.level,
    node,
    searchText: `${flag.id} ${flag.level} ${flag.message}`.toLowerCase(),
    pinned: false,
    acknowledged: false,
    note: "",
    severityHidden: false,
    triageHidden: false
  };

  const controls = el("div", { className: "finding-triage-controls" });

  const pinButton = document.createElement("button");
  pinButton.type = "button";
  pinButton.className = "secondary-button finding-pin-button";
  pinButton.setAttribute("aria-pressed", "false");
  pinButton.setAttribute("aria-label", `Pin finding: ${flag.id}`);
  pinButton.textContent = "Pin";
  entry.pinButton = pinButton;
  controls.appendChild(pinButton);

  const ackButton = document.createElement("button");
  ackButton.type = "button";
  ackButton.className = "secondary-button finding-ack-button";
  ackButton.setAttribute("aria-pressed", "false");
  ackButton.setAttribute("aria-label", `Acknowledge finding: ${flag.id}`);
  ackButton.textContent = "Acknowledge";
  entry.ackButton = ackButton;
  controls.appendChild(ackButton);

  const noteToggle = document.createElement("button");
  noteToggle.type = "button";
  noteToggle.className = "secondary-button finding-note-toggle";
  noteToggle.textContent = "Add private note";
  noteToggle.setAttribute("aria-expanded", "false");
  entry.noteToggle = noteToggle;
  controls.appendChild(noteToggle);

  node.appendChild(controls);

  const noteWrap = el("div", { className: "finding-note-wrap" });
  noteWrap.hidden = true;
  const noteLabel = document.createElement("label");
  const noteId = `${id}-note`;
  noteLabel.htmlFor = noteId;
  noteLabel.textContent = "Private local note (memory only; never in share-safe exports)";
  const noteTextarea = document.createElement("textarea");
  noteTextarea.id = noteId;
  noteTextarea.maxLength = MAX_CHECKLIST_NOTE_LENGTH;
  const noteStatus = el("p", { className: "finding-note-status" });
  noteStatus.setAttribute("role", "status");
  noteStatus.setAttribute("aria-live", "polite");
  entry.noteTextarea = noteTextarea;
  entry.noteWrap = noteWrap;
  entry.noteStatus = noteStatus;

  noteTextarea.addEventListener("input", () => {
    entry.note = noteTextarea.value;
    const hasNote = entry.note.trim().length > 0;
    noteToggle.textContent = hasNote ? "Edit private note" : "Add private note";
    noteStatus.textContent = hasNote ? "Private note saved in memory only." : "";
  });
  noteToggle.addEventListener("click", () => {
    const expanded = noteToggle.getAttribute("aria-expanded") === "true";
    noteWrap.hidden = expanded;
    noteToggle.setAttribute("aria-expanded", expanded ? "false" : "true");
    if (!expanded && noteTextarea.focus) noteTextarea.focus();
  });
  noteWrap.appendChild(noteLabel);
  noteWrap.appendChild(noteTextarea);
  noteWrap.appendChild(noteStatus);
  node.appendChild(noteWrap);

  return entry;
}

// Wires pin/acknowledge behavior for one finding entry: toggling state,
// updating accessible pressed state and visible labels, re-sorting pinned
// findings first, and notifying the caller so readiness and triage filter
// counts stay in sync.
function attachFindingTriageHandlers(entry, getContainerEl, getEntries, onChange) {
  entry.pinButton.addEventListener("click", () => {
    entry.pinned = !entry.pinned;
    entry.pinButton.setAttribute("aria-pressed", entry.pinned ? "true" : "false");
    entry.pinButton.textContent = entry.pinned ? "Unpin" : "Pin";
    updateFindingNodeClass(entry);
    sortFindingsContainer(getContainerEl(), getEntries());
    onChange();
  });
  entry.ackButton.addEventListener("click", () => {
    entry.acknowledged = !entry.acknowledged;
    entry.ackButton.setAttribute("aria-pressed", entry.acknowledged ? "true" : "false");
    entry.ackButton.textContent = entry.acknowledged ? "Unacknowledge" : "Acknowledge";
    updateFindingNodeClass(entry);
    onChange();
  });
}

// Filters rendered finding nodes by severity and, optionally, an accessible
// local text search over each finding's already-rendered text. This only
// hides/shows DOM nodes and never mutates the underlying report object. The
// status message always uses fixed, count-based wording — it never echoes
// the raw search text back into the page. Visibility is combined with any
// active triage filter so both controls can hide a finding independently.
function applyFindingFilter(entries, filterValue, statusEl, searchValue = "") {
  const query = String(searchValue || "").trim().toLowerCase();
  let visible = 0;
  for (const entry of entries) {
    const severityMatches = filterValue === "all" || entry.level === filterValue;
    const textMatches = query === "" || (entry.searchText || "").includes(query);
    const matches = severityMatches && textMatches;
    entry.severityHidden = !matches;
    entry.node.hidden = entry.severityHidden || entry.triageHidden === true;
    if (matches) visible += 1;
  }
  const label = filterValue === "all" ? "all severities" : filterValue;
  statusEl.textContent = `${visible} finding${visible === 1 ? "" : "s"} shown (${label}).`;
}

// Filters rendered finding nodes by fixed triage state (all/pinned/
// unacknowledged/acknowledged). Counts are always computed over every
// rendered finding for this report, independent of the severity/search
// filter, and never mutate the underlying report object.
function applyTriageFilter(entries, filterValue, statusEl) {
  let visible = 0;
  for (const entry of entries) {
    const matches = filterValue === "all"
      || (filterValue === "pinned" && entry.pinned)
      || (filterValue === "unacknowledged" && !entry.acknowledged)
      || (filterValue === "acknowledged" && entry.acknowledged);
    entry.triageHidden = !matches;
    entry.node.hidden = entry.severityHidden === true || entry.triageHidden;
    if (matches) visible += 1;
  }
  statusEl.textContent = `${visible} of ${entries.length} finding${entries.length === 1 ? "" : "s"} shown (${filterValue}).`;
}

// Resets pin, acknowledge, and private note state for every finding in the
// given report's in-memory triage list, restores the fixed "all" triage
// filter, and re-sorts the container back to report order. Nothing here
// touches report data or any persistence layer (there is none).
function resetFindingsTriage(entries, getContainerEl, filterEl, onChange) {
  for (const entry of entries) {
    entry.pinned = false;
    entry.acknowledged = false;
    entry.note = "";
    entry.pinButton.setAttribute("aria-pressed", "false");
    entry.pinButton.textContent = "Pin";
    entry.ackButton.setAttribute("aria-pressed", "false");
    entry.ackButton.textContent = "Acknowledge";
    entry.noteTextarea.value = "";
    entry.noteToggle.textContent = "Add private note";
    entry.noteToggle.setAttribute("aria-expanded", "false");
    entry.noteWrap.hidden = true;
    entry.noteStatus.textContent = "";
    updateFindingNodeClass(entry);
  }
  filterEl.value = "all";
  sortFindingsContainer(getContainerEl(), entries);
  onChange();
}

function applyAnalysisFindingFilters() {
  applyFindingFilter(analysisFindingNodes, analysisSeverityFilterEl.value, analysisFilterStatusEl, analysisFindingSearchEl.value);
}

function applyComparisonFindingFilters() {
  applyFindingFilter(comparisonFindingNodes, comparisonSeverityFilterEl.value, comparisonFilterStatusEl, comparisonFindingSearchEl.value);
}

function applyAnalysisTriageFilter() {
  applyTriageFilter(analysisFindingNodes, analysisTriageFilterEl.value, analysisTriageFilterStatusEl);
}

function applyComparisonTriageFilter() {
  applyTriageFilter(comparisonFindingNodes, comparisonTriageFilterEl.value, comparisonTriageFilterStatusEl);
}

function analysisTriageOnChange() {
  updateAnalysisReadiness();
  applyAnalysisTriageFilter();
}

function comparisonTriageOnChange() {
  updateComparisonReadiness();
  applyComparisonTriageFilter();
}

analysisSeverityFilterEl.addEventListener("change", applyAnalysisFindingFilters);
analysisFindingSearchEl.addEventListener("input", applyAnalysisFindingFilters);
analysisTriageFilterEl.addEventListener("change", applyAnalysisTriageFilter);
resetAnalysisTriageButton.addEventListener("click", () => {
  resetFindingsTriage(analysisFindingNodes, () => analysisFindingsContentEl, analysisTriageFilterEl, analysisTriageOnChange);
});

comparisonSeverityFilterEl.addEventListener("change", applyComparisonFindingFilters);
comparisonFindingSearchEl.addEventListener("input", applyComparisonFindingFilters);
comparisonTriageFilterEl.addEventListener("change", applyComparisonTriageFilter);
resetComparisonTriageButton.addEventListener("click", () => {
  resetFindingsTriage(comparisonFindingNodes, () => comparisonFindingsContentEl, comparisonTriageFilterEl, comparisonTriageOnChange);
});

// Builds one collapsible result section with a fully accessible toggle
// button (correct aria-expanded state kept in sync with the visually
// hidden content) and registers it so expand/collapse-all controls can
// operate on every section in a report.
function appendCollapsibleSection(container, sectionId, title, buildContent, registry) {
  const section = el("div", { className: "collapsible-section" });
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "section-toggle";
  toggle.id = `${sectionId}-toggle`;
  toggle.setAttribute("aria-expanded", "true");
  toggle.setAttribute("aria-controls", `${sectionId}-content`);
  toggle.textContent = title;
  const content = el("div", { className: "section-content" });
  content.id = `${sectionId}-content`;
  buildContent(content);
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    setSectionExpanded(section, !expanded);
  });
  section.appendChild(toggle);
  section.appendChild(content);
  container.appendChild(section);
  if (registry) registry.push(section);
  return section;
}

function setSectionExpanded(section, expanded) {
  const [toggle, content] = section.children;
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  content.hidden = !expanded;
}

function expandAllSections(sections) {
  for (const section of sections) setSectionExpanded(section, true);
}

function collapseAllSections(sections) {
  for (const section of sections) setSectionExpanded(section, false);
}

reportExpandAllButton.addEventListener("click", () => expandAllSections(analysisCollapsibleSections));
reportCollapseAllButton.addEventListener("click", () => collapseAllSections(analysisCollapsibleSections));
compareReportExpandAllButton.addEventListener("click", () => expandAllSections(comparisonCollapsibleSections));
compareReportCollapseAllButton.addEventListener("click", () => collapseAllSections(comparisonCollapsibleSections));

// Keeps at most five in-memory, timestamp-free run summaries. Rerun always
// replays the manifest object already held in memory from the original run;
// it never re-reads a file or contacts any endpoint other than the same
// local analyze/compare endpoints used for the original run.
function addRecentRun(label, rerun) {
  recentRuns.unshift({ label, rerun });
  if (recentRuns.length > MAX_RECENT_RUNS) recentRuns.length = MAX_RECENT_RUNS;
  renderRecentRuns();
}

function renderRecentRuns() {
  recentRunsListEl.textContent = "";
  for (const run of recentRuns) {
    const item = el("li", { className: "recent-run-item" });
    item.appendChild(el("span", { text: run.label }));
    const rerunButton = document.createElement("button");
    rerunButton.type = "button";
    rerunButton.className = "secondary-button";
    rerunButton.textContent = "Rerun";
    rerunButton.addEventListener("click", () => run.rerun());
    item.appendChild(rerunButton);
    recentRunsListEl.appendChild(item);
  }
  recentRunsEl.hidden = recentRuns.length === 0;
}

// Local keyboard shortcuts. These never fire while the user is typing in a
// text field, textarea, or select so normal typing is never intercepted.
function isTypingTarget(target) {
  if (!target) return false;
  if (target.isContentEditable === true) return true;
  const tag = String(target.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

document.addEventListener("keydown", event => {
  if (isTypingTarget(event.target)) return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const key = String(event.key || "").toLowerCase();
  if (key === "i") {
    setWorkflowMode("inspect");
    fileInput.focus();
  } else if (key === "c") {
    setWorkflowMode("compare");
    previousFileInput.focus();
  } else if (key === "s" || key === "/") {
    if (event.preventDefault) event.preventDefault();
    if (!compareReportEl.hidden) comparisonFindingSearchEl.focus();
    else analysisFindingSearchEl.focus();
  } else if (key === "escape") {
    clearWorkspaceButton.click();
  }
});

printReportButton.addEventListener("click", () => {
  if (typeof window !== "undefined" && window.print) window.print();
});

function appendComparisonChangeSection(category, node, hasChanges, container = compareReportDetailsEl) {
  node.className = `${node.className || ""} change-section`.trim();
  node.setAttribute("data-change-category", category);
  node.setAttribute("data-has-changes", String(hasChanges));
  comparisonChangeSectionNodes.push({ category, hasChanges, node });
  container.appendChild(node);
}

function applyComparisonChangeFilter(filterValue) {
  let visible = 0;
  const changedOnly = comparisonChangedOnlyEl.checked === true;
  for (const entry of comparisonChangeSectionNodes) {
    const categoryMatches = filterValue === "all" || entry.category === filterValue;
    const matches = categoryMatches && (!changedOnly || entry.hasChanges);
    entry.node.hidden = !matches;
    if (matches) visible += 1;
  }
  const label = filterValue === "all" ? "all categories" : filterValue;
  const mode = changedOnly ? "; changed only" : "";
  comparisonChangeFilterStatusEl.textContent = `${visible} of ${comparisonChangeSectionNodes.length} change sections shown (${label}${mode}).`;
}

comparisonChangeFilterEl.addEventListener("change", () => {
  applyComparisonChangeFilter(comparisonChangeFilterEl.value);
});

comparisonChangedOnlyEl.addEventListener("change", () => {
  applyComparisonChangeFilter(comparisonChangeFilterEl.value);
});

function renderReport(report) {
  reportDetailsEl.textContent = "";
  analysisFindingNodes = [];
  analysisCollapsibleSections = [];
  reportEl.hidden = false;

  appendCollapsibleSection(reportDetailsEl, "analysis-identity", "Identity", content => {
    content.appendChild(el("p", {
      text: `${report.identity.name} — version ${report.identity.version} (Manifest V${report.identity.manifestVersion})`
    }));
  }, analysisCollapsibleSections);

  appendCollapsibleSection(reportDetailsEl, "analysis-surfaces", "Detected surfaces", content => {
    const surfaceList = el("ul");
    for (const [key, value] of Object.entries(report.surfaces)) {
      surfaceList.appendChild(el("li", { text: `${key}: ${String(value)}` }));
    }
    content.appendChild(surfaceList);
  }, analysisCollapsibleSections);

  appendCollapsibleSection(reportDetailsEl, "analysis-coverage", "Coverage gaps", content => {
    content.appendChild(el("p", {
      text: report.coverage.unmodeledTopLevelKeys.length > 0
        ? `Top-level manifest keys not interpreted by this analyzer: ${report.coverage.unmodeledTopLevelKeys.join(", ")}.`
        : "Every top-level manifest key in this file is modeled by the current analyzer."
    }));
  }, analysisCollapsibleSections);

  appendCollapsibleSection(reportDetailsEl, "analysis-lanes", "Test lanes", content => {
    if (report.lanes.length === 0) {
      content.appendChild(el("p", { text: "No test lanes were derived from this manifest." }));
    } else {
      for (const lane of report.lanes) content.appendChild(renderLane(lane));
    }
  }, analysisCollapsibleSections);

  appendCollapsibleSection(reportDetailsEl, "analysis-findings", "Findings", content => {
    analysisFindingsContentEl = content;
    if (report.riskFlags.length === 0) {
      content.appendChild(el("p", { text: "No risk flags were detected in this static analysis." }));
    } else {
      report.riskFlags.forEach((flag, index) => {
        const entry = createFindingEntry(flag, "analysis", index);
        attachFindingTriageHandlers(entry, () => analysisFindingsContentEl, () => analysisFindingNodes, analysisTriageOnChange);
        analysisFindingNodes.push(entry);
        content.appendChild(entry.node);
      });
    }
  }, analysisCollapsibleSections);
  analysisFilterControlsEl.hidden = report.riskFlags.length === 0;
  analysisTriageControlsEl.hidden = report.riskFlags.length === 0;
  analysisSeverityFilterEl.value = "all";
  analysisFindingSearchEl.value = "";
  analysisTriageFilterEl.value = "all";
  applyAnalysisFindingFilters();
  applyAnalysisTriageFilter();

  appendCollapsibleSection(reportDetailsEl, "analysis-limitations", "Limitations", content => {
    content.appendChild(el("p", {
      text: "This is a static manifest analysis only. The extension has not been loaded, executed, or "
        + "tested in a browser. It does not read extension source files or verify runtime behavior."
    }));
  }, analysisCollapsibleSections);
}

function updateChecklistProgress() {
  const total = checklistState.length;
  const completed = checklistState.filter(item => item.done).length;
  checklistProgressEl.textContent = total === 0
    ? "No checklist items for this manifest."
    : `${completed} of ${total} checklist items completed.`;
  updateAnalysisReadiness();
  applyChecklistFilter(checklistState, checklistFilterEl.value, checklistFilterStatusEl);
  updateInspectJumpNav();
}

function applyChecklistFilter(state, filterValue, statusEl) {
  let visible = 0;
  for (const entry of state) {
    const matches = filterValue === "all"
      || (filterValue === "open" && !entry.done)
      || (filterValue === "done" && entry.done);
    entry.node.hidden = !matches;
    if (matches) visible += 1;
  }
  const label = filterValue === "open" ? "incomplete" : (filterValue === "done" ? "completed" : "all");
  statusEl.textContent = `${visible} of ${state.length} checks shown (${label}).`;
}

function resetChecklist(state, filterEl, updateProgress) {
  for (const entry of state) {
    entry.done = false;
    entry.checkbox.checked = false;
  }
  filterEl.value = "all";
  updateProgress();
}

// --- Local, memory-only checklist customization -----------------------
//
// Every checklist item (built-in or custom) supports: reordering, and a
// short private note. Only custom items (added locally by the tester)
// support text editing and deletion; built-in generated check text is
// immutable. Nothing here reads or writes any storage or network API —
// state lives only in the in-memory arrays passed as `config.getState()`.
const MIN_CUSTOM_CHECK_LENGTH = 3;
const MAX_CUSTOM_CHECK_LENGTH = 200;
const MAX_CHECKLIST_NOTE_LENGTH = 500;

function validateCustomChecklistText(rawValue) {
  const value = String(rawValue || "").trim();
  if (value.length < MIN_CUSTOM_CHECK_LENGTH) {
    return { valid: false, error: `Enter at least ${MIN_CUSTOM_CHECK_LENGTH} characters for a custom check.` };
  }
  if (value.length > MAX_CUSTOM_CHECK_LENGTH) {
    return { valid: false, error: `Keep a custom check to ${MAX_CUSTOM_CHECK_LENGTH} characters or fewer.` };
  }
  return { valid: true, value };
}

// Rebuilds the list DOM strictly from the current in-memory order (used
// after add/delete/move) and keeps move-button disabled state in sync with
// each item's new position, without recreating any item's DOM node.
function syncChecklistOrder(config) {
  const state = config.getState();
  config.listEl.textContent = "";
  for (const entry of state) config.listEl.appendChild(entry.node);
  state.forEach((entry, index) => {
    entry.upButton.disabled = index === 0;
    entry.downButton.disabled = index === state.length - 1;
  });
}

function moveChecklistItem(config, entry, direction) {
  const state = config.getState();
  const index = state.indexOf(entry);
  if (index === -1) return;
  const target = index + direction;
  if (target < 0 || target >= state.length) return;
  const [moved] = state.splice(index, 1);
  state.splice(target, 0, moved);
  syncChecklistOrder(config);
  config.updateProgress();
}

function deleteCustomChecklistItem(config, entry) {
  const state = config.getState();
  const index = state.indexOf(entry);
  if (index === -1) return;
  state.splice(index, 1);
  config.listEl.removeChild(entry.node);
  config.updateProgress();
  syncChecklistOrder(config);
}

// Replaces an item's label with an inline text control, validating the same
// fixed length limits used when adding a custom item. Only ever invoked for
// custom items; built-in generated check text has no edit control.
function startEditingCustomChecklistItem(entry) {
  if (entry.editing) return;
  entry.editing = true;
  entry.label.hidden = true;
  entry.editButton.hidden = true;
  entry.deleteButton.hidden = true;

  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = MAX_CUSTOM_CHECK_LENGTH;
  input.value = entry.check;
  input.id = `${entry.id}-edit-input`;
  input.setAttribute("aria-label", "Edit custom check text");
  input.setAttribute("aria-describedby", entry.editStatus.id);

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "Save";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "secondary-button";
  cancelButton.textContent = "Cancel";

  function finishEditing() {
    input.remove ? input.remove() : entry.node.removeChild(input);
    saveButton.remove ? saveButton.remove() : entry.node.removeChild(saveButton);
    cancelButton.remove ? cancelButton.remove() : entry.node.removeChild(cancelButton);
    entry.label.hidden = false;
    entry.editButton.hidden = false;
    entry.deleteButton.hidden = false;
    entry.editing = false;
  }

  cancelButton.addEventListener("click", () => {
    entry.editStatus.textContent = "";
    finishEditing();
  });

  saveButton.addEventListener("click", () => {
    const result = validateCustomChecklistText(input.value);
    if (!result.valid) {
      entry.editStatus.textContent = result.error;
      return;
    }
    entry.check = result.value;
    entry.label.textContent = `${entry.laneId}: ${entry.check}`;
    entry.editStatus.textContent = "Custom check updated.";
    finishEditing();
  });

  entry.node.insertBefore
    ? entry.node.insertBefore(input, entry.controlsEl)
    : entry.node.appendChild(input);
  entry.node.insertBefore
    ? entry.node.insertBefore(saveButton, entry.controlsEl)
    : entry.node.appendChild(saveButton);
  entry.node.insertBefore
    ? entry.node.insertBefore(cancelButton, entry.controlsEl)
    : entry.node.appendChild(cancelButton);
  if (input.focus) input.focus();
}

// Builds one checklist item (built-in when custom=false, tester-added when
// custom=true) with a checkbox/label, move up/down controls, a private note
// toggle, and — for custom items only — edit and delete-with-local-confirm
// controls. Pushes the resulting entry into config.getState() and appends
// its DOM node to config.listEl.
function createChecklistEntry(config, id, laneId, check, custom) {
  const state = config.getState();
  const item = el("li", { className: custom ? "checklist-item checklist-item-custom" : "checklist-item" });
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = id;
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = `${laneId}: ${check}`;

  const entry = { id, laneId, check, done: false, node: item, checkbox, label, custom, note: "" };

  checkbox.addEventListener("change", () => {
    entry.done = checkbox.checked;
    config.updateProgress();
  });

  item.appendChild(checkbox);
  item.appendChild(label);

  const controls = el("div", { className: "checklist-item-controls" });
  entry.controlsEl = controls;

  const upButton = document.createElement("button");
  upButton.type = "button";
  upButton.className = "secondary-button checklist-move-button";
  upButton.textContent = "Move up";
  upButton.setAttribute("aria-label", `Move check up: ${laneId}`);
  upButton.addEventListener("click", () => moveChecklistItem(config, entry, -1));

  const downButton = document.createElement("button");
  downButton.type = "button";
  downButton.className = "secondary-button checklist-move-button";
  downButton.textContent = "Move down";
  downButton.setAttribute("aria-label", `Move check down: ${laneId}`);
  downButton.addEventListener("click", () => moveChecklistItem(config, entry, 1));

  entry.upButton = upButton;
  entry.downButton = downButton;
  controls.appendChild(upButton);
  controls.appendChild(downButton);

  const noteToggle = document.createElement("button");
  noteToggle.type = "button";
  noteToggle.className = "secondary-button checklist-note-toggle";
  noteToggle.textContent = "Add private note";
  noteToggle.setAttribute("aria-expanded", "false");
  controls.appendChild(noteToggle);

  if (custom) {
    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "secondary-button checklist-edit-button";
    editButton.textContent = "Edit";
    entry.editButton = editButton;
    controls.appendChild(editButton);

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "secondary-button checklist-delete-button";
    deleteButton.textContent = "Delete";
    entry.deleteButton = deleteButton;
    controls.appendChild(deleteButton);

    const deleteConfirm = el("span", { className: "checklist-delete-confirm" });
    deleteConfirm.hidden = true;
    const confirmDeleteButton = document.createElement("button");
    confirmDeleteButton.type = "button";
    confirmDeleteButton.textContent = "Confirm delete";
    const cancelDeleteButton = document.createElement("button");
    cancelDeleteButton.type = "button";
    cancelDeleteButton.className = "secondary-button";
    cancelDeleteButton.textContent = "Cancel";
    deleteConfirm.appendChild(confirmDeleteButton);
    deleteConfirm.appendChild(cancelDeleteButton);
    entry.deleteConfirmEl = deleteConfirm;
    controls.appendChild(deleteConfirm);

    deleteButton.addEventListener("click", () => {
      deleteButton.hidden = true;
      editButton.hidden = true;
      deleteConfirm.hidden = false;
    });
    cancelDeleteButton.addEventListener("click", () => {
      deleteConfirm.hidden = true;
      deleteButton.hidden = false;
      editButton.hidden = false;
    });
    confirmDeleteButton.addEventListener("click", () => {
      deleteCustomChecklistItem(config, entry);
    });

    const editStatus = el("p", { className: "checklist-edit-status" });
    editStatus.id = `${id}-edit-status`;
    editStatus.setAttribute("role", "status");
    editStatus.setAttribute("aria-live", "polite");
    entry.editStatus = editStatus;
    editButton.addEventListener("click", () => startEditingCustomChecklistItem(entry));
  }

  item.appendChild(controls);
  if (entry.editStatus) item.appendChild(entry.editStatus);

  const noteWrap = el("div", { className: "checklist-note-wrap" });
  noteWrap.hidden = true;
  const noteLabel = document.createElement("label");
  const noteId = `${id}-note`;
  noteLabel.htmlFor = noteId;
  noteLabel.textContent = "Private local note (memory only; never in share-safe exports)";
  const noteTextarea = document.createElement("textarea");
  noteTextarea.id = noteId;
  noteTextarea.maxLength = MAX_CHECKLIST_NOTE_LENGTH;
  const noteStatus = el("p", { className: "checklist-note-status" });
  noteStatus.setAttribute("role", "status");
  noteStatus.setAttribute("aria-live", "polite");
  noteTextarea.addEventListener("input", () => {
    entry.note = noteTextarea.value;
    const hasNote = entry.note.trim().length > 0;
    noteToggle.textContent = hasNote ? "Edit private note" : "Add private note";
    noteStatus.textContent = hasNote ? "Private note saved in memory only." : "";
  });
  noteToggle.addEventListener("click", () => {
    const expanded = noteToggle.getAttribute("aria-expanded") === "true";
    noteWrap.hidden = expanded;
    noteToggle.setAttribute("aria-expanded", expanded ? "false" : "true");
    if (!expanded && noteTextarea.focus) noteTextarea.focus();
  });
  noteWrap.appendChild(noteLabel);
  noteWrap.appendChild(noteTextarea);
  noteWrap.appendChild(noteStatus);
  entry.noteTextarea = noteTextarea;
  entry.noteToggle = noteToggle;
  item.appendChild(noteWrap);

  state.push(entry);
  config.listEl.appendChild(item);
  return entry;
}

function wireCustomChecklistAdd(config, inputEl, buttonEl, statusEl) {
  buttonEl.addEventListener("click", () => {
    const result = validateCustomChecklistText(inputEl.value);
    if (!result.valid) {
      statusEl.textContent = result.error;
      return;
    }
    const id = `${config.idPrefix}-custom-${config.nextCustomId()}`;
    createChecklistEntry(config, id, "Custom check", result.value, true);
    syncChecklistOrder(config);
    config.updateProgress();
    inputEl.value = "";
    statusEl.textContent = "Custom check added.";
  });
}

const checklistConfig = {
  idPrefix: "checklist-item",
  getState: () => checklistState,
  listEl: checklistListEl,
  updateProgress: () => updateChecklistProgress(),
  nextCustomId: () => ++checklistCustomCounter
};

const candidateChecklistConfig = {
  idPrefix: "candidate-checklist-item",
  getState: () => candidateChecklistState,
  listEl: candidateChecklistListEl,
  updateProgress: () => updateCandidateChecklistProgress(),
  nextCustomId: () => ++candidateChecklistCustomCounter
};

wireCustomChecklistAdd(checklistConfig, checklistAddInputEl, checklistAddButtonEl, checklistAddStatusEl);
wireCustomChecklistAdd(candidateChecklistConfig, candidateChecklistAddInputEl, candidateChecklistAddButtonEl, candidateChecklistAddStatusEl);

checklistFilterEl.addEventListener("change", () => {
  applyChecklistFilter(checklistState, checklistFilterEl.value, checklistFilterStatusEl);
});

resetChecklistButton.addEventListener("click", () => {
  resetChecklist(checklistState, checklistFilterEl, updateChecklistProgress);
});

function renderChecklist(report) {
  checklistListEl.textContent = "";
  checklistState = [];
  checklistCustomCounter = 0;
  checklistAddInputEl.value = "";
  checklistAddStatusEl.textContent = "";

  report.lanes.forEach((lane, laneIndex) => {
    lane.checks.forEach((check, checkIndex) => {
      const id = `checklist-item-${laneIndex}-${checkIndex}`;
      createChecklistEntry(checklistConfig, id, lane.id, check, false);
    });
  });
  syncChecklistOrder(checklistConfig);

  checklistEl.hidden = checklistState.length === 0;
  checklistControlsEl.hidden = checklistState.length === 0;
  checklistFilterEl.value = "all";
  exportButton.disabled = checklistState.length === 0;
  exportMarkdownButton.disabled = checklistState.length === 0;
  exportAnalysisSafeSummaryButton.disabled = false;
  exportStatusEl.textContent = "";
  updateChecklistProgress();
}

function downloadLocalFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function buildFeedbackTemplate() {
  return [
    "# MV3 Replay private tester notes",
    "",
    "> Keep this file local until you intentionally choose to share it.",
    "> Remove extension names, private URLs, source code, account details, and personal information.",
    "",
    "## What I tried",
    "- [ ] Built-in analysis example",
    "- [ ] My local manifest",
    "- [ ] Previous-to-candidate comparison",
    "",
    "## What was useful?",
    "",
    "",
    "## What was confusing or incorrect?",
    "",
    "",
    "## What result did I expect?",
    "",
    "",
    "## Would I use this before a release? Why or why not?",
    "",
    "",
    "## Optional non-identifying context",
    "- Browser family: Chrome / Edge / Other / Prefer not to say",
    "- Extension shape: popup / service worker / content scripts / other",
    "",
    "Do not add contact details or identifying information.",
    ""
  ].join("\n");
}

feedbackTemplateButton.addEventListener("click", () => {
  downloadLocalFile(
    "mv3-replay-private-tester-notes.md",
    buildFeedbackTemplate(),
    "text/markdown"
  );
  feedbackTemplateStatusEl.textContent = "Private feedback template downloaded locally.";
});

// Deterministically neutralizes a dynamic text value for inclusion in the
// generated Markdown exports. Manifest- and report-controlled strings must
// never be able to introduce headings, links, images, HTML, extra list
// items, or line breaks into the exported document.
function escapeMarkdownText(value) {
  const text = value === undefined || value === null ? "" : String(value);
  let result = "";
  for (const ch of text) {
    const code = ch.codePointAt(0);
    // Replace control characters (including CR/LF) with a single space so
    // embedded line breaks cannot start a new Markdown line.
    if (code < 32 || code === 127) {
      result += " ";
      continue;
    }
    // Escape characters with Markdown/HTML significance so they render as
    // literal punctuation instead of active syntax.
    if ("\\`*_{}[]()#+-!<>|~".indexOf(ch) !== -1) {
      result += "\\" + ch;
      continue;
    }
    result += ch;
  }
  return result.replace(/\s+/g, " ").trim();
}

function buildAnalysisMarkdown(report, checklist, findingsTriage = []) {
  const lines = [];
  lines.push("# MV3 Replay analysis report");
  lines.push("");
  lines.push(`Exported: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Identity");
  lines.push(`- Name: ${escapeMarkdownText(report.identity.name)}`);
  lines.push(`- Version: ${escapeMarkdownText(report.identity.version)}`);
  lines.push(`- Manifest version: ${escapeMarkdownText(report.identity.manifestVersion)}`);
  lines.push("");
  lines.push("## Detected surfaces");
  for (const [key, value] of Object.entries(report.surfaces).sort(([first], [second]) => first.localeCompare(second))) {
    lines.push(`- ${escapeMarkdownText(key)}: ${escapeMarkdownText(value)}`);
  }
  lines.push("");
  lines.push("## Manifest counts");
  for (const [key, value] of Object.entries(report.counts).sort(([first], [second]) => first.localeCompare(second))) {
    lines.push(`- ${escapeMarkdownText(key)}: ${escapeMarkdownText(value)}`);
  }
  lines.push("");
  lines.push("## Coverage gaps");
  if (report.coverage.unmodeledTopLevelKeys.length === 0) {
    lines.push("Every top-level manifest key in this file is modeled by the current analyzer.");
  } else {
    lines.push(`- Unmodeled top-level keys: ${report.coverage.unmodeledTopLevelKeys.map(escapeMarkdownText).join(", ")}`);
  }
  lines.push("");
  lines.push("## Findings");
  if (report.riskFlags.length === 0) {
    lines.push("No risk flags were detected in this static analysis.");
  } else {
    for (const flag of report.riskFlags) {
      lines.push(
        `- **${escapeMarkdownText(flag.id)}** (${escapeMarkdownText(flag.level)}): ${escapeMarkdownText(flag.message)}`
      );
    }
  }
  lines.push("");
  lines.push("## Finding triage (private)");
  if (findingsTriage.length === 0) {
    lines.push("No findings to triage.");
  } else {
    for (const triage of findingsTriage) {
      lines.push(
        `- ${escapeMarkdownText(triage.findingId)}: pinned=${triage.pinned ? "yes" : "no"}; acknowledged=${triage.acknowledged ? "yes" : "no"}`
      );
      if (triage.note && String(triage.note).trim() !== "") {
        lines.push(`  - Private note: ${escapeMarkdownText(triage.note)}`);
      }
    }
  }
  lines.push("");
  lines.push("## Test checklist");
  if (checklist.length === 0) {
    lines.push("No checklist items for this manifest.");
  } else {
    for (const item of checklist) {
      lines.push(
        `- [${item.done ? "x" : " "}] ${escapeMarkdownText(item.laneId)}: ${escapeMarkdownText(item.check)}`
      );
      if (item.note && String(item.note).trim() !== "") {
        lines.push(`  - Private note: ${escapeMarkdownText(item.note)}`);
      }
    }
  }
  lines.push("");
  lines.push("## Limitations");
  lines.push(
    "This is a static manifest analysis only. The extension has not been loaded, executed, or "
      + "tested in a browser. It does not read extension source files or verify runtime behavior."
  );
  lines.push("");
  return lines.join("\n");
}

function severityCountLines(items) {
  const counts = countByLevel(items);
  return ["critical", "high", "medium", "low"]
    .map(level => `- ${level}: ${counts[level] || 0}`);
}

function buildShareSafeAnalysisSummary(report, checklist) {
  const completed = checklist.filter(item => item.done).length;
  const numericCounts = Object.values(report.counts || {})
    .filter(value => Number.isInteger(value) && value >= 0);
  const activeSurfaceCount = Object.values(report.surfaces || {})
    .filter(value => value === true || (Number.isInteger(value) && value > 0)).length;
  return [
    "# MV3 Replay share-safe structural analysis summary",
    "",
    "> Generated locally on explicit user request. No data was uploaded.",
    "> Excludes extension names, versions, URLs, filenames, manifest values, finding messages, and checklist text.",
    "",
    "## Structure",
    `- Active modeled surface fields: ${activeSurfaceCount}`,
    `- Total across numeric manifest counters: ${numericCounts.reduce((total, value) => total + value, 0)}`,
    `- Unmodeled top-level key count: ${report.coverage.unmodeledTopLevelKeys.length}`,
    `- Regression lane count: ${report.lanes.length}`,
    "",
    "## Finding severity counts",
    ...severityCountLines(report.riskFlags),
    "",
    "## Checklist progress",
    `- Completed: ${completed}`,
    `- Total: ${checklist.length}`,
    "",
    "This sanitized structural summary is still a static plan, not proof of runtime testing.",
    ""
  ].join("\n");
}

exportButton.addEventListener("click", () => {
  if (!currentReport) return;

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    report: currentReport,
    checklist: checklistState.map(({ id, laneId, check, done, custom, note }) => ({ id, laneId, check, done, custom, note })),
    findingsTriage: analysisFindingNodes.map(({ findingId, pinned, acknowledged, note }) => ({ findingId, pinned, acknowledged, note }))
  };

  downloadLocalFile(
    "mv3-replay-checklist.json",
    JSON.stringify(exportPayload, null, 2),
    "application/json"
  );

  exportStatusEl.textContent = "Checklist exported to a local JSON file.";
});

exportMarkdownButton.addEventListener("click", () => {
  if (!currentReport) return;

  const markdown = buildAnalysisMarkdown(currentReport, checklistState, analysisFindingNodes.map(({ findingId, pinned, acknowledged, note }) => ({ findingId, pinned, acknowledged, note })));
  downloadLocalFile("mv3-replay-checklist.md", markdown, "text/markdown");

  exportStatusEl.textContent = "Checklist exported to a local Markdown file.";
});

exportAnalysisSafeSummaryButton.addEventListener("click", () => {
  if (!currentReport) return;
  downloadLocalFile(
    "mv3-replay-share-safe-analysis-summary.md",
    buildShareSafeAnalysisSummary(currentReport, checklistState),
    "text/markdown"
  );
  exportStatusEl.textContent = "Share-safe structural summary downloaded locally.";
});

// Given a FileList from a webkitdirectory input, locate exactly one root
// manifest.json (folderName/manifest.json). Relative paths are inspected only
// to locate it; only this single File object's contents may be read later.
function findRootManifestInFolder(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) {
    return { file: null, error: null };
  }

  const rootManifests = files.filter(file => {
    const relativePath = file.webkitRelativePath || "";
    const segments = relativePath.split("/").filter(Boolean);
    return segments.length === 2 && segments[1] === "manifest.json";
  });

  if (rootManifests.length === 0) {
    return { file: null, error: "The selected folder must contain a root manifest.json file." };
  }
  if (rootManifests.length > 1) {
    return {
      file: null,
      error: "The selected folder has more than one root manifest.json file; the selection is ambiguous."
    };
  }
  return { file: rootManifests[0], error: null };
}

async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read the selected file."));
    reader.readAsText(file);
  });
}

async function runAnalysis(manifest, isExample) {
  setStatus(isExample ? "Analyzing built-in example locally..." : "Analyzing locally...");
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(manifest)
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "The manifest could not be analyzed.");
      focusElement(statusEl);
      return;
    }
    setStatus(isExample ? "Built-in example analysis complete — this is sample data." : "Analysis complete.");
    currentReport = data.report;
    renderReport(data.report);
    renderAnalysisSummary(data.report);
    if (isExample) {
      reportSummaryEl.prepend(el("p", { className: "example-label", text: "Built-in example — not your extension" }));
    }
    renderChecklist(data.report);
    updateInspectJumpNav();
    addRecentRun(
      `Inspect — lanes: ${data.report.lanes.length}, findings: ${data.report.riskFlags.length}`,
      () => runAnalysis(manifest, isExample)
    );
    // Move focus to the result heading only after a successful run, never
    // while the user might still be typing in a form field.
    focusElement(reportHeadingEl);
  } catch {
    setStatus("The local analyzer could not be reached.");
    focusElement(statusEl);
  }
}

function resetAnalysisResults() {
  reportEl.hidden = true;
  reportJumpNavEl.hidden = true;
  reportSummaryEl.textContent = "";
  reportDetailsEl.textContent = "";
  analysisReadinessEl.textContent = "";
  analysisFilterControlsEl.hidden = true;
  analysisSeverityFilterEl.value = "all";
  analysisFindingSearchEl.value = "";
  analysisFilterStatusEl.textContent = "";
  analysisTriageControlsEl.hidden = true;
  analysisTriageFilterEl.value = "all";
  analysisTriageFilterStatusEl.textContent = "";
  analysisFindingNodes = [];
  analysisFindingsContentEl = null;
  analysisCollapsibleSections = [];
  checklistEl.hidden = true;
  checklistControlsEl.hidden = true;
  checklistFilterStatusEl.textContent = "";
  checklistListEl.textContent = "";
  checklistProgressEl.textContent = "";
  checklistAddInputEl.value = "";
  checklistAddStatusEl.textContent = "";
  exportStatusEl.textContent = "";
  exportButton.disabled = true;
  exportMarkdownButton.disabled = true;
  exportAnalysisSafeSummaryButton.disabled = true;
  currentReport = null;
  checklistState = [];
  checklistCustomCounter = 0;
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  resetAnalysisResults();

  setActionGroupLoading(analyzeSubmitButton, analyzeExampleButton, form, true, "Analyzing...", "Analyze locally");
  try {
    let file = fileInput.files[0];
    if (!file && folderInput.files.length > 0) {
      const { file: folderManifest, error } = findRootManifestInFolder(folderInput.files);
      if (error) {
        setStatus(error);
        focusElement(statusEl);
        return;
      }
      file = folderManifest;
    }
    if (!file) {
      setStatus("Select a local manifest.json file or an unpacked extension folder first.");
      focusElement(statusEl);
      return;
    }

    setStatus("Reading local file...");
    let manifest;
    try {
      const text = await readFileAsText(file);
      manifest = JSON.parse(text);
    } catch {
      setStatus("The selected file is not valid JSON.");
      focusElement(statusEl);
      return;
    }

    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      setStatus("The selected file must contain a JSON object.");
      focusElement(statusEl);
      return;
    }

    await runAnalysis(manifest, false);
  } finally {
    setActionGroupLoading(analyzeSubmitButton, analyzeExampleButton, form, false, "Analyzing...", "Analyze locally");
  }
});

analyzeExampleButton.addEventListener("click", async () => {
  resetAnalysisResults();
  fileInput.value = "";
  folderInput.value = "";
  setActionGroupLoading(analyzeSubmitButton, analyzeExampleButton, form, true, "Analyzing...", "Analyze locally");
  try {
    await runAnalysis(EXAMPLE_ANALYSIS_MANIFEST, true);
  } finally {
    setActionGroupLoading(analyzeSubmitButton, analyzeExampleButton, form, false, "Analyzing...", "Analyze locally");
  }
});

function setCompareStatus(message) {
  compareStatusEl.textContent = message;
}

// Opens the paste-JSON panel with a blank textarea and no leftover status.
pasteJsonButton.addEventListener("click", () => {
  pasteJsonPanelEl.hidden = false;
  pasteJsonTargetEl.value = "inspect";
  pasteJsonTextareaEl.value = "";
  pasteJsonStatusEl.textContent = "";
});

// Cancels the paste-JSON flow without importing anything and clears the
// textarea so no pasted text lingers in the DOM.
pasteJsonCancelButton.addEventListener("click", () => {
  pasteJsonPanelEl.hidden = true;
  pasteJsonTextareaEl.value = "";
  pasteJsonStatusEl.textContent = "";
});

// Parses pasted JSON only in memory and imports it into the selected target.
// The raw pasted text is discarded (textarea cleared) immediately once a
// valid manifest object has been parsed, so it is never displayed again.
pasteJsonConfirmButton.addEventListener("click", async () => {
  let manifest;
  try {
    manifest = JSON.parse(pasteJsonTextareaEl.value);
  } catch {
    pasteJsonStatusEl.textContent = "The pasted text is not valid JSON.";
    return;
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    pasteJsonStatusEl.textContent = "The pasted JSON must be an object.";
    return;
  }

  const target = pasteJsonTargetEl.value;
  pasteJsonTextareaEl.value = "";

  if (target === "inspect") {
    fileInput.value = "";
    folderInput.value = "";
    setInputStatus(manifestFileStatusEl, "ready", "Manifest imported via paste — ready to analyze.");
    pasteJsonPanelEl.hidden = true;
    pasteJsonStatusEl.textContent = "";
    resetAnalysisResults();
    await runAnalysis(manifest, false);
    return;
  }

  if (target === "previous") {
    pastedPreviousManifest = manifest;
    previousFileInput.value = "";
    previousFolderInput.value = "";
    setInputStatus(previousManifestFileStatusEl, "ready", "Previous manifest imported via paste — ready to compare.");
  } else {
    pastedCurrentManifest = manifest;
    candidateFileInput.value = "";
    candidateFolderInput.value = "";
    setInputStatus(candidateManifestFileStatusEl, "ready", "Candidate manifest imported via paste — ready to compare.");
  }
  pasteJsonPanelEl.hidden = true;
  pasteJsonStatusEl.textContent = "";
});

function renderListDiff(title, diff) {
  const container = el("div", { className: "finding" });
  container.appendChild(el("strong", { text: title }));
  container.appendChild(el("p", {
    text: `Added: ${diff.added && diff.added.length ? diff.added.join(", ") : "none"}`
  }));
  container.appendChild(el("p", {
    text: `Removed: ${diff.removed && diff.removed.length ? diff.removed.join(", ") : "none"}`
  }));
  return container;
}

function formatContentScriptRegistration(registration) {
  const files = registration.files.length > 0 ? registration.files.join(", ") : "none";
  const matches = registration.matches.length > 0 ? registration.matches.join(", ") : "none";
  return `files=${files}; matches=${matches}; runAt=${registration.runAt || "default"}; world=${registration.world}; allFrames=${registration.allFrames}`;
}

function renderContentScriptChanges(diff) {
  const container = el("div", { className: "declaration-changes" });
  container.appendChild(el("strong", { text: "Content-script registrations" }));
  if (diff.added.length === 0 && diff.removed.length === 0) {
    container.appendChild(el("p", { text: "No content-script registration changed." }));
    return container;
  }
  const list = el("ul");
  for (const registration of diff.added) {
    list.appendChild(el("li", { text: `Added: ${formatContentScriptRegistration(registration)}` }));
  }
  for (const registration of diff.removed) {
    list.appendChild(el("li", { text: `Removed: ${formatContentScriptRegistration(registration)}` }));
  }
  container.appendChild(list);
  return container;
}

function renderStaticRulesetChanges(diff) {
  const container = el("div", { className: "finding" });
  container.appendChild(el("strong", { text: "Static DNR rulesets" }));
  container.appendChild(el("p", { text: `Added: ${diff.added.length ? diff.added.join(", ") : "none"}` }));
  container.appendChild(el("p", { text: `Removed: ${diff.removed.length ? diff.removed.join(", ") : "none"}` }));
  container.appendChild(el("p", { text: `Changed: ${diff.changed.length ? diff.changed.join(", ") : "none"}` }));
  return container;
}

function renderKeyValueChanges(title, diff) {
  const container = el("div", { className: "declaration-changes" });
  container.appendChild(el("strong", { text: title }));
  container.appendChild(el("p", { text: `Added: ${diff.added.length ? diff.added.join(", ") : "none"}` }));
  container.appendChild(el("p", { text: `Removed: ${diff.removed.length ? diff.removed.join(", ") : "none"}` }));
  container.appendChild(el("p", { text: `Changed: ${diff.changed.length ? diff.changed.join(", ") : "none"}` }));
  return container;
}

function formatWebAccessibleResource(declaration) {
  const resources = declaration.resources.length > 0 ? declaration.resources.join(", ") : "none";
  const matches = declaration.matches.length > 0 ? declaration.matches.join(", ") : "none";
  const extensionIds = declaration.extensionIds.length > 0 ? declaration.extensionIds.join(", ") : "none";
  return `resources=${resources}; matches=${matches}; extensionIds=${extensionIds}; dynamicUrl=${declaration.useDynamicUrl}`;
}

function renderWebAccessibleResourceChanges(diff) {
  const container = el("div", { className: "declaration-changes" });
  container.appendChild(el("strong", { text: "Web-accessible resources" }));
  if (diff.added.length === 0 && diff.removed.length === 0) {
    container.appendChild(el("p", { text: "No web-accessible resource declaration changed." }));
    return container;
  }
  const list = el("ul");
  for (const declaration of diff.added) {
    list.appendChild(el("li", { text: `Added: ${formatWebAccessibleResource(declaration)}` }));
  }
  for (const declaration of diff.removed) {
    list.appendChild(el("li", { text: `Removed: ${formatWebAccessibleResource(declaration)}` }));
  }
  container.appendChild(list);
  return container;
}

function formatDeclarationValue(value) {
  if (value === null || value === undefined) return "not declared";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "none";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function renderDeclarationChanges(changes) {
  const container = el("div", { className: "declaration-changes" });
  container.appendChild(el("strong", { text: "Manifest declarations" }));
  if (changes.length === 0) {
    container.appendChild(el("p", { text: "No modeled manifest declaration values changed." }));
    return container;
  }
  const list = el("ul");
  for (const change of changes) {
    list.appendChild(el("li", {
      text: `${change.field}: ${formatDeclarationValue(change.previous)} → ${formatDeclarationValue(change.current)}`
    }));
  }
  container.appendChild(list);
  return container;
}

function renderExtensionKeyChange(change) {
  const container = el("div", { className: "declaration-changes" });
  container.appendChild(el("strong", { text: "Extension identity key" }));
  container.appendChild(el("p", {
    text: `Previous declared: ${change.previousDeclared ? "yes" : "no"}; current declared: ${change.currentDeclared ? "yes" : "no"}; changed: ${change.changed ? "yes" : "no"}.`
  }));
  return container;
}

function renderCompareReport(report) {
  compareReportDetailsEl.textContent = "";
  comparisonFindingNodes = [];
  comparisonChangeSectionNodes = [];
  comparisonCollapsibleSections = [];
  compareReportEl.hidden = false;

  appendCollapsibleSection(compareReportDetailsEl, "comparison-identity", "Release identity", content => {
    content.appendChild(el("p", {
      text: `From ${report.from.name} v${report.from.version} to ${report.to.name} v${report.to.version}`
    }));
    content.appendChild(el("p", {
      text: `Chrome version ordering: ${report.changes.version.relation}.`
    }));
  }, comparisonCollapsibleSections);

  appendCollapsibleSection(compareReportDetailsEl, "comparison-manual-validation", "Manual update validation", content => {
    content.appendChild(el("p", {
      text: report.requiresManualUpdateValidation
        ? "This release requires manual update-path validation before it ships."
        : "No critical-level findings were detected, but review the findings below before shipping."
    }));
  }, comparisonCollapsibleSections);

  appendCollapsibleSection(compareReportDetailsEl, "comparison-findings", "Findings", content => {
    comparisonFindingsContentEl = content;
    if (report.findings.length === 0) {
      content.appendChild(el("p", { text: "No comparison findings were detected in this static analysis." }));
    } else {
      report.findings.forEach((finding, index) => {
        const entry = createFindingEntry(finding, "comparison", index);
        attachFindingTriageHandlers(entry, () => comparisonFindingsContentEl, () => comparisonFindingNodes, comparisonTriageOnChange);
        comparisonFindingNodes.push(entry);
        content.appendChild(entry.node);
      });
    }
  }, comparisonCollapsibleSections);
  comparisonFilterControlsEl.hidden = report.findings.length === 0;
  comparisonTriageControlsEl.hidden = report.findings.length === 0;
  comparisonSeverityFilterEl.value = "all";
  comparisonFindingSearchEl.value = "";
  comparisonTriageFilterEl.value = "all";
  applyComparisonFindingFilters();
  applyComparisonTriageFilter();

  appendCollapsibleSection(compareReportDetailsEl, "comparison-key-changes", "Key changes", content => {
    appendComparisonChangeSection("access", renderListDiff("Required permissions", report.changes.requiredPermissions), countListDiff(report.changes.requiredPermissions) > 0, content);
    appendComparisonChangeSection("access", renderListDiff("Optional permissions", report.changes.optionalPermissions), countListDiff(report.changes.optionalPermissions) > 0, content);
    appendComparisonChangeSection("access", renderListDiff("Required host access", report.changes.requiredHosts), countListDiff(report.changes.requiredHosts) > 0, content);
    appendComparisonChangeSection("access", renderListDiff("Optional host access", report.changes.optionalHosts), countListDiff(report.changes.optionalHosts) > 0, content);
    appendComparisonChangeSection("access", renderListDiff("OAuth scopes", report.changes.oauthScopes), countListDiff(report.changes.oauthScopes) > 0, content);
    appendComparisonChangeSection("scripts", renderListDiff("Content-script match scope", report.changes.contentScriptMatches), countListDiff(report.changes.contentScriptMatches) > 0, content);
    appendComparisonChangeSection("scripts", renderContentScriptChanges(report.changes.contentScripts), countListDiff(report.changes.contentScripts) > 0, content);
    appendComparisonChangeSection("commands", renderListDiff("Keyboard commands", report.changes.commands), countListDiff(report.changes.commands) > 0, content);
    appendComparisonChangeSection("surfaces", renderListDiff("Extension surfaces", report.changes.surfaces), countListDiff(report.changes.surfaces) > 0, content);
    appendComparisonChangeSection("rules", renderStaticRulesetChanges(report.changes.staticRulesets), (report.changes.staticRulesets.added.length + report.changes.staticRulesets.removed.length + report.changes.staticRulesets.changed.length) > 0, content);
    appendComparisonChangeSection("external", renderListDiff("External messaging matches", report.changes.externalMessaging.matches), countListDiff(report.changes.externalMessaging.matches) > 0, content);
    appendComparisonChangeSection("external", renderListDiff("External messaging extension IDs", report.changes.externalMessaging.ids), countListDiff(report.changes.externalMessaging.ids) > 0, content);
    appendComparisonChangeSection("external", renderWebAccessibleResourceChanges(report.changes.webAccessibleResources), countListDiff(report.changes.webAccessibleResources) > 0, content);
    appendComparisonChangeSection("declarations", renderDeclarationChanges(report.changes.declarations), report.changes.declarations.length > 0, content);
    appendComparisonChangeSection("identity", renderExtensionKeyChange(report.changes.extensionKey), report.changes.extensionKey.changed, content);
    appendComparisonChangeSection("coverage", renderKeyValueChanges(
      "Unmodeled top-level manifest keys",
      report.changes.unmodeledTopLevelKeys
    ), (report.changes.unmodeledTopLevelKeys.added.length + report.changes.unmodeledTopLevelKeys.removed.length + report.changes.unmodeledTopLevelKeys.changed.length) > 0, content);
  }, comparisonCollapsibleSections);
  comparisonChangeFilterControlsEl.hidden = false;
  comparisonChangeFilterEl.value = "all";
  comparisonChangedOnlyEl.checked = false;
  applyComparisonChangeFilter("all");

  appendCollapsibleSection(compareReportDetailsEl, "comparison-limitations", "Limitations", content => {
    content.appendChild(el("p", {
      text: "This is a static comparison of two manifest files only. Neither release has been loaded, "
        + "executed, or tested in a browser. It does not read extension source files or verify runtime behavior."
    }));
  }, comparisonCollapsibleSections);
}

function updateCandidateChecklistProgress() {
  const total = candidateChecklistState.length;
  const completed = candidateChecklistState.filter(item => item.done).length;
  candidateChecklistProgressEl.textContent = total === 0
    ? "No candidate-release checklist items for this comparison."
    : `${completed} of ${total} candidate-release checklist items completed.`;
  updateComparisonReadiness();
  applyChecklistFilter(candidateChecklistState, candidateChecklistFilterEl.value, candidateChecklistFilterStatusEl);
  updateCompareJumpNav();
}

candidateChecklistFilterEl.addEventListener("change", () => {
  applyChecklistFilter(
    candidateChecklistState,
    candidateChecklistFilterEl.value,
    candidateChecklistFilterStatusEl
  );
});

resetCandidateChecklistButton.addEventListener("click", () => {
  resetChecklist(candidateChecklistState, candidateChecklistFilterEl, updateCandidateChecklistProgress);
});

function appendCandidateChecklistItem(id, laneId, check) {
  createChecklistEntry(candidateChecklistConfig, id, laneId, check, false);
}

function renderCandidateChecklist(candidateAnalysis, comparisonReport) {
  candidateChecklistListEl.textContent = "";
  candidateChecklistState = [];
  candidateChecklistCustomCounter = 0;
  candidateChecklistAddInputEl.value = "";
  candidateChecklistAddStatusEl.textContent = "";

  comparisonReport.findings.forEach((finding, findingIndex) => {
    appendCandidateChecklistItem(
      `candidate-comparison-item-${findingIndex}`,
      `comparison-${finding.id}`,
      finding.message
    );
  });

  candidateAnalysis.lanes.forEach((lane, laneIndex) => {
    lane.checks.forEach((check, checkIndex) => {
      const id = `candidate-checklist-item-${laneIndex}-${checkIndex}`;
      appendCandidateChecklistItem(id, lane.id, check);
    });
  });
  syncChecklistOrder(candidateChecklistConfig);

  candidateChecklistEl.hidden = candidateChecklistState.length === 0;
  candidateChecklistControlsEl.hidden = candidateChecklistState.length === 0;
  candidateChecklistFilterEl.value = "all";
  exportComparisonButton.disabled = candidateChecklistState.length === 0;
  exportComparisonMarkdownButton.disabled = candidateChecklistState.length === 0;
  exportComparisonSafeSummaryButton.disabled = false;
  exportComparisonStatusEl.textContent = "";
  updateCandidateChecklistProgress();
}

function buildComparisonMarkdown(report, checklist, findingsTriage = []) {
  const lines = [];
  lines.push("# MV3 Replay comparison report");
  lines.push("");
  lines.push(`Exported: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Release identity");
  lines.push(`- From: ${escapeMarkdownText(report.from.name)} v${escapeMarkdownText(report.from.version)}`);
  lines.push(`- To: ${escapeMarkdownText(report.to.name)} v${escapeMarkdownText(report.to.version)}`);
  lines.push(`- Chrome version ordering: ${escapeMarkdownText(report.changes.version.relation)}`);
  lines.push("");
  lines.push("## Structured change count");
  lines.push(`- Total: ${countComparisonChanges(report.changes)}`);
  for (const [label, count] of comparisonChangeBreakdown(report.changes)) {
    lines.push(`- ${escapeMarkdownText(label)}: ${count}`);
  }
  lines.push("");
  lines.push("## Manual update validation");
  lines.push(
    report.requiresManualUpdateValidation
      ? "This release requires manual update-path validation before it ships."
      : "No critical-level findings were detected, but review the findings below before shipping."
  );
  lines.push("");
  lines.push("## Findings");
  if (report.findings.length === 0) {
    lines.push("No comparison findings were detected in this static analysis.");
  } else {
    for (const finding of report.findings) {
      lines.push(
        `- **${escapeMarkdownText(finding.id)}** (${escapeMarkdownText(finding.level)}): ${escapeMarkdownText(finding.message)}`
      );
    }
  }
  lines.push("");
  lines.push("## Key changes");
  const changeTitles = [
    ["requiredPermissions", "Required permissions"],
    ["optionalPermissions", "Optional permissions"],
    ["requiredHosts", "Required host access"],
    ["optionalHosts", "Optional host access"],
    ["oauthScopes", "OAuth scopes"],
    ["contentScriptMatches", "Content-script match scope"],
    ["commands", "Keyboard commands"],
    ["surfaces", "Extension surfaces"]
  ];
  for (const [key, title] of changeTitles) {
    const diff = report.changes[key];
    const added = diff && diff.added && diff.added.length
      ? diff.added.map(escapeMarkdownText).join(", ")
      : "none";
    const removed = diff && diff.removed && diff.removed.length
      ? diff.removed.map(escapeMarkdownText).join(", ")
      : "none";
    lines.push(`- ${title} — Added: ${added}; Removed: ${removed}`);
  }
  lines.push("");
  lines.push("### Content-script registrations");
  if (report.changes.contentScripts.added.length === 0 && report.changes.contentScripts.removed.length === 0) {
    lines.push("No content-script registration changed.");
  } else {
    for (const registration of report.changes.contentScripts.added) {
      lines.push(`- Added: ${escapeMarkdownText(formatContentScriptRegistration(registration))}`);
    }
    for (const registration of report.changes.contentScripts.removed) {
      lines.push(`- Removed: ${escapeMarkdownText(formatContentScriptRegistration(registration))}`);
    }
  }
  lines.push("");
  lines.push("### Static DNR rulesets");
  lines.push(`- Added: ${report.changes.staticRulesets.added.length ? report.changes.staticRulesets.added.map(escapeMarkdownText).join(", ") : "none"}`);
  lines.push(`- Removed: ${report.changes.staticRulesets.removed.length ? report.changes.staticRulesets.removed.map(escapeMarkdownText).join(", ") : "none"}`);
  lines.push(`- Changed: ${report.changes.staticRulesets.changed.length ? report.changes.staticRulesets.changed.map(escapeMarkdownText).join(", ") : "none"}`);
  lines.push("");
  lines.push("### External messaging");
  for (const [title, diff] of [
    ["Matches", report.changes.externalMessaging.matches],
    ["Extension IDs", report.changes.externalMessaging.ids]
  ]) {
    const added = diff.added.length ? diff.added.map(escapeMarkdownText).join(", ") : "none";
    const removed = diff.removed.length ? diff.removed.map(escapeMarkdownText).join(", ") : "none";
    lines.push(`- ${title} — Added: ${added}; Removed: ${removed}`);
  }
  lines.push("");
  lines.push("### Web-accessible resources");
  if (report.changes.webAccessibleResources.added.length === 0 && report.changes.webAccessibleResources.removed.length === 0) {
    lines.push("No web-accessible resource declaration changed.");
  } else {
    for (const declaration of report.changes.webAccessibleResources.added) {
      lines.push(`- Added: ${escapeMarkdownText(formatWebAccessibleResource(declaration))}`);
    }
    for (const declaration of report.changes.webAccessibleResources.removed) {
      lines.push(`- Removed: ${escapeMarkdownText(formatWebAccessibleResource(declaration))}`);
    }
  }
  lines.push("");
  lines.push("### Manifest declarations");
  if (report.changes.declarations.length === 0) {
    lines.push("No modeled manifest declaration values changed.");
  } else {
    for (const change of report.changes.declarations) {
      lines.push(
        `- ${escapeMarkdownText(change.field)}: ${escapeMarkdownText(formatDeclarationValue(change.previous))} → ${escapeMarkdownText(formatDeclarationValue(change.current))}`
      );
    }
  }
  lines.push("");
  lines.push("### Extension identity key");
  lines.push(`- Previous declared: ${report.changes.extensionKey.previousDeclared ? "yes" : "no"}`);
  lines.push(`- Current declared: ${report.changes.extensionKey.currentDeclared ? "yes" : "no"}`);
  lines.push(`- Changed: ${report.changes.extensionKey.changed ? "yes" : "no"}`);
  lines.push("");
  lines.push("### Unmodeled top-level manifest keys");
  lines.push(`- Added: ${report.changes.unmodeledTopLevelKeys.added.length ? report.changes.unmodeledTopLevelKeys.added.map(escapeMarkdownText).join(", ") : "none"}`);
  lines.push(`- Removed: ${report.changes.unmodeledTopLevelKeys.removed.length ? report.changes.unmodeledTopLevelKeys.removed.map(escapeMarkdownText).join(", ") : "none"}`);
  lines.push(`- Changed: ${report.changes.unmodeledTopLevelKeys.changed.length ? report.changes.unmodeledTopLevelKeys.changed.map(escapeMarkdownText).join(", ") : "none"}`);
  lines.push("");
  lines.push("## Finding triage (private)");
  if (findingsTriage.length === 0) {
    lines.push("No findings to triage.");
  } else {
    for (const triage of findingsTriage) {
      lines.push(
        `- ${escapeMarkdownText(triage.findingId)}: pinned=${triage.pinned ? "yes" : "no"}; acknowledged=${triage.acknowledged ? "yes" : "no"}`
      );
      if (triage.note && String(triage.note).trim() !== "") {
        lines.push(`  - Private note: ${escapeMarkdownText(triage.note)}`);
      }
    }
  }
  lines.push("");
  lines.push("## Candidate-release checklist");
  if (checklist.length === 0) {
    lines.push("No candidate-release checklist items for this comparison.");
  } else {
    for (const item of checklist) {
      lines.push(
        `- [${item.done ? "x" : " "}] ${escapeMarkdownText(item.laneId)}: ${escapeMarkdownText(item.check)}`
      );
      if (item.note && String(item.note).trim() !== "") {
        lines.push(`  - Private note: ${escapeMarkdownText(item.note)}`);
      }
    }
  }
  lines.push("");
  lines.push("## Limitations");
  lines.push(
    "This is a static comparison of two manifest files only. Neither release has been loaded, "
      + "executed, or tested in a browser. It does not read extension source files or verify runtime behavior."
  );
  lines.push("");
  return lines.join("\n");
}

function buildShareSafeComparisonSummary(report, checklist) {
  const completed = checklist.filter(item => item.done).length;
  return [
    "# MV3 Replay share-safe structural comparison summary",
    "",
    "> Generated locally on explicit user request. No data was uploaded.",
    "> Excludes release names, versions, URLs, filenames, manifest values, finding messages, and checklist text.",
    "",
    "## Structured change counts",
    `- Total: ${countComparisonChanges(report.changes)}`,
    ...comparisonChangeBreakdown(report.changes).map(([label, count]) => `- ${label}: ${count}`),
    "",
    "## Finding severity counts",
    ...severityCountLines(report.findings),
    "",
    "## Manual validation",
    `- Critical update-path validation required: ${report.requiresManualUpdateValidation ? "yes" : "no"}`,
    "",
    "## Candidate checklist progress",
    `- Completed: ${completed}`,
    `- Total: ${checklist.length}`,
    "",
    "This sanitized structural summary is still a static comparison, not proof of runtime testing or update safety.",
    ""
  ].join("\n");
}

exportComparisonButton.addEventListener("click", () => {
  if (!currentCompareReport || !currentCandidateAnalysis) return;

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    comparisonReport: currentCompareReport,
    candidateAnalysis: currentCandidateAnalysis,
    candidateChecklist: candidateChecklistState.map(({ id, laneId, check, done, custom, note }) => ({ id, laneId, check, done, custom, note })),
    findingsTriage: comparisonFindingNodes.map(({ findingId, pinned, acknowledged, note }) => ({ findingId, pinned, acknowledged, note }))
  };

  downloadLocalFile(
    "mv3-replay-comparison-checklist.json",
    JSON.stringify(exportPayload, null, 2),
    "application/json"
  );

  exportComparisonStatusEl.textContent = "Comparison and candidate checklist exported to a local JSON file.";
});

exportComparisonMarkdownButton.addEventListener("click", () => {
  if (!currentCompareReport || !currentCandidateAnalysis) return;

  const markdown = buildComparisonMarkdown(currentCompareReport, candidateChecklistState, comparisonFindingNodes.map(({ findingId, pinned, acknowledged, note }) => ({ findingId, pinned, acknowledged, note })));
  downloadLocalFile("mv3-replay-comparison-checklist.md", markdown, "text/markdown");

  exportComparisonStatusEl.textContent = "Comparison and candidate checklist exported to a local Markdown file.";
});

exportComparisonSafeSummaryButton.addEventListener("click", () => {
  if (!currentCompareReport) return;
  downloadLocalFile(
    "mv3-replay-share-safe-comparison-summary.md",
    buildShareSafeComparisonSummary(currentCompareReport, candidateChecklistState),
    "text/markdown"
  );
  exportComparisonStatusEl.textContent = "Share-safe structural comparison summary downloaded locally.";
});

function resetComparisonResults() {
  compareReportEl.hidden = true;
  compareJumpNavEl.hidden = true;
  compareReportSummaryEl.textContent = "";
  compareReportDetailsEl.textContent = "";
  comparisonReadinessEl.textContent = "";
  comparisonFilterControlsEl.hidden = true;
  comparisonSeverityFilterEl.value = "all";
  comparisonFindingSearchEl.value = "";
  comparisonFilterStatusEl.textContent = "";
  comparisonTriageControlsEl.hidden = true;
  comparisonTriageFilterEl.value = "all";
  comparisonTriageFilterStatusEl.textContent = "";
  comparisonFindingNodes = [];
  comparisonFindingsContentEl = null;
  comparisonChangeFilterControlsEl.hidden = true;
  comparisonChangeFilterEl.value = "all";
  comparisonChangedOnlyEl.checked = false;
  comparisonChangeFilterStatusEl.textContent = "";
  comparisonChangeSectionNodes = [];
  comparisonCollapsibleSections = [];
  candidateChecklistEl.hidden = true;
  candidateChecklistControlsEl.hidden = true;
  candidateChecklistFilterStatusEl.textContent = "";
  candidateChecklistListEl.textContent = "";
  candidateChecklistProgressEl.textContent = "";
  candidateChecklistAddInputEl.value = "";
  candidateChecklistAddStatusEl.textContent = "";
  exportComparisonStatusEl.textContent = "";
  exportComparisonButton.disabled = true;
  exportComparisonMarkdownButton.disabled = true;
  exportComparisonSafeSummaryButton.disabled = true;
  currentCompareReport = null;
  currentCandidateAnalysis = null;
  candidateChecklistState = [];
  candidateChecklistCustomCounter = 0;
}

async function runComparison(previousManifest, currentManifest, isExample) {
  setCompareStatus(isExample ? "Comparing built-in example releases locally..." : "Comparing locally...");
  try {
    const response = await fetch("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previous: previousManifest, current: currentManifest })
    });
    const data = await response.json();
    if (!response.ok) {
      setCompareStatus(data.error || "The manifests could not be compared.");
      focusElement(compareStatusEl);
      return;
    }
    setCompareStatus(isExample ? "Built-in example comparison complete — this is sample data." : "Comparison complete.");
    currentCompareReport = data.report;
    currentCandidateAnalysis = data.candidateAnalysis;
    renderCompareReport(data.report);
    renderComparisonSummary(data.report);
    if (isExample) {
      compareReportSummaryEl.prepend(el("p", { className: "example-label", text: "Built-in example — not your extension" }));
    }
    renderCandidateChecklist(data.candidateAnalysis, data.report);
    updateCompareJumpNav();
    addRecentRun(
      `Compare — changes: ${countComparisonChanges(data.report.changes)}, findings: ${data.report.findings.length}`,
      () => runComparison(previousManifest, currentManifest, isExample)
    );
    // Move focus to the result heading only after a successful run, never
    // while the user might still be typing in a form field.
    focusElement(compareReportHeadingEl);
  } catch {
    setCompareStatus("The local comparison endpoint could not be reached.");
    focusElement(compareStatusEl);
  }
}

// Resolves one compare side's manifest, preferring an in-memory pasted
// manifest over a selected file or folder. Reading only occurs here so both
// drag-and-drop and paste imports share this same local-only path.
async function resolveCompareSideManifest(fileInput, folderInput, pastedManifest, label) {
  if (pastedManifest) return { manifest: pastedManifest, error: null };

  let file = fileInput.files[0];
  if (!file && folderInput.files.length > 0) {
    const { file: folderManifest, error } = findRootManifestInFolder(folderInput.files);
    if (error) return { manifest: null, error: `${label}: ${error}` };
    file = folderManifest;
  }
  if (!file) return { manifest: null, error: null };

  try {
    const text = await readFileAsText(file);
    const manifest = JSON.parse(text);
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      return { manifest: null, error: `${label}: the selected file must contain a JSON object.` };
    }
    return { manifest, error: null };
  } catch {
    return { manifest: null, error: `${label}: the selected file must be valid JSON.` };
  }
}

async function performCompare() {
  resetComparisonResults();
  setActionGroupLoading(compareSubmitButton, compareExampleButton, compareForm, true, "Comparing...", "Compare locally");
  try {
    setCompareStatus("Reading local manifests...");
    const previousResult = await resolveCompareSideManifest(previousFileInput, previousFolderInput, pastedPreviousManifest, "Previous release");
    if (previousResult.error) {
      setCompareStatus(previousResult.error);
      focusElement(compareStatusEl);
      return;
    }
    const candidateResult = await resolveCompareSideManifest(candidateFileInput, candidateFolderInput, pastedCurrentManifest, "Candidate release");
    if (candidateResult.error) {
      setCompareStatus(candidateResult.error);
      focusElement(compareStatusEl);
      return;
    }
    if (!previousResult.manifest || !candidateResult.manifest) {
      setCompareStatus("Select both a previous and a candidate manifest.json file, folder, or pasted JSON.");
      focusElement(compareStatusEl);
      return;
    }
    await runComparison(previousResult.manifest, candidateResult.manifest, false);
  } finally {
    setActionGroupLoading(compareSubmitButton, compareExampleButton, compareForm, false, "Comparing...", "Compare locally");
  }
}

compareForm.addEventListener("submit", async event => {
  event.preventDefault();
  await performCompare();
});

// Swaps the previous and current compare sides (files, folders, pasted
// manifests, and their local status text) and, if a comparison is already
// shown, recomputes it locally against the swapped sides. No new data leaves
// the browser: this only reorders manifests already held in memory.
swapCompareButton.addEventListener("click", async () => {
  const previousFiles = previousFileInput.files;
  const candidateFiles = candidateFileInput.files;
  try {
    previousFileInput.files = candidateFiles;
    candidateFileInput.files = previousFiles;
  } catch {
    // If direct FileList assignment is unavailable, pasted manifests and
    // folders can still be swapped below.
  }

  const previousFolders = previousFolderInput.files;
  const candidateFolders = candidateFolderInput.files;
  try {
    previousFolderInput.files = candidateFolders;
    candidateFolderInput.files = previousFolders;
  } catch {
    // See note above.
  }

  const swappedPasted = pastedPreviousManifest;
  pastedPreviousManifest = pastedCurrentManifest;
  pastedCurrentManifest = swappedPasted;

  const previousStatusText = previousManifestFileStatusEl.textContent;
  previousManifestFileStatusEl.textContent = candidateManifestFileStatusEl.textContent;
  candidateManifestFileStatusEl.textContent = previousStatusText;

  setCompareStatus("Swapped the previous and current manifest selections.");

  if (currentCompareReport) {
    await performCompare();
    if (currentCompareReport) {
      setCompareStatus("Swapped the previous and current manifests. Comparison complete.");
    }
  }
});

compareExampleButton.addEventListener("click", async () => {
  resetComparisonResults();
  previousFileInput.value = "";
  previousFolderInput.value = "";
  candidateFileInput.value = "";
  candidateFolderInput.value = "";
  pastedPreviousManifest = null;
  pastedCurrentManifest = null;
  setActionGroupLoading(compareSubmitButton, compareExampleButton, compareForm, true, "Comparing...", "Compare locally");
  try {
    await runComparison(EXAMPLE_PREVIOUS_MANIFEST, EXAMPLE_CANDIDATE_MANIFEST, true);
  } finally {
    setActionGroupLoading(compareSubmitButton, compareExampleButton, compareForm, false, "Comparing...", "Compare locally");
  }
});

// Removes every selected manifest reference, rendered result, filter,
// checklist, transient error, and in-memory feedback status without a page
// reload and without touching any persistence layer (there is none).
clearWorkspaceButton.addEventListener("click", () => {
  resetAnalysisResults();
  resetComparisonResults();

  fileInput.value = "";
  folderInput.value = "";
  previousFileInput.value = "";
  previousFolderInput.value = "";
  candidateFileInput.value = "";
  candidateFolderInput.value = "";

  pastedPreviousManifest = null;
  pastedCurrentManifest = null;

  setInputStatus(manifestFileStatusEl, "empty", "No file selected.");
  setInputStatus(manifestFolderStatusEl, "empty", "No folder selected.");
  setInputStatus(previousManifestFileStatusEl, "empty", "No file selected.");
  setInputStatus(previousManifestFolderStatusEl, "empty", "No folder selected.");
  setInputStatus(candidateManifestFileStatusEl, "empty", "No file selected.");
  setInputStatus(candidateManifestFolderStatusEl, "empty", "No folder selected.");

  pasteJsonPanelEl.hidden = true;
  pasteJsonTextareaEl.value = "";
  pasteJsonStatusEl.textContent = "";

  setStatus("");
  setCompareStatus("");
  feedbackTemplateStatusEl.textContent = "";
  exportStatusEl.textContent = "";
  exportComparisonStatusEl.textContent = "";

  recentRuns = [];
  renderRecentRuns();

  resetDisplayPreferences();
  setWorkflowMode("inspect");

  clearWorkspaceStatusEl.textContent = "Workspace cleared. All local selections and results were removed.";
});
