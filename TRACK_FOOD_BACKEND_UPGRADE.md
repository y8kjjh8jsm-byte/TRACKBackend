# TRACK Food Backend Upgrade

This backend keeps the existing `/search-food` and `/analyze-food` routes and adds the v2 routes expected by the upgraded iOS `screentwo.swift`:

- `POST /v2/food/search`
- `POST /v2/food/analyze`
- `GET /health`

## What changed

The v2 search route prioritises FatSecret for branded, restaurant and generic food coverage, including region/language filtering and serving variants. If that commercial database is unavailable or returns too few results, generic fallback data remains available through USDA and Open Food Facts.

The v2 image route uses OpenAI vision to identify the likely brand, menu item, size, quantity and serving. It then searches the nutrition database and uses retrieved nutrition instead of asking the vision model to invent calories/macros. Composite meals are summed from matched components. If the commercial database cannot match the scan, TRACK's existing nutrition engine remains as the final fallback. Nutrition-label scans can also fall back to values read directly from a clearly visible label.

## Render environment variables

Add these in Render > your service > Environment:

- `OPENAI_API_KEY`
- `FATSECRET_CLIENT_ID`
- `FATSECRET_CLIENT_SECRET`
- `USDA_API_KEY` (recommended fallback)
- `FATSECRET_SCOPE` (optional; only scopes enabled for your FatSecret account)
- `OPENAI_VISION_MODEL` (optional; defaults to `gpt-4.1-mini`)

Never put the FatSecret client secret or OpenAI key in the iOS app.

## Deploy

Deploy this backend to the same Render service currently used by TRACK. The iOS client already points to the same base URL and will automatically try the v2 endpoints first, then its existing legacy fallbacks.

After deployment, open `/health`. `foodDatabase` should be `true` once FatSecret credentials are configured and `vision` should be `true` when the OpenAI key is configured.

## Minimum tests

1. Search: `McDonald's Big Mac`
2. Search: `KFC Zinger`
3. Search: `Starbucks latte`
4. Search a generic food such as `banana`
5. Scan a clearly branded restaurant meal
6. Scan a mixed non-branded meal
7. Scan a nutrition label

The backend is designed to degrade gracefully if FatSecret is temporarily unavailable; the legacy endpoints were intentionally left in place.
