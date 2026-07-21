import {
  assertAiSummaryContent,
  createTemplatePromptText,
  defaultOpenRouterModel,
  extractInstagramUrls,
  normalizeExtractionTemplateId
} from "../src/extraction.js";

const MAX_TEXT_LENGTH = 18000;
const MAX_FIELD_LENGTH = 6000;
const METADATA_TIMEOUT_MS = 4500;
const OPENROUTER_TIMEOUT_MS = 20000;
const DEFAULT_APP_ORIGIN = "https://instabrief-vercel.vercel.app";
const RETIRED_OPENROUTER_MODELS = new Set(["openai/gpt-oss-120b:free"]);
const INSTAGRAM_MEDIA_URL_RE = /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[A-Za-z0-9_.-]+\/?(?:\?[^)\]\s"'<>]*)?/gi;

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Use POST." });
  }
  if (!isAllowedRequestOrigin(request)) {
    return response.status(403).json({ error: "Origin is not allowed." });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return response.status(503).json({ error: "OPENROUTER_API_KEY is not configured on the server." });
  }

  const { payload, error } = readPayload(request);
  if (error) {
    return response.status(400).json({ error });
  }
  if (!extractInstagramUrls(normalizeText(payload.rawUrls)).length) {
    return response.status(400).json({ error: "A supported Instagram media URL is required." });
  }
  const prompt = await createPrompt(payload);
  const model = configuredOpenRouterModel();

  try {
    const openRouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": readRequestOrigin(request) || DEFAULT_APP_ORIGIN,
        "X-Title": "InstaBrief"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: "You summarize Instagram videos into concise research notes. Return strict JSON only."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2
      })
    });

    const body = await openRouterResponse.json().catch(() => ({}));
    if (!openRouterResponse.ok) {
      return response.status(openRouterResponse.status).json({
        error: body?.error?.message || "OpenRouter request failed."
      });
    }

    const content = body?.choices?.[0]?.message?.content || "{}";
    const summary = safeJson(content);
    try {
      assertAiSummaryContent(summary);
    } catch (error) {
      return response.status(502).json({
        error: error instanceof Error ? error.message : "OpenRouter did not return summary content."
      });
    }
    return response.status(200).json({
      summarySentence: String(summary.summarySentence || "").trim(),
      takeaways: normalizeArray(summary.takeaways),
      actions: normalizeArray(summary.actions),
      tags: normalizeArray(summary.tags),
      model: body.model || model
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      return response.status(504).json({
        error: "OpenRouter summary request timed out."
      });
    }
    return response.status(500).json({
      error: error instanceof Error ? error.message : "AI summarization failed."
    });
  }
}

function configuredOpenRouterModel() {
  const configuredModel = process.env.OPENROUTER_MODEL?.trim();
  return configuredModel && !RETIRED_OPENROUTER_MODELS.has(configuredModel)
    ? configuredModel
    : defaultOpenRouterModel();
}

async function createPrompt(payload) {
  const urls = normalizeText(payload.rawUrls);
  const caption = normalizeText(payload.caption);
  const transcript = normalizeText(payload.transcript);
  const visualText = normalizeText(payload.visualText);
  const role = normalizeText(payload.role || "researcher", 80);
  const template = normalizeExtractionTemplateId(payload.template);
  const metadata = await fetchInstagramMetadata(urls);
  const source = [
    `Role: ${role}`,
    createTemplatePromptText(template),
    `URLs:\n${urls}`,
    `Extracted Instagram metadata:\n${metadata}`,
    `Caption:\n${caption}`,
    `Transcript:\n${transcript}`,
    `Visual notes:\n${visualText}`
  ].join("\n\n").slice(0, MAX_TEXT_LENGTH);

  return `${source}\n\nReturn JSON with keys summarySentence, takeaways, actions, and tags. summarySentence must be one short sentence suitable for a Markdown filename. Tailor the takeaways and actions to the selected template.`;
}

function readPayload(request) {
  if (!request.body) {
    return { payload: {} };
  }
  if (typeof request.body === "string") {
    try {
      return { payload: JSON.parse(request.body) };
    } catch {
      return { payload: {}, error: "Request body must be valid JSON." };
    }
  }
  if (typeof request.body === "object") {
    return { payload: request.body };
  }
  return { payload: {}, error: "Request body must be a JSON object." };
}

function normalizeText(value = "", maxLength = MAX_FIELD_LENGTH) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isAllowedRequestOrigin(request) {
  const origin = readRequestOrigin(request);
  if (!origin) {
    return true;
  }
  const originUrl = safeUrl(origin);
  if (!originUrl) {
    return false;
  }
  const host = readHeader(request.headers, "host");
  if (host && originUrl.host === host) {
    return true;
  }
  return allowedAppOrigins().some((allowedOrigin) => originUrl.origin === allowedOrigin);
}

function readRequestOrigin(request) {
  const origin = readHeader(request.headers, "origin");
  const originUrl = safeUrl(origin);
  return originUrl ? originUrl.origin : "";
}

function readHeader(headers = {}, name) {
  if (typeof headers.get === "function") {
    return headers.get(name) || "";
  }
  return headers[name] || headers[name.toLowerCase()] || "";
}

function allowedAppOrigins() {
  return [DEFAULT_APP_ORIGIN, process.env.APP_ORIGIN]
    .filter(Boolean)
    .map((origin) => safeUrl(origin)?.origin)
    .filter(Boolean);
}

function safeUrl(value = "") {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

async function fetchInstagramMetadata(rawUrls) {
  const urls = [...new Set(rawUrls.match(INSTAGRAM_MEDIA_URL_RE) || [])].slice(0, 3);
  const pages = await Promise.all(urls.map(async (url) => {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
        headers: {
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
          "user-agent": "Mozilla/5.0 (compatible; InstaBrief/1.0; +https://instabrief-vercel.vercel.app)"
        }
      });
      if (!response.ok) {
        return `${url}\nInstagram returned HTTP ${response.status}.`;
      }
      const html = await response.text();
      const title = readMeta(html, "og:title") || readTitle(html);
      const description = readMeta(html, "og:description");
      return [
        url,
        title ? `Title: ${title}` : "",
        description ? `Description: ${cleanInstagramDescription(description)}` : ""
      ].filter(Boolean).join("\n");
    } catch (error) {
      return `${url}\nMetadata unavailable: ${error instanceof Error ? error.message : "fetch failed"}.`;
    }
  }));
  return pages.filter(Boolean).join("\n\n") || "No public Instagram metadata fetched.";
}

function readMeta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+property\\s*=\\s*["']${escaped}["'][^>]+content\\s*=\\s*["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]+property\\s*=\\s*["']${escaped}["'][^>]*>`, "i")
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtml(match[1]);
    }
  }
  return "";
}

function readTitle(html) {
  return decodeHtml(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "");
}

function cleanInstagramDescription(value) {
  return value
    .replace(/^\s*[\d,.]+\s+likes?,\s*[\d,.]+\s+comments?\s*-\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value = "") {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function normalizeArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, 8)
    : [];
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
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

function isTimeoutError(error) {
  return error?.name === "TimeoutError" || error?.name === "AbortError";
}
