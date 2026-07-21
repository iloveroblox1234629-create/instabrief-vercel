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
const DEFAULT_OPENROUTER_MODEL = "openai/gpt-oss-20b:free";
const DEFAULT_TEMPLATE_ID = "general";
const EXTRACTION_TEMPLATES = [
  {
    id: "general",
    label: "General",
    prompt: "Create concise research notes with source context, useful takeaways, and next actions.",
    fallbackActions: ["Review the source before publishing or citing the summary."],
    fallbackNote: "Capture claims, tools mentioned, open questions, and source context."
  },
  {
    id: "recipe",
    label: "Recipe",
    prompt: "Extract ingredients, measurements, steps, timing, substitutions, and grocery-list actions.",
    fallbackActions: ["List the ingredients, estimate measurements, and verify cook times from the source."],
    fallbackNote: "Turn the Reel into ingredients, steps, substitutions, timing, and grocery items."
  },
  {
    id: "travel",
    label: "Travel",
    prompt: "Extract places, itinerary ideas, costs, timing, booking hints, and map/search terms.",
    fallbackActions: ["Save places, timing, costs, and map search terms before planning the trip."],
    fallbackNote: "Convert the Reel into places, itinerary ideas, cost clues, and booking questions."
  },
  {
    id: "workout",
    label: "Workout",
    prompt: "Extract exercises, sets, reps, duration, equipment, cautions, and progression ideas.",
    fallbackActions: ["Record exercises, sets, reps, equipment, and safety cautions before trying it."],
    fallbackNote: "Summarize exercises, sets, reps, rest, equipment, cautions, and progression."
  },
  {
    id: "tutorial",
    label: "Tutorial",
    prompt: "Extract prerequisites, tools, ordered steps, pitfalls, decisions, and follow-up checks.",
    fallbackActions: ["Convert the tutorial into ordered steps, required tools, and likely failure points."],
    fallbackNote: "Turn the Reel into prerequisites, tools, steps, pitfalls, and follow-up checks."
  },
  {
    id: "product",
    label: "Product/ad analysis",
    prompt: "Extract the offer, audience, hook, proof, CTA, objections, and claims that need verification.",
    fallbackActions: ["Identify the offer, audience, proof, CTA, and claims that should be verified."],
    fallbackNote: "Analyze hook, audience, pain, proof, objections, CTA, and claims to verify."
  }
];

export function defaultOpenRouterModel() {
  return DEFAULT_OPENROUTER_MODEL;
}

export function extractionTemplates() {
  return EXTRACTION_TEMPLATES.map((template) => ({ ...template }));
}

export function defaultExtractionTemplateId() {
  return DEFAULT_TEMPLATE_ID;
}

export function normalizeExtractionTemplateId(value = DEFAULT_TEMPLATE_ID) {
  const id = String(value || DEFAULT_TEMPLATE_ID).trim().toLowerCase();
  return EXTRACTION_TEMPLATES.some((template) => template.id === id) ? id : DEFAULT_TEMPLATE_ID;
}

export function getExtractionTemplate(value = DEFAULT_TEMPLATE_ID) {
  const id = normalizeExtractionTemplateId(value);
  return EXTRACTION_TEMPLATES.find((template) => template.id === id) || EXTRACTION_TEMPLATES[0];
}

export function createTemplatePromptText(value = DEFAULT_TEMPLATE_ID) {
  const template = getExtractionTemplate(value);
  return `Template: ${template.label}\nTemplate guidance: ${template.prompt}`;
}

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

export function createClientExtraction({ rawUrls = "", role = "researcher", caption = "", transcript = "", visualText = "", template = DEFAULT_TEMPLATE_ID } = {}) {
  const templateId = normalizeExtractionTemplateId(template);
  const generatedAt = new Date().toISOString();
  const baseSummary = summarizeInputs({ role, caption, transcript, visualText, template: templateId });
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
        extraction: metadata,
        template: templateId,
        generatedAt
      });
    })
  };
}

