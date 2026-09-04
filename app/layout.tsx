import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const TITLE = "gh-ascii — your GitHub profile as ASCII";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "github profile readme",
    "ascii art generator",
    "neofetch",
    "profile readme generator",
    "github stats card",
    "ascii profile card",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: SITE_DESCRIPTION,
  },
};

// Describes the tool itself. AI summarizers parse this more reliably than
// they parse the page's prose, and it is the only place the repo, licence and
// price are stated in a machine-readable form.
const appJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Any",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  author: {
    "@type": "Organization",
    name: "Crafter Station",
    url: "https://github.com/crafter-station",
  },
  sameAs: ["https://github.com/crafter-station/gh-ascii"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(appJsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}
