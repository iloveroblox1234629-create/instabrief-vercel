import { useEffect, useMemo, useState } from "react";
import {
  applyAiSummary,
  createClientExtraction,
  createMarkdownDocument,
  createTemplatePromptText,
  defaultExtractionTemplateId,
  defaultOpenRouterModel,
  extractionTemplates,
  extractInstagramUrls,
  getExtractionTemplate
} from "./extraction.js";
import { pathForView, readSharedTextFromUrl, resolveViewFromUrl } from "./routing.js";

const themePresets = {
  axolotl: {
    name: "Axolotl",
    bg: "#09090d",
    panel: "#1e1e26",
    text: "#fcfaff",
    muted: "#b8b3c4",
    accent: "#ff87be",
    soft: "#121218"
  },
  nebula: {
    name: "Nebula",
    bg: "#0b0911",
    panel: "#1c1826",
    text: "#fcfaff",
    muted: "#c3b9d6",
    accent: "#b988ff",
    soft: "#181222"
  },
  cyan: {
    name: "Cyan",
    bg: "#061013",
    panel: "#121e23",
    text: "#f7feff",
    muted: "#aac4ca",
    accent: "#40e0d0",
    soft: "#0c1f24"
  }
};

const initialForm = {
  rawUrls: "",
  role: "researcher",
  template: defaultExtractionTemplateId(),
  caption: "",
  transcript: "",
  visualText: "",
  useServerSummary: true,
  clientApiKey: "",
  clientModel: defaultOpenRouterModel()
};
const SUMMARY_TIMEOUT_MS = 25000;
const HISTORY_KEY = "instabrief-markdown-history";
const MAX_HISTORY_ITEMS = 20;
const templates = extractionTemplates();

