import { useEffect, useMemo, useState } from "react";
import {
  applyAiSummary,
  createClientExtraction,
  createMarkdownDocument,
  defaultOpenRouterModel
} from "./extraction.js";

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
  caption: "",
  transcript: "",
  visualText: "",
  useServerSummary: true,
  clientApiKey: "",
  clientModel: defaultOpenRouterModel()
};
const SUMMARY_TIMEOUT_MS = 25000;

export default function App() {
  const [form, setForm] = useState(initialForm);
  const [theme, setTheme] = useState(() => readTheme());
  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const [status, setStatus] = useState("Paste a link to start.");
  const [latestFile, setLatestFile] = useState(null);
  const [pendingFallback, setPendingFallback] = useState(null);
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
      setLatestFile(markdownFile);
      downloadMarkdown(markdownFile);
      setStatus(`Downloaded ${markdownFile.filename}.`);
    } catch (error) {
      const localOnly = createClientExtraction(form);
      if (localOnly.items.length) {
        const markdownFile = createMarkdownDocument(localOnly.items);
        setPendingFallback(markdownFile);
        setStatus(`${error instanceof Error ? error.message : "AI summary failed."} Local fallback is ready if you want it.`);
      } else {
        setStatus(error instanceof Error ? error.message : "Extraction failed.");
      }
    } finally {
      setIsWorking(false);
    }
  }

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function updateTheme(name, value) {
    setTheme((current) => ({ ...current, [name]: value }));
  }

  function downloadPendingFallback() {
    if (!pendingFallback) {
      return;
    }
    downloadMarkdown(pendingFallback);
    setLatestFile(pendingFallback);
    setPendingFallback(null);
    setStatus(`Downloaded ${pendingFallback.filename}.`);
  }

  return (
    <main className="app-shell min-h-screen px-4 py-6 text-app-text" style={themeStyle}>
      <div className="fixed right-4 top-4 z-10">
        <button
          aria-expanded={isThemeOpen}
          aria-label="Open theme settings"
          className="theme-trigger focus-glow"
          title="Theme"
          type="button"
          onClick={() => setIsThemeOpen((open) => !open)}
        >
          <span className="theme-trigger-dot" />
        </button>
        {isThemeOpen ? (
          <section className="glass-panel absolute right-0 mt-3 w-[17rem] rounded-[1.75rem] p-5 shadow-2xl sm:w-72">
            <h2 className="text-lg font-black text-app-text">Theme</h2>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {Object.entries(themePresets).map(([key, preset]) => (
                <button
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-2 py-3 text-xs font-black text-app-text transition hover:border-app-accent hover:bg-white/[0.08]"
                  key={key}
                  type="button"
                  onClick={() => setTheme(preset)}
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
                    onChange={(event) => updateTheme(key, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <section className="mx-auto flex min-h-[calc(100vh-48px)] w-full max-w-2xl flex-col items-center justify-center">
        <header className="mb-8 text-center">
          <div className="mb-2 flex items-center justify-center gap-3">
            <span className="brand-mark" aria-hidden="true" />
            <h1 className="text-gradient text-4xl font-black tracking-tight sm:text-6xl">InstaBrief</h1>
          </div>
          <p className="text-lg font-semibold text-app-muted">Turn Instagram links into organized Markdown.</p>
        </header>

        <form className="glass-panel w-full overflow-hidden rounded-[2rem] p-5 shadow-2xl sm:p-8" onSubmit={handleSubmit}>
          <div className="panel-accent" />
          <div className="text-center">
            <h2 className="text-2xl font-black tracking-tight text-app-text">Download a Markdown summary</h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-app-muted">Paste one Reel link and get a one-file download.</p>
          </div>

          <label className="mt-7 grid gap-2 text-sm font-black text-app-text">
            Instagram link
            <input
              className="app-input focus-glow"
              placeholder="https://www.instagram.com/reel/..."
              value={form.rawUrls}
              onChange={(event) => updateField("rawUrls", event.target.value)}
            />
          </label>

          <div className="mt-4 rounded-[1.5rem] border border-white/10 bg-app-soft p-4">
            <label className="flex items-start gap-3 text-sm font-black text-app-text">
              <input
                className="mt-0.5 h-5 w-5 accent-[var(--theme-accent)]"
                type="checkbox"
                checked={form.useServerSummary}
                onChange={(event) => updateField("useServerSummary", event.target.checked)}
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
                    onChange={(event) => updateField("clientApiKey", event.target.value)}
                  />
                </label>
                <label className="grid gap-2 text-sm font-black text-app-text">
                  Model
                  <input
                    className="app-input focus-glow"
                    value={form.clientModel}
                    onChange={(event) => updateField("clientModel", event.target.value)}
                  />
                </label>
                <p className="text-xs font-bold leading-5 text-app-muted">The key stays in this tab and is sent directly from your browser to OpenRouter. It is not committed, stored, or sent to this app's server.</p>
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
                  onChange={(event) => updateField("role", event.target.value)}
                >
                  <option value="researcher">Researcher</option>
                  <option value="creator">Creator</option>
                  <option value="marketer">Social media manager</option>
                  <option value="student">Student</option>
                  <option value="casual">Quick TL;DR</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm font-black text-app-text">
                Caption or description
                <textarea
                  className="app-input min-h-20 focus-glow"
                  value={form.caption}
                  onChange={(event) => updateField("caption", event.target.value)}
                />
              </label>
              <label className="grid gap-2 text-sm font-black text-app-text">
                Transcript
                <textarea
                  className="app-input min-h-24 focus-glow"
                  value={form.transcript}
                  onChange={(event) => updateField("transcript", event.target.value)}
                />
              </label>
              <label className="grid gap-2 text-sm font-black text-app-text">
                Visual notes
                <textarea
                  className="app-input min-h-20 focus-glow"
                  value={form.visualText}
                  onChange={(event) => updateField("visualText", event.target.value)}
                />
              </label>
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
              <button
                className="min-h-14 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm font-black text-app-text transition hover:border-app-accent hover:text-app-accent"
                type="button"
                onClick={() => downloadMarkdown(latestFile)}
              >
                Download again
              </button>
            ) : null}
            {pendingFallback ? (
              <button
                className="min-h-14 rounded-2xl border border-app-accent bg-white/[0.04] px-5 py-4 text-sm font-black text-app-accent transition hover:bg-white/[0.08]"
                type="button"
                onClick={downloadPendingFallback}
              >
                Download local fallback
              </button>
            ) : null}
          </div>
          <p className="mt-3 min-h-6 text-sm font-bold text-app-muted" role="status">{status}</p>
        </form>
      </section>
    </main>
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
    `URLs:\n${payload.rawUrls || ""}`,
    `Caption:\n${payload.caption || ""}`,
    `Transcript:\n${payload.transcript || ""}`,
    `Visual notes:\n${payload.visualText || ""}`,
    "Return JSON with keys summarySentence, takeaways, actions, and tags. summarySentence must be one short sentence suitable for a Markdown filename."
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

function hexToRgb(value = "#ff87be") {
  const normalized = colorInputValue(value).replace("#", "");
  const number = parseInt(normalized, 16);
  return `${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}`;
}

function colorInputValue(value = "#ff87be") {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#ff87be";
}
