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

const checklistEl = document.getElementById("checklist");
const checklistListEl = document.getElementById("checklist-list");
const checklistProgressEl = document.getElementById("checklist-progress");
const checklistControlsEl = document.getElementById("checklist-controls");
const checklistFilterEl = document.getElementById("checklist-filter");
const checklistFilterStatusEl = document.getElementById("checklist-filter-status");
const resetChecklistButton = document.getElementById("reset-checklist");
const exportButton = document.getElementById("export-checklist");
const exportMarkdownButton = document.getElementById("export-checklist-markdown");
const exportAnalysisSafeSummaryButton = document.getElementById("export-analysis-safe-summary");
const exportStatusEl = document.getElementById("export-status");

// Checklist state exists only for the lifetime of this page.
let currentReport = null;
let checklistState = [];
let analysisFindingNodes = [];

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

const candidateChecklistEl = document.getElementById("candidate-checklist");
const candidateChecklistListEl = document.getElementById("candidate-checklist-list");
const candidateChecklistProgressEl = document.getElementById("candidate-checklist-progress");
const candidateChecklistControlsEl = document.getElementById("candidate-checklist-controls");
const candidateChecklistFilterEl = document.getElementById("candidate-checklist-filter");
const candidateChecklistFilterStatusEl = document.getElementById("candidate-checklist-filter-status");
const resetCandidateChecklistButton = document.getElementById("reset-candidate-checklist");
const exportComparisonButton = document.getElementById("export-comparison");
const exportComparisonMarkdownButton = document.getElementById("export-comparison-markdown");
const exportComparisonSafeSummaryButton = document.getElementById("export-comparison-safe-summary");
const exportComparisonStatusEl = document.getElementById("export-comparison-status");

// Candidate checklist state exists only for the lifetime of this page.
let currentCompareReport = null;
let currentCandidateAnalysis = null;
let candidateChecklistState = [];
let comparisonFindingNodes = [];
let comparisonChangeSectionNodes = [];

