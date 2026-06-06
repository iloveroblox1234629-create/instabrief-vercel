import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pathForView, readSharedTextFromUrl, resolveViewFromUrl } from "../src/routing.js";

describe("resolveViewFromUrl", () => {
  it("maps planned subdomains to the expected app views", () => {
    assert.equal(resolveViewFromUrl("https://instabrief.xyz/"), "extract");
    assert.equal(resolveViewFromUrl("https://www.instabrief.xyz/"), "extract");
    assert.equal(resolveViewFromUrl("https://app.instabrief.xyz/"), "extract");
    assert.equal(resolveViewFromUrl("https://extract.instabrief.xyz/"), "extract");
    assert.equal(resolveViewFromUrl("https://about.instabrief.xyz/"), "about");
    assert.equal(resolveViewFromUrl("https://docs.instabrief.xyz/"), "docs");
    assert.equal(resolveViewFromUrl("https://templates.instabrief.xyz/"), "templates");
    assert.equal(resolveViewFromUrl("https://privacy.instabrief.xyz/"), "privacy");
  });

  it("uses path fallbacks before host-based routing", () => {
    assert.equal(resolveViewFromUrl("https://instabrief.xyz/about"), "about");
    assert.equal(resolveViewFromUrl("https://docs.instabrief.xyz/extract"), "extract");
  });
});

describe("pathForView", () => {
  it("returns SPA fallback paths for known views", () => {
    assert.equal(pathForView("about"), "/about");
    assert.equal(pathForView("docs"), "/docs");
    assert.equal(pathForView("templates"), "/templates");
    assert.equal(pathForView("privacy"), "/privacy");
    assert.equal(pathForView("extract"), "/extract");
  });
});

describe("readSharedTextFromUrl", () => {
  it("collects Web Share Target query fields for the extractor", () => {
    const sharedText = readSharedTextFromUrl("https://instabrief.xyz/extract?title=Saved%20Reel&text=Watch&url=https%3A%2F%2Fwww.instagram.com%2Freel%2FABC123%2F");

    assert.match(sharedText, /Saved Reel/);
    assert.match(sharedText, /Watch/);
    assert.match(sharedText, /https:\/\/www.instagram.com\/reel\/ABC123\//);
  });
});
