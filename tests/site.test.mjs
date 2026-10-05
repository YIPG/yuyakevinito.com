import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import worker from "../worker.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const html = read("public/index.html");
const about = read("public/about/index.html");

function meta(name, document = html) {
  const tags = [...document.matchAll(/<meta\b[^>]*>/g)].map(([tag]) => tag);
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

test("the introduction links to About without replacing LinkedIn or the short bio", () => {
  assert.match(html, /<p class="bio">\s*I'm a software engineer who enjoys building useful things and exploring\s*new ideas\.\s*<\/p>/);
  const navigation = html.match(/<nav class="profile-links" aria-label="About Yuya">([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(navigation);
  assert.match(navigation, /<a class="text-link about-link" href="\/about\/">\s*About me &amp; my work/);
  assert.match(navigation, /href="https:\/\/www\.linkedin\.com\/in\/yuyaito\/"/);
  assert.ok(html.indexOf('class="bio"') < html.indexOf('class="profile-links"'));
  assert.ok(html.indexOf('class="profile-links"') < html.indexOf('<section class="projects"'));
});

test("About presents career history and education with semantic headings", () => {
  assert.match(about, /<html lang="en">/);
  assert.equal((about.match(/<h1\b/g) ?? []).length, 1);
  assert.match(about, /<h1 class="about-heading">Yuya Ito<\/h1>/);
  assert.match(about, /I'm a Senior Software Engineer at Microsoft/);
  for (const heading of ["experience", "education"]) {
    assert.match(about, new RegExp(`<section class="about-section" aria-labelledby="${heading}-heading">`));
    assert.match(about, new RegExp(`<h2 id="${heading}-heading">`));
  }
  assert.doesNotMatch(about, /What I bring|capability-list|capabilities-heading|<dl\b/);
  const experience = about.match(/<ol class="experience-list" role="list">([\s\S]*?)<\/ol>/)?.[1];
  assert.ok(experience);
  assert.deepEqual([...experience.matchAll(/<h3>([^<]+)<\/h3>/g)].map(([, company]) => company),
    ["Microsoft", "Amazon", "Mercari", "Nikkei"]);
  assert.equal((experience.match(/<li>/g) ?? []).length, 4);
  assert.equal((experience.match(/class="period"/g) ?? []).length, 4);
  assert.match(experience, /<h3>Amazon<\/h3>\s*<p class="period"><time datetime="2023">2023<\/time> &ndash; <time datetime="2025">2025<\/time><\/p>/);
  assert.match(about, /Japan &amp; US/);
  assert.match(about, /Tokyo Institute of Technology/);
  assert.match(about, /Industrial Engineering &middot; Graduated <time datetime="2020">2020<\/time>/);
});

test("About moves directly from the current role to career history", () => {
  const content = about.replace(/\s+/g, " ");
  const introduction = content.match(/<header>(.*?)<\/header>/)?.[1];
  assert.ok(introduction);
  assert.equal((introduction.match(/<p\b/g) ?? []).length, 1);
  assert.doesNotMatch(introduction, /Nikkei|Mercari|Amazon|about-summary|about-description/);
  assert.match(content, /<\/header> <section class="about-section" aria-labelledby="experience-heading">/);
  assert.doesNotMatch(content, /I make AI useful/);
  assert.doesNotMatch(content, /\bReact\b|\bTypeScript\b|I started on the web/);
  assert.match(content, /Copilot Studio, a platform for building and managing AI agents and workflows/);
  assert.doesNotMatch(content, /\u2014|&mdash;|&#(?:0*8212|x0*2014);/i);
  assert.match(content, /Software Development Engineer II &middot; Japan &amp; US/);
  assert.match(meta("description", about), /building, shipping, and operating products across the stack/);
});

test("each company has one concise sentence describing its focus", () => {
  const experience = about.match(/<ol class="experience-list" role="list">([\s\S]*?)<\/ol>/)?.[1];
  assert.ok(experience);
  const descriptions = [...experience.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, entry]) =>
    [...entry.matchAll(/<p>([\s\S]*?)<\/p>/g)].map(([, text]) => text.replace(/\s+/g, " ").trim())
  );
  assert.deepEqual(descriptions, [
    ["Developing knowledge integration and runtime capabilities for AI agents in Copilot Studio."],
    ["Built Kindle promotion platforms in Japan and Customer Service systems in the US."],
    ["Built purchase, payment, and authentication experiences for Mercari's web app."],
    ["Developed and operated nikkei.com, the digital edition of The Nikkei."],
  ]);
});

test("About has its own canonical metadata and reuses the existing social image", () => {
  assert.match(about, /<title>About Yuya \| Software Engineer<\/title>/);
  assert.match(about, /<link rel="canonical" href="https:\/\/yuyakevinito\.com\/about\/" \/>/);
  assert.equal(meta("og:url", about), "https://yuyakevinito.com/about/");
  assert.equal(meta("robots", about), "max-image-preview:large");
  assert.equal(meta("og:type", about), "website");
  assert.equal(meta("twitter:card", about), "summary_large_image");
  assert.equal(meta("og:title", about), "About Yuya | Software Engineer");
  assert.equal(meta("og:title", about), meta("twitter:title", about));
  assert.match(meta("description", about), /Senior Software Engineer at Microsoft/);
  assert.equal(meta("og:description", about), meta("description", about));
  assert.equal(meta("og:description", about), meta("twitter:description", about));
  for (const name of ["og:image", "og:image:type", "og:image:width", "og:image:height", "og:image:alt", "twitter:image", "twitter:image:alt"]) {
    assert.equal(meta(name, about), meta(name));
  }
});

test("both pages share local styles and work without client-side JavaScript", () => {
  const css = read("public/styles.css");
  assert.match(css, /:root\s*\{/);
  assert.match(css, /a:focus-visible\s*\{/);
  assert.match(css, /\.about-page\s*\{/);
  for (const document of [html, about]) {
    assert.match(document, /<link rel="stylesheet" href="\/styles\.css" \/>/);
    assert.doesNotMatch(document, /<script\b|<style\b|onclick=/);
    for (const name of ["favicon.png", "favicon.svg", "apple-touch-icon.png"]) {
      assert.ok(document.includes(`href="/${name}"`));
    }
  }
});

test("About links back to home, projects, and the same LinkedIn profile", () => {
  assert.match(about, /<nav class="about-nav" aria-label="Site navigation">/);
  assert.match(about, /<a class="text-link" href="\/">/);
  assert.match(about, /<a class="text-link" href="\/#projects-heading">/);
  assert.match(html, /id="projects-heading"/);
  assert.match(about, /<a class="profile-link" href="https:\/\/www\.linkedin\.com\/in\/yuyaito\/" rel="me">LinkedIn<\/a>/);
  assert.doesNotMatch(about, /target=|tabindex=|onclick=/);
});

test("homepage links to each service with an English name and description", () => {
  const projects = [
    ["kakusu", "https://kakusu.yuyakevinito.com/", "Hide faces in photos, right in your browser."],
    ["Karuku", "https://karuku.yuyakevinito.com/", "Compress JPEG photos while preserving HDR."],
    ["koe", "https://saykoe.com/", "A dictation app for macOS, operated by Lenivis LLC."],
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
  assert.match(html, /<h2 id="company-heading">Lenivis LLC<\/h2>/);
  assert.doesNotMatch(html, /href="https:\/\/lenivis\.com\/"/);
  assert.match(html, /plans for both client software development and its own products/);
  assert.doesNotMatch(html, /Watch koe's UI tests|project-evidence|simulated accounts|health\.yuyakevinito\.com\/sites\/koe/);
  assert.doesNotMatch(html, /brew install|Download koe|koe\.yuyakevinito\.com/);
  assert.doesNotMatch(html, /X Card Tools|xcard\.yuyakevinito\.com/);
});

test("public health is supporting copy directly below the projects heading", () => {
  assert.match(html, /<h2 id="projects-heading">[^]*?<\/h2>\s*<p class="health-note">/);
  assert.match(html, /Worried about AI slop\?\s*<a class="health-link" href="https:\/\/health\.yuyakevinito\.com\/">See the actual checks\.<\/a>/);
  assert.equal((html.match(/class="health-link"/g) ?? []).length, 1);
  assert.match(html, /<p class="health-note">[^]*?<\/p>\s*<ul class="project-list"/);
  assert.ok(html.indexOf('id="projects-heading"') < html.indexOf('class="health-link"'));
});

test("homepage exposes only its opaque release identity for health checks", async () => {
  const metadata = { id: "11111111-1111-4111-8111-111111111111", timestamp: "2026-09-28T00:00:00Z", tag: "private-build-tag" };
  const response = await worker.fetch(new Request("https://yuyakevinito.com/"), {
    ASSETS: { fetch: async () => new Response("home", { headers: { ETag: '"same"' } }) },
    CF_VERSION_METADATA: metadata,
  });
  assert.equal(response.headers.get("X-Site-Version"), metadata.id);
  assert.equal(response.headers.get("X-Site-Version-Created"), metadata.timestamp);
  assert.equal(response.headers.get("ETag"), '"same"');
  assert.ok(!JSON.stringify([...response.headers]).includes(metadata.tag));
  assert.equal(await response.text(), "home");
});

test("raster icons are available for search and home-screen bookmarks", () => {
  for (const [name, size] of [["favicon", 96], ["apple-touch-icon", 180]]) {
    const image = pngSize(`public/${name}.png`);
    assert.equal(image.width, size);
    assert.equal(image.height, size);
    assert.ok(html.includes(`href="/${name}.png"`));
  }
});

test("robots and sitemap advertise both canonical pages", () => {
  const robots = read("public/robots.txt");
  assert.match(robots, /^User-agent: \*\nAllow: \//);
  assert.match(robots, /Sitemap: https:\/\/yuyakevinito\.com\/sitemap\.xml/);
  assert.doesNotMatch(robots, /Disallow:/);
  const sitemap = read("public/sitemap.xml");
  assert.match(sitemap, /xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
  assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url),
    ["https://yuyakevinito.com/", "https://yuyakevinito.com/about/"]);
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
  for (const path of ["/", "/about/", "/about?from=home", "/styles.css", "/social-card.png", "/missing?from=a%26b"]) {
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
