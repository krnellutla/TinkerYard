// Which site sign-in belongs to, from BETTER_AUTH_URL. Pure, so it's easy to test.
//
// tinkeryard.dev redirects to www.tinkeryard.dev, so browsers send requests from the www origin even
// when BETTER_AUTH_URL names the bare domain (or the other way round). Both spellings are trusted:
//   origins: where sign-in requests and passkey ceremonies may come from
//   rpID:    the passkey's site; kept as BETTER_AUTH_URL's host so existing passkeys keep working
//            (a passkey for tinkeryard.dev also works on www.tinkeryard.dev)
export function siteFor(authUrl: string | undefined): { rpID: string; origin: string; origins: string[] } {
  let url: URL;
  try {
    url = new URL(authUrl || "http://localhost:3000");
  } catch {
    url = new URL("http://localhost:3000");
  }
  const host = url.hostname;
  const origins = new Set([url.origin]);
  const local = host === "localhost" || /^[\d.]+$/.test(host) || host.endsWith(".localhost") || host.endsWith(".vercel.app");
  if (!local) {
    const apex = host.replace(/^www\./, "");
    const port = url.port ? `:${url.port}` : "";
    origins.add(`${url.protocol}//${apex}${port}`);
    origins.add(`${url.protocol}//www.${apex}${port}`);
  }
  return { rpID: host, origin: url.origin, origins: [...origins] };
}
