# 🔧 XYMake - Turn Your 𝕏 Into LLM-Ready Data

Login at https://xymake.com to Free Your X Data and use it with any LLM, MCP, or API.

# CHANGELOG

## Half an hour turned into 10 hours - I made this POC in a day! (2025-03-24)

As I made [https://openapisearch.com](https://openapisearch.com) friday and saturday, this morning I woke up with an idea to quickly try out [https://openapisearch.com/socialdata.tools](https://openapisearch.com/socialdata.tools) because it would allow me to improve my POC of pulling LLM context from my X threads. To my surprise, after about 30 minutes I actually [got it working](https://x.com/janwilmake/status/1904080559422288062)!

I really wanted to work on some low-hanging fruit for [https://openapisearch.com](https://openapisearch.com) today as there is quite a lot, but I just couldn't resist the urge to do a few improvements to XYMake first. And now it's 5PM... I spent the whole day on something unplanned. As a result, I've been in flow all day. And I don't think it's a waste of time.

The following is what I spent my entire day on:

- ✅ Initial implementation (see https://x.com/janwilmake/status/1904080559422288062)
- ✅ Calculate data to serve in the og:image and thread
- ✅ Respond with HTML but only for crawlers. This HTML is also SEO optimised.
- ✅ OG Image for any thread, counting tokens and including usernames and images of the participant(s).
- ✅ Change landingpage to show opportunity of unlocking your data.
- ✅ Tweak og:image further so it renders everywhere perfectly.

The result is what you can see at https://xymake.com. Change any X URL into xymake.com and you get flat text out for the entire thread + comments.

For example: https://x.com/janwilmake/status/1904080559422288062

Becomes [this markdown thread](https://xymake.com/janwilmake/status/1904080559422288062):

![md](md.png)

The key thing I focused on is smooth onboarding. XYMake features:

- OAuth2 onboarding (built from scratch using Cloudflare Worker Primitives)
- OG Image generation for each thread for easy sharing of threads. See below:

![og](og.png)

There are some neat little tricks in this codebase that I aim to explain here...

So how did I do this?

**serving different things to different type of consumers**

In this project I used the following function to determine whether a request comes from a crawler, a user, or an agent:

```ts
const getCrawler = (userAgent: string | null) => {
  const crawlers = [
    { name: "Facebook", userAgentRegex: /facebookexternalhit|Facebot/ },
    { name: "Twitter", userAgentRegex: /Twitterbot/ },
    { name: "LinkedIn", userAgentRegex: /LinkedInBot/ },
    { name: "Slack", userAgentRegex: /Slackbot-LinkExpanding/ },
    { name: "Discord", userAgentRegex: /Discordbot/ },
    { name: "WhatsApp", userAgentRegex: /WhatsApp/ },
    { name: "Telegram", userAgentRegex: /TelegramBot/ },
    { name: "Pinterest", userAgentRegex: /Pinterest/ },
    { name: "Google", userAgentRegex: /Googlebot/ },
    { name: "Bing", userAgentRegex: /bingbot/ },
  ];
  const crawler = crawlers.find((item) =>
    item.userAgentRegex.test(userAgent || ""),
  )?.name;

  return crawler;
};

/** Useful function to determine what to respond with */
export const identify = (
  request: Request,
): {
  /** Based on the user-agent, we think the the user is a crawler (such as Google) */
  isCrawler: boolean;
  /** The request does not want text/html */
  isAgent: boolean;
  isBrowser: boolean;
  preferHTML: boolean;
} => {
  const acceptHeader = request.headers.get("Accept");
  const crawler = getCrawler(request.headers.get("user-agent"));
  const isCrawler = !!crawler;
  const isBrowser = !!acceptHeader?.includes("text/html");
  const isAgent = !isBrowser;
  const preferHTML = isBrowser || isCrawler;

  return { isCrawler, isAgent, isBrowser, preferHTML };
};
```

With this trick, I was able to serve the html with og-image to crawlers, while serving agents and humans raw markdown on the very same URL. This is a trick I've also applied at https://uithub.com and many other websites.

Besides this, we need to make sure the og:image is ready, and as fast as possible, once the user shares the image on social media. I did this using the `ctx.waitUntil` primitive to actually preload the og:image generation, and then cache it, before the crawler goes there. Because the user hopefully already visited the link they shared, the crawler should get an image nearly instantly, because it's cached.

`getThread.ts:178`

```ts
// NB: This is only to pre-generate the og image so it's available quicker the second time
ctx.waitUntil(
  getOgImage(
    new Request(request.url.replace("/status/", "/og/")),
    env,
    ctx,
    true,
  ),
);
```

Last but not least, the `og:image` serving to different platforms is quite tricky. I've used the wonderful package [`workers-og`](https://github.com/kvnang/workers-og) to turn a piece of specialized HTML into an SVG and then into a PNG, all from a [Cloudflare Worker](https://workers.cloudflare.com). Also, I've previously built https://quickog.com to easily generate the right code to be used in vanilla HTML, and reused that here. As a result, the og:image shows up quite fast when going to any status URL.

That's about it! Now I've built an entire product in a long day of flowstate. I'm exhausted and excited. Time for some food. You may wonder if I used any AI? Of course! There's no such thing as this without AI. I don't use Cursor (yet), but I've used a combination of Claude Anthropic and Grok today for my code generation from natural language specification. Of course this would be impossible without. The project now contains ±40.000 tokens of code, but the amount of instructions I gave in natural language is probably well below that.

**So what's my vision for XYMake?**

I don't know about much about the legal aspect of it, and I'm sure it's gray area, but I strongly that people should have the right to own their own data. Elon advocates for Freedom of Speech, and I surely hope he'd also agree with the right to 'own your own data that is an outcome of freedom of speech'. X obviously uses our posts now to train Grok, and we, the people, should claim our right to our own conversations too. We can probably do much more cool things with it than just train Grok!

That said, I also feel some could be uncomfortable with sharing all their data into the intelligent world wide web. Maybe people don't want this at all and feel like X is a platform where their data is kept behind bars(Safely with Elon, Grok, and [@yacineMTB](https://x.com/yacineMTB)). That's why I decided for now to only allow accessing Markdown posts of users that "Freed their Data". Users that haven't enabled it, won't be exposed here, unless they're not the major contributor of a thread. But if the major contributor to any thread has unlocked their X data with XYMake, the entire public conversation is now public to the WWW.

I'm excited to share this on X now, and see what you guys have to say! I feel we can use our own posts for so much more than just within Grok, and this is just the first step to make anything possible!

# TODO

See how the launch goes!

# BACKLOG

- Index the totality of posts as well (and update this daily)
- Get the actual URLs of media and links
- Ensure Google indexes it too by adding sitemap
- Show your threads in the dashboard. To see more than Top 10 most recent, pay $20/month!
- `/janwilmake` should also be accessible for agents and respond with md,json,yaml file object for every thread
- Simple LLM Analysis for all your threads that allows for improved SEO, search, etc.
- Fix DO for data aggregation: Make it easier to debug what happens in the alarms with a special log function, then make the explorer able to easily switch between available DO names (use cf api)
