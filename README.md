# dresdengoehner.com

Personal site of Dresden Goehner. It is an evidence archive: three flagship
systems (AI Navigation Glasses, EPSILON, GERT), an open-source record,
competition results, field notes, and a proof index that ties public claims
to their sources.

## Research in Light

The previous one-pager used a Bauhaus paper ground and a red / blue / yellow
shape code. This version keeps the editorial habits that were working —
left-aligned grid, thin rules, tabular figures, high-contrast text, visible
focus — and changes the identity.

The room is charcoal. One cool highlight is the only accent: a hairline at
the top of the page, links, focus, and the mark beside a separate listing.
Evidence figures sit on a lit paper plate. Chapter numbers, as-of dates, and
status labels stay in the margin. There is no shape legend, no decorative
shadow, and no motion.

The first screen states the method and three questions. Counts with a
denominator come after those questions. Star totals stay in the chapter
record, each with a date, and on the proof index.

Type is self-hosted [Newsreader](fonts/OFL-newsreader.txt) and
[Atkinson Hyperlegible](fonts/OFL-atkinson.txt), with `font-display: swap`
and a system-font fallback. Pages are readable if those files fail to load.

## Pages

Plain static files: HTML + one stylesheet (`style.css`) + images + `fonts/`.
No build step, no framework, no server-side code. Every page is readable
with JavaScript disabled.

- `index.html` — archive (questions, flagships, Kaggle note, open source,
  competitions, organisations, work index, about)
- `notes.html` + `notes/` — Field Notes
- `proof.html` — claim-by-claim evidence index (figures as of 2026-11-05)
- `404.html`, `sitemap.xml`, `robots.txt`, `og.png`, `favicon.svg`
- `dresden-goehner-cv.pdf` — one-page CV

## Local preview

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deployment

Production is a direct upload to the Cloudflare Pages project
`site-dresdengoehner` (custom domains dresdengoehner.com and www).

Pushing to GitHub, including merging this redesign, does **not** publish
the site. A production upload still needs explicit approval from the site
owner. Do not deploy from this change, and do not change DNS.

## Rollback

The site from before the 5 November 2026 redesign is preserved at git tag
`v1-pre-redesign-2026-11-05` and branch `archive/pre-redesign-2026-11-05`.
Restoring production still means uploading a chosen directory, with the
same explicit approval.
