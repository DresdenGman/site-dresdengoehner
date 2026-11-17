# dresdengoehner.com

Personal site of Dresden Goehner. The homepage is the approved kinetic-museum exhibition: static HTML, CSS, and a short script. There is no build step and no deploy from this repository. Publishing stays a separate upload to Cloudflare Pages.

## Pages

- `index.html` — the exhibition
- `proof.html` — claim index. Every homepage figure is repeated with a public source link.
- `notes.html` and `notes/` — the field note
- `dresden-goehner-cv.pdf` — one-page CV. Every figure on it is already on the homepage or in `proof.html`.
- `404.html`, `robots.txt`, `sitemap.xml`, `og.png`, `favicon.svg`

## Local preview

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000

## Deployment

Do not upload this tree to Cloudflare Pages, and do not change DNS, from a content edit alone.
