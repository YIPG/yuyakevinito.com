# yuyakevinito.com

A small, English-language personal homepage. Plain HTML and CSS, with no
JavaScript, external fonts, dependencies, or build step.

## Local preview

From this directory:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory public
```

Open <http://127.0.0.1:4173>.

## Deployment

Source: <https://github.com/YIPG/yuyakevinito.com>

Use Cloudflare Workers Static Assets with Workers Builds' GitHub integration for
automatic deployments and pull request previews. No GitHub Actions deployment
workflow or repository secrets are needed.

`wrangler.jsonc` configures the Worker to serve `public/` directly. There is no
Worker script or application build step. It also declares `yuyakevinito.com` as
the Worker's custom domain, so the domain configuration stays in Git. The
standard `workers.dev` URL and version preview URLs remain enabled alongside
the custom domain.

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

This setup provides automatic deployment checks, not a separate test suite.

See Cloudflare's [Workers Builds documentation](https://developers.cloudflare.com/workers/ci-cd/builds/),
[Static Assets documentation](https://developers.cloudflare.com/workers/static-assets/),
and [custom domain documentation](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
