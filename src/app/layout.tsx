import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Character Studio",
  description:
    "Character-consistent animation studio for faceless YouTube channels. A character is data, not a picture.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Hand-drawn fonts for text cards / labels (style guide R19:
            Patrick Hand / Kalam, with a cursive fallback offline). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Patrick+Hand&family=Kalam:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-white text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
