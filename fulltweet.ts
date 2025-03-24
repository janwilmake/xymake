// Define interfaces based on the OpenAPI schema
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

// Define the response structure for the worker
interface TweetHierarchy {
  tweet: Tweet;
  parents: Tweet[];
  comments: Tweet[];
}

// Environment variables (set in wrangler.toml or Cloudflare dashboard)
interface Env {
  SOCIALDATA_API_KEY: string;
}

const BASE_URL = "https://api.socialdata.tools";

// [Previous interface definitions remain unchanged]

interface CachedTweetData {
  timestamp: number;
  tweets: Tweet[];
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000; // One day in milliseconds
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60; // 30 days in seconds for TTL

// Fetch a single tweet by ID (unchanged)
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

// Fetch all comments for a tweet, handling pagination (unchanged)
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

// Fetch parent tweets recursively (unchanged)
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

// Updated Env interface to include KV namespace
interface Env {
  SOCIALDATA_API_KEY: string;
  TWEET_KV: KVNamespace;
}

// Main handler with KV caching
export const middleware = async (request: Request, env: Env) => {
  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/");

    if (pathParts.length < 4 || pathParts[2] !== "status") {
      return;
    }

    const tweetId = pathParts[3];

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

    // Check KV cache first
    const cachedData = await env.TWEET_KV.get<CachedTweetData>(tweetId, {
      type: "json",
    });

    const currentTime = Date.now();

    if (cachedData && cachedData.tweets.length > 0) {
      // Get the timestamp of the most recent tweet
      const latestTweetTime = Math.max(
        ...cachedData.tweets.map((t) => new Date(t.tweet_created_at).getTime()),
      );

      // Use cached data if the latest tweet is older than 24 hours
      if (currentTime - latestTweetTime > ONE_DAY_MS) {
        return new Response(JSON.stringify(cachedData.tweets, undefined, 2), {
          status: 200,
          headers: {
            "Content-Type": "application/json;charset=utf8",
            "X-Cache": "HIT",
          },
        });
      }
    }

    // If no valid cache, fetch fresh data
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

    await env.TWEET_KV.put(tweetId, JSON.stringify(cacheData), {
      expirationTtl: THIRTY_DAYS_SECONDS,
    });

    return new Response(JSON.stringify(allTweets, undefined, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json;charset=utf8",
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
