import { useEffect, useMemo, useState } from "react";
import {
  applyAiSummary,
  createClientExtraction,
  createMarkdownDocument
} from "./extraction.js";

const themePresets = {
  slate: {
    name: "Slate",
    bg: "#f6f7fb",
    panel: "#ffffff",
    text: "#121826",
    muted: "#5f6b7a",
    accent: "#2563eb",
    soft: "#eaf1ff"
  },
  citrus: {
    name: "Citrus",
    bg: "#fbfaf5",
    panel: "#ffffff",
    text: "#182018",
    muted: "#687463",
    accent: "#2f8f46",
    soft: "#eef8e8"
  },
  mono: {
    name: "Mono",
    bg: "#f5f5f4",
    panel: "#ffffff",
    text: "#1c1917",
    muted: "#6b625c",
    accent: "#111827",
    soft: "#ececea"
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
  clientModel: "openrouter/auto"
};

export default function App() {
  const [form, setForm] = useState(initialForm);
  const [theme, setTheme] = useState(() => readTheme());
  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const [status, setStatus] = useState("Paste a link to start.");
  const [latestFile, setLatestFile] = useState(null);
  const [isWorking, setIsWorking] = useState(false);

  const themeStyle = useMemo(() => ({
    "--theme-bg": theme.bg,
    "--theme-panel": theme.panel,
    "--theme-text": theme.text,
    "--theme-muted": theme.muted,
    "--theme-accent": theme.accent,
    "--theme-soft": theme.soft
  }), [theme]);

  useEffect(() => {
    localStorage.setItem("instabrief-theme", JSON.stringify(theme));
  }, [theme]);

  async function handleSubmit(event) {
    event.preventDefault();
    setIsWorking(true);
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
        setLatestFile(markdownFile);
        downloadMarkdown(markdownFile);
        setStatus(`${error instanceof Error ? error.message : "AI summary failed."} Downloaded local fallback.`);
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

  return (
    <main className="min-h-screen bg-app-bg px-4 py-5 text-app-text" style={themeStyle}>
      <div className="fixed right-4 top-4 z-10">
        <button
          aria-expanded={isThemeOpen}
          className="rounded-full border border-black/10 bg-app-panel px-4 py-2 text-sm font-black shadow-sm"
          type="button"
          onClick={() => setIsThemeOpen((open) => !open)}
        >
          Theme
        </button>
        {isThemeOpen ? (
          <section className="absolute right-0 mt-2 w-72 rounded-lg border border-black/10 bg-app-panel p-4 shadow-xl">
            <h2 className="text-sm font-black">Theme</h2>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {Object.entries(themePresets).map(([key, preset]) => (
                <button
                  className="rounded-md border border-black/10 px-2 py-2 text-xs font-black hover:border-app-accent"
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
                    className="h-8 w-12 rounded border border-black/10 bg-transparent"
                    type="color"
                    value={theme[key]}
                    onChange={(event) => updateTheme(key, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <section className="mx-auto flex min-h-[calc(100vh-40px)] w-full max-w-2xl items-center">
        <form className="w-full rounded-lg border border-black/10 bg-app-panel p-4 shadow-sm sm:p-6" onSubmit={handleSubmit}>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-app-muted">InstaBrief</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">Download a Markdown summary.</h1>

          <label className="mt-6 grid gap-2 text-sm font-black">
            Instagram link
            <input
              className="rounded-md border border-black/10 bg-white px-3 py-3 font-medium text-slate-900 outline-app-accent"
              placeholder="https://www.instagram.com/reel/..."
              value={form.rawUrls}
              onChange={(event) => updateField("rawUrls", event.target.value)}
            />
          </label>

          <div className="mt-4 rounded-md border border-black/10 bg-app-soft p-3">
            <label className="flex items-start gap-3 text-sm font-black">
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
                <label className="grid gap-2 text-sm font-black">
                  Client OpenRouter API key
                  <input
                    className="rounded-md border border-black/10 bg-white px-3 py-2 font-medium text-slate-900 outline-app-accent"
                    placeholder="sk-or-..."
                    type="password"
                    value={form.clientApiKey}
                    onChange={(event) => updateField("clientApiKey", event.target.value)}
                  />
                </label>
                <label className="grid gap-2 text-sm font-black">
                  Model
                  <input
                    className="rounded-md border border-black/10 bg-white px-3 py-2 font-medium text-slate-900 outline-app-accent"
                    value={form.clientModel}
                    onChange={(event) => updateField("clientModel", event.target.value)}
                  />
                </label>
                <p className="text-xs font-bold leading-5 text-app-muted">The key stays in this tab and is sent directly from your browser to OpenRouter. It is not committed, stored, or sent to this app's server.</p>
              </div>
            ) : null}
          </div>

          <details className="mt-4 rounded-md border border-black/10 bg-white/70 p-3">
            <summary className="cursor-pointer text-sm font-black">Optional context</summary>
            <div className="mt-4 grid gap-4">
              <label className="grid gap-2 text-sm font-black">
                Role
                <select
                  className="rounded-md border border-black/10 bg-white px-3 py-2 text-slate-900 outline-app-accent"
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
              <label className="grid gap-2 text-sm font-black">
                Caption or description
                <textarea
                  className="min-h-20 rounded-md border border-black/10 bg-white px-3 py-2 font-medium text-slate-900 outline-app-accent"
                  value={form.caption}
                  onChange={(event) => updateField("caption", event.target.value)}
                />
              </label>
              <label className="grid gap-2 text-sm font-black">
                Transcript
                <textarea
                  className="min-h-24 rounded-md border border-black/10 bg-white px-3 py-2 font-medium text-slate-900 outline-app-accent"
                  value={form.transcript}
                  onChange={(event) => updateField("transcript", event.target.value)}
                />
              </label>
              <label className="grid gap-2 text-sm font-black">
                Visual notes
                <textarea
                  className="min-h-20 rounded-md border border-black/10 bg-white px-3 py-2 font-medium text-slate-900 outline-app-accent"
                  value={form.visualText}
                  onChange={(event) => updateField("visualText", event.target.value)}
                />
              </label>
            </div>
          </details>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              className="rounded-md bg-app-accent px-5 py-3 text-sm font-black text-white shadow-sm disabled:opacity-60"
              disabled={isWorking}
              type="submit"
            >
              {isWorking ? "Preparing..." : "Download Markdown"}
            </button>
            {latestFile ? (
              <button
                className="rounded-md border border-app-accent px-4 py-3 text-sm font-black text-app-accent"
                type="button"
                onClick={() => downloadMarkdown(latestFile)}
              >
                Download again
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
  const response = await fetch("/api/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseSummaryResponse(response);
}

async function requestClientSummary(payload) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${payload.clientApiKey.trim()}`,
      "Content-Type": "application/json",
      "X-Title": "InstaBrief"
    },
    body: JSON.stringify({
      model: payload.clientModel || "openrouter/auto",
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
    model: body.model || payload.clientModel || "openrouter/auto"
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
    return match ? JSON.parse(match[0]) : {};
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
      ...themePresets.slate,
      ...JSON.parse(localStorage.getItem("instabrief-theme") || "{}")
    };
  } catch {
    return themePresets.slate;
  }
}
