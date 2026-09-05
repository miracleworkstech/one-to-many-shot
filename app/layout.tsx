import "./globals.css";
export const metadata = { title: "Styled Shots" };
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
