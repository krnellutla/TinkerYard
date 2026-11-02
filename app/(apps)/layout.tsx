import { AppNav } from "./AppNav";

// Wraps every app (not the landing page). Sign-in will live here when OAuth is added.
export default function AppsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppNav />
      {children}
    </>
  );
}
