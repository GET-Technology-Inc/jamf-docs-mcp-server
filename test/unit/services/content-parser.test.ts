/**
 * Unit tests for content-parser
 */

import { describe, it, expect } from 'vitest';
import { parseArticle, cleanSnippet, htmlToMarkdown } from '../../../src/core/services/content-parser.js';
import { extractSections } from '../../../src/core/services/tokenizer.js';

describe('parseArticle', () => {
  it('should extract title and convert content to markdown', () => {
    const html = `
      <html><body>
        <h1>MDM Profile Settings</h1>
        <article>
          <p>The MDM Profile allows you to configure device management.</p>
          <h2>Configuration</h2>
          <p>Configure the settings below.</p>
        </article>
      </body></html>
    `;

    const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page');

    expect(result.title).toBe('MDM Profile Settings');
    expect(result.content).toContain('MDM Profile');
    expect(result.content).toContain('## Configuration');
  });

  it('should strip script and style elements', () => {
    const html = `
      <html><body>
        <script>alert('xss')</script>
        <style>.hidden{display:none}</style>
        <h1>Title</h1>
        <article><p>Clean content</p></article>
      </body></html>
    `;

    const result = parseArticle(html, 'https://example.com');

    expect(result.content).not.toContain('alert');
    expect(result.content).not.toContain('display');
    expect(result.content).toContain('Clean content');
  });

  it('should fix relative URLs', () => {
    const html = `
      <html><body>
        <h1>Test</h1>
        <article>
          <a href="/r/en-US/doc/other">Link</a>
          <img src="/images/photo.png" alt="Photo">
        </article>
      </body></html>
    `;

    const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page');

    expect(result.content).toContain('https://learn.jamf.com/r/en-US/doc/other');
    expect(result.content).toContain('https://learn.jamf.com/images/photo.png');
  });

  it('should handle FT article with main content area', () => {
    const html = `
      <html><body>
        <main>
          <article>
            <h1>Automated Device Enrollment</h1>
            <p>Automated Device Enrollment streamlines the deployment of devices.</p>
            <h2>Requirements</h2>
            <p>You need an Apple Business Manager account.</p>
          </article>
        </main>
      </body></html>
    `;

    const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/ADE');
    expect(result.title).toBe('Automated Device Enrollment');
    expect(result.content).toContain('streamlines');
    expect(result.content).toContain('## Requirements');
  });

  it('should return Untitled when no h1 found', () => {
    const html = '<html><body><article><p>Content only</p></article></body></html>';
    const result = parseArticle(html, 'https://example.com');
    expect(result.title).toBe('Untitled');
  });

  it('should handle FT API HTML fragment with content-locale wrapper', () => {
    const html = `<div class="content-locale-en-US content-locale-en">
  <div id="ID-000023b2">
    <div class="body taskbody">
      <section class="section context">
        <p class="p">Jamf Connect licenses are available for purchase.</p>
      </section>
    </div>
  </div>
</div>`;

    const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page');

    expect(result.title).toBe('Untitled');
    expect(result.content).toContain('Jamf Connect licenses');
    expect(result.content.length).toBeGreaterThan(10);
  });

  it('should handle FT API HTML fragment with taskbody and no locale wrapper', () => {
    const html = `<div id="task-9280">
  <div class="body taskbody">
    <section class="section context">
      <p class="p">When a policy is applied to all cloud apps, any login request will be included.</p>
    </section>
  </div>
</div>`;

    const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page');

    expect(result.content).toContain('policy is applied');
    expect(result.content.length).toBeGreaterThan(10);
  });

  it('should extract title when h1 is outside body wrapper', () => {
    const html = `
      <html><body>
        <h1>Computer Configuration Profiles</h1>
        <div class="taskbody">
          <section class="section"><h2>Prerequisites</h2><p>Content here</p></section>
        </div>
      </body></html>
    `;
    const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page');
    expect(result.title).toBe('Computer Configuration Profiles');
    // Body wrapper content is extracted separately from the h1 title
    expect(result.content).toContain('Prerequisites');
    expect(result.content).toContain('Content here');
  });

  it('should extract sections when headings are inside body wrapper', () => {
    const html = `
      <html><body>
        <h1>Main Title</h1>
        <div class="conbody">
          <h2>Section One</h2><p>Content one</p>
          <h2>Section Two</h2><p>Content two</p>
        </div>
      </body></html>
    `;
    const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page');
    const sections = extractSections(result.content);
    expect(sections.length).toBeGreaterThanOrEqual(2);
  });

  it('should prefer article wrapper over body wrapper when they are siblings', () => {
    const html = `
      <html><body>
        <article>
          <h1>Article Title</h1>
          <p>Full article content with details</p>
        </article>
        <div class="taskbody">
          <p>Narrow body only</p>
        </div>
      </body></html>
    `;
    const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page');
    expect(result.title).toBe('Article Title');
    expect(result.content).toContain('Full article content');
    expect(result.content).not.toContain('Narrow body only');
  });
});

  describe('parseArticle — includeRelated option', () => {
    it('should extract related article links when includeRelated is true', () => {
      const html = `
        <html><body>
          <h1>MDM Profile Settings</h1>
          <article>
            <p>Main content here.</p>
          </article>
          <nav class="related-links">
            <a href="https://learn.jamf.com/r/en-US/doc/Smart_Groups">Smart Groups</a>
            <a href="https://learn.jamf.com/r/en-US/doc/Policies">Policies</a>
          </nav>
        </body></html>
      `;

      const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page', {
        includeRelated: true,
      });

      expect(result.relatedArticles).toHaveLength(2);
      expect(result.relatedArticles[0].title).toBe('Smart Groups');
      expect(result.relatedArticles[0].url).toBe('https://learn.jamf.com/r/en-US/doc/Smart_Groups');
      expect(result.relatedArticles[1].title).toBe('Policies');
    });

    it('should return empty relatedArticles when includeRelated is false (default)', () => {
      const html = `
        <html><body>
          <h1>Title</h1>
          <article><p>Content</p></article>
          <nav class="related-links">
            <a href="https://learn.jamf.com/r/en-US/doc/Other">Other Article</a>
          </nav>
        </body></html>
      `;

      const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page');

      expect(result.relatedArticles).toEqual([]);
    });

    it('should skip related articles with empty href', () => {
      const html = `
        <html><body>
          <h1>Title</h1>
          <article><p>Content</p></article>
          <nav class="related-links">
            <a href="">Empty Href Article</a>
            <a href="https://learn.jamf.com/r/en-US/doc/Valid">Valid Article</a>
          </nav>
        </body></html>
      `;

      const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page', {
        includeRelated: true,
      });

      expect(result.relatedArticles).toHaveLength(1);
      expect(result.relatedArticles[0].title).toBe('Valid Article');
    });

    it('should skip related articles with anchor-only href (#section)', () => {
      const html = `
        <html><body>
          <h1>Title</h1>
          <article><p>Content</p></article>
          <nav class="related-links">
            <a href="#section-1">Section Link</a>
            <a href="https://learn.jamf.com/r/en-US/doc/Real">Real Article</a>
          </nav>
        </body></html>
      `;

      const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page', {
        includeRelated: true,
      });

      expect(result.relatedArticles).toHaveLength(1);
      expect(result.relatedArticles[0].title).toBe('Real Article');
    });

    it('should resolve relative hrefs against displayUrl', () => {
      const html = `
        <html><body>
          <h1>Title</h1>
          <article><p>Content</p></article>
          <nav class="related-links">
            <a href="/r/en-US/doc/OtherPage">Other Page</a>
          </nav>
        </body></html>
      `;

      const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page', {
        includeRelated: true,
      });

      expect(result.relatedArticles).toHaveLength(1);
      // The relative href was already rewritten to absolute by cleanHtml, so it resolves correctly
      expect(result.relatedArticles[0].url).toContain('learn.jamf.com');
    });
  });

  describe('parseArticle — Turndown code block rule', () => {
    it('should produce a fenced code block with language tag from <pre><code class="language-typescript">', () => {
      const html = `
        <html><body>
          <h1>Code Example</h1>
          <article>
            <pre><code class="language-typescript">const x: number = 42;</code></pre>
          </article>
        </body></html>
      `;

      const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page');

      expect(result.content).toContain('```typescript');
      expect(result.content).toContain('const x: number = 42;');
      expect(result.content).toContain('```');
    });

    it('should produce a fenced code block without language tag for plain <pre><code>', () => {
      const html = `
        <html><body>
          <h1>Code Example</h1>
          <article>
            <pre><code>plain code block</code></pre>
          </article>
        </body></html>
      `;

      const result = parseArticle(html, 'https://learn.jamf.com/r/en-US/doc/page');

      expect(result.content).toContain('```\nplain code block\n```');
    });
  });

describe('cleanSnippet', () => {
  it('should strip HTML tags from snippet', () => {
    const snippet = '<span class="kwicmatch">MDM</span> Profile Settings allow configuration.  This is a long enough snippet for testing purposes.';
    const result = cleanSnippet(snippet, 'MDM', null);
    expect(result).not.toContain('<span');
    expect(result).toContain('MDM');
  });

  it('should strip breadcrumb prefix', () => {
    const snippet = 'Home > Settings > MDM Profile allows you to configure device management settings and renewal periods.';
    const result = cleanSnippet(snippet, 'MDM', null);
    expect(result).not.toMatch(/^Home/);
  });

  it('should use fallback for short snippets', () => {
    const result = cleanSnippet('Short', 'MDM Profile', 'Jamf Pro');
    expect(result).toBe('MDM Profile \u2014 Jamf Pro');
  });
});

describe('htmlToMarkdown', () => {
  it('should convert HTML to markdown', () => {
    const result = htmlToMarkdown('<h2>Title</h2><p>Paragraph</p>');
    expect(result).toContain('## Title');
    expect(result).toContain('Paragraph');
  });
});
