import "./globals.css";
import { APP_NAME } from "@/components/Logo";
export const metadata = { title: APP_NAME };
export const viewport = { width: "device-width", initialScale: 1 };
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // Extensions and the in-app browser's device emulation add attributes to <html>
    // before React hydrates; suppress that one element's attribute diff, nothing else.
    <html lang="en" suppressHydrationWarning>
      <body className="bg-stone-50 text-stone-900 antialiased">{children}</body>
    </html>
  );
}
