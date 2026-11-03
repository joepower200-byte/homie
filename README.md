# Homie pairing

Just the pairing, built from the Figma file (iPad Pro 11" screens 3 and 4, the start screen, and the iPhone 17 scanner).

1. iPad opens `index.html` and taps **Get started**. A QR code appears.
2. The phone opens `phone.html` (or the installed Homie app), which goes straight to the camera. Point it at the QR code.
3. The phone picks a six-digit code and both screens show it. Tap **Confirm** on the phone to pair.

**Enter manually** on the iPad shows the code as numbers instead; on the phone, tap **Enter code instead** and type it.

Files: `index.html` (iPad), `phone.html` (phone), `styles.css`, `app.js`, `config.js` (Supabase settings), `fonts/` (Geist and Cooper Hewitt, self-hosted), `sw.js` + `phone.webmanifest` + icons (phone app install).
