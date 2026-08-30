import type { Metadata } from "next";
import Script from "next/script";
import Providers from "@/components/Providers";
import "@/index.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://geogushing.com"),
  title: "GEOGUSHING - Watch. Guess. Score.",
  description: "GEOGUSHING - Watch a clip, guess the location, score points!",
  authors: [{ name: "GEOGUSHING" }],
  icons: { icon: "/favicon.png" },
  openGraph: {
    title: "GEOGUSHING - Watch. Guess. Score.",
    description: "Watch a clip, guess the location, score points!",
    type: "website",
    url: "https://geogushing.com",
    images: ["/og-image-v2.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "GEOGUSHING - Watch. Guess. Score.",
    description: "Watch a clip, guess the location, score points!",
    images: ["/og-image-v2.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <Script id="gtm" strategy="lazyOnload">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
          new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
          j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
          'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
          })(window,document,'script','dataLayer','GTM-NRVZ6ZV6');`}
        </Script>
      </head>
      <body>
        <noscript>
          <iframe
            src="https://www.googletagmanager.com/ns.html?id=GTM-NRVZ6ZV6"
            height="0"
            width="0"
            style={{ display: "none", visibility: "hidden" }}
          />
        </noscript>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
