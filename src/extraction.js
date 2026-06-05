const INSTAGRAM_MEDIA_URL_RE = /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[A-Za-z0-9_.-]+\/?(?:\?[^)\]\s"'<>]*)?/gi;
const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "are",
  "but",
  "for",
  "from",
  "has",
  "have",
  "into",
  "later",
  "that",
  "the",
  "this",
  "then",
  "they",
  "with",
  "your"
]);

export function extractInstagramUrls(text = "") {
  const urls = text.match(INSTAGRAM_MEDIA_URL_RE) ?? [];
  const seen = new Set();
  return urls.reduce((acc, url) => {
    const cleaned = normalizeInstagramUrl(url);
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      acc.push(cleaned);
    }
    return acc;
  }, []);
}

export function createClientExtraction({ rawUrls = "", role = "researcher", caption = "", transcript = "", visualText = "" } = {}) {
  const baseSummary = summarizeInputs({ role, caption, transcript, visualText });
  const tags = createTags([caption, transcript, visualText].join(" "));

  return {
    items: extractInstagramUrls(rawUrls).map((url) => {
      const metadata = extractInstagramUrlMetadata(url);
      const type = classifyInstagramUrl(url);
      const canonicalUrl = metadata.canonicalUrl || url;
      return buildItem({
        url: canonicalUrl,
        type,
        role,
        summary: baseSummary,
        tags,
        extraction: metadata
      });
    })
  };
}

export function applyAiSummary(extraction, aiSummary = {}) {
  const summarySentence = normalizeSentence(aiSummary.summarySentence || "");
  const takeaways = normalizeList(aiSummary.takeaways).slice(0, 5);
  const actions = normalizeList(aiSummary.actions).slice(0, 4);
  const tags = normalizeList(aiSummary.tags).slice(0, 6);

  return {
    items: extraction.items.map((item) => buildItem({
      ...item,
      summary: {
        ...item.summary,
        hook: summarySentence || item.summary.hook,
        takeaways: takeaways.length ? takeaways : item.summary.takeaways,
        actions: actions.length ? actions : item.summary.actions,
        creatorNotes: item.summary.creatorNotes
      },
      tags: tags.length ? tags : item.tags,
      ai: aiSummary.model ? { model: aiSummary.model } : undefined
    }))
  };
}

export function createMarkdownDocument(items = []) {
  const cleanItems = items.filter(Boolean);
  const primaryItem = cleanItems[0];
  return {
    filename: createMarkdownFilename(primaryItem || {}),
    title: createSummarySentence(primaryItem),
    markdown: cleanItems.map((item) => item.markdown).join("\n\n---\n\n")
  };
}

export function createSummarySentence(item = {}) {
  const summary = item.summary || {};
  const sentence = [
    summary.hook,
    summary.takeaways?.[0],
    item.extraction?.title,
    `${titleForType(item.type || "reel")} summary`
  ].find((value) => typeof value === "string" && value.trim());
  return normalizeSentence(sentence || "Instagram summary");
}

export function createMarkdownFilename(item = {}) {
  const slug = createSummarySentence(item)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${slug || "instagram-summary"}.md`;
}

export function extractInstagramUrlMetadata(url) {
  const parsed = safeUrl(url);
  const type = classifyInstagramUrl(url);
  const shortcode = readShortcode(parsed);

  if (!parsed || !shortcode || type === "unsupported") {
    return {
      ok: false,
      source: "local-url",
      error: "Unsupported Instagram media URL."
    };
  }

  const canonicalUrl = `https://www.instagram.com/${type === "video" ? "tv" : type === "post" ? "p" : "reel"}/${shortcode}/`;
  return {
    ok: true,
    source: "local-url",
    title: `Instagram ${titleForType(type)} ${shortcode}`,
    caption: "",
    description: "",
    image: "",
    shortcode,
    canonicalUrl
  };
}

export function classifyInstagramUrl(url) {
  const pathname = safeUrl(url)?.pathname ?? "";
  if (pathname.startsWith("/reel/") || pathname.startsWith("/reels/")) {
    return "reel";
  }
  if (pathname.startsWith("/p/")) {
    return "post";
  }
  if (pathname.startsWith("/tv/")) {
    return "video";
  }
  return "unsupported";
}

