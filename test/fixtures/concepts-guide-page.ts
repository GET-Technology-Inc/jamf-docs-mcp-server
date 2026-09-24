/**
 * One concepts.jamf.com guide page, captured 2026-09-24 from
 * {@link CONCEPTS_GUIDE_URL} with a plain `curl` (served by GitHub Pages,
 * `last-modified: Wed, 23 Sep 2026 12:06:17 GMT`).
 *
 * Trimmed from 125,186 bytes to the page's skeleton. Removed: `<script>`
 * (a JSON-LD `BreadcrumbList` among them, which nothing here reads),
 * `<style>` and `<link>`; every `<head>` entry but the charset, `<title>` and
 * `og:title`; the mobile header row and the header's search, theme and
 * language controls; the mobile "open guide navigation" button and the guide
 * search box; both "Was this helpful?" blocks; the sidebar and drawer entries
 * that are not on this page's path; the article after its first three
 * children; the footer after one paragraph; and every decorative `<svg>`
 * except the breadcrumb's own chevron separators. Line breaks and
 * indentation are added for reading. What is left is otherwise the served
 * markup, Tailwind classes included — the point is that none of them carries
 * a `crumb` substring (none on the full page did either), so the only thing
 * marking the trail is `nav[aria-label="Breadcrumb"]`, capitalised.
 *
 * Chosen because the trail has three crumbs, and because the rest of the
 * page's navigation uses the same words: the header `<nav>` links "Guides",
 * and the sidebar `<nav>` links "Device Trust Identity and Deployment" and,
 * twice, "Platform SSO for macOS". A selector that matched navigation in
 * general rather than the trail would return a different array, not the same
 * one.
 *
 * The trail stops at the page's parent, as 390 of the 550 guide trails do
 * (measured 2026-09-24). Its last crumb, "Platform SSO for macOS", links to
 * `…/platform-single-sign-on/`, the section this page sits in; it matches
 * the page's own `og:title` only because the section and the page share a
 * name.
 *
 * Its hero `<h1>Guides</h1>` sits in a plain `<section>` ahead of the
 * article, where no chrome rule reaches it, and the article does not open
 * with an `<h1>`. The title tests in static-article-service.test.ts use it
 * for that.
 */

export const CONCEPTS_GUIDE_URL =
  'https://concepts.jamf.com/en/guides/device-trust-identity-and-deployment/platform-single-sign-on/platform-sso-for-macos/';

