# dresdengoehner.com

Personal site of Dresden Goehner. The pages are his earlier static export
(scroll hero, artifact triptych, flagship chapters, certificate film,
research gallery, field notes). Copy was tightened against the November 5,
2026 evidence snapshot. The layout, type, color, and motion are that
earlier site.

Plain static files. No build step.

## Pages

- `index.html` — the site
- `notes.html` and `notes/` — Field Notes
- `proof.html` — dated claim index, linked from the evidence section
- `404.html`, `robots.txt`, `sitemap.xml`, `og.png`

## Local preview

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deployment

This tree is not a production deploy. Do not upload it to Cloudflare
Pages, and do not change DNS, from a content edit alone. Publishing
stays a separate, explicit step.