export function summarizeInputs({ role = "researcher", caption = "", transcript = "", visualText = "" } = {}) {
  const captionSentences = splitSentences(caption);
  const transcriptSentences = splitSentences(transcript);
  const visualSentences = splitSentences(visualText);
  const allSentences = [...captionSentences, ...transcriptSentences, ...visualSentences];

  return {
    hook: chooseHook([...visualSentences, ...captionSentences, ...transcriptSentences]),
    takeaways: chooseTakeaways(allSentences),
    visualContext: visualSentences.slice(0, 3),
    actions: chooseActions(allSentences),
    creatorNotes: buildRoleNotes(role, allSentences)
  };
}

export function buildMarkdown({ url, type, role, summary, tags, extraction, ai }) {
  const titleType = titleForType(type);
  return [
    `# ${createSummarySentence({ type, summary })}`,
    "",
    `- URL: ${url}`,
    `- Type: ${titleType}`,
    `- Role: ${role}`,
    `- Tags: ${(tags || []).join(", ") || "untagged"}`,
    extraction?.ok ? `- Extracted Title: ${extraction.title || "Untitled"}` : "",
    extraction && !extraction.ok ? `- Extraction Status: ${extraction.error}` : "",
    ai?.model ? `- AI Model: ${ai.model}` : "",
    "",
    "## Summary",
    summary.hook || "No summary sentence detected yet.",
    "",
    "## Takeaways",
    formatList(summary.takeaways),
    "",
    "## Visual Context",
    formatList(summary.visualContext),
    "",
    "## Actions",
    formatList(summary.actions),
    "",
    "## Notes",
    formatList(summary.creatorNotes)
  ].filter((line) => line !== "").join("\n");
}

function buildItem({ url, type, role, summary, tags, extraction, ai }) {
  return {
    url,
    type,
    role,
    summary,
    tags,
    extraction,
    ai,
    filename: createMarkdownFilename({ type, summary }),
    markdown: buildMarkdown({ url, type, role, summary, tags, extraction, ai })
  };
}

function normalizeInstagramUrl(value) {
  const parsed = safeUrl(value);
  if (!parsed) {
    return value;
  }
  parsed.searchParams.delete("igsh");
  return parsed.toString();
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function readShortcode(parsed) {
  const [, mediaType, shortcode] = parsed?.pathname.match(/^\/(reel|reels|p|tv)\/([A-Za-z0-9_.-]+)/) ?? [];
  return mediaType ? shortcode || "" : "";
}

function titleForType(type) {
  if (type === "reel") {
    return "Reel";
  }
  if (type === "post") {
    return "Post";
  }
  return "Video";
}

function splitSentences(text) {
  return text
    .split(/[\n.!?]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function chooseHook(sentences) {
  return sentences.find((sentence) => /hook|start|secret|nobody|steal|mistake|why|how/i.test(sentence)) ?? sentences[0] ?? "";
}

function chooseTakeaways(sentences) {
  const useful = sentences.filter((sentence) => sentence.length > 12);
  return (useful.length ? useful : sentences).slice(0, 5);
}

function chooseActions(sentences) {
  const actions = sentences.filter((sentence) => /save|try|use|export|add|paste|start|write|share/i.test(sentence));
  return (actions.length ? actions : ["Review the source before publishing or citing the summary."]).slice(0, 4);
}

function buildRoleNotes(role, sentences) {
  const roleNotes = {
    creator: ["Identify the hook pattern, CTA, and reusable content structure."],
    marketer: ["Map this post to campaign angle, audience pain, proof, and CTA."],
    researcher: ["Capture claims, tools mentioned, open questions, and source context."],
    student: ["Turn takeaways into study notes, flashcards, or follow-up questions."],
    casual: ["Keep the TL;DR short and save only the useful next action."]
  };
  const notes = roleNotes[role] ?? roleNotes.researcher;
  const pattern = sentences.find((sentence) => /hook|CTA|step|pattern|template|framework/i.test(sentence));
  return pattern ? [...notes, `Detected pattern: ${pattern}`] : notes;
}

function createTags(text) {
  const words = text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
  const counts = new Map();
  for (const word of words) {
    if (!STOP_WORDS.has(word)) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([word]) => word);
}

function normalizeSentence(value) {
  const words = String(value)
    .replace(/\s+/g, " ")
    .replace(/^hook:\s*/i, "")
    .trim()
    .split(" ")
    .slice(0, 12);
  return words.join(" ").replace(/[.!?]+$/g, "") || "";
}

function normalizeList(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function formatList(items) {
  return items?.length ? items.map((item) => `- ${item}`).join("\n") : "- Not provided.";
}
