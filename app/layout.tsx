import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bookly Order Concierge",
  description: "Demo AI support agent for a fictional online bookstore"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
