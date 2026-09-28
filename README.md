# yuyakevinito.com

A small, English-language personal homepage. Plain HTML and CSS, with no
client-side JavaScript, external fonts, or runtime package dependencies.

## Local preview

From this directory:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory public
```

Open <http://127.0.0.1:4173>.

To also exercise Worker routing locally, run `npx wrangler dev`. The configured
development host is `localhost`, so Wrangler does not rewrite local requests
to the production domain and trigger its HTTPS redirect.

## Deployment

Source: <https://github.com/YIPG/yuyakevinito.com>

Use Cloudflare Workers Static Assets with Workers Builds' GitHub integration for
automatic deployments and pull request previews. No GitHub Actions deployment
workflow or repository secrets are needed. A separate GitHub Actions workflow
runs the dependency-free regression checks.

`wrangler.jsonc` configures the Worker to serve `public/`. A small `worker.mjs`
runs before assets to permanently redirect production HTTP requests to HTTPS
and add `X-Robots-Tag: noindex` to `workers.dev` responses. Local HTTP previews
still work. The script preserves asset status codes, headers, and 404 responses.
There is no application build step.

The custom domain, standard `workers.dev` URL, and version preview URLs are
declared in Git. Because `run_worker_first` is enabled, requests invoke the
Worker and count toward Workers request limits rather than using assets-only
delivery. No paid plan is required by this configuration.

### One-time Cloudflare setup

1. In [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages),
   choose **Create application** and import a Git repository using the Workers
   workflow, not the legacy Pages workflow.
2. Connect the `YIPG` GitHub account. When installing the Cloudflare GitHub App,
   choose **Only select repositories** and select `yuyakevinito.com`.
3. Select `YIPG/yuyakevinito.com` and use these settings:

   | Setting | Value |
   | --- | --- |
   | Project name | `yuyakevinito-com` |
   | Production branch | `main` |
   | Build command | Leave empty |
   | Deploy command | `npx wrangler deploy` |
   | Preview command | `npx wrangler preview` |
   | Enable Preview builds | On |
   | Protect with Cloudflare Access | Off (public site) |
   | Root directory | Leave empty (repository root) |
   | Environment variables | None |

   The project name must match `name` in `wrangler.jsonc`. There is no build output
   directory field: `assets.directory` in that file already points to `public/`.

4. Select **Save and Deploy**.
5. The deploy command attaches `yuyakevinito.com` from `wrangler.jsonc`. Check it
   under **Settings > Domains & Routes**. Cloudflare manages the DNS record and
   TLS certificate.

Only `public/` is published. Do not manually point a CNAME at the `workers.dev`
address.

### CLI management

Wrangler can deploy the site and manage its declared custom domain:

```sh
npx wrangler login --use-keyring
npx wrangler deploy
```

Keep credentials out of the repository. Wrangler can store login credentials
securely in the operating system's keychain.

Managing Git build triggers through the Workers Builds API requires a separate
user-scoped API token with **Workers Builds Configuration: Edit** permission.
That is distinct from the deployment token used by the builds themselves.

### Updating the site

- Push a feature branch and open a pull request to get a preview deployment.
  Keep preview builds enabled for non-production branches.
- Merge into `main` to automatically deploy the production site.
- Check deployment status and preview links in the GitHub commit or pull request
  checks and Cloudflare build history.

### SEO and social previews

- The visible introduction is unchanged. The document title identifies Yuya as
  a software engineer, with a description and canonical HTTPS URL.
- Open Graph and X/Twitter metadata use the same public 1200 x 630 PNG, with
  image dimensions, type, and alternative text.
- `robots.txt` permits crawling and points to `sitemap.xml`. The sitemap lists
  only the canonical homepage; it does not claim an artificial modification date.
- A PNG favicon and Apple touch icon supplement the existing SVG.
- Production is indexable. Standard and preview `workers.dev` URLs remain
  accessible but carry `noindex`; this is not an access-control mechanism.

Cloudflare may prepend its managed robots policy. Check the live file when
changing crawler settings. The site does not disable Cloudflare bot protections.

The social card is a typographic adaptation of the existing homepage, not
stock or AI-generated artwork. Its editable source is `design/social-card.svg`;
the icon source is `public/favicon.svg`. Both retain the approved colors,
system typography, and waving-hand motif. Regenerate the committed PNGs with:

```sh
node scripts/render-assets.mjs
```

The renderer needs Node.js 24 and Chrome/Chromium. It uses a temporary browser
profile and removes it afterward. Set `CHROME_BIN` if Chrome is not at the
default macOS or Linux location. System fonts and emoji are rasterized on the
rendering machine, so review the results when regenerating on another OS.
The generated PNGs are committed; deployment does not need Chrome.

To verify metadata, PNG dimensions, sitemap contents, and redirect/indexing
behavior:

```sh
node --test tests/site.test.mjs
npx wrangler deploy --dry-run
```

GitHub Actions runs the tests on pushes and pull requests. Workers Builds
deploys independently; the test check is not a production deployment gate.

Google indexing is not guaranteed or immediate. Verify ownership in
[Google Search Console](https://search.google.com/search-console), submit
`https://yuyakevinito.com/sitemap.xml`, and use URL Inspection to request indexing.
That requires the owner's Google account and is not automated by this repository.
Social platforms cache previews; metadata and crawler HTTP checks do not prove
the exact card shown in a real X, LinkedIn, Facebook, or messaging-app post.

See Cloudflare's [Workers Builds documentation](https://developers.cloudflare.com/workers/ci-cd/builds/),
[Static Assets documentation](https://developers.cloudflare.com/workers/static-assets/),
and [custom domain documentation](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
