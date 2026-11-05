# dresdengoehner.com

Personal site of Dresden Goehner — research direction, flagship work
(GERT, EPSILON, FutureOS, AI navigation glasses), a complete work
index, and notes.

This repository holds the site as plain static files (HTML, CSS, JS,
images, fonts). There is no build step and no server-side code: every
page is served exactly as it appears here.

## Local preview

Any static file server works, for example:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deployment (Cloudflare Pages)

1. Cloudflare dashboard → Workers & Pages → Create → Pages →
   Connect to Git → select this repository.
2. Framework preset: **None**. Build command: *(leave empty)*.
   Build output directory: `/`.
3. Add the custom domain `dresdengoehner.com` (and `www`) under the
   project's Custom domains tab, then update DNS as prompted.

Every push to `main` redeploys automatically.
