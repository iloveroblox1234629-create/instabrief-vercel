import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import handler from "../api/summarize.js";

const originalFetch = globalThis.fetch;
const originalAbortSignalTimeout = globalThis.AbortSignal.timeout;
const originalKey = process.env.OPENROUTER_API_KEY;
const originalModel = process.env.OPENROUTER_MODEL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.AbortSignal.timeout = originalAbortSignalTimeout;
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
      headers: allowedHeaders(),
      body: { rawUrls: "https://www.instagram.com/reel/ABC123/" }
    }, response);

    assert.equal(requestBody.model, "openai/gpt-oss-120b:free");
    assert.match(requestBody.messages[1].content, /Template: General/);
    assert.equal(response.statusCode, 200);
  });

  it("includes the selected extraction template in the OpenRouter prompt", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    let openRouterPrompt = "";
    globalThis.fetch = async (url, options = {}) => {
      if (String(url).includes("instagram.com")) {
        return { ok: false, status: 404, text: async () => "" };
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
                  summarySentence: "A recipe brief for a saved pasta reel.",
                  takeaways: ["Capture ingredients and timing."],
                  actions: ["Make a grocery list."],
                  tags: ["recipe"]
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
      headers: allowedHeaders(),
      body: {
        rawUrls: "https://www.instagram.com/reel/FOOD123/",
        template: "recipe"
      }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.match(openRouterPrompt, /Template: Recipe/);
    assert.match(openRouterPrompt, /ingredients, measurements, steps, timing/);
    assert.match(openRouterPrompt, /Tailor the takeaways and actions to the selected template/);
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
      headers: allowedHeaders(),
      body: { rawUrls: "https://www.instagram.com/reel/DZMEWYFvfyS/" }
    }, response);

    assert.equal(response.statusCode, 502);
    assert.match(response.body.error, /OpenRouter did not return summary content/);
  });

  it("rejects malformed JSON request bodies", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";

    const response = createResponse();
    await handler({
      method: "POST",
      headers: allowedHeaders(),
      body: "{bad json"
    }, response);

    assert.equal(response.statusCode, 400);
    assert.match(response.body.error, /valid JSON/);
  });

  it("rejects requests without a supported Instagram media URL before using OpenRouter", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    let calledOpenRouter = false;
    globalThis.fetch = async () => {
      calledOpenRouter = true;
      return { ok: true, json: async () => ({}) };
    };

    const response = createResponse();
    await handler({
      method: "POST",
      headers: allowedHeaders(),
      body: { rawUrls: "" }
    }, response);

    assert.equal(response.statusCode, 400);
    assert.match(response.body.error, /Instagram media URL/);
    assert.equal(calledOpenRouter, false);
  });

  it("rejects browser requests from other origins before using OpenRouter", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    let calledOpenRouter = false;
    globalThis.fetch = async () => {
      calledOpenRouter = true;
      return { ok: true, json: async () => ({}) };
    };

    const response = createResponse();
    await handler({
      method: "POST",
      headers: {
        host: "instabrief-vercel.vercel.app",
        origin: "https://attacker.example"
      },
      body: { rawUrls: "https://www.instagram.com/reel/ABC123/" }
    }, response);

    assert.equal(response.statusCode, 403);
    assert.equal(calledOpenRouter, false);
  });

  it("returns the upstream status when OpenRouter sends a non-JSON error body", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = async () => ({
      ok: false,
      status: 429,
      json: async () => {
        throw new Error("not json");
      }
    });

    const response = createResponse();
    await handler({
      method: "POST",
      headers: allowedHeaders(),
      body: { rawUrls: "https://www.instagram.com/reel/ABC123/" }
    }, response);

    assert.equal(response.statusCode, 429);
    assert.equal(response.body.error, "OpenRouter request failed.");
  });

  it("returns 502 when OpenRouter returns malformed summary JSON", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.fetch = async (url) => {
      if (String(url).includes("instagram.com")) {
        return { ok: false, status: 404 };
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "not json {bad}" } }]
        })
      };
    };

    const response = createResponse();
    await handler({
      method: "POST",
      headers: allowedHeaders(),
      body: { rawUrls: "https://www.instagram.com/reel/ABC123/" }
    }, response);

    assert.equal(response.statusCode, 502);
    assert.match(response.body.error, /summary content/);
  });

  it("returns 504 when the OpenRouter request times out", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    globalThis.AbortSignal.timeout = () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    };

    const response = createResponse();
    await handler({
      method: "POST",
      headers: allowedHeaders(),
      body: { rawUrls: "https://www.instagram.com/reel/ABC123/" }
    }, response);

    assert.equal(response.statusCode, 504);
    assert.match(response.body.error, /timed out/);
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
      headers: allowedHeaders(),
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
      headers: allowedHeaders(),
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

function allowedHeaders() {
  return {
    host: "instabrief-vercel.vercel.app",
    origin: "https://instabrief-vercel.vercel.app"
  };
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
