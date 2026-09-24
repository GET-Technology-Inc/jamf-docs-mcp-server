/**
 * The concepts.jamf.com guide that used to be served under the wrong title,
 * captured 2026-09-24 from {@link CONCEPTS_STRAY_H1_URL} with a plain `curl`
 * (served by GitHub Pages, `etag: "6ab51218-1e7f8"`,
 * `last-modified: Thu, 24 Sep 2026 12:05:44 GMT`).
 *
 * Trimmed from 124,920 bytes to the page's skeleton, the same way as
 * concepts-guide-page.ts. Removed: `<script>`, `<style>` and `<link>`; every
 * `<head>` entry but the charset, `<title>` and `og:title`; the mobile header
 * row and the header's search, theme and language controls; the mobile guide
 * drawer, the mobile "open guide navigation" button and the guide search box;
 * both "Was this helpful?" blocks; the sidebar entries that are not on this
 * page's path; every decorative `<svg>`; the article except its first
 * paragraph, two headings, and the first of its two scripts with the steps
 * around it; and the footer after one paragraph. Line breaks and indentation
 * outside the article are added for reading. The rest is the served markup.
 *
 * Two things on it are `<h1>`s and neither is the title:
 *
 * - The hero `<h1>Guides</h1>`, in a plain `<section>` ahead of the article,
 *   which every guide page carries. Its class list includes Tailwind's
 *   `tracking-tight`, which is the only reason `[class*="tracking"]` in
 *   SELECTORS.REMOVE strips it.
 * - Three inside the article. The guide types a bash script in single
 *   backticks, and the site's Markdown turns the script's `#` comment lines
 *   into headings, the first of them "Jamf Pro Extension Attribute which
 *   checks and validates the following:". That is what this guide was served
 *   as, in all 10 locales.
 *
 * The article itself does not open with an `<h1>`, unlike the 190 guides that
 * do. Its title appears only in `og:title`, `<title>`, and the `<h2>` above
 * the article that the site renders it into.
 */

export const CONCEPTS_STRAY_H1_URL =
  'https://concepts.jamf.com/en/guides/threat-and-risk-management/enforcing-compliance-baselines-for-network-access/';

export const CONCEPTS_STRAY_H1_HTML = `<!DOCTYPE html><html lang="en" class="inter_31011fd-module__jtyeTG__variable"><head>
<meta charSet="utf-8"/>
<title>Enforcing Compliance Baselines for Network Access | Jamf Concepts</title>
<meta property="og:title" content="Enforcing Compliance Baselines for Network Access"/>
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
                    <div class="flex items-center"><a class="flex-1 px-0 py-1.5 text-[14px] leading-[20px] transition-colors text-text-primary font-medium" href="/en/guides/threat-and-risk-management/">Threat and Risk Management</a><button class="p-1 text-text-tertiary hover:text-text-secondary transition-colors" aria-label="Collapse section"></button></div>
                    <ul class="ml-3 mt-1 space-y-1 pl-3" style="border-left:1px solid rgba(128,128,128,0.15)">
                      <li><a class="block py-1.5 text-[13px] transition-colors text-text-secondary hover:text-text-primary px-2" href="/en/guides/threat-and-risk-management/enforcing-compliance-baselines-for-network-access/">Enforcing Compliance Baselines for Network Access</a></li>
                    </ul>
                  </li>
                </ul>
              </nav>
            </div>
          </aside>
          <main class="flex-1 min-w-0">
            <nav class="flex items-center flex-wrap gap-1 text-[12px] text-text-tertiary mb-3" aria-label="Breadcrumb">
              <a class="hover:text-text-primary transition-colors" href="/en/guides/">Guides</a>
              <a class="hover:text-text-primary transition-colors" href="/en/guides/threat-and-risk-management/">Threat and Risk Management</a>
            </nav>
            <div class="flex items-baseline gap-4 mb-6"><h2 class="text-[24px] md:text-[32px] font-bold text-text-primary">Enforcing Compliance Baselines for Network Access</h2><span class="text-[12px] text-text-tertiary flex-shrink-0">~<!-- -->6<!-- --> min read</span></div>
            <article class="prose max-w-none [&amp;&gt;h1:first-child]:hidden"><p>Ensuring device compliance stands as a crucial cornerstone for organizations, safeguarding their IT assets and maintaining controlled, secure access to essential resources. Various vendors and solutions offer unique workflows and capabilities to achieve this compliance state. Jamf offers multiple integrations whether it's Microsoft Entra Conditional Access, Okta Identity Threat Prevention, Google BeyondCorp Enterprise Context-Aware Policy or AWS Verified Access, each integration targets the essential need of allowing only trusted users from compliant devices access to organizational resources.</p>
<h2>Establishing a Compliance Baseline</h2>
<h3>Jamf Pro: Create macOS Extension Attribute in Jamf Pro</h3>
<p>Name: <em>Jamf Protect Installed</em></p>
<ul>
<li><p>Data Type: <em>String</em></p>
</li>
<li><p>Inventory Display: <em>Extension Attribute</em></p>
</li>
<li><p>Input Type: <em>Script</em></p>
</li>
</ul>
<p>\`#!/bin/bash</p>
<h1>Jamf Pro Extension Attribute which checks and validates the following:</h1>
<h1></h1>
<h1>Jamf Protect is installed and located under /Applications</h1>
<p>ProtectStatus="/Applications/JamfProtect.app"</p>
<p>if [ -e "$ProtectStatus" ]; then
    echo "Installed"
else
    echo "Not Installed"
fi</p>
<p>exit 0\`
![](/images/1. Jamf Protect Installed Status.png)</p>
<ul>
<li>Then press save</li>
</ul></article>
          </main>
        </div>
      </div>
    </div>
  </div>
<!--$--><!--/$--></main>
<footer class="bg-bg-secondary"><p class="text-[12px] leading-[16px] text-text-secondary max-w-xs">Jamf&#x27;s purpose is to simplify work by helping organizations manage and secure an Apple experience that end users love and organizations trust.</p></footer>
</body></html>`;
