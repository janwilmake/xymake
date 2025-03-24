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
