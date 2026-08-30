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
        <Script id="tiktok-pixel" strategy="lazyOnload">
          {`!function (w, d, t) {
          w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(
          var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script")
          ;n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};

            ttq.load('DAA1FHJC77UEOA3O9UC0');
            ttq.page();
          }(window, document, 'ttq');`}
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
