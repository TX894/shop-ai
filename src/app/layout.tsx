import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shop AI",
  description: "Product image restyler powered by Gemini 2.5 Flash Image",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt">
      <body className="antialiased">{children}</body>
    </html>
  );
}
