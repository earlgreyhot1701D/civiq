import type { Metadata } from "next";
import "./globals.css";

// No webfont. The prototype used a system stack on purpose and it is the right
// call for the audience: two fewer blocking requests for a resident reading this
// on a phone, on cell data, outside a council chamber. The stack is declared in
// globals.css so there is one source of truth for it.

export const metadata: Metadata = {
  title: "Civiq — Ventura",
  description:
    "Ask about City of Ventura board and commission agendas in plain language. Every answer carries a receipt.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
