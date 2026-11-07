import { RequireSignIn } from "@signin/ui/Gate";
import { AppNav } from "./AppNav";
import { TabBar } from "./TabBar";

// Wraps every app (not the landing page). Every app needs an account: until you sign in,
// the sign-in wall shows instead of the app. On phones, the tab bar at the bottom switches apps.
export default function AppsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppNav />
      <RequireSignIn>{children}</RequireSignIn>
      <TabBar />
    </>
  );
}