export function applyAiSummary(extraction, aiSummary = {}) {
  assertAiSummaryContent(aiSummary);
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

export function assertAiSummaryContent(aiSummary = {}) {
  const hasSummarySentence = Boolean(normalizeSentence(aiSummary.summarySentence || ""));
  const hasTakeaways = normalizeList(aiSummary.takeaways).length > 0;
  if (!hasSummarySentence && !hasTakeaways) {
    throw new Error("OpenRouter did not return summary content.");
  }
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

export function summarizeInputs({ role = "researcher", caption = "", transcript = "", visualText = "", template = DEFAULT_TEMPLATE_ID } = {}) {
  const templateId = normalizeExtractionTemplateId(template);
  const captionSentences = splitSentences(caption);
  const transcriptSentences = splitSentences(transcript);
  const visualSentences = splitSentences(visualText);
  const allSentences = [...captionSentences, ...transcriptSentences, ...visualSentences];

  return {
    hook: chooseHook([...visualSentences, ...captionSentences, ...transcriptSentences]),
    takeaways: chooseTakeaways(allSentences),
    visualContext: visualSentences.slice(0, 3),
    actions: chooseActions(allSentences, templateId),
    creatorNotes: buildRoleNotes(role, allSentences, templateId)
  };
}

export function buildMarkdown({ url, type, role, summary, tags, extraction, ai, template = DEFAULT_TEMPLATE_ID, generatedAt }) {
  const titleType = titleForType(type);
  const templateInfo = getExtractionTemplate(template);
  const title = createSummarySentence({ type, summary });
  return [
    formatFrontmatter({
      title,
      url,
      type,
      role,
      tags,
      extraction,
      ai,
      template: templateInfo.id,
      generatedAt
    }),
    "",
    `# ${escapeMarkdownText(title)}`,
    "",
    `- URL: ${escapeMarkdownText(url)}`,
    `- Type: ${escapeMarkdownText(titleType)}`,
    `- Role: ${escapeMarkdownText(role)}`,
    `- Template: ${escapeMarkdownText(templateInfo.label)}`,
    `- Tags: ${escapeMarkdownText((tags || []).join(", ") || "untagged")}`,
    extraction?.ok ? `- Extracted Title: ${escapeMarkdownText(extraction.title || "Untitled")}` : "",
    extraction && !extraction.ok ? `- Extraction Status: ${escapeMarkdownText(extraction.error)}` : "",
    ai?.model ? `- AI Model: ${escapeMarkdownText(ai.model)}` : "",
    "",
    "## Summary",
    escapeMarkdownText(summary.hook || "No summary sentence detected yet."),
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

function buildItem({ url, type, role, summary, tags, extraction, ai, template = DEFAULT_TEMPLATE_ID, generatedAt }) {
  const templateId = normalizeExtractionTemplateId(template);
  const itemGeneratedAt = generatedAt || new Date().toISOString();
  return {
    url,
    type,
    role,
    summary,
    tags,
    extraction,
    ai,
    template: templateId,
    generatedAt: itemGeneratedAt,
    filename: createMarkdownFilename({ type, summary }),
    markdown: buildMarkdown({ url, type, role, summary, tags, extraction, ai, template: templateId, generatedAt: itemGeneratedAt })
  };
}

function normalizeInstagramUrl(value) {
  const parsed = safeUrl(trimTrailingUrlPunctuation(value));
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

function trimTrailingUrlPunctuation(value = "") {
  return String(value).replace(/[),.;:]+$/g, "");
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

function chooseActions(sentences, template = DEFAULT_TEMPLATE_ID) {
  const templateInfo = getExtractionTemplate(template);
  const actions = sentences.filter((sentence) => /save|try|use|export|add|paste|start|write|share/i.test(sentence));
  return (actions.length ? actions : templateInfo.fallbackActions).slice(0, 4);
}

function buildRoleNotes(role, sentences, template = DEFAULT_TEMPLATE_ID) {
  const templateInfo = getExtractionTemplate(template);
  const roleNotes = {
    creator: ["Identify the hook pattern, CTA, and reusable content structure."],
    marketer: ["Map this post to campaign angle, audience pain, proof, and CTA."],
    researcher: ["Capture claims, tools mentioned, open questions, and source context."],
    student: ["Turn takeaways into study notes, flashcards, or follow-up questions."],
    casual: ["Keep the TL;DR short and save only the useful next action."]
  };
  const notes = roleNotes[role] ?? roleNotes.researcher;
  const templateNote = templateInfo.id === DEFAULT_TEMPLATE_ID ? "" : templateInfo.fallbackNote;
  const pattern = sentences.find((sentence) => /hook|CTA|step|pattern|template|framework/i.test(sentence));
  return [
    ...notes,
    templateNote,
    pattern ? `Detected pattern: ${pattern}` : ""
  ].filter(Boolean);
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
  return items?.length ? items.map((item) => `- ${escapeMarkdownText(item)}`).join("\n") : "- Not provided.";
}

function formatFrontmatter({ title, url, type, role, tags = [], extraction = {}, ai = {}, template = DEFAULT_TEMPLATE_ID, generatedAt }) {
  const cleanTags = normalizeList(tags).slice(0, 8);
  return [
    "---",
    `title: ${yamlString(title || "Instagram summary")}`,
    "source: \"instagram\"",
    "platform: \"Instagram\"",
    `type: ${yamlString(type || "reel")}`,
    `url: ${yamlString(url || "")}`,
    `shortcode: ${yamlString(extraction?.shortcode || "")}`,
    `generatedAt: ${yamlString(generatedAt || new Date().toISOString())}`,
    `template: ${yamlString(normalizeExtractionTemplateId(template))}`,
    `role: ${yamlString(role || "researcher")}`,
    "tags:",
    ...(cleanTags.length ? cleanTags.map((tag) => `  - ${yamlString(tag)}`) : ["  - \"untagged\""]),
    `aiModel: ${yamlString(ai?.model || "local-fallback")}`,
    "---"
  ].join("\n");
}

function yamlString(value = "") {
  return JSON.stringify(escapeMarkdownText(value));
}

function escapeMarkdownText(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, " ")
    .trim();
}