export const CONCEPTS_GUIDE_HTML = `<!DOCTYPE html><html lang="en" class="inter_31011fd-module__jtyeTG__variable"><head>
<meta charSet="utf-8"/>
<title>Platform SSO for macOS | Jamf Concepts</title>
<meta property="og:title" content="Platform SSO for macOS"/>
</head><body class="min-h-screen bg-bg-primary text-text-primary antialiased flex flex-col">
<header class="sticky top-0 z-50 w-full bg-bg-secondary/80 backdrop-blur-md">
  <div class="hidden md:flex relative mx-auto h-[88px] max-w-7xl items-center justify-between px-6 lg:px-[42px]">
    <a class="flex items-center gap-2.5 text-text-primary transition-opacity hover:opacity-80 z-10" href="/en/"><span class="text-[18px] leading-[20px]"><span class="font-bold">Jamf</span> <span class="font-normal">Concepts</span></span></a>
    <nav class="absolute left-1/2 -translate-x-1/2 flex items-center gap-1">
      <a class="px-4 py-3 text-[14px] leading-[20px] rounded-full transition-colors font-normal text-text-primary hover:text-text-secondary" href="/en/concepts/">Concepts</a>
      <a class="px-4 py-3 text-[14px] leading-[20px] rounded-full transition-colors font-semibold text-text-primary" href="/en/guides/">Guides</a>
      <a class="px-4 py-3 text-[14px] leading-[20px] rounded-full transition-colors font-normal text-text-primary hover:text-text-secondary" href="/en/ecosystem/">Ecosystem</a>
      <a class="px-4 py-3 text-[14px] leading-[20px] rounded-full transition-colors font-normal text-text-primary hover:text-text-secondary" href="/en/about/">About</a>
    </nav>
  </div>
</header>
<main class="flex-1">
  <div class="relative min-h-screen bg-bg-primary">
    <div class="fixed top-[56px] bottom-0 left-0 z-50 w-[300px] bg-bg-primary flex flex-col lg:hidden transition-transform duration-300 ease-in-out -translate-x-full" style="background-color:var(--color-bg-primary);box-shadow:none" aria-label="Guide navigation">
      <div class="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0"><span class="text-[15px] font-semibold text-text-primary">Guides</span><button class="p-1.5 -mr-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-bg-secondary transition-colors" aria-label="Close navigation"></button></div>
      <div class="flex-1 overflow-y-auto px-5 py-4">
        <ul class="space-y-0.5">
          <li><a class="block px-0 py-1.5 text-[14px] leading-[20px] transition-colors text-text-secondary hover:text-text-primary" href="/en/guides/">Overview</a></li>
          <li><div class="flex items-center"><button class="flex-1 flex items-center justify-between px-0 py-1.5 text-[14px] leading-[20px] transition-colors text-left text-text-primary font-medium">Device Trust Identity and Deployment</button></div></li>
        </ul>
      </div>
    </div>
    <section class="relative"><div class="relative mx-auto max-w-7xl px-6 lg:px-[42px] pt-16 md:pt-20 lg:pt-24 pb-0"><h1 class="text-[32px] md:text-[48px] leading-[1.1] font-extrabold text-text-primary tracking-tight">Guides</h1></div></section>
    <div class="relative z-10 bg-bg-primary">
      <div class="mx-auto max-w-7xl px-6 lg:px-[42px] pt-16 md:pt-20 lg:pt-24 pb-16 md:pb-20">
        <div class="flex flex-col lg:flex-row gap-8 lg:gap-20 lg:items-start">
          <aside class="hidden lg:block lg:w-[220px] flex-shrink-0">
            <div class="lg:sticky lg:top-24">
              <nav>
                <ul class="space-y-0.5">
                  <li><a class="block px-0 py-1.5 text-[14px] leading-[20px] transition-colors text-text-secondary hover:text-text-primary" href="/en/guides/">Overview</a></li>
                  <li>
                    <div class="flex items-center"><a class="flex-1 px-0 py-1.5 text-[14px] leading-[20px] transition-colors text-text-primary font-medium" href="/en/guides/device-trust-identity-and-deployment/">Device Trust Identity and Deployment</a><button class="p-1 text-text-tertiary hover:text-text-secondary transition-colors" aria-label="Collapse section"></button></div>
                    <ul class="ml-3 mt-1 space-y-1 pl-3" style="border-left:1px solid rgba(128,128,128,0.15)">
                      <li>
                        <div class="flex items-center"><a class="flex-1 px-0 py-1.5 text-[14px] leading-[20px] transition-colors text-text-primary font-medium" style="padding-left:12px" href="/en/guides/device-trust-identity-and-deployment/platform-single-sign-on/">Platform SSO for macOS</a><button class="p-1 text-text-tertiary hover:text-text-secondary transition-colors" aria-label="Collapse section"></button></div>
                        <ul class="ml-3 mt-1 space-y-1 pl-3" style="border-left:1px solid rgba(128,128,128,0.15)">
                          <li><a class="block py-1.5 text-[13px] transition-colors text-text-secondary hover:text-text-primary px-2" href="/en/guides/device-trust-identity-and-deployment/platform-single-sign-on/platform-sso-for-macos/">Platform SSO for macOS</a></li>
                        </ul>
                      </li>
                    </ul>
                  </li>
                </ul>
              </nav>
            </div>
          </aside>
          <main class="flex-1 min-w-0">
            <nav class="flex items-center flex-wrap gap-1 text-[12px] text-text-tertiary mb-3" aria-label="Breadcrumb">
              <a class="hover:text-text-primary transition-colors" href="/en/guides/">Guides</a>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-right h-3 w-3 opacity-40 flex-shrink-0" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
              <a class="hover:text-text-primary transition-colors" href="/en/guides/device-trust-identity-and-deployment/">Device Trust Identity and Deployment</a>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-right h-3 w-3 opacity-40 flex-shrink-0" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
              <a class="hover:text-text-primary transition-colors" href="/en/guides/device-trust-identity-and-deployment/platform-single-sign-on/">Platform SSO for macOS</a>
            </nav>
            <div class="flex items-baseline gap-4 mb-6"><h2 class="text-[24px] md:text-[32px] font-bold text-text-primary">Platform SSO for macOS</h2><span class="text-[12px] text-text-tertiary flex-shrink-0">~<!-- -->5<!-- --> min read</span></div>
            <article class="prose max-w-none [&amp;&gt;h1:first-child]:hidden"><p><em>How Apple's Platform Single Sign-On is transforming Mac authentication in the enterprise</em></p>
<h2>Overview</h2>
<p>Authentication fatigue is real. IT departments spend countless hours managing password resets, while employees waste time juggling multiple credentials across corporate applications. Meanwhile, security teams battle an endless stream of phishing attempts targeting those same passwords.</p>
</article>
          </main>
        </div>
      </div>
    </div>
  </div>
<!--$--><!--/$--></main>
<footer class="bg-bg-secondary"><p class="text-[12px] leading-[16px] text-text-secondary max-w-xs">Jamf&#x27;s purpose is to simplify work by helping organizations manage and secure an Apple experience that end users love and organizations trust.</p></footer>
</body></html>`;
