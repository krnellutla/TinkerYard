import { createAuthClient } from "better-auth/react";
import { emailOTPClient, magicLinkClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

// The browser side of sign-in. Same origin as the apps, so no base URL is needed.
export const authClient = createAuthClient({ plugins: [emailOTPClient(), magicLinkClient(), passkeyClient()] });
