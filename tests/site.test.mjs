import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import worker from "../worker.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const html = read("public/index.html");

function meta(name) {
  const tags = [...html.matchAll(/<meta\b[^>]*>/g)].map(([tag]) => tag);
  const matches = tags.filter((tag) =>
    tag.includes(`name="${name}"`) || tag.includes(`property="${name}"`)
  );
  assert.equal(matches.length, 1, `Expected exactly one ${name} meta tag`);
  return matches[0].match(/content="([^"]*)"/)?.[1];
}

function pngSize(path) {
  const data = readFileSync(new URL(path, root));
  assert.deepEqual(data.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(data.toString("ascii", 12, 16), "IHDR");
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), bytes: data.length };
}

test("homepage has descriptive, crawlable metadata without changing its introduction", () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>Yuya \| Software Engineer<\/title>/);
  assert.match(meta("description"), /software engineer/i);
  assert.equal(meta("robots"), "max-image-preview:large");
  assert.match(html, /<link rel="canonical" href="https:\/\/yuyakevinito\.com\/" \/>/);
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.match(html, /<h1>Hi, I'm Yuya\.<\/h1>/);
  assert.doesNotMatch(html, /<script\b/);
});

test("Open Graph and X cards share a real, correctly sized PNG", () => {
  assert.equal(meta("og:type"), "website");
  assert.equal(meta("og:url"), "https://yuyakevinito.com/");
  assert.equal(meta("og:title"), meta("twitter:title"));
  assert.equal(meta("og:description"), meta("twitter:description"));
  assert.equal(meta("twitter:card"), "summary_large_image");
  assert.equal(meta("og:image"), "https://yuyakevinito.com/social-card.png");
  assert.equal(meta("og:image"), meta("twitter:image"));
  assert.equal(meta("og:image:alt"), meta("twitter:image:alt"));
  assert.ok(meta("og:image:alt").length > 0);
  assert.equal(meta("og:image:type"), "image/png");
  const image = pngSize("public/social-card.png");
  assert.equal(image.width, 1200);
  assert.equal(image.height, 630);
  assert.equal(Number(meta("og:image:width")), image.width);
  assert.equal(Number(meta("og:image:height")), image.height);
  assert.ok(image.bytes < 1_000_000, "Keep the social image under 1 MB");
});

test("homepage links to the verified LinkedIn profile separately from projects", () => {
  const profiles = [...html.matchAll(/<a\b([^>]*class="profile-link"[^>]*)>([\s\S]*?)<\/a>/g)];
  assert.equal(profiles.length, 1);
  const [, attributes, content] = profiles[0];
  assert.ok(attributes.includes('href="https://www.linkedin.com/in/yuyaito/"'));
  assert.ok(attributes.includes('rel="me"'));
  assert.equal(content, "LinkedIn");
  assert.doesNotMatch(attributes, /target=|tabindex=|onclick=/);
  assert.ok(html.indexOf('class="profile-link"') < html.indexOf('<section class="projects"'));
});

test("homepage links to each service with an English name and description", () => {
  const projects = [
    ["kakusu", "https://kakusu.yuyakevinito.com/", "Hide faces in photos, right in your browser."],
    ["Karuku", "https://karuku.yuyakevinito.com/", "Compress JPEG photos while preserving HDR."],
    ["koe", "https://koe.yuyakevinito.com/", "Dictation for your Mac, wherever you type."],
    ["X Card Tools", "https://xcard.yuyakevinito.com/", "A guide and shortcut to X's Card Validator."],
  ];
  const links = [...html.matchAll(/<a\b([^>]*class="project-link"[^>]*)>([\s\S]*?)<\/a>/g)];
  assert.equal(links.length, projects.length);
  for (const [index, [name, url, description]] of projects.entries()) {
    const [, attributes, content] = links[index];
    assert.ok(attributes.includes(`href="${url}"`));
    assert.ok(content.includes(`<span class="project-name">${name}</span>`));
    assert.ok(content.replace(/\s+/g, " ").includes(description));
    assert.doesNotMatch(attributes, /target=|tabindex=|onclick=/);
    assert.match(content, /aria-hidden="true" focusable="false"/);
  }
  assert.match(html, /<section class="projects" aria-labelledby="projects-heading">/);
  assert.match(html, /<h2 id="projects-heading">A few things <s aria-hidden="true">I<\/s> an AI Agent made<\/h2>/);
  assert.doesNotMatch(html, /A few things are in the works/);
});

