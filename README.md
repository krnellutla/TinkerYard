# Tinkeryard

A yard for half-finished AI things. The landing page at [tinkeryard.dev](https://tinkeryard.dev) is the root of this repo; each app lives in its own folder and deploys on its own.

| Folder | What it is | Runs at |
|---|---|---|
| `/` (`index.html`) | Landing page listing the projects | tinkeryard.dev |
| [`Tallyback/`](Tallyback) | Snap any bill, find the line that doesn't add up, send one message. Next.js | tallyback.tinkeryard.dev |
| [`Reviewscout/`](Reviewscout) | A cited summary of what YouTube reviewers said about a product, with follow-ups. Next.js | reviewscout.tinkeryard.dev |

Each app has its own `package.json`, `.env.local` and README; run commands from inside its folder. The root `vercel.json` only applies to the landing-page project (its root directory is the repo root): it returns 404 for the app folders so their source isn't served. Don't use a root `.vercelignore` here: Vercel applies it to every project in the repo, which strips the apps out of their own builds.

Each project's `vercel.json` has an `ignoreCommand` that skips the build when nothing in its folder changed since that project's last deploy (`VERCEL_GIT_PREVIOUS_SHA`), so a push only builds what it touched. A deploy shown as "Canceled by Ignored Build Step" is this working as intended.
