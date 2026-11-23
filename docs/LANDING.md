# Landing page

The public page that sells Stitch. It is separate from the app: no login, plain HTML, CSS and JS, built by the same Vite as the app.

## Where things are

```
frontend/landing/
  index.html    the page (served at /landing/)
  landing.css   all styles, scoped under .p2 (green + Cormorant Garamond / Hanken Grotesk)
  landing.js    mobile menu, FAQ, and the demo form
  assets/       the logo and photos
api/src/routes/enquiries.js   POST /api/enquiries (open) and GET /api/enquiries (admin)
api/src/models/enquiries.js   the `enquiries` collection
```

## How it connects to the app

- **Early access** in the menu opens the app (`/`), where people sign in or sign up.
- **Book a demo** form posts name, brand, WhatsApp number, work email and purpose to `POST /api/enquiries`. The number is
  stored as +E.164 and the e-mail in lower case. An admin reads them with `GET /api/enquiries` (newest first, last 200).
- The form is open to anyone, so it has a hidden `website` field (a bot that fills it is ignored) and a limit of 5 per hour per IP.

## Not built

- The demo video (the play button is a placeholder), a screen in the app to read enquiries, an e-mail to the team when one arrives.
