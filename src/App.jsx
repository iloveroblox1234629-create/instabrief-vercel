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
  useAi: true
};

export default function App() {
  const [form, setForm] = useState(initialForm);
  const [theme, setTheme] = useState(() => readTheme());
  const [status, setStatus] = useState("Ready.");
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
    setStatus(form.useAi ? "Building local metadata and asking the server for an AI summary..." : "Building the Markdown file in this browser...");

    try {
      let extraction = createClientExtraction(form);
      if (!extraction.items.length) {
        setStatus("No supported Instagram media URLs found.");
        return;
      }

      if (form.useAi) {
        const aiSummary = await requestAiSummary(form);
        extraction = applyAiSummary(extraction, aiSummary);
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
        setStatus(`${error instanceof Error ? error.message : "AI summary failed."} Downloaded local fallback ${markdownFile.filename}.`);
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
    <main className="min-h-screen bg-app-bg text-app-text" style={themeStyle}>
      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[280px_1fr] lg:py-8">
        <aside className="rounded-lg border border-black/10 bg-app-panel p-4 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-app-muted">InstaBrief</p>
          <h1 className="mt-2 text-2xl font-black leading-tight">Instagram notes as one Markdown file.</h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-app-muted">
            Extract URL metadata locally, summarize with a server-side OpenRouter route when configured, and download a single organized `.md` file.
          </p>

          <section className="mt-6">
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
        </aside>

        <section className="rounded-lg border border-black/10 bg-app-panel p-4 shadow-sm sm:p-6">
          <div className="flex flex-col justify-between gap-4 border-b border-black/10 pb-5 md:flex-row md:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-app-muted">Extraction console</p>
              <h2 className="mt-2 text-3xl font-black tracking-tight">Download a clean Markdown summary.</h2>
            </div>
            {latestFile ? (
              <button
                className="rounded-md border border-app-accent px-4 py-2 text-sm font-black text-app-accent"
                type="button"
                onClick={() => downloadMarkdown(latestFile)}
              >
                Download {latestFile.filename}
              </button>
            ) : null}
          </div>

          <form className="mt-5 grid gap-4" onSubmit={handleSubmit}>
            <label className="grid gap-2 text-sm font-black">
              Instagram URLs
              <textarea
                className="min-h-28 rounded-md border border-black/10 bg-white px-3 py-2 font-medium text-slate-900 outline-app-accent"
                placeholder="Paste Reel, post, or TV links. Multiple links are supported."
                value={form.rawUrls}
                onChange={(event) => updateField("rawUrls", event.target.value)}
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-black">
                Summary role
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

              <label className="flex items-center gap-3 rounded-md border border-black/10 bg-app-soft px-3 py-2 text-sm font-black">
                <input
                  className="h-5 w-5 accent-[var(--theme-accent)]"
                  type="checkbox"
                  checked={form.useAi}
                  onChange={(event) => updateField("useAi", event.target.checked)}
                />
                Use server-side OpenRouter summary
              </label>
            </div>

            <label className="grid gap-2 text-sm font-black">
              Caption or description
              <textarea
                className="min-h-24 rounded-md border border-black/10 bg-white px-3 py-2 font-medium text-slate-900 outline-app-accent"
                placeholder="Paste caption text when available."
                value={form.caption}
                onChange={(event) => updateField("caption", event.target.value)}
              />
            </label>

            <label className="grid gap-2 text-sm font-black">
              Transcript
              <textarea
                className="min-h-32 rounded-md border border-black/10 bg-white px-3 py-2 font-medium text-slate-900 outline-app-accent"
                placeholder="Paste speech transcript, generated captions, or audio notes."
                value={form.transcript}
                onChange={(event) => updateField("transcript", event.target.value)}
              />
            </label>

            <label className="grid gap-2 text-sm font-black">
              Visual notes
              <textarea
                className="min-h-24 rounded-md border border-black/10 bg-white px-3 py-2 font-medium text-slate-900 outline-app-accent"
                placeholder="Paste OCR text, scene descriptions, or overlay notes."
                value={form.visualText}
                onChange={(event) => updateField("visualText", event.target.value)}
              />
            </label>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                className="rounded-md bg-app-accent px-5 py-3 text-sm font-black text-white shadow-sm disabled:opacity-60"
                disabled={isWorking}
                type="submit"
              >
                {isWorking ? "Preparing..." : "Download Markdown"}
              </button>
              <p className="min-h-6 text-sm font-bold text-app-muted" role="status">{status}</p>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}

async function requestAiSummary(payload) {
  const response = await fetch("/api/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "OpenRouter summary failed.");
  }
  return body;
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
