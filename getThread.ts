import { getOgImage } from "./getOgImage.js";
import { identify } from "./identify.js";
import { UserConfig } from "./xLoginMiddleware.js";
import html400 from "./public/400.html";

export const getThreadData = async (request: Request, env: Env) => {
  const url = new URL(request.url);
  const pathParts = url.pathname.split("/");

  if (pathParts.length < 4 || !["status", "og"].includes(pathParts[2])) {
    return;
  }

  // Split the last part to handle optional format
  const lastPart = pathParts[3];
  const [tweetId, formatExt] = lastPart.split(".");

  const storageFormat = formatExt === "json" ? "json" : "md";

  const allTweets = await getAllTweets(env, tweetId, storageFormat);
  const markdownContent = allTweets.tweets
    .map(formatTweetAsMarkdown)
    .join("\n\n");
  const totalTokens = Math.round(markdownContent.length / 5);

  // Count occurrences of each user
  const userOccurrences = new Map<string, number>();
  const userMap = new Map<string, User>();

  allTweets.tweets.forEach((tweet) => {
    const screenName = tweet.user.screen_name;
    userOccurrences.set(screenName, (userOccurrences.get(screenName) || 0) + 1);
    userMap.set(screenName, tweet.user);
  });

  // Sort users by occurrence count (descending)
  const sortedUsers = Array.from(userOccurrences.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([screenName]) => userMap.get(screenName)!);

  // Determine main user (author of the first tweet that isn't a reply or the most active user)
  let mainUser = null;
  for (const tweet of allTweets.tweets) {
    if (!tweet.in_reply_to_status_id_str) {
      mainUser = tweet.user;
      break;
    }
  }

  // If we couldn't find a non-reply tweet, use the most active user
  if (!mainUser && sortedUsers.length > 0) {
    mainUser = sortedUsers[0];
  }

  // Extract user screen names in order of frequency
  const userScreenNames = sortedUsers.map((user) => user.screen_name);

  // Create avatar URLs array in the same order as userScreenNames
  const avatarUrls = sortedUsers.map((user) => user.profile_image_url_https);

  // Generate participant text
  let participantsText = "";
  if (userScreenNames.length === 1) {
    participantsText = `@${userScreenNames[0]}`;
  } else if (userScreenNames.length <= 3) {
    // For 2-3 users, list all of them
    if (mainUser) {
      const otherUsers = userScreenNames.filter(
        (name) => name !== mainUser.screen_name,
      );
      participantsText = `@${mainUser.screen_name} and ${otherUsers
        .map((name) => `@${name}`)
        .join(", ")}`;
    } else {
      participantsText = userScreenNames.map((name) => `@${name}`).join(", ");
    }
  } else {
    // For more than 3 users, show main user and top 2 others, plus count of remaining
    const otherTopUsers = userScreenNames
      .filter((name) => name !== mainUser?.screen_name)
      .slice(0, 2);
    const remainingCount = userScreenNames.length - otherTopUsers.length - 1;
    participantsText = `@${mainUser?.screen_name}, ${otherTopUsers
      .map((name) => `@${name}`)
      .join(", ")} and ${remainingCount} others`;
  }

  // Generate title and description for SEO
  const firstTweet = allTweets.tweets.length > 0 ? allTweets.tweets[0] : null;
  const title = firstTweet
    ? `${participantsText} on X: "${firstTweet.full_text.substring(0, 60)}${
        firstTweet.full_text.length > 60 ? "..." : ""
      }"`
    : "X Thread";

  const description = firstTweet
    ? `X thread with ${
        allTweets.tweets.length
      } posts (${totalTokens} tokens) by ${participantsText}. "${firstTweet.full_text.substring(
        0,
        120,
      )}${firstTweet.full_text.length > 120 ? "..." : ""}"`
    : `X thread with ${allTweets.tweets.length} tweets (${totalTokens} tokens)`;

  const ogImageUrl = `${url.origin}/${pathParts[1]}/og/${tweetId}`;
  const threadData = {
    ogImageUrl,
    tweets: allTweets.tweets,
    userScreenNames,
    participantsText,
    mainUser,
    totalTokens,
    title,
    description,
    avatarUrls,
    "X-CACHE": allTweets["X-CACHE"],
  };
  return threadData;
};
// Main handler with format support
export const getThread = async (request: Request, env: Env, ctx: any) => {
  const { isBrowser } = identify(request);
  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/");

    if (pathParts.length < 4 || pathParts[2] !== "status") {
      return;
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

    const configUsername = await env.TWEET_KV.get<UserConfig>(
      `user:${username}`,
      "json",
    );

    if (configUsername?.privacy !== "public") {
      if (isBrowser) {
        return new Response(
          html400.replaceAll(`{{username}}`, username || "this user"),
          { headers: { "content-type": "text/html;charset=utf8" } },
        );
      }

      return new Response(
        `Bad request: @${username} did not free their data yet. Tell them to join the free data movement, or free your own data at https://xymake.com`,
        { status: 400 },
      );
    }

    // Load data if OK

    // Determine output format (default to .md if not specified)
    const threadData = await getThreadData(request, env);

    if (!threadData) {
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

    // Before sending data, ensure to first double check that the main contributor to the convo is has their data unlocked already

    const config = await env.TWEET_KV.get<UserConfig>(
      `user:${threadData.mainUser?.screen_name}`,
      "json",
    );

    if (config?.privacy !== "public") {
      if (isBrowser) {
        return new Response(
          html400.replaceAll(
            `{{username}}`,
            threadData.mainUser?.screen_name || "this user",
          ),
          { headers: { "content-type": "text/html;charset=utf8" } },
        );
      }

      return new Response(
        `Bad request: @${threadData.mainUser?.screen_name} did not free their data yet. Tell them to join the free data movement, or free your own data at https://xymake.com`,
        { status: 400 },
      );
    }

    const { isCrawler } = identify(request);
    const TEST_CRAWLER = false;
    const isHTML = TEST_CRAWLER || isCrawler || formatExt === "html";

    const responseBody = isHTML
      ? getThreadHtml(threadData)
      : storageFormat === "json"
      ? JSON.stringify(threadData.tweets, undefined, 2)
      : threadData.tweets.map(formatTweetAsMarkdown).join("\n\n");

    // NB: This is only to pre-generate the og image so it's available quicker the second time
    ctx.waitUntil(
      getOgImage(
        new Request(request.url.replace("/status/", "/og/")),
        env,
        ctx,
        true,
      ),
    );

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

interface ThreadData {
  tweets: Tweet[];
  userScreenNames: string[];
  participantsText: string;
  mainUser: User | null;
  totalTokens: number;
  title: string;
  description: string;
  avatarUrls: string[];
  ogImageUrl: string;
}

const getThreadHtml = (threadData: ThreadData): string => {
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
<meta property="og:url" content="https://producthunt.com" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description}" />
<meta property="og:image" content="${ogImageUrl}" />
<meta property="og:image:alt" content="${description}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>

<!-- Twitter Meta Tags -->
<meta name="twitter:card" content="summary_large_image" />
<meta property="twitter:domain" content="producthunt.com" />
<meta property="twitter:url" content="https://producthunt.com" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${description}" />
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

// [Previous interface definitions remain unchanged]
interface Tweet {
  id_str: string;
  full_text: string;
  tweet_created_at: string;
  source: string;
  truncated: boolean;
  in_reply_to_status_id_str: string | null;
  in_reply_to_user_id_str: string | null;
  in_reply_to_screen_name: string | null;
  user: User;
  lang: string;
  quoted_status_id_str: string | null;
  is_quote_status: boolean;
  is_pinned: boolean;
  quote_count: number;
  reply_count: number;
  retweet_count: number;
  favorite_count: number;
  views_count: number;
  bookmark_count: number;
  quoted_status?: Tweet | null;
  retweeted_status?: Tweet | null;
  entities: TweetEntities;
}

interface User {
  id_str: string;
  name: string;
  screen_name: string;
  location: string;
  description: string;
  url?: string | null;
  protected: boolean;
  verified: boolean;
  followers_count: number;
  friends_count: number;
  listed_count: number;
  favourites_count: number;
  statuses_count: number;
  created_at: string;
  profile_banner_url: string;
  profile_image_url_https: string;
  can_dm: boolean | null;
}

interface TweetEntities {
  urls: UrlEntity[];
  user_mentions: UserMentionEntity[];
  hashtags: HashtagEntity[];
  symbols: SymbolEntity[];
  media?: MediaEntity[];
  poll?: PollEntity;
}

interface UrlEntity {
  url: string;
  expanded_url: string;
  display_url: string;
  indices: number[];
}

interface UserMentionEntity {
  id_str: string;
  name: string;
  screen_name: string;
  indices: number[];
}

interface HashtagEntity {
  text: string;
  indices: number[];
}

interface SymbolEntity {
  text: string;
  indices: number[];
}

interface MediaEntity {
  id_str: string;
  media_url_https: string;
  url: string;
  display_url: string;
  expanded_url: string;
  type: "photo" | "video" | "animated_gif";
  indices: number[];
}

interface PollEntity {
  end_datetime: string;
  duration_minutes: number;
  counts_are_final: boolean;
  choices: PollChoice[];
}

interface PollChoice {
  label: string;
  count: number;
}

interface TweetsResponse {
  next_cursor: string | null;
  tweets: Tweet[];
}

interface ErrorResponse {
  status: "error";
  message: string;
}

interface TweetHierarchy {
  tweet: Tweet;
  parents: Tweet[];
  comments: Tweet[];
}

interface Env {
  SOCIALDATA_API_KEY: string;
  TWEET_KV: KVNamespace;
}

const BASE_URL = "https://api.socialdata.tools";

interface CachedTweetData {
  timestamp: number;
  tweets: Tweet[];
  "X-CACHE": "HIT" | "MISS";
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

// Fetch a single tweet by ID
async function fetchTweet(tweetId: string, apiKey: string): Promise<Tweet> {
  const response = await fetch(`${BASE_URL}/twitter/tweets/${tweetId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const error: ErrorResponse = await response.json();
    throw new Error(`Failed to fetch tweet ${tweetId}: ${error.message}`);
  }

  return response.json();
}

// Fetch all comments for a tweet
async function fetchAllComments(
  tweetId: string,
  apiKey: string,
): Promise<Tweet[]> {
  let comments: Tweet[] = [];
  let cursor: string | null = null;

  do {
    const url = `${BASE_URL}/twitter/tweets/${tweetId}/comments${
      cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""
    }`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const error: ErrorResponse = await response.json();
      throw new Error(
        `Failed to fetch comments for tweet ${tweetId}: ${error.message}`,
      );
    }

    const data: TweetsResponse = await response.json();
    comments = comments.concat(data.tweets);
    cursor = data.next_cursor;
  } while (cursor);

  return comments;
}

// Fetch parent tweets recursively
async function fetchParentTweets(
  tweet: Tweet,
  apiKey: string,
  seenIds: Set<string> = new Set(),
): Promise<Tweet[]> {
  const parents: Tweet[] = [];
  seenIds.add(tweet.id_str);

  if (tweet.quoted_status_id_str && !seenIds.has(tweet.quoted_status_id_str)) {
    const quotedTweet = await fetchTweet(tweet.quoted_status_id_str, apiKey);
    parents.push(quotedTweet);
    const nestedParents = await fetchParentTweets(quotedTweet, apiKey, seenIds);
    parents.push(...nestedParents);
  }

  if (
    tweet.in_reply_to_status_id_str &&
    !seenIds.has(tweet.in_reply_to_status_id_str)
  ) {
    const replyParent = await fetchTweet(
      tweet.in_reply_to_status_id_str,
      apiKey,
    );
    parents.push(replyParent);
    const nestedParents = await fetchParentTweets(replyParent, apiKey, seenIds);
    parents.push(...nestedParents);
  }

  return parents;
}

// Format tweet as Markdown
function formatTweetAsMarkdown(tweet: Tweet): string {
  const date = new Date(tweet.tweet_created_at).toLocaleString();
  let markdown = `@${tweet.user.screen_name} - ${date}: ${tweet.full_text}`;

  // Add engagement stats if present
  const stats = [];
  if (tweet.favorite_count > 0) stats.push(`${tweet.favorite_count} likes`);
  if (tweet.retweet_count > 0) stats.push(`${tweet.retweet_count} retweets`);
  if (stats.length > 0) {
    markdown += `\n(${stats.join(", ")})`;
  }

  return markdown;
}

const getAllTweets = async (env: Env, tweetId: string, format: string) => {
  // Check KV cache first
  const cacheKey = `v2.${tweetId}.${format}`;
  const cachedData = await env.TWEET_KV.get<CachedTweetData>(cacheKey, {
    type: "json",
  });

  const currentTime = Date.now();

  if (cachedData && cachedData.tweets.length > 0) {
    const latestTweetTime = Math.max(
      ...cachedData.tweets.map((t) => new Date(t.tweet_created_at).getTime()),
    );

    if (currentTime - latestTweetTime > ONE_DAY_MS) {
      return cachedData;
    }

    if (currentTime - cachedData.timestamp < 3600000) {
      return cachedData;
    }
  }

  // Fetch fresh data
  const [mainTweet, comments] = await Promise.all([
    fetchTweet(tweetId, env.SOCIALDATA_API_KEY),
    fetchAllComments(tweetId, env.SOCIALDATA_API_KEY),
  ]);

  const parents = await fetchParentTweets(mainTweet, env.SOCIALDATA_API_KEY);
  const allTweets: Tweet[] = [mainTweet, ...parents, ...comments];

  allTweets.sort((a, b) => {
    const dateA = new Date(a.tweet_created_at).getTime();
    const dateB = new Date(b.tweet_created_at).getTime();
    if (dateA !== dateB) {
      return dateA - dateB; // Sort by timestamp first
    } else {
      const idA = BigInt(a.id_str);
      const idB = BigInt(b.id_str);
      return idA < idB ? -1 : idA > idB ? 1 : 0; // Use tweet ID if timestamps are equal
    }
  });

  // Store in KV with 30-day TTL
  const cacheData: CachedTweetData = {
    timestamp: currentTime,
    tweets: allTweets,
    "X-CACHE": "HIT",
  };

  await env.TWEET_KV.put(cacheKey, JSON.stringify(cacheData), {
    expirationTtl: THIRTY_DAYS_SECONDS,
  });

  return { ...cacheData, "X-CACHE": "MISS" };
};
