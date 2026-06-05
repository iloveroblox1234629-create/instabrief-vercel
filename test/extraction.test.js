import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyAiSummary,
  createClientExtraction,
  createMarkdownDocument,
  extractInstagramUrls
} from "../src/extraction.js";

describe("extractInstagramUrls", () => {
  it("normalizes Instagram URLs and removes igsh tracking", () => {
    assert.deepEqual(
      extractInstagramUrls("https://www.instagram.com/reel/ABC/?igsh=tracker&utm_source=keep"),
      ["https://www.instagram.com/reel/ABC/?utm_source=keep"]
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
    assert.match(file.markdown, /# How to organize saved reels into research notes/);
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
    assert.match(file.markdown, /Capture the source/);
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
