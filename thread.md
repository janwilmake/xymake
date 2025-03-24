# 🔧 Introducing XYMake - Turn Your 𝕏 Into LLM-Ready Data

Just add "ymake" to ANY X URL to get the entire thread in LLM-ready format!

Let me share my secret sauce and codebase 🧵👇

---

I built this in what was supposed to be a 30-minute POC that turned into a 10-hour flow state!

XYMake lets you:
• Access your X threads in clean markdown format
• Use your content with any LLM, MCP or API
• Repurpose your X content elsewhere

---

XYMake features smooth onboarding:
• OAuth2 login (built from scratch using Cloudflare Worker Primitives)
• Auto-generated OG images for each thread
• Token counting for LLM context
• SEO-optimized HTML for crawlers

---

How does it work? Using some neat Cloudflare Worker tricks:

1. The site serves different content to different consumers:

• HTML with og-image to crawlers
• Raw markdown to humans and agents

2. I preload og-image generation with `ctx.waitUntil` for instant social sharing

---

I made this using `workers-og` to turn specialized HTML into SVG then PNG, all from a Cloudflare Worker.

The entire project contains ~40,000 tokens of code, built with help from Claude and Grok for code generation from natural language specs.

---

My vision: We should have the right to own and use our own data. X obviously uses our posts to train Grok - we should claim our right to our own conversations too!

I'm only sharing threads where the main contributor has "freed their data" - respecting privacy is important.

---

To try it yourself:

1. Go to any X post you like
2. Change x.com to xymake.com in the URL
3. Get clean, LLM-ready markdown!

Or visit https://xymake.com to unlock your own X data with one click.

What will you build with your freed X data?

---

Read the full story and codebase here:

https://github.com/janwilmake/xymake
