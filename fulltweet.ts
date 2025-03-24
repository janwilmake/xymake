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

// Main handler with format support
export const middleware = async (request: Request, env: Env) => {
  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/");

    if (pathParts.length < 4 || pathParts[2] !== "status") {
      return;
    }

    // Split the last part to handle optional format
    const lastPart = pathParts[3];
    const [tweetId, formatExt] = lastPart.split(".");

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

    // Determine output format (default to .md if not specified)
    const format = formatExt === "json" ? "json" : "md";

    // Check KV cache first
    const cacheKey = `${tweetId}.${format}`;
    const cachedData = await env.TWEET_KV.get<CachedTweetData>(cacheKey, {
      type: "json",
    });

    const currentTime = Date.now();

    if (cachedData && cachedData.tweets.length > 0) {
      const latestTweetTime = Math.max(
        ...cachedData.tweets.map((t) => new Date(t.tweet_created_at).getTime()),
      );

      if (currentTime - latestTweetTime > ONE_DAY_MS) {
        return new Response(
          format === "json"
            ? JSON.stringify(cachedData.tweets, undefined, 2)
            : cachedData.tweets.map(formatTweetAsMarkdown).join("\n\n"),
          {
            status: 200,
            headers: {
              "Content-Type":
                format === "json"
                  ? "application/json;charset=utf8"
                  : "text/markdown;charset=utf8",
              "X-Cache": "HIT",
            },
          },
        );
      }

      if (currentTime - latestTweetTime < 3600000) {
        return new Response(
          format === "json"
            ? JSON.stringify(cachedData.tweets, undefined, 2)
            : cachedData.tweets.map(formatTweetAsMarkdown).join("\n\n"),
          {
            status: 200,
            headers: {
              "Content-Type":
                format === "json"
                  ? "application/json;charset=utf8"
                  : "text/markdown;charset=utf8",
              "X-Cache": "HIT",
            },
          },
        );
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
      const dateA = new Date(a.tweet_created_at);
      const dateB = new Date(b.tweet_created_at);
      return dateA.getTime() - dateB.getTime();
    });

    // Store in KV with 30-day TTL
    const cacheData: CachedTweetData = {
      timestamp: currentTime,
      tweets: allTweets,
    };

    await env.TWEET_KV.put(cacheKey, JSON.stringify(cacheData), {
      expirationTtl: THIRTY_DAYS_SECONDS,
    });

    // Return response based on format
    const responseBody =
      format === "json"
        ? JSON.stringify(allTweets, undefined, 2)
        : allTweets.map(formatTweetAsMarkdown).join("\n\n");

    return new Response(responseBody, {
      status: 200,
      headers: {
        "Content-Type":
          format === "json"
            ? "application/json;charset=utf8"
            : "text/markdown;charset=utf8",
        "X-Cache": "MISS",
      },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