export default function App() {
  const [view, setView] = useState(() => resolveViewFromUrl(window.location.href));
  const [form, setForm] = useState(() => ({
    ...initialForm,
    rawUrls: initialSharedText()
  }));
  const [theme, setTheme] = useState(() => readTheme());
  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const [status, setStatus] = useState("Paste a link to start.");
  const [latestFile, setLatestFile] = useState(null);
  const [pendingFallback, setPendingFallback] = useState(null);
  const [history, setHistory] = useState(() => readHistory());
  const [isWorking, setIsWorking] = useState(false);

  const themeStyle = useMemo(() => ({
    "--theme-bg": theme.bg,
    "--theme-panel": theme.panel,
    "--theme-text": theme.text,
    "--theme-muted": theme.muted,
    "--theme-accent": theme.accent,
    "--theme-soft": theme.soft,
    "--theme-accent-rgb": hexToRgb(theme.accent)
  }), [theme]);

  useEffect(() => {
    localStorage.setItem("instabrief-theme", JSON.stringify(theme));
  }, [theme]);

  useEffect(() => {
    const handlePopState = () => setView(resolveViewFromUrl(window.location.href));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setIsWorking(true);
    setPendingFallback(null);
    setStatus(form.useServerSummary ? "Preparing server summary..." : "Preparing client summary...");

    try {
      let extraction = createClientExtraction(form);
      if (!extraction.items.length) {
        setStatus("No supported Instagram media URL found.");
        return;
      }

      if (form.useServerSummary) {
        extraction = applyAiSummary(extraction, await requestServerSummary(form));
      } else if (form.clientApiKey.trim()) {
        extraction = applyAiSummary(extraction, await requestClientSummary(form));
      }

      const markdownFile = createMarkdownDocument(extraction.items);
      publishMarkdownFile(markdownFile, form);
      setStatus(`Downloaded ${markdownFile.filename}.`);
    } catch (error) {
      const localOnly = createClientExtraction(form);
      if (localOnly.items.length) {
        const markdownFile = createMarkdownDocument(localOnly.items);
        setPendingFallback(markdownFile);
        setStatus(`${error instanceof Error ? error.message : "AI summary failed."} Local fallback is ready.`);
      } else {
        setStatus(error instanceof Error ? error.message : "Extraction failed.");
      }
    } finally {
      setIsWorking(false);
    }
  }

  function publishMarkdownFile(file, sourceForm) {
    setLatestFile(file);
    downloadMarkdown(file);
    saveHistoryEntry(file, sourceForm);
  }

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function updateTheme(name, value) {
    setTheme((current) => ({ ...current, [name]: value }));
  }

  function navigate(nextView) {
    const nextPath = pathForView(nextView);
    window.history.pushState({}, "", nextPath);
    setView(resolveViewFromUrl(window.location.href));
  }

  function downloadPendingFallback() {
    if (!pendingFallback) {
      return;
    }
    publishMarkdownFile(pendingFallback, form);
    setPendingFallback(null);
    setStatus(`Downloaded ${pendingFallback.filename}.`);
  }

  async function copyFile(file) {
    if (!file?.markdown) {
      return;
    }
    await copyMarkdown(file.markdown);
    setStatus(`Copied ${file.filename}.`);
  }

  function saveHistoryEntry(file, sourceForm) {
    const urls = extractInstagramUrls(sourceForm.rawUrls);
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      filename: file.filename,
      title: file.title,
      markdown: file.markdown,
      createdAt: new Date().toISOString(),
      url: urls[0] || sourceForm.rawUrls.trim(),
      template: sourceForm.template,
      tags: readFrontmatterTags(file.markdown)
    };
    setHistory((current) => {
      const next = [entry, ...current.filter((item) => item.markdown !== file.markdown)].slice(0, MAX_HISTORY_ITEMS);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }

  function deleteHistoryEntry(id) {
    setHistory((current) => {
      const next = current.filter((item) => item.id !== id);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }

  function clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
    setStatus("Local history cleared.");
  }

  return (
    <main className="app-shell min-h-screen px-4 py-6 text-app-text" style={themeStyle}>
      <ThemeMenu
        isOpen={isThemeOpen}
        onToggle={() => setIsThemeOpen((open) => !open)}
        onThemeChange={setTheme}
        onValueChange={updateTheme}
        theme={theme}
      />

      <div className="mx-auto w-full max-w-6xl">
        <SiteNav currentView={view} onNavigate={navigate} />
        {view === "extract" ? (
          <ExtractorView
            form={form}
            history={history}
            isWorking={isWorking}
            latestFile={latestFile}
            onClearHistory={clearHistory}
            onCopyFile={copyFile}
            onDeleteHistoryEntry={deleteHistoryEntry}
            onDownloadFile={downloadMarkdown}
            onDownloadFallback={downloadPendingFallback}
            onSubmit={handleSubmit}
            onUpdateField={updateField}
            pendingFallback={pendingFallback}
            status={status}
          />
        ) : (
          <InfoPage view={view} onNavigate={navigate} />
        )}
      </div>
    </main>
  );
}

function SiteNav({ currentView, onNavigate }) {
  const links = [
    ["extract", "Extract"],
    ["about", "About"],
    ["docs", "Docs"],
    ["templates", "Templates"],
    ["privacy", "Privacy"]
  ];
  return (
    <nav className="site-nav mx-auto mb-6 flex max-w-5xl flex-wrap items-center justify-between gap-4">
      <button className="brand-link" type="button" onClick={() => onNavigate("extract")}>
        <span className="brand-mark brand-mark-small" aria-hidden="true" />
        <span>InstaBrief</span>
      </button>
      <div className="nav-links">
        {links.map(([view, label]) => (
          <button
            className={currentView === view ? "nav-link nav-link-active" : "nav-link"}
            key={view}
            type="button"
            onClick={() => onNavigate(view)}
          >
            {label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function ExtractorView({
  form,
  history,
  isWorking,
  latestFile,
  onClearHistory,
  onCopyFile,
  onDeleteHistoryEntry,
  onDownloadFile,
  onDownloadFallback,
  onSubmit,
  onUpdateField,
  pendingFallback,
  status
}) {
  return (
    <section className="mx-auto grid min-h-[calc(100vh-120px)] w-full max-w-5xl items-start gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
      <div className="flex min-h-[34rem] flex-col justify-center">
        <header className="mb-7">
          <div className="mb-2 flex items-center gap-3">
            <span className="brand-mark" aria-hidden="true" />
            <h1 className="text-gradient text-4xl font-black tracking-tight sm:text-6xl">InstaBrief</h1>
          </div>
          <p className="max-w-2xl text-lg font-semibold text-app-muted">Turn Instagram links into organized Markdown.</p>
        </header>

        <form className="glass-panel w-full overflow-hidden rounded-[2rem] p-5 shadow-2xl sm:p-8" onSubmit={onSubmit}>
          <div className="panel-accent" />
          <div>
            <h2 className="text-2xl font-black tracking-tight text-app-text">Download a Markdown summary</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-app-muted">Paste one Reel link and get a one-file download.</p>
          </div>

          <label className="mt-7 grid gap-2 text-sm font-black text-app-text">
            Instagram link
            <input
              className="app-input focus-glow"
              placeholder="https://www.instagram.com/reel/..."
              value={form.rawUrls}
              onChange={(event) => onUpdateField("rawUrls", event.target.value)}
            />
          </label>

          <label className="mt-4 grid gap-2 text-sm font-black text-app-text">
            Template
            <select
              className="app-input focus-glow"
              value={form.template}
              onChange={(event) => onUpdateField("template", event.target.value)}
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>{template.label}</option>
              ))}
            </select>
          </label>

          <div className="mt-4 rounded-[1.5rem] border border-white/10 bg-app-soft p-4">
            <label className="flex items-start gap-3 text-sm font-black text-app-text">
              <input
                className="mt-0.5 h-5 w-5 accent-[var(--theme-accent)]"
                type="checkbox"
                checked={form.useServerSummary}
                onChange={(event) => onUpdateField("useServerSummary", event.target.checked)}
              />
              <span>
                Use server-side OpenRouter summary
                <small className="mt-1 block font-bold text-app-muted">Uncheck to summarize in this browser with your own temporary key.</small>
              </span>
            </label>

            {!form.useServerSummary ? (
              <div className="mt-3 grid gap-3">
                <label className="grid gap-2 text-sm font-black text-app-text">
                  Client OpenRouter API key
                  <input
                    className="app-input focus-glow"
                    placeholder="sk-or-..."
                    type="password"
                    value={form.clientApiKey}
                    onChange={(event) => onUpdateField("clientApiKey", event.target.value)}
                  />
                </label>
                <label className="grid gap-2 text-sm font-black text-app-text">
                  Model
                  <input
                    className="app-input focus-glow"
                    value={form.clientModel}
                    onChange={(event) => onUpdateField("clientModel", event.target.value)}
                  />
                </label>
                <p className="text-xs font-bold leading-5 text-app-muted">The key stays in this tab and is sent directly from your browser to OpenRouter.</p>
              </div>
            ) : null}
          </div>

          <details className="mt-4 rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-4">
            <summary className="cursor-pointer text-sm font-black text-app-text">Optional context</summary>
            <div className="mt-4 grid gap-4">
              <label className="grid gap-2 text-sm font-black text-app-text">
                Role
                <select
                  className="app-input focus-glow"
                  value={form.role}
                  onChange={(event) => onUpdateField("role", event.target.value)}
                >
                  <option value="researcher">Researcher</option>
                  <option value="creator">Creator</option>
                  <option value="marketer">Social media manager</option>
                  <option value="student">Student</option>
                  <option value="casual">Quick TL;DR</option>
                </select>
              </label>
              <TextAreaField label="Caption or description" value={form.caption} onChange={(value) => onUpdateField("caption", value)} />
              <TextAreaField label="Transcript" minHeight="min-h-24" value={form.transcript} onChange={(value) => onUpdateField("transcript", value)} />
              <TextAreaField label="Visual notes" value={form.visualText} onChange={(value) => onUpdateField("visualText", value)} />
            </div>
          </details>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              className="gradient-primary glow-hover min-h-14 flex-1 rounded-2xl px-5 py-4 text-base font-black text-[#520031] shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isWorking}
              type="submit"
            >
              {isWorking ? "Preparing..." : "Download Markdown"}
            </button>
            {latestFile ? (
              <>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => onCopyFile(latestFile)}
                >
                  Copy Markdown
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => onDownloadFile(latestFile)}
                >
                  Download again
                </button>
              </>
            ) : null}
            {pendingFallback ? (
              <button
                className="secondary-button secondary-button-accent"
                type="button"
                onClick={onDownloadFallback}
              >
                Download local fallback
              </button>
            ) : null}
          </div>
          <p className="mt-3 min-h-6 text-sm font-bold text-app-muted" role="status">{status}</p>
        </form>
      </div>

      <HistoryPanel
        history={history}
        onClear={onClearHistory}
        onCopy={onCopyFile}
        onDelete={onDeleteHistoryEntry}
        onDownload={onDownloadFile}
      />
    </section>
  );
}

function TextAreaField({ label, minHeight = "min-h-20", value, onChange }) {
  return (
    <label className="grid gap-2 text-sm font-black text-app-text">
      {label}
      <textarea
        className={`app-input ${minHeight} focus-glow`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function HistoryPanel({ history, onClear, onCopy, onDelete, onDownload }) {
  return (
    <aside className="glass-panel history-panel rounded-[2rem] p-5 shadow-2xl sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-app-text">Recent Markdown</h2>
          <p className="mt-1 text-xs font-bold text-app-muted">Stored in this browser.</p>
        </div>
        {history.length ? (
          <button className="tiny-button" type="button" onClick={onClear}>Clear</button>
        ) : null}
      </div>
      <div className="mt-5 grid gap-3">
        {history.length ? history.map((item) => (
          <article className="history-card" key={item.id}>
            <h3 className="line-clamp-2 text-sm font-black text-app-text">{item.title}</h3>
            <p className="mt-1 truncate text-xs font-bold text-app-muted">{item.filename}</p>
            <p className="mt-2 text-xs font-bold text-app-muted">{formatHistoryDate(item.createdAt)} · {getExtractionTemplate(item.template).label}</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button className="tiny-button" type="button" onClick={() => onCopy(item)}>Copy</button>
              <button className="tiny-button" type="button" onClick={() => onDownload(item)}>Download</button>
              <button className="tiny-button danger-button" type="button" onClick={() => onDelete(item.id)}>Delete</button>
            </div>
          </article>
        )) : (
          <p className="rounded-2xl border border-dashed border-white/10 p-4 text-sm font-bold leading-6 text-app-muted">Generated files will appear here with copy, download, and delete controls.</p>
        )}
      </div>
    </aside>
  );
}

function InfoPage({ view, onNavigate }) {
  const pages = {
    about: {
      title: "About InstaBrief",
      intro: "InstaBrief turns useful Instagram posts and Reels into portable Markdown notes for people who save more content than they can organize.",
      sections: [
        ["Why it exists", "Saved social posts are hard to search, cite, and reuse. InstaBrief converts a link plus optional context into a local Markdown file with a clear filename, metadata, takeaways, and next actions."],
        ["Who we are", "This is a focused utility built for researchers, creators, students, and operators who want their saved videos to become notes instead of another queue."],
        ["What it is meant to do", "The service keeps the workflow narrow: paste a supported Instagram media URL, choose a template, and download a Markdown brief you can store anywhere."]
      ]
    },
    docs: {
      title: "Docs",
      intro: "The extractor can use a server-side OpenRouter key, a browser-side key you provide, or a local fallback when AI is unavailable.",
      sections: [
        ["Server-side summary", "When enabled, the app sends the URL and optional context to /api/summarize. The server uses its OpenRouter key only for that request and returns structured JSON."],
        ["Client-side summary", "When server-side summary is unchecked, the API key field appears. That key stays in tab memory and is sent from your browser directly to OpenRouter."],
        ["Markdown output", "Each file includes YAML frontmatter, source URL, shortcode, role, template, tags, AI model, summary, takeaways, visual context, actions, and notes."],
        ["Fallback behavior", "If AI fails, InstaBrief still creates a local Markdown draft from the URL and any context you supplied."]
      ]
    },
    templates: {
      title: "Templates",
      intro: "Templates shape the prompt, filename summary, local fallback notes, and recommended actions.",
      sections: templates.map((template) => [template.label, template.prompt])
    },
    privacy: {
      title: "Privacy",
      intro: "InstaBrief is designed around portable files and browser-local state, with no account or hosted library in this batch.",
      sections: [
        ["No account", "The app does not require login, and generated Markdown is downloaded to your device."],
        ["Local history", "Recent files are stored in localStorage in your browser. Use Clear in the history panel to remove them from that browser."],
        ["Bring your own key", "Client-side OpenRouter keys stay in the current tab state. They are not persisted in localStorage by this app."],
        ["Server-side key", "The hosted OpenRouter key is used only by /api/summarize to summarize extraction payloads."]
      ]
    }
  };
  const page = pages[view] || pages.about;

  return (
    <section className="mx-auto max-w-5xl py-8 sm:py-14">
      <div className="max-w-3xl">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-app-accent">InstaBrief</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight text-app-text sm:text-6xl">{page.title}</h1>
        <p className="mt-5 text-lg font-semibold leading-8 text-app-muted">{page.intro}</p>
      </div>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {page.sections.map(([title, body]) => (
          <article className="info-card" key={title}>
            <h2 className="text-xl font-black text-app-text">{title}</h2>
            <p className="mt-3 text-sm font-semibold leading-7 text-app-muted">{body}</p>
          </article>
        ))}
      </div>
      <button className="gradient-primary glow-hover mt-8 rounded-2xl px-5 py-4 text-sm font-black text-[#520031]" type="button" onClick={() => onNavigate("extract")}>
        Open extractor
      </button>
    </section>
  );
}

function ThemeMenu({ isOpen, onThemeChange, onToggle, onValueChange, theme }) {
  return (
    <div className="fixed right-4 top-4 z-20">
      <button
        aria-expanded={isOpen}
        aria-label="Open theme settings"
        className="theme-trigger focus-glow"
        title="Theme"
        type="button"
        onClick={onToggle}
      >
        <span className="theme-trigger-dot" />
      </button>
      {isOpen ? (
        <section className="glass-panel absolute right-0 mt-3 w-[17rem] rounded-[1.75rem] p-5 shadow-2xl sm:w-72">
          <h2 className="text-lg font-black text-app-text">Theme</h2>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {Object.entries(themePresets).map(([key, preset]) => (
              <button
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-2 py-3 text-xs font-black text-app-text transition hover:border-app-accent hover:bg-white/[0.08]"
                key={key}
                type="button"
                onClick={() => onThemeChange(preset)}
              >
                {preset.name}
              </button>
            ))}
          </div>
          <div className="mt-4 grid gap-3">
            {[
              ["accent", "Accent"],
              ["bg", "Background"],
              ["panel", "Panel"],
              ["text", "Text"]
            ].map(([key, label]) => (
              <label className="grid grid-cols-[1fr_auto] items-center gap-3 text-xs font-black text-app-muted" key={key}>
                {label}
                <input
                  aria-label={label}
                  className="h-9 w-12 rounded-full border border-white/10 bg-transparent"
                  type="color"
                  value={colorInputValue(theme[key])}
                  onChange={(event) => onValueChange(key, event.target.value)}
                />
              </label>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

async function requestServerSummary(payload) {
  const signal = AbortSignal.timeout(SUMMARY_TIMEOUT_MS);
  const response = await fetch("/api/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });
  return parseSummaryResponse(response);
}

async function requestClientSummary(payload) {
  const signal = AbortSignal.timeout(SUMMARY_TIMEOUT_MS);
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal,
    headers: {
      "Authorization": `Bearer ${payload.clientApiKey.trim()}`,
      "Content-Type": "application/json",
      "X-Title": "InstaBrief"
    },
    body: JSON.stringify({
      model: payload.clientModel || defaultOpenRouterModel(),
      messages: [
        {
          role: "system",
          content: "You summarize Instagram videos into concise research notes. Return strict JSON only."
        },
        {
          role: "user",
          content: createSummaryPrompt(payload)
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.2
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || "Client-side OpenRouter request failed.");
  }
  const content = body?.choices?.[0]?.message?.content || "{}";
  return {
    ...safeJson(content),
    model: body.model || payload.clientModel || defaultOpenRouterModel()
  };
}

async function parseSummaryResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "OpenRouter summary failed.");
  }
  return body;
}

function createSummaryPrompt(payload) {
  return [
    `Role: ${payload.role || "researcher"}`,
    createTemplatePromptText(payload.template),
    `URLs:\n${payload.rawUrls || ""}`,
    `Caption:\n${payload.caption || ""}`,
    `Transcript:\n${payload.transcript || ""}`,
    `Visual notes:\n${payload.visualText || ""}`,
    "Return JSON with keys summarySentence, takeaways, actions, and tags. summarySentence must be one short sentence suitable for a Markdown filename. Tailor the takeaways and actions to the selected template."
  ].join("\n\n");
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    const match = String(value).match(/\{[\s\S]*\}/);
    if (!match) {
      return {};
    }
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function downloadMarkdown(file) {
  const blob = new Blob([file.markdown], { type: "text/markdown;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = file.filename || "instagram-summary.md";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

async function copyMarkdown(markdown) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(markdown);
    return;
  }
  const textArea = document.createElement("textarea");
  textArea.value = markdown;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.append(textArea);
  textArea.select();
  document.execCommand("copy");
  textArea.remove();
}

function readTheme() {
  try {
    return {
      ...themePresets.axolotl,
      ...JSON.parse(localStorage.getItem("instabrief-theme") || "{}")
    };
  } catch {
    return themePresets.axolotl;
  }
}

function readHistory() {
  try {
    const items = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(items) ? items.filter((item) => item?.markdown && item?.filename).slice(0, MAX_HISTORY_ITEMS) : [];
  } catch {
    return [];
  }
}

function initialSharedText() {
  const sharedText = readSharedTextFromUrl(window.location.href);
  const urls = extractInstagramUrls(sharedText);
  return urls.length ? urls.join("\n") : "";
}

function readFrontmatterTags(markdown = "") {
  return markdown
    .split("\n")
    .filter((line) => /^\s+-\s+"/.test(line))
    .map((line) => line.replace(/^\s+-\s+/, "").replace(/^"|"$/g, ""))
    .slice(0, 6);
}

function formatHistoryDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Recently"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function hexToRgb(value = "#ff87be") {
  const normalized = colorInputValue(value).replace("#", "");
  const number = parseInt(normalized, 16);
  return `${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}`;
}

function colorInputValue(value = "#ff87be") {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#ff87be";
}