function setStatus(message) {
  statusEl.textContent = message;
}

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
  const criticalCount = currentReport.riskFlags.filter(flag => flag.level === "critical").length;
  const remaining = checklistState.filter(item => !item.done).length;
  if (criticalCount > 0) {
    setReadiness(
      analysisReadinessEl,
      "blocked",
      "Review required",
      `${criticalCount} critical finding${criticalCount === 1 ? "" : "s"} must be reviewed before browser testing.`
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
  if (currentCompareReport.requiresManualUpdateValidation) {
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

function applyFindingFilter(entries, filterValue, statusEl) {
  let visible = 0;
  for (const entry of entries) {
    const matches = filterValue === "all" || entry.level === filterValue;
    entry.node.hidden = !matches;
    if (matches) visible += 1;
  }
  const label = filterValue === "all" ? "all severities" : filterValue;
  statusEl.textContent = `${visible} finding${visible === 1 ? "" : "s"} shown (${label}).`;
}

analysisSeverityFilterEl.addEventListener("change", () => {
  applyFindingFilter(analysisFindingNodes, analysisSeverityFilterEl.value, analysisFilterStatusEl);
});

comparisonSeverityFilterEl.addEventListener("change", () => {
  applyFindingFilter(comparisonFindingNodes, comparisonSeverityFilterEl.value, comparisonFilterStatusEl);
});

function appendComparisonChangeSection(category, node, hasChanges) {
  node.className = `${node.className || ""} change-section`.trim();
  node.setAttribute("data-change-category", category);
  node.setAttribute("data-has-changes", String(hasChanges));
  comparisonChangeSectionNodes.push({ category, hasChanges, node });
  compareReportDetailsEl.appendChild(node);
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
  reportEl.hidden = false;

  reportDetailsEl.appendChild(el("h2", { text: "Identity" }));
  reportDetailsEl.appendChild(el("p", {
    text: `${report.identity.name} — version ${report.identity.version} (Manifest V${report.identity.manifestVersion})`
  }));

  reportDetailsEl.appendChild(el("h2", { text: "Detected surfaces" }));
  const surfaceList = el("ul");
  for (const [key, value] of Object.entries(report.surfaces)) {
    surfaceList.appendChild(el("li", { text: `${key}: ${String(value)}` }));
  }
  reportDetailsEl.appendChild(surfaceList);

  reportDetailsEl.appendChild(el("h2", { text: "Coverage gaps" }));
  reportDetailsEl.appendChild(el("p", {
    text: report.coverage.unmodeledTopLevelKeys.length > 0
      ? `Top-level manifest keys not interpreted by this analyzer: ${report.coverage.unmodeledTopLevelKeys.join(", ")}.`
      : "Every top-level manifest key in this file is modeled by the current analyzer."
  }));

  reportDetailsEl.appendChild(el("h2", { text: "Test lanes" }));
  if (report.lanes.length === 0) {
    reportDetailsEl.appendChild(el("p", { text: "No test lanes were derived from this manifest." }));
  } else {
    for (const lane of report.lanes) reportDetailsEl.appendChild(renderLane(lane));
  }

  reportDetailsEl.appendChild(el("h2", { text: "Findings" }));
  if (report.riskFlags.length === 0) {
    reportDetailsEl.appendChild(el("p", { text: "No risk flags were detected in this static analysis." }));
  } else {
    for (const flag of report.riskFlags) {
      const node = renderFinding(flag);
      analysisFindingNodes.push({ level: flag.level, node });
      reportDetailsEl.appendChild(node);
    }
  }
  analysisFilterControlsEl.hidden = report.riskFlags.length === 0;
  analysisSeverityFilterEl.value = "all";
  applyFindingFilter(analysisFindingNodes, "all", analysisFilterStatusEl);

  reportDetailsEl.appendChild(el("h2", { text: "Limitations" }));
  reportDetailsEl.appendChild(el("p", {
    text: "This is a static manifest analysis only. The extension has not been loaded, executed, or "
      + "tested in a browser. It does not read extension source files or verify runtime behavior."
  }));
}

function updateChecklistProgress() {
  const total = checklistState.length;
  const completed = checklistState.filter(item => item.done).length;
  checklistProgressEl.textContent = total === 0
    ? "No checklist items for this manifest."
    : `${completed} of ${total} checklist items completed.`;
  updateAnalysisReadiness();
  applyChecklistFilter(checklistState, checklistFilterEl.value, checklistFilterStatusEl);
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

checklistFilterEl.addEventListener("change", () => {
  applyChecklistFilter(checklistState, checklistFilterEl.value, checklistFilterStatusEl);
});

resetChecklistButton.addEventListener("click", () => {
  resetChecklist(checklistState, checklistFilterEl, updateChecklistProgress);
});

function renderChecklist(report) {
  checklistListEl.textContent = "";
  checklistState = [];

  report.lanes.forEach((lane, laneIndex) => {
    lane.checks.forEach((check, checkIndex) => {
      const id = `checklist-item-${laneIndex}-${checkIndex}`;
      const item = el("li", { className: "checklist-item" });
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = id;
      checkbox.addEventListener("change", () => {
        const entry = checklistState.find(candidate => candidate.id === id);
        if (entry) entry.done = checkbox.checked;
        updateChecklistProgress();
      });
      const label = document.createElement("label");
      label.htmlFor = id;
      label.textContent = `${lane.id}: ${check}`;

      checklistState.push({ id, laneId: lane.id, check, done: false, node: item, checkbox });

      item.appendChild(checkbox);
      item.appendChild(label);
      checklistListEl.appendChild(item);
    });
  });

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

function buildAnalysisMarkdown(report, checklist) {
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
  lines.push("## Test checklist");
  if (checklist.length === 0) {
    lines.push("No checklist items for this manifest.");
  } else {
    for (const item of checklist) {
      lines.push(
        `- [${item.done ? "x" : " "}] ${escapeMarkdownText(item.laneId)}: ${escapeMarkdownText(item.check)}`
      );
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
    checklist: checklistState.map(({ id, laneId, check, done }) => ({ id, laneId, check, done }))
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

  const markdown = buildAnalysisMarkdown(currentReport, checklistState);
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
  } catch {
    setStatus("The local analyzer could not be reached.");
  }
}

function resetAnalysisResults() {
  reportEl.hidden = true;
  reportSummaryEl.textContent = "";
  reportDetailsEl.textContent = "";
  analysisReadinessEl.textContent = "";
  analysisFilterControlsEl.hidden = true;
  analysisSeverityFilterEl.value = "all";
  analysisFilterStatusEl.textContent = "";
  analysisFindingNodes = [];
  checklistEl.hidden = true;
  checklistControlsEl.hidden = true;
  checklistFilterStatusEl.textContent = "";
  checklistListEl.textContent = "";
  checklistProgressEl.textContent = "";
  exportStatusEl.textContent = "";
  exportButton.disabled = true;
  exportMarkdownButton.disabled = true;
  exportAnalysisSafeSummaryButton.disabled = true;
  currentReport = null;
  checklistState = [];
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
        return;
      }
      file = folderManifest;
    }
    if (!file) {
      setStatus("Select a local manifest.json file or an unpacked extension folder first.");
      return;
    }

    setStatus("Reading local file...");
    let manifest;
    try {
      const text = await readFileAsText(file);
      manifest = JSON.parse(text);
    } catch {
      setStatus("The selected file is not valid JSON.");
      return;
    }

    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      setStatus("The selected file must contain a JSON object.");
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
  compareReportEl.hidden = false;

  compareReportDetailsEl.appendChild(el("h2", { text: "Release identity" }));
  compareReportDetailsEl.appendChild(el("p", {
    text: `From ${report.from.name} v${report.from.version} to ${report.to.name} v${report.to.version}`
  }));
  compareReportDetailsEl.appendChild(el("p", {
    text: `Chrome version ordering: ${report.changes.version.relation}.`
  }));

  compareReportDetailsEl.appendChild(el("h2", { text: "Manual update validation" }));
  compareReportDetailsEl.appendChild(el("p", {
    text: report.requiresManualUpdateValidation
      ? "This release requires manual update-path validation before it ships."
      : "No critical-level findings were detected, but review the findings below before shipping."
  }));

  compareReportDetailsEl.appendChild(el("h2", { text: "Findings" }));
  if (report.findings.length === 0) {
    compareReportDetailsEl.appendChild(el("p", { text: "No comparison findings were detected in this static analysis." }));
  } else {
    for (const finding of report.findings) {
      const node = renderFinding(finding);
      comparisonFindingNodes.push({ level: finding.level, node });
      compareReportDetailsEl.appendChild(node);
    }
  }
  comparisonFilterControlsEl.hidden = report.findings.length === 0;
  comparisonSeverityFilterEl.value = "all";
  applyFindingFilter(comparisonFindingNodes, "all", comparisonFilterStatusEl);

  compareReportDetailsEl.appendChild(el("h2", { text: "Key changes" }));
  appendComparisonChangeSection("access", renderListDiff("Required permissions", report.changes.requiredPermissions), countListDiff(report.changes.requiredPermissions) > 0);
  appendComparisonChangeSection("access", renderListDiff("Optional permissions", report.changes.optionalPermissions), countListDiff(report.changes.optionalPermissions) > 0);
  appendComparisonChangeSection("access", renderListDiff("Required host access", report.changes.requiredHosts), countListDiff(report.changes.requiredHosts) > 0);
  appendComparisonChangeSection("access", renderListDiff("Optional host access", report.changes.optionalHosts), countListDiff(report.changes.optionalHosts) > 0);
  appendComparisonChangeSection("access", renderListDiff("OAuth scopes", report.changes.oauthScopes), countListDiff(report.changes.oauthScopes) > 0);
  appendComparisonChangeSection("scripts", renderListDiff("Content-script match scope", report.changes.contentScriptMatches), countListDiff(report.changes.contentScriptMatches) > 0);
  appendComparisonChangeSection("scripts", renderContentScriptChanges(report.changes.contentScripts), countListDiff(report.changes.contentScripts) > 0);
  appendComparisonChangeSection("commands", renderListDiff("Keyboard commands", report.changes.commands), countListDiff(report.changes.commands) > 0);
  appendComparisonChangeSection("surfaces", renderListDiff("Extension surfaces", report.changes.surfaces), countListDiff(report.changes.surfaces) > 0);
  appendComparisonChangeSection("rules", renderStaticRulesetChanges(report.changes.staticRulesets), (report.changes.staticRulesets.added.length + report.changes.staticRulesets.removed.length + report.changes.staticRulesets.changed.length) > 0);
  appendComparisonChangeSection("external", renderListDiff("External messaging matches", report.changes.externalMessaging.matches), countListDiff(report.changes.externalMessaging.matches) > 0);
  appendComparisonChangeSection("external", renderListDiff("External messaging extension IDs", report.changes.externalMessaging.ids), countListDiff(report.changes.externalMessaging.ids) > 0);
  appendComparisonChangeSection("external", renderWebAccessibleResourceChanges(report.changes.webAccessibleResources), countListDiff(report.changes.webAccessibleResources) > 0);
  appendComparisonChangeSection("declarations", renderDeclarationChanges(report.changes.declarations), report.changes.declarations.length > 0);
  appendComparisonChangeSection("identity", renderExtensionKeyChange(report.changes.extensionKey), report.changes.extensionKey.changed);
  appendComparisonChangeSection("coverage", renderKeyValueChanges(
    "Unmodeled top-level manifest keys",
    report.changes.unmodeledTopLevelKeys
  ), (report.changes.unmodeledTopLevelKeys.added.length + report.changes.unmodeledTopLevelKeys.removed.length + report.changes.unmodeledTopLevelKeys.changed.length) > 0);
  comparisonChangeFilterControlsEl.hidden = false;
  comparisonChangeFilterEl.value = "all";
  comparisonChangedOnlyEl.checked = false;
  applyComparisonChangeFilter("all");

  compareReportDetailsEl.appendChild(el("h2", { text: "Limitations" }));
  compareReportDetailsEl.appendChild(el("p", {
    text: "This is a static comparison of two manifest files only. Neither release has been loaded, "
      + "executed, or tested in a browser. It does not read extension source files or verify runtime behavior."
  }));
}

function updateCandidateChecklistProgress() {
  const total = candidateChecklistState.length;
  const completed = candidateChecklistState.filter(item => item.done).length;
  candidateChecklistProgressEl.textContent = total === 0
    ? "No candidate-release checklist items for this comparison."
    : `${completed} of ${total} candidate-release checklist items completed.`;
  updateComparisonReadiness();
  applyChecklistFilter(candidateChecklistState, candidateChecklistFilterEl.value, candidateChecklistFilterStatusEl);
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
  const item = el("li", { className: "checklist-item" });
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = id;
  checkbox.addEventListener("change", () => {
    const entry = candidateChecklistState.find(candidate => candidate.id === id);
    if (entry) entry.done = checkbox.checked;
    updateCandidateChecklistProgress();
  });
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = `${laneId}: ${check}`;

  candidateChecklistState.push({ id, laneId, check, done: false, node: item, checkbox });
  item.appendChild(checkbox);
  item.appendChild(label);
  candidateChecklistListEl.appendChild(item);
}

function renderCandidateChecklist(candidateAnalysis, comparisonReport) {
  candidateChecklistListEl.textContent = "";
  candidateChecklistState = [];

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

  candidateChecklistEl.hidden = candidateChecklistState.length === 0;
  candidateChecklistControlsEl.hidden = candidateChecklistState.length === 0;
  candidateChecklistFilterEl.value = "all";
  exportComparisonButton.disabled = candidateChecklistState.length === 0;
  exportComparisonMarkdownButton.disabled = candidateChecklistState.length === 0;
  exportComparisonSafeSummaryButton.disabled = false;
  exportComparisonStatusEl.textContent = "";
  updateCandidateChecklistProgress();
}

function buildComparisonMarkdown(report, checklist) {
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
  lines.push("## Candidate-release checklist");
  if (checklist.length === 0) {
    lines.push("No candidate-release checklist items for this comparison.");
  } else {
    for (const item of checklist) {
      lines.push(
        `- [${item.done ? "x" : " "}] ${escapeMarkdownText(item.laneId)}: ${escapeMarkdownText(item.check)}`
      );
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
    candidateChecklist: candidateChecklistState.map(({ id, laneId, check, done }) => ({ id, laneId, check, done }))
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

  const markdown = buildComparisonMarkdown(currentCompareReport, candidateChecklistState);
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
  compareReportSummaryEl.textContent = "";
  compareReportDetailsEl.textContent = "";
  comparisonReadinessEl.textContent = "";
  comparisonFilterControlsEl.hidden = true;
  comparisonSeverityFilterEl.value = "all";
  comparisonFilterStatusEl.textContent = "";
  comparisonFindingNodes = [];
  comparisonChangeFilterControlsEl.hidden = true;
  comparisonChangeFilterEl.value = "all";
  comparisonChangedOnlyEl.checked = false;
  comparisonChangeFilterStatusEl.textContent = "";
  comparisonChangeSectionNodes = [];
  candidateChecklistEl.hidden = true;
  candidateChecklistControlsEl.hidden = true;
  candidateChecklistFilterStatusEl.textContent = "";
  candidateChecklistListEl.textContent = "";
  candidateChecklistProgressEl.textContent = "";
  exportComparisonStatusEl.textContent = "";
  exportComparisonButton.disabled = true;
  exportComparisonMarkdownButton.disabled = true;
  exportComparisonSafeSummaryButton.disabled = true;
  currentCompareReport = null;
  currentCandidateAnalysis = null;
  candidateChecklistState = [];
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
  } catch {
    setCompareStatus("The local comparison endpoint could not be reached.");
  }
}

compareForm.addEventListener("submit", async event => {
  event.preventDefault();
  resetComparisonResults();

  setActionGroupLoading(compareSubmitButton, compareExampleButton, compareForm, true, "Comparing...", "Compare locally");
  try {
  let previousFile = previousFileInput.files[0];
  if (!previousFile && previousFolderInput.files.length > 0) {
    const { file: folderManifest, error } = findRootManifestInFolder(previousFolderInput.files);
    if (error) {
      setCompareStatus(`Previous release: ${error}`);
      return;
    }
    previousFile = folderManifest;
  }

  let candidateFile = candidateFileInput.files[0];
  if (!candidateFile && candidateFolderInput.files.length > 0) {
    const { file: folderManifest, error } = findRootManifestInFolder(candidateFolderInput.files);
    if (error) {
      setCompareStatus(`Candidate release: ${error}`);
      return;
    }
    candidateFile = folderManifest;
  }

  if (!previousFile || !candidateFile) {
    setCompareStatus("Select both a previous and a candidate manifest.json file or folder.");
    return;
  }

  setCompareStatus("Reading local files...");
  let previousManifest;
  let currentManifest;
  try {
    const [previousText, candidateText] = await Promise.all([
      readFileAsText(previousFile),
      readFileAsText(candidateFile)
    ]);
    previousManifest = JSON.parse(previousText);
    currentManifest = JSON.parse(candidateText);
  } catch {
    setCompareStatus("Both selected files must be valid JSON.");
    return;
  }

  if (
    !previousManifest || typeof previousManifest !== "object" || Array.isArray(previousManifest)
    || !currentManifest || typeof currentManifest !== "object" || Array.isArray(currentManifest)
  ) {
    setCompareStatus("Both selected files must contain a JSON object.");
    return;
  }

  await runComparison(previousManifest, currentManifest, false);
  } finally {
    setActionGroupLoading(compareSubmitButton, compareExampleButton, compareForm, false, "Comparing...", "Compare locally");
  }
});

compareExampleButton.addEventListener("click", async () => {
  resetComparisonResults();
  previousFileInput.value = "";
  previousFolderInput.value = "";
  candidateFileInput.value = "";
  candidateFolderInput.value = "";
  setActionGroupLoading(compareSubmitButton, compareExampleButton, compareForm, true, "Comparing...", "Compare locally");
  try {
    await runComparison(EXAMPLE_PREVIOUS_MANIFEST, EXAMPLE_CANDIDATE_MANIFEST, true);
  } finally {
    setActionGroupLoading(compareSubmitButton, compareExampleButton, compareForm, false, "Comparing...", "Compare locally");
  }
});
