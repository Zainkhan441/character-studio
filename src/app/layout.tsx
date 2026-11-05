import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Character Studio",
  description:
    "Character-consistent animation studio for faceless YouTube channels. A character is data, not a picture.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-white text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
