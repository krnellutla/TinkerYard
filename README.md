# Tinkeryard

A yard for half-finished AI things. The landing page at [tinkeryard.dev](https://tinkeryard.dev) is the root of this repo; each app lives in its own folder and deploys on its own.

| Folder | What it is | Runs at |
|---|---|---|
| `/` (`index.html`) | Landing page listing the projects | tinkeryard.dev |
| [`Tallyback/`](Tallyback) | Snap any bill, find the line that doesn't add up, send one message. Next.js | tallyback.tinkeryard.dev |
| [`Reviewscout/`](Reviewscout) | A cited summary of what YouTube reviewers said about a product, with follow-ups. Next.js | reviewscout.tinkeryard.dev |

Each app has its own `package.json`, `.env.local` and README; run commands from inside its folder. `.vercelignore` keeps the app folders out of the static landing-page deploy.
