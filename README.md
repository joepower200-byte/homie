# Homie website

A real website version of Homie. The wall display (an iPad, old tablet or computer) and your phone both open the same web address. The display shows a QR code, the phone scans it with its normal camera, and from then on the phone controls the home and the display updates live.

The devices are still demo devices. Real integrations come in a later phase.

## What's in this folder

| File | What it is |
| --- | --- |
| `index.html` | The whole app: display, customise panel, ambient mode, QR linking and the phone remote. |
| `config.js` | Two settings from Supabase, the service that keeps both screens in sync. |
| `schema.sql` | Sets up the Supabase database. You run it once. |

## Set it up (about 10 minutes, all free)

### 1. Create the sync database (Supabase)
1. Sign up at https://supabase.com and create a new project. Any name and region is fine (London is closest for the UK).
2. In the project, open **SQL Editor > New query**, paste everything from `schema.sql`, and press **Run**.
3. Open **Project Settings > API**. Copy the **Project URL** and the **anon public** key.
4. Paste both into `config.js` in place of `https://YOUR-PROJECT.supabase.co` and `YOUR-ANON-KEY`.

### 2. Put the site online (Netlify, no code tools needed)
1. Go to https://app.netlify.com/drop and sign up.
2. Drag this whole `homie-site` folder onto the page.
3. Netlify gives you an address like `https://homie-abc123.netlify.app`. You can rename it in Site settings.

### 3. Use it
1. Open the address on the iPad. Add it to the home screen for a full-screen display.
2. Tap **Pair phone**, scan the QR code with your phone's camera and tap the link.
3. Check the four digits match and tap **Yes, they match** on the phone.

## How it works

- Each display makes a private random home ID the first time it opens, and saves its demo devices under it.
- The QR code carries that home ID and a one-time pairing code: `your-site/#pair-<home>-<code>`.
- Both screens read and write one Supabase table (`docs`) and listen to its live updates, so a change on either one shows on the other within a moment.

## Before you share it with anyone

In this preview, anyone who knows a home's ID could read and change that home. That's fine for trying it on your own devices. The next phase adds proper accounts (sign-in with email or Apple) and per-user database rules, which closes this.
