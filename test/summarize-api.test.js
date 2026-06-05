import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import handler from "../api/summarize.js";

const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENROUTER_API_KEY;
const originalModel = process.env.OPENROUTER_MODEL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv("OPENROUTER_API_KEY", originalKey);
  restoreEnv("OPENROUTER_MODEL", originalModel);
});

describe("summarize API", () => {
  it("defaults to a free structured-output OpenRouter model", async () => {
    delete process.env.OPENROUTER_MODEL;
    process.env.OPENROUTER_API_KEY = "test-key";
    let requestBody;
    globalThis.fetch = async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          model: requestBody.model,
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summarySentence: "A clear workflow for turning reels into notes.",
                  takeaways: ["Capture the source."],
                  actions: ["Download Markdown."],
                  tags: ["notes"]
                })
              }
            }
          ]
        })
      };
    };

    const response = createResponse();
    await handler({
      method: "POST",
      headers: { origin: "https://example.com" },
      body: { rawUrls: "https://www.instagram.com/reel/ABC123/" }
    }, response);

    assert.equal(requestBody.model, "openai/gpt-oss-120b:free");
    assert.equal(response.statusCode, 200);
  });

  it("rejects OpenRouter responses that contain no usable summary content", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        model: "nvidia/nemotron-3.5-content-safety-20260604:free",
        choices: [
          {
            message: {
              content: JSON.stringify({
                summarySentence: "",
                takeaways: [],
                actions: [],
                tags: []
              })
            }
          }
        ]
      })
    });

    const response = createResponse();
    await handler({
      method: "POST",
      headers: { origin: "https://example.com" },
      body: { rawUrls: "https://www.instagram.com/reel/DZMEWYFvfyS/" }
    }, response);

    assert.equal(response.statusCode, 502);
    assert.match(response.body.error, /OpenRouter did not return summary content/);
  });

  it("fetches public Instagram metadata before asking OpenRouter to summarize", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const requestedUrls = [];
    let openRouterPrompt = "";
    globalThis.fetch = async (url, options = {}) => {
      requestedUrls.push(String(url));
      if (String(url).includes("instagram.com")) {
        return {
          ok: true,
          text: async () => `
            <html>
              <head>
                <meta property="og:title" content="Creator reel about searchable notes">
                <meta property="og:description" content="99 likes, 2 comments - Creator on June 4, 2026: &quot;Turn saved reels into searchable Markdown notes.&quot;">
              </head>
            </html>
          `
        };
      }

      const body = JSON.parse(options.body);
      openRouterPrompt = body.messages[1].content;
      return {
        ok: true,
        json: async () => ({
          model: body.model,
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summarySentence: "Turn saved reels into searchable Markdown notes.",
                  takeaways: ["Use the reel as a source for notes."],
                  actions: ["Download the Markdown file."],
                  tags: ["markdown", "notes"]
                })
              }
            }
          ]
        })
      };
    };

    const response = createResponse();
    await handler({
      method: "POST",
      headers: { origin: "https://example.com" },
      body: { rawUrls: "https://www.instagram.com/reel/ABC123/" }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(requestedUrls[0], "https://www.instagram.com/reel/ABC123/");
    assert.match(openRouterPrompt, /Creator reel about searchable notes/);
    assert.match(openRouterPrompt, /Turn saved reels into searchable Markdown notes/);
  });

  it("uses a timeout signal for Instagram metadata fetches", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    let instagramSignal;
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).includes("instagram.com")) {
        instagramSignal = options.signal;
        return {
          ok: false,
          status: 504,
          text: async () => ""
        };
      }
      const body = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          model: body.model,
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summarySentence: "A fallback summary still gets generated.",
                  takeaways: ["Continue when metadata is unavailable."],
                  actions: ["Download Markdown."],
                  tags: ["fallback"]
                })
              }
            }
          ]
        })
      };
    };

    const response = createResponse();
    await handler({
      method: "POST",
      headers: { origin: "https://example.com" },
      body: { rawUrls: "https://www.instagram.com/reel/ABC123/" }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.ok(instagramSignal instanceof AbortSignal);
  });
});

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
