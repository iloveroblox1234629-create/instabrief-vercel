import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyAiSummary,
  createClientExtraction,
  createMarkdownDocument,
  createTemplatePromptText,
  extractInstagramUrls
} from "../src/extraction.js";

describe("extractInstagramUrls", () => {
  it("normalizes Instagram URLs and removes igsh tracking", () => {
    assert.deepEqual(
      extractInstagramUrls("https://www.instagram.com/reel/ABC/?igsh=tracker&utm_source=keep"),
      ["https://www.instagram.com/reel/ABC/?utm_source=keep"]
    );
  });

  it("trims common punctuation copied after an Instagram URL", () => {
    assert.deepEqual(
      extractInstagramUrls("Watch https://www.instagram.com/reel/ABC123/?utm_source=ig_web_copy_link,"),
      ["https://www.instagram.com/reel/ABC123/?utm_source=ig_web_copy_link"]
    );
  });
});

describe("createMarkdownDocument", () => {
  it("creates one Markdown file named from the summary sentence", () => {
    const extraction = createClientExtraction({
      rawUrls: "https://www.instagram.com/reel/ABC123/",
      caption: "How to organize saved reels into research notes."
    });
    const file = createMarkdownDocument(extraction.items);

    assert.equal(file.filename, "how-to-organize-saved-reels-into-research-notes.md");
    assert.match(file.markdown, /^---\ntitle: "How to organize saved reels into research notes"/);
    assert.match(file.markdown, /source: "instagram"/);
    assert.match(file.markdown, /platform: "Instagram"/);
    assert.match(file.markdown, /shortcode: "ABC123"/);
    assert.match(file.markdown, /template: "general"/);
    assert.match(file.markdown, /aiModel: "local-fallback"/);
    assert.match(file.markdown, /# How to organize saved reels into research notes/);
  });

  it("uses template-specific local fallback actions and notes", () => {
    const extraction = createClientExtraction({
      rawUrls: "https://www.instagram.com/reel/FOOD123/",
      caption: "Fast weeknight pasta with lemon, butter, and parmesan.",
      template: "recipe"
    });
    const file = createMarkdownDocument(extraction.items);

    assert.match(file.markdown, /template: "recipe"/);
    assert.match(file.markdown, /- Template: Recipe/);
    assert.match(file.markdown, /List the ingredients, estimate measurements, and verify cook times/);
    assert.match(file.markdown, /ingredients, steps, substitutions, timing, and grocery items/);
  });

  it("uses OpenRouter summary output when present", () => {
    const extraction = createClientExtraction({
      rawUrls: "https://www.instagram.com/p/XYZ789/",
      caption: "Local fallback text."
    });
    const withAi = applyAiSummary(extraction, {
      summarySentence: "A concise framework for turning posts into reusable research notes.",
      takeaways: ["Capture the source.", "Extract reusable claims."],
      actions: ["Download the Markdown note."],
      tags: ["research", "notes"],
      model: "openrouter/auto"
    });
    const file = createMarkdownDocument(withAi.items);

    assert.equal(file.filename, "a-concise-framework-for-turning-posts-into-reusable-research-notes.md");
    assert.match(file.markdown, /AI Model: openrouter\/auto/);
    assert.match(file.markdown, /aiModel: "openrouter\/auto"/);
    assert.match(file.markdown, /Capture the source/);
  });

  it("escapes generated Markdown text that could render HTML", () => {
    const extraction = createClientExtraction({
      rawUrls: "https://www.instagram.com/reel/ABC123/",
      caption: "How <script>alert(1)</script> becomes safe notes."
    });
    const withAi = applyAiSummary(extraction, {
      summarySentence: "How <script>alert(1)</script> becomes safe notes.",
      takeaways: ["Review <img src=x onerror=alert(1)> safely."],
      actions: [],
      tags: ["security"]
    });
    const file = createMarkdownDocument(withAi.items);

    assert.doesNotMatch(file.markdown, /<script>/);
    assert.match(file.markdown, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(file.markdown, /&lt;img src=x onerror=alert\(1\)&gt;/);
  });

  it("rejects OpenRouter responses that only identify a model without summary content", () => {
    const extraction = createClientExtraction({
      rawUrls: "https://www.instagram.com/reel/DZMEWYFvfyS/"
    });

    assert.throws(
      () => applyAiSummary(extraction, {
        model: "nvidia/nemotron-3.5-content-safety-20260604:free",
        summarySentence: "",
        takeaways: [],
        actions: [],
        tags: []
      }),
      /OpenRouter did not return summary content/
    );
  });

  it("rejects OpenRouter responses that contain only tags or actions", () => {
    const extraction = createClientExtraction({
      rawUrls: "https://www.instagram.com/reel/DZMEWYFvfyS/"
    });

    assert.throws(
      () => applyAiSummary(extraction, {
        model: "some-model",
        summarySentence: "",
        takeaways: [],
        actions: ["Review the source."],
        tags: ["instagram"]
      }),
      /OpenRouter did not return summary content/
    );
  });
});

describe("createTemplatePromptText", () => {
  it("includes selected template guidance for AI prompts", () => {
    assert.match(createTemplatePromptText("travel"), /Template: Travel/);
    assert.match(createTemplatePromptText("travel"), /itinerary ideas/);
  });
});
