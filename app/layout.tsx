import type { Metadata } from "next";
import "./globals.css";
import "./palette.css";
import "./transport.css";

export const metadata: Metadata = {
  title: "Hair Motion Viewer",
  description: "DIPP-MOTION hair marker visualization for research.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
