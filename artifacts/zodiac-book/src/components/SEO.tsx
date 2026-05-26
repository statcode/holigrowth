import { useEffect } from "react";

/**
 * Lightweight client-side SEO updater for SPA routes.
 *
 * Updates `document.title`, the meta description, the canonical URL, and
 * the matching Open Graph / Twitter equivalents whenever the mounted
 * route changes. Modern crawlers (Googlebot, Bingbot) DO execute JS, so
 * these updates land in their index — but AI crawlers (ChatGPT,
 * Perplexity, Claude) typically do not. That's fine: the homepage gets
 * a rich static set of tags in index.html (which AI crawlers see), and
 * sub-routes use this component to override for users + JS-capable
 * crawlers. If you ever need full SSR-quality coverage of every route,
 * the right path is a pre-rendering plugin like `vite-plugin-prerender`
 * — that's a larger change; this component is the 80/20.
 *
 * Reuses the existing tags in index.html when not overridden — never
 * removes a tag, only updates its content. So the rich Product /
 * Organization JSON-LD baked into index.html stays intact on every
 * route.
 */
export function SEO({
  title,
  description,
  canonical,
  /** Path on holigrowth.com — converted to absolute by prepending the
   *  current origin (e.g. "/privacy" → "https://holigrowth.com/privacy"). */
  path,
  noindex = false,
}: {
  title: string;
  description?: string;
  canonical?: string;
  path?: string;
  noindex?: boolean;
}) {
  useEffect(() => {
    document.title = title;

    const setMeta = (selector: string, value: string | null) => {
      const el = document.head.querySelector<HTMLMetaElement>(selector);
      if (!el) return;
      if (value === null) el.remove();
      else el.setAttribute("content", value);
    };

    const upsertMeta = (attrName: "name" | "property", attrValue: string, content: string) => {
      const selector = `meta[${attrName}="${attrValue}"]`;
      let el = document.head.querySelector<HTMLMetaElement>(selector);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attrName, attrValue);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };

    upsertMeta("property", "og:title", title);
    upsertMeta("name", "twitter:title", title);

    if (description) {
      setMeta('meta[name="description"]', description);
      upsertMeta("property", "og:description", description);
      upsertMeta("name", "twitter:description", description);
    }

    const absoluteUrl = canonical
      ?? (path ? `${window.location.origin}${path}` : undefined);
    if (absoluteUrl) {
      let linkEl = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      if (!linkEl) {
        linkEl = document.createElement("link");
        linkEl.setAttribute("rel", "canonical");
        document.head.appendChild(linkEl);
      }
      linkEl.setAttribute("href", absoluteUrl);
      upsertMeta("property", "og:url", absoluteUrl);
    }

    // Robots noindex — used for transactional / user-specific pages we
    // never want indexed (/admin, /preview/:id, etc.). Removed cleanly
    // on unmount so navigating from a noindex page back to an indexable
    // page doesn't leak the directive.
    let robotsEl: HTMLMetaElement | null = null;
    if (noindex) {
      robotsEl = document.createElement("meta");
      robotsEl.setAttribute("name", "robots");
      robotsEl.setAttribute("content", "noindex, nofollow");
      document.head.appendChild(robotsEl);
    }

    return () => {
      if (robotsEl?.parentNode) robotsEl.parentNode.removeChild(robotsEl);
    };
  }, [title, description, canonical, path, noindex]);

  return null;
}
