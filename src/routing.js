const PAGE_PATHS = new Set(["about", "docs", "templates", "privacy", "extract"]);
const PAGE_HOSTS = new Map([
  ["about", "about"],
  ["docs", "docs"],
  ["templates", "templates"],
  ["privacy", "privacy"],
  ["app", "extract"],
  ["extract", "extract"],
  ["www", "extract"]
]);

export function resolveViewFromUrl(value = "https://instabrief.xyz/") {
  const url = safeUrl(value);
  if (!url) {
    return "extract";
  }

  const pathView = url.pathname.replace(/^\/+|\/+$/g, "").split("/")[0];
  if (PAGE_PATHS.has(pathView)) {
    return pathView;
  }

  const hostParts = url.hostname.toLowerCase().split(".");
  const subdomain = hostParts.length > 2 ? hostParts[0] : "";
  return PAGE_HOSTS.get(subdomain) || "extract";
}

export function pathForView(view = "extract") {
  const normalized = PAGE_PATHS.has(view) ? view : "extract";
  return normalized === "extract" ? "/extract" : `/${normalized}`;
}

export function readSharedTextFromUrl(value = "") {
  const url = safeUrl(value);
  if (!url) {
    return "";
  }
  const params = url.searchParams;
  return [params.get("url"), params.get("text"), params.get("title")]
    .filter(Boolean)
    .join("\n")
    .trim();
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
