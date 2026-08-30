// Small, hard-coded, valid MV3 manifests used only for the built-in
// "try an example" flows below. These never leave the browser except via
// the same local /api/analyze and /api/compare requests used for real files.
const EXAMPLE_ANALYSIS_MANIFEST = {
  manifest_version: 3,
  name: "Built-in example extension",
  version: "1.0.0",
  permissions: ["storage", "notifications"],
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
  }
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
const analyzeSubmitButton = document.getElementById("analyze-submit");
const analyzeExampleButton = document.getElementById("analyze-example-button");
const fileInput = document.getElementById("manifest-file");
const folderInput = document.getElementById("manifest-folder");
const statusEl = document.getElementById("status");
const reportEl = document.getElementById("report");
const reportSummaryEl = document.getElementById("report-summary");
const reportDetailsEl = document.getElementById("report-details");

const checklistEl = document.getElementById("checklist");
const checklistListEl = document.getElementById("checklist-list");
const checklistProgressEl = document.getElementById("checklist-progress");
const exportButton = document.getElementById("export-checklist");
const exportMarkdownButton = document.getElementById("export-checklist-markdown");
const exportStatusEl = document.getElementById("export-status");

// Checklist state exists only for the lifetime of this page.
let currentReport = null;
let checklistState = [];

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
const compareReportDetailsEl = document.getElementById("compare-report-details");

const candidateChecklistEl = document.getElementById("candidate-checklist");
const candidateChecklistListEl = document.getElementById("candidate-checklist-list");
const candidateChecklistProgressEl = document.getElementById("candidate-checklist-progress");
const exportComparisonButton = document.getElementById("export-comparison");
const exportComparisonMarkdownButton = document.getElementById("export-comparison-markdown");
const exportComparisonStatusEl = document.getElementById("export-comparison-status");

// Candidate checklist state exists only for the lifetime of this page.
let currentCompareReport = null;
let currentCandidateAnalysis = null;
let candidateChecklistState = [];

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

  const badgeRow = el("div", { className: "badge-row" });
  renderCountBadges(badgeRow, countByLevel(report.findings));
  compareReportSummaryEl.appendChild(badgeRow);

  const changeCount = Object.values(report.changes).reduce(
    (total, diff) => total + (diff.added ? diff.added.length : 0) + (diff.removed ? diff.removed.length : 0),
    0
  );
  compareReportSummaryEl.appendChild(el("p", {
    text: `${changeCount} change${changeCount === 1 ? "" : "s"} across permissions, hosts, matches, and commands.`
  }));

  const manualBadge = el("span", {
    className: `badge ${report.requiresManualUpdateValidation ? "badge-critical" : "badge-ok"}`,
    text: report.requiresManualUpdateValidation
      ? "Manual validation required"
      : "No manual validation required"
  });
  compareReportSummaryEl.appendChild(el("p", {}, [manualBadge]));
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

function renderReport(report) {
  reportDetailsEl.textContent = "";
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
    for (const flag of report.riskFlags) reportDetailsEl.appendChild(renderFinding(flag));
  }

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
}

function renderChecklist(report) {
  checklistListEl.textContent = "";
  checklistState = [];

  report.lanes.forEach((lane, laneIndex) => {
    lane.checks.forEach((check, checkIndex) => {
      const id = `checklist-item-${laneIndex}-${checkIndex}`;
      checklistState.push({ id, laneId: lane.id, check, done: false });

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

      item.appendChild(checkbox);
      item.appendChild(label);
      checklistListEl.appendChild(item);
    });
  });

  checklistEl.hidden = checklistState.length === 0;
  exportButton.disabled = checklistState.length === 0;
  exportMarkdownButton.disabled = checklistState.length === 0;
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
  checklistEl.hidden = true;
  checklistListEl.textContent = "";
  checklistProgressEl.textContent = "";
  exportStatusEl.textContent = "";
  exportButton.disabled = true;
  exportMarkdownButton.disabled = true;
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

function renderCompareReport(report) {
  compareReportDetailsEl.textContent = "";
  compareReportEl.hidden = false;

  compareReportDetailsEl.appendChild(el("h2", { text: "Release identity" }));
  compareReportDetailsEl.appendChild(el("p", {
    text: `From ${report.from.name} v${report.from.version} to ${report.to.name} v${report.to.version}`
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
    for (const finding of report.findings) compareReportDetailsEl.appendChild(renderFinding(finding));
  }

  compareReportDetailsEl.appendChild(el("h2", { text: "Key changes" }));
  compareReportDetailsEl.appendChild(renderListDiff("Required permissions", report.changes.requiredPermissions));
  compareReportDetailsEl.appendChild(renderListDiff("Optional permissions", report.changes.optionalPermissions));
  compareReportDetailsEl.appendChild(renderListDiff("Required host access", report.changes.requiredHosts));
  compareReportDetailsEl.appendChild(renderListDiff("Optional host access", report.changes.optionalHosts));
  compareReportDetailsEl.appendChild(renderListDiff("Content-script match scope", report.changes.contentScriptMatches));
  compareReportDetailsEl.appendChild(renderListDiff("Keyboard commands", report.changes.commands));

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
}

function renderCandidateChecklist(candidateAnalysis) {
  candidateChecklistListEl.textContent = "";
  candidateChecklistState = [];

  candidateAnalysis.lanes.forEach((lane, laneIndex) => {
    lane.checks.forEach((check, checkIndex) => {
      const id = `candidate-checklist-item-${laneIndex}-${checkIndex}`;
      candidateChecklistState.push({ id, laneId: lane.id, check, done: false });

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
      label.textContent = `${lane.id}: ${check}`;

      item.appendChild(checkbox);
      item.appendChild(label);
      candidateChecklistListEl.appendChild(item);
    });
  });

  candidateChecklistEl.hidden = candidateChecklistState.length === 0;
  exportComparisonButton.disabled = candidateChecklistState.length === 0;
  exportComparisonMarkdownButton.disabled = candidateChecklistState.length === 0;
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
    ["contentScriptMatches", "Content-script match scope"],
    ["commands", "Keyboard commands"]
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

function resetComparisonResults() {
  compareReportEl.hidden = true;
  compareReportSummaryEl.textContent = "";
  compareReportDetailsEl.textContent = "";
  candidateChecklistEl.hidden = true;
  candidateChecklistListEl.textContent = "";
  candidateChecklistProgressEl.textContent = "";
  exportComparisonStatusEl.textContent = "";
  exportComparisonButton.disabled = true;
  exportComparisonMarkdownButton.disabled = true;
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
    renderCandidateChecklist(data.candidateAnalysis);
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
