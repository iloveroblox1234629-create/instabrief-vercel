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
  focus: {
    name: "Focus",
    slug: "focus",
    mode: "light",
    bg: "#f8fafc",
    panel: "#ffffff",
    text: "#0f172a",
    muted: "#475569",
    accent: "#2563eb",
    soft: "#eef6ff",
    cta: "#9a3412",
    ctaHover: "#7c2d12",
    ctaText: "#ffffff"
  },
  graphite: {
    name: "Graphite",
    slug: "graphite",
    mode: "dark",
    bg: "#0f172a",
    panel: "#111827",
    text: "#f8fafc",
    muted: "#94a3b8",
    accent: "#60a5fa",
    soft: "#1e293b",
    cta: "#9a3412",
    ctaHover: "#7c2d12",
    ctaText: "#ffffff"
  },
  copper: {
    name: "Copper",
    slug: "copper",
    mode: "light",
    bg: "#fff7ed",
    panel: "#fffaf5",
    text: "#0f172a",
    muted: "#475569",
    accent: "#c2410c",
    soft: "#ffedd5",
    cta: "#9a3412",
    ctaHover: "#7c2d12",
    ctaText: "#ffffff"
  },
  engineering: {
    name: "Engineering",
    slug: "engineering",
    mode: "light",
    bg: "#f6f8f7",
    panel: "#f6f8f7",
    text: "#000000",
    muted: "#5a5a5a",
    accent: "#000000",
    soft: "#ffffff",
    cta: "#000000",
    ctaHover: "#0f0e12",
    ctaText: "#f6f8f7"
  },
  collective: {
    name: "Collective",
    slug: "collective",
    mode: "dark",
    bg: "#000000",
    panel: "#000000",
    text: "#ffffff",
    muted: "#5a5a5a",
    accent: "#ffffff",
    soft: "#0d0d0d",
    cta: "#ffffff",
    ctaHover: "#ffffff",
    ctaText: "#000000"
  }
};

const defaultThemeByMode = {
  light: themePresets.focus,
  dark: themePresets.graphite
};

