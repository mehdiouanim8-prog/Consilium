# Consilium website application-page update

This folder contains the public application page update for the existing `mehdiouanim8-prog/Consilium` Cloudflare Pages site. It is intentionally limited to the application route and its assets; do not replace the homepage or unrelated website files.

## Files

- `apply.html` — preserves the supplied application layout, form fields, wording, and official eight-point SVG logo.
- `calendar.js` / `calendar.css` — the custom month calendar and 45-minute slot selection UI.
- `apply.js` — client validation, duplicate-submit lock, JSON submission, reference confirmation, and error handling.
- `functions/api/[[path]].js` — optional but recommended Cloudflare Pages same-origin proxy for `/api/*` requests to the independent `consilium-system` Worker.

The external Google Fonts and Google Apps Script dependencies have been removed. The existing condensed typography falls back to locally installed condensed system fonts.

## Cloudflare Pages configuration

Add this Pages environment variable after deploying the backend:

```text
CONSILIUM_API_ORIGIN=https://<your-worker-host>
```

Use the actual HTTPS Worker origin and do not append `/api`. The Worker must allow the website origin in `ALLOWED_ORIGINS`. Keep `functions/` at the Pages project root so `/api/*` routes through the function. Deploy the application files alongside the existing website files; do not delete other repository content.

## API contract

The browser calls:

- `GET /api/availability?month=YYYY-MM`
- `GET /api/availability?date=YYYY-MM-DD`
- `POST /api/applications` with JSON

The server is the authority for past-time rejection, appointment conflicts, and the nine-active-requests-per-day limit. `PENDING` and `ACCEPTED` requests reserve a slot; `DECLINED` requests do not.
