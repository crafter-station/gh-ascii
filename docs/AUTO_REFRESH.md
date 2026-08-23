# Keeping Your Card Fresh - Daily Auto-Refresh Guide
Implements [#1](https://github.com/crafter-station/gh-ascii/issues/1)
## Why your card goes stale
Every number in a committed SVG is baked-in text, not live data. Even the
hosted URL caches hourly (`max-age=3600` in app/[user]/route.ts).
Neither updates daily on its own.
## The fix: a 20-line GitHub Action
Template: `.github/workflows/refresh-card.yml.example`
Same proven pattern as cicirello/user-statistician and github-readme-stats-action:
generate once per cycle -> commit -> serve statically.
### Setup (2 minutes)
1. Copy refresh-card.yml.example into your PROFILE repo as .github/workflows/refresh-card.yml
2. Replace YOUR_HANDLE with your username (2 places)
3. Commit + push
4. Actions tab -> Refresh gh-ascii cards -> Run workflow (test now!)
5. Verify dark_mode.svg / light_mode.svg got new commits
### Before vs After
| Stat        | Without Action | With Action |
|-------------|----------------|-------------|
| Uptime      | Frozen         | Correct daily |
| Stars       | Frozen         | Daily       |
| Cost        | -              | Free        |
## Troubleshooting
- Numbers unchanged after run? Nothing changed upstream either - guarded commit correctly skipped.
- Workflow disabled after ~60 days? GitHub auto-disables schedules on inactive repos - re-enable in Actions tab.
- Curl 403? Handle renamed or deployment moved - test the URL directly.
