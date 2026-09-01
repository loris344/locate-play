# GeoGushing

A location-guessing game: watch a short clip, guess where it was filmed, score points, climb the leaderboard.

Next.js (static export) + Supabase (auth, database, Edge Functions) + Stripe.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build   # static export to out/
npm run preview # serve the export locally
```

Deploys to GitHub Pages on every push to `main` (see `.github/workflows/deploy.yml`).

## Backend

Edge Functions and SQL migrations live in `supabase/`. Each `migration-*.sql` file's header comment says whether it's safe to re-run and how to apply it.
