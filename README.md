# dresdengoehner.com

Personal site of Dresden Goehner — research direction, three flagship
systems (AI Navigation Glasses, EPSILON, GERT), an open-source record,
competition results, field notes, and a proof index that links every
public claim to its evidence.

Plain static files: HTML + one stylesheet (`style.css`) + images.
No build step, no framework, no server-side code; every page is
readable with JavaScript disabled.

## Pages

- `index.html` — the one-page site (flagships, Kaggle record, open
  source, competitions, organizations, complete work index, about)
- `notes.html` + `notes/` — Field Notes
- `proof.html` — claim-by-claim evidence index (figures as of
  2026-11-05)
- `404.html`, `sitemap.xml`, `robots.txt`, `og.png`
- `dresden-goehner-cv.pdf` — one-page CV generated from the same
  figures as the site

## Local preview

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deployment (Cloudflare Pages)

Deployed as direct uploads with wrangler to the Cloudflare Pages
project `site-dresdengoehner` (custom domains dresdengoehner.com
and www). Pushing to GitHub does not by itself publish changes;
redeploy the directory after editing.

## Rollback

The pre-redesign site (2026-11-05) is preserved at git tag
`v1-pre-redesign-2026-11-05` and branch
`archive/pre-redesign-2026-11-05`. To roll back: check out the tag
into a clean directory and redeploy that directory the same way.