const themeColorFields = ["bg", "panel", "text", "muted", "accent", "soft", "cta", "ctaHover", "ctaText"];

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
    "--theme-accent-rgb": hexToRgb(theme.accent),
    "--theme-color-scheme": theme.mode,
    "--cta": theme.cta,
    "--cta-hover": theme.ctaHover,
    "--cta-text": theme.ctaText
  }), [theme]);

  useEffect(() => {
    localStorage.setItem("instabrief-theme", JSON.stringify(theme));
  }, [theme]);

  useEffect(() => {
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) {
      themeColor.setAttribute("content", theme.bg);
    }
  }, [theme.bg]);

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

  function updateThemeMode(mode) {
    setTheme(normalizeTheme(defaultThemeByMode[mode]));
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
    <main
      className="app-shell min-h-screen px-4 py-4 text-app-text sm:px-6 sm:py-6"
      data-theme-mode={theme.mode}
      data-theme-name={theme.slug || "custom"}
      style={themeStyle}
    >
      <ThemeMenu
        isOpen={isThemeOpen}
        onModeChange={updateThemeMode}
        onToggle={() => setIsThemeOpen((open) => !open)}
        onThemeChange={(preset) => setTheme(normalizeTheme(preset))}
        onValueChange={updateTheme}
        theme={theme}
      />

      <div className="mx-auto w-full max-w-7xl">
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
    <nav className="site-nav mx-auto mb-5 flex w-full items-center justify-between gap-4">
      <button className="brand-link" type="button" onClick={() => onNavigate("extract")}>
        <span className="brand-mark brand-mark-small" aria-hidden="true" />
        <span className="grid text-left leading-tight">
          <span>InstaBrief</span>
          <span className="brand-subtitle">Extraction workspace</span>
        </span>
      </button>
      <div className="nav-links">
        {links.map(([view, label]) => (
          <button
            className={currentView === view ? "nav-link nav-link-active" : "nav-link"}
            key={view}
            type="button"
            aria-current={currentView === view ? "page" : undefined}
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
  const selectedTemplate = getExtractionTemplate(form.template);

  return (
    <section className="extractor-workspace mx-auto grid w-full items-start gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
      <div className="grid gap-5">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Instagram to Markdown</p>
            <h1 className="mt-2 text-3xl font-black text-app-text sm:text-4xl">Extract a reusable brief from saved media.</h1>
          </div>
          <div className="workspace-header-aside" aria-label="Workflow">
            <span>Link</span>
            <span>Template</span>
            <span>Markdown</span>
          </div>
        </header>

        <form className="tool-panel" onSubmit={onSubmit}>
          <div className="tool-panel-header">
            <div>
              <h2 className="text-2xl font-black text-app-text">New extraction</h2>
              <p className="mt-1 text-sm font-semibold leading-6 text-app-muted">Paste one Instagram Reel or post URL, choose a brief style, and download a Markdown file.</p>
            </div>
            <span className="panel-state-pill">{form.useServerSummary ? "Server AI" : "Browser AI"}</span>
          </div>

          <div className="form-grid mt-6">
            <label className="field field-wide">
              <span className="field-label">Instagram link</span>
              <input
                className="app-input focus-glow"
                placeholder="https://www.instagram.com/reel/..."
                value={form.rawUrls}
                onChange={(event) => onUpdateField("rawUrls", event.target.value)}
              />
            </label>

            <label className="field">
              <span className="field-label">Template</span>
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

            <div className="field-summary">
              <span className="field-label">Output profile</span>
              <strong>{selectedTemplate.label}</strong>
              <span>{form.role === "casual" ? "Quick read" : `${form.role.charAt(0).toUpperCase()}${form.role.slice(1)} workflow`}</span>
            </div>
          </div>

          <section className="settings-band mt-5" aria-label="Summary settings">
            <label className="summary-toggle text-sm font-black text-app-text">
              <input
                className="h-5 w-5 accent-[var(--theme-accent)]"
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
              <div className="client-key-grid mt-4">
                <label className="field">
                  <span className="field-label">Client OpenRouter API key</span>
                  <input
                    className="app-input focus-glow"
                    placeholder="sk-or-..."
                    type="password"
                    value={form.clientApiKey}
                    onChange={(event) => onUpdateField("clientApiKey", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Model</span>
                  <input
                    className="app-input focus-glow"
                    value={form.clientModel}
                    onChange={(event) => onUpdateField("clientModel", event.target.value)}
                  />
                </label>
                <p className="client-key-note text-xs font-bold leading-5 text-app-muted">The key stays in this tab and is sent directly from your browser to OpenRouter.</p>
              </div>
            ) : null}
          </section>

          <details className="details-panel mt-5">
            <summary className="details-summary">Optional context</summary>
            <div className="mt-4 grid gap-4">
              <label className="field">
                <span className="field-label">Role</span>
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

          <div className="action-row mt-5">
            <button
              className="primary-button"
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

          <StatusBand
            isWorking={isWorking}
            latestFile={latestFile}
            pendingFallback={pendingFallback}
            status={status}
          />
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
    <label className="field">
      <span className="field-label">{label}</span>
      <textarea
        className={`app-input ${minHeight} focus-glow`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function StatusBand({ isWorking, latestFile, pendingFallback, status }) {
  const steps = [
    ["Ready", Boolean(status)],
    ["Summarize", isWorking || Boolean(latestFile) || Boolean(pendingFallback)],
    ["Save", Boolean(latestFile)]
  ];

  return (
    <section className="status-band mt-5" aria-label="Extraction status">
      <div>
        <span className={isWorking ? "status-dot status-dot-busy" : "status-dot"} aria-hidden="true" />
        <p className="status-copy" role="status">{status}</p>
      </div>
      <ol className="status-steps" aria-label="Progress">
        {steps.map(([label, active]) => (
          <li className={active ? "status-step status-step-active" : "status-step"} key={label}>{label}</li>
        ))}
      </ol>
    </section>
  );
}

function HistoryPanel({ history, onClear, onCopy, onDelete, onDownload }) {
  return (
    <aside className="history-panel tool-panel">
      <div className="history-panel-heading">
        <div>
          <p className="eyebrow">Local library</p>
          <h2 className="mt-1 text-xl font-black text-app-text">Recent Markdown</h2>
          <p className="mt-1 text-xs font-bold text-app-muted">Stored in this browser.</p>
        </div>
        {history.length ? (
          <button className="tiny-button" type="button" onClick={onClear}>Clear</button>
        ) : null}
      </div>
      <div className="mt-5 grid gap-3">
        {history.length ? history.map((item) => (
          <article className="history-card" key={item.id}>
            <div className="history-card-main">
              <h3 className="line-clamp-2 text-sm font-black text-app-text">{item.title}</h3>
              <p className="mt-1 truncate text-xs font-bold text-app-muted">{item.filename}</p>
              <p className="mt-2 text-xs font-bold text-app-muted">{formatHistoryDate(item.createdAt)} · {getExtractionTemplate(item.template).label}</p>
            </div>
            {item.tags?.length ? (
              <div className="tag-row" aria-label="Tags">
                {item.tags.slice(0, 3).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            ) : null}
            <div className="history-actions">
              <button className="tiny-button" type="button" onClick={() => onCopy(item)}>Copy</button>
              <button className="tiny-button" type="button" onClick={() => onDownload(item)}>Download</button>
              <button className="tiny-button danger-button" type="button" onClick={() => onDelete(item.id)}>Delete</button>
            </div>
          </article>
        )) : (
          <p className="empty-history text-sm font-bold leading-6 text-app-muted">Generated files will appear here with copy, download, and delete controls.</p>
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
    <section className="info-page mx-auto py-8 sm:py-12">
      <div className="info-page-header">
        <p className="eyebrow">InstaBrief</p>
        <h1 className="mt-3 text-3xl font-black text-app-text sm:text-5xl">{page.title}</h1>
        <p className="mt-5 text-lg font-semibold leading-8 text-app-muted">{page.intro}</p>
      </div>
      <div className="info-grid mt-8">
        {page.sections.map(([title, body]) => (
          <article className="info-card" key={title}>
            <h2 className="text-xl font-black text-app-text">{title}</h2>
            <p className="mt-3 text-sm font-semibold leading-7 text-app-muted">{body}</p>
          </article>
        ))}
      </div>
      <button className="primary-button mt-8 w-full sm:w-auto" type="button" onClick={() => onNavigate("extract")}>
        Open extractor
      </button>
    </section>
  );
}

function ThemeMenu({ isOpen, onModeChange, onThemeChange, onToggle, onValueChange, theme }) {
  const modeOptions = [
    ["light", "Light"],
    ["dark", "Dark"]
  ];

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
        <section className="theme-menu absolute right-0 mt-3 w-[17rem] p-5 shadow-2xl sm:w-72">
          <h2 className="text-lg font-black text-app-text">Theme</h2>
          <div className="theme-mode-switch mt-4 grid grid-cols-2 gap-2" aria-label="Color mode">
            {modeOptions.map(([mode, label]) => (
              <button
                aria-pressed={theme.mode === mode}
                className={theme.mode === mode ? "theme-mode-button theme-mode-button-active" : "theme-mode-button"}
                key={mode}
                type="button"
                onClick={() => onModeChange(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {Object.entries(themePresets).map(([key, preset]) => (
              <button
                className={theme.name === preset.name && theme.mode === preset.mode ? "theme-preset theme-preset-active" : "theme-preset"}
                key={key}
                type="button"
                onClick={() => onThemeChange(preset)}
              >
                <span>{preset.name}</span>
                <small>{preset.mode}</small>
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
                  className="theme-color-input"
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
    return normalizeTheme(JSON.parse(localStorage.getItem("instabrief-theme") || "{}"));
  } catch {
    return themePresets.focus;
  }
}

function normalizeTheme(savedTheme = {}) {
  const mode = readThemeMode(savedTheme);
  const fallback = defaultThemeByMode[mode];
  const normalized = {
    ...fallback,
    ...savedTheme,
    mode,
    slug: savedTheme.slug || fallback.slug
  };

  themeColorFields.forEach((field) => {
    if (!isThemeColor(normalized[field])) {
      normalized[field] = fallback[field];
    }
  });

  return normalized;
}

function readThemeMode(theme) {
  if (theme?.mode === "light" || theme?.mode === "dark") {
    return theme.mode;
  }

  if (theme?.name) {
    const preset = Object.values(themePresets).find((item) => item.name === theme.name);
    if (preset) {
      return preset.mode;
    }
  }

  return isLikelyLightColor(theme?.bg) ? "light" : "dark";
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

function hexToRgb(value = "#3b82f6") {
  const normalized = colorInputValue(value).replace("#", "");
  const number = parseInt(normalized, 16);
  return `${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}`;
}

function colorInputValue(value = "#3b82f6") {
  return isThemeColor(value) ? value : "#3b82f6";
}

function isThemeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

function isLikelyLightColor(value) {
  if (!isThemeColor(value)) {
    return true;
  }

  const normalized = value.replace("#", "");
  const red = parseInt(normalized.slice(0, 2), 16) / 255;
  const green = parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = parseInt(normalized.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.6;
}
