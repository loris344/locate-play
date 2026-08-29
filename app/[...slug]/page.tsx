import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  allPages,
  getContent,
  isPublished,
  getPublishedEntries,
  buildBreadcrumb,
  getInternalLinksForPage,
  getPublishedUrlSet,
  type SeoPage,
} from "@/lib/seo-pages";
import SeoGameWidget from "@/components/SeoGameWidget";

export const dynamicParams = false;

export function generateStaticParams() {
  return getPublishedEntries().map(({ page }) => ({
    slug: page.url.replace(/^\/|\/$/g, "").split("/"),
  }));
}

function findPage(slugParam: string[]): SeoPage | undefined {
  const url = "/" + slugParam.join("/") + "/";
  return allPages.find((p) => p.url === url);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = findPage(slug);
  if (!page) return {};
  const content = getContent(page.slug);
  const title = content?.metaTitle || page.metaTitle;
  const description = content?.metaDescription || page.metaDescription;

  return {
    title,
    description,
    alternates: { canonical: page.canonical },
    robots: page.noindexBeforePublication ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: { title, description, url: page.canonical, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

function MdLink({ href, children }: { href?: string; children?: ReactNode }) {
  if (!href) return <>{children}</>;
  if (!href.startsWith("/")) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  if (getPublishedUrlSet().has(href)) return <Link href={href}>{children}</Link>;
  return <span>{children}</span>;
}

export default async function Page({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const page = findPage(slug);
  if (!page) notFound();

  const content = getContent(page.slug);
  if (!isPublished(page, content)) notFound();

  const breadcrumb = buildBreadcrumb(page);
  const requiredLinks = getInternalLinksForPage(page.url);
  const publishedUrls = getPublishedUrlSet();
  const schemaType = page.schemaType.toLowerCase().includes("article") ? "Article" : "WebPage";

  const gameEmbed = content!.gameEmbed ?? {
    mode: page.cityDestination ? ("city" as const) : page.country ? ("country" as const) : ("random" as const),
    filter: page.cityDestination || page.country || undefined,
  };

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": schemaType,
      name: content!.h1 || page.h1,
      url: page.canonical,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: breadcrumb.map((b, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: b.label,
        item: `https://geogushing.com${b.href}`,
      })),
    },
  ];

  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-8">
        <nav className="text-sm text-muted-foreground">
          {breadcrumb.map((b, i) => (
            <span key={b.href}>
              {i > 0 && " › "}
              {i === breadcrumb.length - 1 ? b.label : <Link href={b.href}>{b.label}</Link>}
            </span>
          ))}
        </nav>

        <h1 className="text-4xl font-black text-gradient-hot">{content!.h1 || page.h1}</h1>

        <SeoGameWidget mode={gameEmbed.mode} filter={gameEmbed.filter} />

        <article className="prose prose-invert max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: MdLink }}>
            {content!.body}
          </ReactMarkdown>
        </article>

        {content!.faq && content!.faq.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-2xl font-black">FAQ</h2>
            {content!.faq.map((f) => (
              <div key={f.q}>
                <p className="font-bold">{f.q}</p>
                <p className="text-muted-foreground">{f.a}</p>
              </div>
            ))}
          </section>
        )}

        {requiredLinks.length > 0 && (
          <section className="space-y-2 border-t border-border pt-6">
            <h2 className="text-sm font-bold uppercase text-muted-foreground">See also</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {requiredLinks
                .filter((link) => publishedUrls.has(link.target))
                .map((link) => (
                  <li key={link.target}>
                    <Link href={link.target} className="text-primary hover:underline">
                      {link.anchor}
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </main>
  );
}
