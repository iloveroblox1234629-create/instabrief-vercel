const MAX_TEXT_LENGTH = 18000;

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Use POST." });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return response.status(503).json({ error: "OPENROUTER_API_KEY is not configured on the server." });
  }

  const payload = request.body || {};
  const prompt = createPrompt(payload);

  try {
    const openRouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": request.headers.origin || "https://instabrief.vercel.app",
        "X-Title": "InstaBrief"
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "openrouter/auto",
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

    const body = await openRouterResponse.json();
    if (!openRouterResponse.ok) {
      return response.status(openRouterResponse.status).json({
        error: body?.error?.message || "OpenRouter request failed."
      });
    }

    const content = body?.choices?.[0]?.message?.content || "{}";
    const summary = safeJson(content);
    return response.status(200).json({
      summarySentence: String(summary.summarySentence || "").trim(),
      takeaways: normalizeArray(summary.takeaways),
      actions: normalizeArray(summary.actions),
      tags: normalizeArray(summary.tags),
      model: body.model || process.env.OPENROUTER_MODEL || "openrouter/auto"
    });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "AI summarization failed."
    });
  }
}

function createPrompt(payload) {
  const urls = normalizeText(payload.rawUrls);
  const caption = normalizeText(payload.caption);
  const transcript = normalizeText(payload.transcript);
  const visualText = normalizeText(payload.visualText);
  const role = normalizeText(payload.role || "researcher");
  const source = [
    `Role: ${role}`,
    `URLs:\n${urls}`,
    `Caption:\n${caption}`,
    `Transcript:\n${transcript}`,
    `Visual notes:\n${visualText}`
  ].join("\n\n").slice(0, MAX_TEXT_LENGTH);

  return `${source}\n\nReturn JSON with keys summarySentence, takeaways, actions, and tags. summarySentence must be one short sentence suitable for a Markdown filename.`;
}

function normalizeText(value = "") {
  return typeof value === "string" ? value.trim() : "";
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
    return match ? JSON.parse(match[0]) : {};
  }
}
