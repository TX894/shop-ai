"use client";

/**
 * The bookmarklet hub. Shows the draggable "Import to Shop AI" button,
 * installation steps and a list of currently supported source sites.
 *
 * The bookmarklet code is embedded as a normal anchor's href. Browsers let
 * the user drag any link with a javascript: href onto the bookmarks bar.
 */

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import { Sparkles, ExternalLink as LinkIcon, BookmarkPlus, Copy, Check } from "lucide-react";

export default function ExtensionPage() {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Bookmarklet source — minified at runtime. See the readable version below.
  // Strategy:
  //   1. Detect host. Currently optimised for temu.com (Next.js → __NEXT_DATA__),
  //      with a generic JSON-LD / OpenGraph fallback for any other store.
  //   2. Collect product fields into the payload.
  //   3. Open Shop AI's /import-external page with the payload base64-encoded
  //      in the URL fragment so cookies on the Shop AI origin are used (no
  //      cross-origin auth headaches).
  const bookmarkletJs = `(function(){var _o='${origin}';var u=location.href,h=location.hostname;function pickStr(o,keys){for(var i=0;i<keys.length;i++){var k=keys[i],v=o;k.split('.').forEach(function(p){if(v&&typeof v==='object')v=v[p];});if(typeof v==='string'&&v.length)return v;}return '';}function pickArr(o,keys){for(var i=0;i<keys.length;i++){var k=keys[i],v=o;k.split('.').forEach(function(p){if(v&&typeof v==='object')v=v[p];});if(Array.isArray(v)&&v.length)return v;}return [];}function fromMeta(p){var m=document.querySelector('meta[property="og:'+p+'"]');return m?m.getAttribute('content')||'':'';}function fromJsonLd(){var s=document.querySelectorAll('script[type="application/ld+json"]'),i,j;for(i=0;i<s.length;i++){try{var d=JSON.parse(s[i].textContent);var arr=Array.isArray(d)?d:[d];for(j=0;j<arr.length;j++){var n=arr[j];if(n&&(n['@type']==='Product'||(n['@graph']&&n['@graph'].some&&n['@graph'].some(function(x){return x['@type']==='Product';})))){return n['@graph']?n['@graph'].find(function(x){return x['@type']==='Product';}):n;}}}catch(e){}}return null;}var product={title:'',descriptionHtml:'',priceOriginal:'',priceCurrency:'',imageUrls:[],sourceUrl:u,sourceBrand:''};if(h.indexOf('temu.com')>=0){product.sourceBrand='Temu';try{var nd=document.getElementById('__NEXT_DATA__');if(nd){var nx=JSON.parse(nd.textContent);var raw=pickStr(nx,['props.pageProps.rawData.skuList.0.title','props.pageProps.rawData.title','props.pageProps.serverData.detailData.title'])||document.title;product.title=raw;var price=pickStr(nx,['props.pageProps.rawData.priceObj.priceStr','props.pageProps.serverData.detailData.priceObj.priceStr','props.pageProps.rawData.skuList.0.salePrice','props.pageProps.serverData.detailData.skuList.0.salePrice']);if(price){var m=price.match(/([\\d.,]+)/);if(m)product.priceOriginal=m[1].replace(',','.');product.priceCurrency=price.replace(/[\\d.,\\s]/g,'');}var imgs=pickArr(nx,['props.pageProps.rawData.imageList','props.pageProps.rawData.detailGalleryList','props.pageProps.serverData.detailData.viewImageData','props.pageProps.rawData.skuList.0.viewImageList']);product.imageUrls=imgs.map(function(x){return typeof x==='string'?x:(x.imageUrl||x.url||x.image||'');}).filter(Boolean);var desc=pickArr(nx,['props.pageProps.rawData.featureList','props.pageProps.serverData.detailData.specifyList']);if(desc.length)product.descriptionHtml='<ul>'+desc.map(function(x){var t=typeof x==='string'?x:(x.text||x.key+': '+x.value||'');return t?'<li>'+t.replace(/[<>&]/g,'')+'</li>':'';}).join('')+'</ul>';}}catch(e){}}if(!product.title)product.title=fromMeta('title')||document.title;if(!product.descriptionHtml)product.descriptionHtml=fromMeta('description')||'';if(!product.imageUrls.length){var ogi=fromMeta('image');if(ogi)product.imageUrls=[ogi];}var jl=fromJsonLd();if(jl){if(!product.title&&jl.name)product.title=jl.name;if(!product.descriptionHtml&&jl.description)product.descriptionHtml='<p>'+jl.description+'</p>';if(jl.brand){var b=typeof jl.brand==='string'?jl.brand:jl.brand.name;if(b&&!product.sourceBrand)product.sourceBrand=b;}if(jl.offers){var off=Array.isArray(jl.offers)?jl.offers[0]:jl.offers;if(off){if(!product.priceOriginal&&off.price)product.priceOriginal=String(off.price);if(!product.priceCurrency&&off.priceCurrency)product.priceCurrency=off.priceCurrency;}}if(!product.imageUrls.length){var im=jl.image;if(typeof im==='string')product.imageUrls=[im];else if(Array.isArray(im))product.imageUrls=im;}}if(!product.sourceBrand){product.sourceBrand=h.replace(/^www\\./,'').split('.')[0].replace(/^./,function(c){return c.toUpperCase();});}if(!product.title){alert('Shop AI: could not detect a product on this page.');return;}var payload=JSON.stringify(product);var enc=btoa(unescape(encodeURIComponent(payload)));window.open(_o+'/import-external#data='+enc,'_blank');})();`;

  const href = `javascript:${bookmarkletJs}`;

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  return (
    <>
      <Header />
      <main className="min-h-screen bg-gradient-to-br from-stone-50 to-stone-100 dark:from-stone-950 dark:to-stone-900 p-6 md:p-10">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-3xl font-semibold tracking-tight text-stone-900 dark:text-stone-100 mb-1.5">Browser bookmarklet</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400 mb-6">
            Import products from sites that block server-side scraping — Temu, AliExpress, Amazon, SHEIN, Etsy — by clicking a button on your bookmarks bar. The scrape runs in your own browser session, so Cloudflare and bot detection see a normal user.
          </p>

          {/* The draggable bookmarklet */}
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6 mb-6 text-center">
            <p className="text-xs uppercase tracking-wider text-stone-500 mb-3">Drag this button to your bookmarks bar →</p>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href={href}
              draggable
              onClick={(e) => { e.preventDefault(); alert("Drag this button to your bookmarks bar — don't click it on this page."); }}
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-br from-indigo-600 to-violet-600 text-white rounded-xl font-medium shadow-sm cursor-grab active:cursor-grabbing"
            >
              <Sparkles size={16} />
              Import to Shop AI
            </a>
            <p className="text-[11px] text-stone-400 mt-3 max-w-md mx-auto">
              If dragging doesn&apos;t work in your browser, right-click the button → <em>Bookmark this link</em>, or copy the code below and create a new bookmark manually with this as the URL.
            </p>
            <button onClick={copyCode} className="mt-3 inline-flex items-center gap-1.5 text-xs px-3 py-1.5 border border-stone-300 dark:border-stone-700 rounded-lg text-stone-600 dark:text-stone-300 hover:border-stone-500">
              {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy bookmarklet code</>}
            </button>
          </div>

          {/* Setup steps */}
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6 mb-6">
            <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100 mb-3 flex items-center gap-2"><BookmarkPlus size={16} /> How to set up (60 seconds)</h2>
            <ol className="space-y-2 text-sm text-stone-600 dark:text-stone-400 list-decimal list-inside">
              <li>If your bookmarks bar is hidden, press <kbd className="px-1 py-0.5 bg-stone-100 dark:bg-stone-800 rounded text-xs">⌘⇧B</kbd> (Mac) or <kbd className="px-1 py-0.5 bg-stone-100 dark:bg-stone-800 rounded text-xs">Ctrl+Shift+B</kbd> (Windows) to show it.</li>
              <li>Drag the violet <strong>Import to Shop AI</strong> button above onto your bookmarks bar.</li>
              <li>Go to any product page on a supported site (see below).</li>
              <li>Click the bookmark — a new tab opens with the scraped product ready to import.</li>
            </ol>
          </div>

          {/* Supported sites */}
          <div className="bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl p-6 mb-6">
            <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100 mb-3">Supported sites</h2>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2"><span className="text-green-600">✓</span> <strong>Temu</strong> — full extraction (title, price, images, features) via Next.js page data</li>
              <li className="flex items-center gap-2"><span className="text-stone-400">○</span> <strong>Any e-commerce site</strong> with JSON-LD <code className="text-[11px] bg-stone-100 dark:bg-stone-800 px-1 py-0.5 rounded">Product</code> schema (AliExpress, most Shopify stores, many WooCommerce sites)</li>
              <li className="flex items-center gap-2"><span className="text-stone-400">○</span> Generic fallback uses <code className="text-[11px] bg-stone-100 dark:bg-stone-800 px-1 py-0.5 rounded">og:title</code>, <code className="text-[11px] bg-stone-100 dark:bg-stone-800 px-1 py-0.5 rounded">og:image</code>, <code className="text-[11px] bg-stone-100 dark:bg-stone-800 px-1 py-0.5 rounded">og:description</code> — works on most product pages with minimal data</li>
            </ul>
            <p className="text-xs text-stone-400 mt-3">More sites coming as we encounter them. AliExpress dynamic loading and Amazon SP-PR pages may need site-specific selectors.</p>
          </div>

          {/* What happens next */}
          <div className="bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-950/40 dark:to-violet-950/40 border border-indigo-200 dark:border-indigo-800 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100 mb-2 flex items-center gap-2"><LinkIcon size={14} /> What happens after you click the bookmark</h2>
            <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed">
              A new tab opens with the scraped product. You confirm the language, max images, price strategy and publish target, then click <strong>Import</strong>. The same pipeline as your Shopify-to-Shopify imports runs: text translated and rewritten for your brand voice, every image text translated and the source brand swapped for your brand short name, watermark stamped, SEO meta + handle + tags generated, product pushed to Shopify and published to Online Store.
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
