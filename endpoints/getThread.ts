import { getOgImage } from "../getOgImage.js";
import { identify } from "../identify.js";
import { Env, UserState } from "../xLoginMiddleware.js";
import html400 from "../public/400.html";
import {
  formatTweetAsMarkdown,
  getThreadData,
  ThreadData,
  Tweet,
} from "../getThreadData.js";

// Main handler with format support
export const getThread = async (
  request: Request,
  env: Env,
  ctx: any,
): Promise<Response> => {
  const { isBrowser, isAgent, isCrawler } = identify(request);
  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/");

    if (pathParts.length < 4 || pathParts[2] !== "status") {
      return new Response("Usage /username/status/id[.json]");
    }

    // Split the last part to handle optional format
    const username = pathParts[1];
    const lastPart = pathParts[3];
    const [tweetId, formatExt] = lastPart.split(".");
    const storageFormat = formatExt === "json" ? "json" : "md";

    if (!/^\d+$/.test(tweetId)) {
      return new Response(
        JSON.stringify({
          status: "error",
          message: "Tweet ID must be numeric",
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }

    //1) First check on the username

    // NB: THis could make things cheaper, but would not scrape for unauthorized accounts!
    const userState = await env.TWEET_KV.get<UserState>(
      `user:${username}`,
      "json",
    );

    const isPublic = userState?.privacy === "public";

    // if (configUsername?.privacy !== "public") {
    //   if (isBrowser) {
    //     return new Response(
    //       html400.replaceAll(`{{username}}`, username || "this user"),
    //       { headers: { "content-type": "text/html;charset=utf8" } },
    //     );
    //   }

    //   return new Response(
    //     `Bad request: @${username} did not free their data yet. Tell them to join the free data movement, or free your own data at https://xymake.com`,
    //     { status: 400 },
    //   );
    // }

    // Load data if OK

    // Determine output format (default to .md if not specified)
    const threadData = await getThreadData(request, env, ctx, isPublic);

    if (!threadData) {
      return new Response(
        JSON.stringify({
          status: "error",
          message:
            "Could not retrieve thread data. Be aware: Tweet ID must be numeric",
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }

    // get this already to pass a part of it to the 400 page
    const jsonOrMarkdownString =
      storageFormat === "json"
        ? JSON.stringify(threadData.tweets, undefined, 2)
        : threadData.tweets.map(formatTweetAsMarkdown).join("\n\n") + "\n\n";

    // Before sending data, ensure to first double check that the main contributor to the convo is has their data unlocked already

    const authorConfig = await env.TWEET_KV.get<UserState>(
      `user:${threadData.authorUser?.screen_name}`,
      "json",
    );
    const topConfig = await env.TWEET_KV.get<UserState>(
      `user:${threadData.topUser?.screen_name}`,
      "json",
    );

    // NB: This is only to pre-generate the og image so it's available quicker the second time
    ctx.waitUntil(
      getOgImage(
        new Request(request.url.replace("/status/", "/og/")),
        env,
        ctx,
        true,
      ),
    );

    if (authorConfig?.privacy !== "public" && topConfig?.privacy !== "public") {
      // preview of the data
      const preview = jsonOrMarkdownString.slice(
        0,
        // either max 240/120 tokens, or half. whatever smaller
        Math.min(
          storageFormat === "json" ? 240 : 480,
          Math.round(jsonOrMarkdownString.length / 2),
        ),
      );

      // Not public yet.
      const author = threadData.authorUser?.screen_name;

      if (isBrowser || isCrawler) {
        const { title, description, ogImageUrl } = threadData;

        return new Response(
          html400
            .replaceAll(`{{username}}`, author || "this user")
            .replaceAll(`{{title}}`, title)
            .replaceAll(`{{postCount}}`, String(threadData.postCount || 0))
            .replaceAll(`{{totalTokens}}`, String(threadData.totalTokens || 0))
            .replace(
              "</head>",
              `
            <meta name="description" content="${description}" />
            <meta name="robots" content="index, follow" />
            
            <!-- Facebook Meta Tags -->
            <meta property="og:url" content="${request.url}" />
            <meta property="og:type" content="website" />
            <meta property="og:title" content="${title.slice(0, 70)}" />
            <meta property="og:description" content="${description}" />
            <meta property="og:image" content="${ogImageUrl}" />
            <meta property="og:image:alt" content="${description}"/>
            <meta property="og:image:width" content="1200"/>
            <meta property="og:image:height" content="630"/>
            
            <!-- Twitter Meta Tags -->
            <meta name="twitter:card" content="summary_large_image" />
            <meta property="twitter:url" content="${request.url}" />
            <meta name="twitter:description" content="${description}" />
            <meta name="twitter:title" content="${title.slice(0, 70)}" />
            <meta name="twitter:image" content="${ogImageUrl}" />

            <script>
window.preview = \`${preview}\`;
            </script>
            </head>
             `,
            ),
          { headers: { "content-type": "text/html;charset=utf8" } },
        );
      }

      return new Response(
        `Bad request: @${author} did not free their data yet. Tell them to join the free data movement, or free your own data at https://xymake.com`,
        { status: 400 },
      );
    }

    const TEST_CRAWLER = false;
    const isHTML = TEST_CRAWLER || isCrawler || formatExt === "html";

    const responseBody = isHTML
      ? getThreadHtml(threadData, request.url)
      : jsonOrMarkdownString;

    return new Response(responseBody, {
      status: 200,
      headers: {
        "Content-Type": isHTML
          ? "text/html;charset=utf8"
          : storageFormat === "json"
          ? "application/json;charset=utf8"
          : "text/markdown;charset=utf8",
        "X-Cache": threadData["X-CACHE"],
      },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

const getThreadHtml = (threadData: ThreadData, requestUrl: string): string => {
  const {
    tweets,
    participantsText,
    totalTokens,
    title,
    description,
    ogImageUrl,
  } = threadData;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${description}" />
<meta name="robots" content="index, follow" />

<!-- Facebook Meta Tags -->
<meta property="og:url" content="${requestUrl}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${title.slice(0, 70)}" />
<meta property="og:description" content="${description}" />
<meta property="og:image" content="${ogImageUrl}" />
<meta property="og:image:alt" content="${description}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>

<!-- Twitter Meta Tags -->
<meta name="twitter:card" content="summary_large_image" />
<meta property="twitter:domain" content="https://xymake.com" />
<meta property="twitter:url" content="${requestUrl}" />
<meta name="twitter:description" content="${description}" />
<meta name="twitter:title" content="${title.slice(0, 70)}" />
<meta name="twitter:image" content="${ogImageUrl}" />
 
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    .tweet-text a { color: #1DA1F2; text-decoration: none; }
    .tweet-text a:hover { text-decoration: underline; }
  </style>
</head>
<body class="bg-gray-100 min-h-screen">
  <div class="max-w-2xl mx-auto my-8 bg-white rounded-lg shadow">
    <div class="p-4 border-b border-gray-200">
      <h1 class="text-xl font-bold">X Thread</h1>
      <p class="text-gray-600">
        ${tweets.length} tweets (${totalTokens} tokens) by ${participantsText}
      </p>
    </div>
    <div class="thread-container divide-y divide-gray-200">
      ${tweets.map((tweet) => renderTweet(tweet, tweets)).join("")}
    </div>
  </div>
</body>
</html>
  `;
};

const renderTweet = (tweet: Tweet, allTweets: Tweet[]): string => {
  // Format the tweet date
  const tweetDate = new Date(tweet.tweet_created_at);
  const formattedDate = tweetDate.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const formattedTime = tweetDate.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  // Process tweet text to add links, mentions, hashtags
  let tweetText = tweet.full_text;

  // Replace URLs
  if (tweet.entities.urls) {
    tweet.entities.urls.forEach((url) => {
      tweetText = tweetText.replace(
        url.url,
        `<a href="${url.expanded_url}" target="_blank" rel="noopener">${url.display_url}</a>`,
      );
    });
  }

  // Replace @mentions
  if (tweet.entities.user_mentions) {
    tweet.entities.user_mentions.forEach((mention) => {
      const mentionRegex = new RegExp(`@${mention.screen_name}`, "gi");
      tweetText = tweetText.replace(
        mentionRegex,
        `<a href="https://twitter.com/${mention.screen_name}" target="_blank">@${mention.screen_name}</a>`,
      );
    });
  }

  // Replace #hashtags
  if (tweet.entities.hashtags) {
    tweet.entities.hashtags.forEach((hashtag) => {
      const hashtagRegex = new RegExp(`#${hashtag.text}`, "gi");
      tweetText = tweetText.replace(
        hashtagRegex,
        `<a href="https://twitter.com/hashtag/${hashtag.text}" target="_blank">#${hashtag.text}</a>`,
      );
    });
  }

  // Add line breaks
  tweetText = tweetText.replace(/\n/g, "<br>");

  // Determine if this is a reply
  const isReply = tweet.in_reply_to_status_id_str !== null;
  const replyingTo = isReply
    ? allTweets.find((t) => t.id_str === tweet.in_reply_to_status_id_str)?.user
        .screen_name
    : null;

  // Generate reply line if needed
  const replyLine = replyingTo
    ? `<div class="text-gray-500 text-sm mb-1">Replying to <a href="https://twitter.com/${replyingTo}" class="text-blue-500">@${replyingTo}</a></div>`
    : "";

  // Media handling
  const mediaHtml = tweet.entities.media
    ? `<div class="mt-2 rounded-lg overflow-hidden border border-gray-200">
      ${tweet.entities.media
        .map((media) => {
          if (media.type === "photo") {
            return `<img src="${media.media_url_https}" alt="Tweet media" class="w-full h-auto" />`;
          }
          return `<div class="bg-gray-200 w-full h-48 flex items-center justify-center">
          <span class="text-gray-600">${media.type} media</span>
        </div>`;
        })
        .join("")}
    </div>`
    : "";

  // Quote tweet handling
  const quoteTweetHtml = tweet.quoted_status
    ? `<div class="mt-2 border border-gray-200 rounded-lg p-3 bg-gray-50">
      <div class="flex items-center mb-1">
        <img src="${tweet.quoted_status.user.profile_image_url_https}" alt="${tweet.quoted_status.user.name}" class="w-5 h-5 rounded-full mr-2">
        <span class="font-bold text-sm">${tweet.quoted_status.user.name}</span>
        <span class="text-gray-500 text-sm ml-1">@${tweet.quoted_status.user.screen_name}</span>
      </div>
      <div class="text-sm">${tweet.quoted_status.full_text}</div>
    </div>`
    : "";

  // Poll rendering if present
  const pollHtml = tweet.entities.poll
    ? `<div class="mt-2 border border-gray-200 rounded-lg p-3">
      ${tweet.entities.poll.choices
        .map((choice) => {
          const percentage = (
            (choice.count /
              tweet.entities.poll!.choices.reduce(
                (sum, c) => sum + c.count,
                0,
              )) *
            100
          ).toFixed(1);
          return `
          <div class="mb-2">
            <div class="flex justify-between text-sm mb-1">
              <span>${choice.label}</span>
              <span>${percentage}%</span>
            </div>
            <div class="w-full bg-gray-200 rounded-full h-2">
              <div class="bg-blue-500 rounded-full h-2" style="width: ${percentage}%"></div>
            </div>
          </div>
        `;
        })
        .join("")}
      <div class="text-gray-500 text-xs mt-2">
        ${
          tweet.entities.poll.counts_are_final
            ? "Final results"
            : "Poll in progress"
        } · 
        ${tweet.entities.poll.duration_minutes} minutes
      </div>
    </div>`
    : "";

  // Engagement stats
  const engagementHtml = `
    <div class="flex mt-3 text-gray-500 text-sm">
      <div class="mr-4">
        <span>${tweet.reply_count}</span>
        <span class="ml-1">Replies</span>
      </div>
      <div class="mr-4">
        <span>${tweet.retweet_count}</span>
        <span class="ml-1">Retweets</span>
      </div>
      <div class="mr-4">
        <span>${tweet.favorite_count}</span>
        <span class="ml-1">Likes</span>
      </div>
      <div>
        <span>${tweet.views_count || "–"}</span>
        <span class="ml-1">Views</span>
      </div>
    </div>
  `;

  return `
    <div class="tweet p-4 ${isReply ? "pl-8 border-l-4 border-gray-100" : ""}">
      <div class="flex">
        <div class="flex-shrink-0 mr-3">
          <img src="${tweet.user.profile_image_url_https}" alt="${
    tweet.user.name
  }" class="w-10 h-10 rounded-full">
        </div>
        <div class="flex-grow">
          <div class="flex items-center mb-1">
            <span class="font-bold">${tweet.user.name}</span>
            ${
              tweet.user.verified
                ? '<svg class="w-4 h-4 ml-1 text-blue-500" viewBox="0 0 24 24" fill="currentColor"><path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.415-.165-.866-.25-1.336-.25-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.335-.25.62 1.334 1.926 2.25 3.437 2.25 1.512 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.513 1.158-.687 1.943-1.99 1.943-3.484zm-6.616-3.334l-4.334 6.5c-.145.217-.382.334-.625.334-.143 0-.288-.04-.416-.126l-.115-.094-2.415-2.415c-.293-.293-.293-.768 0-1.06s.768-.294 1.06 0l1.77 1.767 3.825-5.74c.23-.345.696-.436 1.04-.207.346.23.44.696.21 1.04z"></path></svg>'
                : ""
            }
            <span class="text-gray-500 ml-1">@${tweet.user.screen_name}</span>
            <span class="text-gray-500 mx-1">·</span>
            <span class="text-gray-500" title="${formattedDate} ${formattedTime}">${formattedDate}</span>
          </div>
          ${replyLine}
          <div class="tweet-text mb-2">
            ${tweetText}
          </div>
          ${mediaHtml}
          ${quoteTweetHtml}
          ${pollHtml}
          ${engagementHtml}
        </div>
      </div>
    </div>
  `;
};
