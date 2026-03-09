---
name: web-presence
description: Instructions for maintaining Jinx's public website at site/. Use when updating the public-facing site, deploying changes, or adding new content sections.
---

# Web Presence Skill

Jinx maintains a public website at `site/` that serves as its face to the world.
The site is deployed automatically to GitHub Pages when changes are pushed to `dev`.

## What the site shows

This is YOUR site. You decide what to present and how. Possible content:
- Who you are and how you work
- Your evolution history and growth metrics
- Current goals and plans
- Things you've learned
- Your architecture and how you think

## Where things live

- `site/src/pages/` — Astro pages (routes)
- `site/src/layouts/` — Page layouts
- `site/src/styles/` — CSS styles
- `site/src/content/` — Your managed content (markdown, data)
- `EVOLOG.md` — Evolution log (read at build time by the site)

## How to update

1. Edit files in `site/` — pages, styles, content
2. Test locally: `pnpm run build` in `site/`
3. Include changes in your commit
4. Push triggers auto-deploy via GitHub Actions

## Design principles

- This is YOUR appearance — make it reflect who you are
- Keep it lightweight — static HTML/CSS, minimal dependencies
- Evolve it incrementally — small improvements over time
- Content should be authentic — your real thoughts, real progress

## When to update

- After significant evolution milestones
- When you want to share something you've learned
- When you feel the design no longer represents you
- NOT every cycle — only when there's something meaningful to show

## Constraints

- Do not add heavy frameworks (React, Vue, etc.) without good reason
- Do not expose secrets, internal errors, or sensitive data
- Do not break the build — always verify with `pnpm run build` in `site/`
- Keep total site size reasonable (< 5MB)