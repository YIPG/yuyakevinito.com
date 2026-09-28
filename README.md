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

Use Cloudflare Pages' built-in GitHub integration for automatic deployments and
GitHub deployment checks. No GitHub Actions deployment workflow or repository
secrets are needed.

### One-time Cloudflare setup

1. In [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages),
   choose **Create application > Pages > Connect to Git**.
2. Connect the `YIPG` GitHub account. When installing the Cloudflare GitHub App,
   choose **Only select repositories** and select `yuyakevinito.com`.
3. Select `YIPG/yuyakevinito.com` and use these settings:

   | Setting | Value |
   | --- | --- |
   | Project name | `yuyakevinito` |
   | Production branch | `main` |
   | Framework preset | None |
   | Build command | Leave empty |
   | Build output directory | `public` |
   | Root directory | Leave empty (repository root) |
   | Environment variables | None |

4. Select **Save and Deploy**.
5. In the Pages project's **Custom domains > Set up a domain** flow, add
   `yuyakevinito.com` and follow the DNS confirmation prompts.

Only `public/` is published. Do not create a DNS record alone: the custom domain
must also be associated with the Pages project.

### Updating the site

- Push a feature branch and open a pull request to get a preview deployment.
  Preview deployments apply to branches in this repository, not fork pull requests.
- Merge into `main` to automatically deploy the production site.
- Check deployment status and preview links in the GitHub commit or pull request
  checks.

This setup provides automatic deployment checks, not a separate test suite.

See Cloudflare's [GitHub integration documentation](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/)
and [custom domain documentation](https://developers.cloudflare.com/pages/configuration/custom-domains/).
