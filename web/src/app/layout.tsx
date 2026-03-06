import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "tessera 지휘통제실",
  description: "tessera robot command center",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="dark">
      <body className="antialiased min-h-screen bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