test("raster icons are available for search and home-screen bookmarks", () => {
  for (const [name, size] of [["favicon", 96], ["apple-touch-icon", 180]]) {
    const image = pngSize(`public/${name}.png`);
    assert.equal(image.width, size);
    assert.equal(image.height, size);
    assert.ok(html.includes(`href="/${name}.png"`));
  }
});

test("robots and sitemap advertise only the canonical homepage", () => {
  const robots = read("public/robots.txt");
  assert.match(robots, /^User-agent: \*\nAllow: \//);
  assert.match(robots, /Sitemap: https:\/\/yuyakevinito\.com\/sitemap\.xml/);
  assert.doesNotMatch(robots, /Disallow:/);
  const sitemap = read("public/sitemap.xml");
  assert.match(sitemap, /xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
  assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url),
    ["https://yuyakevinito.com/"]);
});

test("Wrangler invokes the redirect before serving static assets", () => {
  const config = JSON.parse(read("wrangler.jsonc"));
  assert.equal(config.main, "worker.mjs");
  assert.equal(config.assets.binding, "ASSETS");
  assert.equal(config.assets.directory, "./public");
  assert.equal(config.assets.run_worker_first, true);
  assert.equal(config.preview_urls, true);
  assert.equal(config.dev.host, "localhost");
  assert.ok(config.routes.some((route) =>
    route.pattern === "yuyakevinito.com" && route.custom_domain));
});

test("HTTP permanently redirects to HTTPS, preserving paths and queries", async () => {
  const env = { ASSETS: { fetch() { assert.fail("Redirect must not fetch assets"); } } };
  for (const path of ["/", "/social-card.png", "/missing?from=a%26b"]) {
    const response = await worker.fetch(new Request(`http://yuyakevinito.com${path}`), env);
    assert.equal(response.status, 301);
    assert.equal(response.headers.get("Location"), `https://yuyakevinito.com${path}`);
  }
});

test("production asset responses keep their status, headers, and body", async () => {
  for (const status of [200, 404, 405]) {
    const original = new Response("asset response", {
      status,
      headers: { "Content-Type": "text/html", ETag: '"abc"' },
    });
    const env = { ASSETS: { fetch: async () => original } };
    const response = await worker.fetch(new Request("https://yuyakevinito.com/"), env);
    assert.equal(response, original);
    assert.equal(response.headers.get("X-Robots-Tag"), null);
    assert.equal(await response.text(), "asset response");
  }
});

test("standard and preview workers.dev URLs remain usable but are not indexable", async () => {
  for (const hostname of [
    "yuyakevinito-com.yuyakevinito.workers.dev",
    "abc123-yuyakevinito-com.yuyakevinito.workers.dev",
  ]) {
    const original = new Response("preview", { headers: { ETag: '"preview"' } });
    const env = { ASSETS: { fetch: async () => original } };
    const response = await worker.fetch(new Request(`https://${hostname}/`), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("X-Robots-Tag"), "noindex");
    assert.equal(response.headers.get("ETag"), '"preview"');
    assert.equal(original.headers.get("X-Robots-Tag"), null);
    assert.equal(await response.text(), "preview");
  }
});

test("local HTTP previews are not redirected and asset failures are not hidden", async () => {
  const request = new Request("http://localhost:8787/");
  const response = await worker.fetch(request, {
    ASSETS: { fetch: async () => new Response("local preview") },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Location"), null);
  await assert.rejects(worker.fetch(request, {
    ASSETS: { fetch: async () => { throw new Error("Asset service unavailable"); } },
  }), /Asset service unavailable/);
});
