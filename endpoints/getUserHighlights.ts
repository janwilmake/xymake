import { Env } from "../xLoginMiddleware.js";
import { getFormat } from "../getFormat.js";
import { stringify } from "yaml";

interface UserConfig {
  privacy: string;
  updatedAt?: string;
}

interface HighlightsData {
  urls: string[];
  updatedAt: string;
}

export async function getUserHighlights(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter((s) => s);
  const username = segments[0];
  const format = getFormat(request);

  // First, check if user is public
  const userConfig = await env.TWEET_KV.get<UserConfig>(
    `user:${username}`,
    "json",
  );

  if (
    userConfig?.privacy !== "public" &&
    // for testing
    username !== "janwilmake"
  ) {
    return new Response(
      JSON.stringify({
        error: "This account's highlights are not available",
        reason: "User profile is not public or doesn't exist",
      }),
      {
        status: 403,
        headers: { "content-type": "application/json" },
      },
    );
  }

  // Check if we have cached highlights data
  const cachedHighlights = await env.TWEET_KV.get<HighlightsData>(
    `v2-highlights:${username}`,
    "json",
  );

  let urls: string[] = [];
  const now = new Date().toISOString();
  let lastUpdatedAt = cachedHighlights?.updatedAt || null;

  // Fetch from Twitter API
  try {
    // If we have cached data, we'll use it as a base
    if (cachedHighlights) {
      urls = cachedHighlights.urls;
    }

    // Fetch all pages of highlights from Twitter API
    const newTweets = await fetchAllHighlights(env, username, lastUpdatedAt);

    if (newTweets.length > 0) {
      // Merge with existing tweets, removing duplicates
      const allTweetIds = new Set(urls.map((t) => t.split("/").pop()));
      for (const tweet of newTweets) {
        if (!allTweetIds.has(tweet.id_str)) {
          urls.push(`https://xymake.com/${username}/status/${tweet.id_str}`);
        }
      }
    }

    // Store updated highlights in KV
    const highlightsData: HighlightsData = {
      urls,
      updatedAt: now,
    };

    await env.TWEET_KV.put(
      `v2-highlights:${username}`,
      JSON.stringify(highlightsData),
    );

    // Return response based on format
    if (format === "text/yaml") {
      return new Response(stringify(highlightsData), {
        headers: { "content-type": "text/yaml" },
      });
    } else if (format === "application/json") {
      return new Response(JSON.stringify(highlightsData, null, 2), {
        headers: { "content-type": "application/json" },
      });
    } else {
      return new Response(highlightsData.urls.join("\n"), {
        headers: { "content-type": "text/markdown" },
      });
    }
  } catch (error: any) {
    console.error(`Error fetching highlights for ${username}:`, error);
    return new Response(
      JSON.stringify({
        error: "Failed to fetch user highlights",
        message: error.message,
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
}

/**
 * Fetch all highlighted tweets for a user by paginating through all available pages
 */
async function fetchAllHighlights(
  env: Env,
  username: string,
  lastUpdatedAt: string | null,
): Promise<any[]> {
  let allTweets: any[] = [];
  let cursor: string | null = null;
  let hasMorePages = true;

  try {
    // Get user ID from username first
    const userProfile = await fetchUserProfile(env, username);
    if (!userProfile || !userProfile.id_str) {
      throw new Error("User not found or ID not available");
    }

    const userId = userProfile.id_str;

    // Continue fetching pages until we reach the end or find tweets older than our last update
    while (hasMorePages) {
      const apiEndpoint = buildApiEndpoint(env, userId, cursor);
      const response = await fetch(apiEndpoint, {
        headers: {
          Authorization: `Bearer ${env.SOCIALDATA_API_KEY}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`API responded with status ${response.status}`);
      }

      const data: any = await response.json();

      // If we have no tweets or next_cursor, we're done
      if (!data.tweets || data.tweets.length === 0) {
        hasMorePages = false;
        break;
      }

      // If we have a lastUpdatedAt date, check if we've reached tweets older than that
      if (lastUpdatedAt) {
        const oldestTweetInBatch = data.tweets[data.tweets.length - 1];
        if (
          new Date(oldestTweetInBatch.tweet_created_at) <=
          new Date(lastUpdatedAt)
        ) {
          // Only add tweets newer than our last update
          const newTweets = data.tweets.filter(
            (t: any) => new Date(t.tweet_created_at) > new Date(lastUpdatedAt),
          );
          allTweets = [...allTweets, ...newTweets];
          hasMorePages = false;
          break;
        }
      }

      // Add all tweets from this page
      allTweets = [...allTweets, ...data.tweets];

      // Set cursor for next page
      cursor = data.next_cursor;
      if (!cursor || cursor === "") {
        hasMorePages = false;
      }
    }

    return allTweets;
  } catch (error) {
    console.error("Error in fetchAllHighlights:", error);
    throw error;
  }
}

/**
 * Fetch user profile to get user ID
 */
async function fetchUserProfile(env: Env, username: string): Promise<any> {
  try {
    const response = await fetch(
      `https://api.socialdata.tools/twitter/user/${username}`,
      {
        headers: {
          Authorization: `Bearer ${env.SOCIALDATA_API_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch user profile: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Error fetching user profile for ${username}:`, error);
    throw error;
  }
}

/**
 * Build the API endpoint URL for highlights
 */
function buildApiEndpoint(
  env: Env,
  userId: string,
  cursor: string | null,
): string {
  const baseUrl = `https://api.socialdata.tools/twitter/user/${userId}/highlights`;

  if (cursor) {
    return `${baseUrl}?cursor=${encodeURIComponent(cursor)}`;
  }

  return baseUrl;
}
