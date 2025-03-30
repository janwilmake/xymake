import { Env, UserState } from "../xLoginMiddleware.js";

// SocialData API interface types
interface Tweet {
  id_str: string;
  full_text: string;
  tweet_created_at: string;
  source?: string;
  truncated?: boolean;
  in_reply_to_status_id_str: string | null;
  in_reply_to_user_id_str?: string | null;
  in_reply_to_screen_name?: string | null;
  user: User;
  lang?: string;
  quoted_status_id_str?: string | null;
  is_quote_status?: boolean;
  is_pinned?: boolean;
  quote_count?: number;
  reply_count?: number;
  retweet_count?: number;
  favorite_count?: number;
  views_count?: number;
  bookmark_count?: number;
  quoted_status?: Tweet | null;
  retweeted_status?: Tweet | null;
  entities?: TweetEntities;
}

interface User {
  id_str: string;
  name: string;
  screen_name: string;
  location?: string;
  description?: string;
  url?: string | null;
  protected?: boolean;
  verified?: boolean;
  followers_count?: number;
  friends_count?: number;
  listed_count?: number;
  favourites_count?: number;
  statuses_count?: number;
  created_at?: string;
  profile_banner_url?: string;
  profile_image_url_https: string;
  can_dm?: boolean | null;
}

interface TweetEntities {
  urls?: UrlEntity[];
  user_mentions?: UserMentionEntity[];
  hashtags?: HashtagEntity[];
  symbols?: SymbolEntity[];
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

interface DateResult {
  username: string;
  date: string;
  post_count: number;
  statusIds: string[];
}

interface GetPostsResult {
  username: string;
  dateResults: DateResult[];
  start: string;
  end: string;
}

/**
 * Gets posts for a username within a date range
 */
export async function getPostsWithReplies(
  env: Env,
  ctx: ExecutionContext,
  username: string,
  start?: string,
  end?: string,
): Promise<GetPostsResult> {
  // Get dates to process
  const dates = getDateRange(start, end);

  if (dates.length > 30) {
    throw new Error("Date range exceeds maximum of 30 days");
  }

  const authorConfig = await env.TWEET_KV.get<UserState>(
    `user:${username}`,
    "json",
  );

  if (authorConfig?.privacy !== "public" && username !== "janwilmake") {
    throw new Error("Author did not authorize this!");
  }

  const dateResults: DateResult[] = [];

  // Process each date independently
  for (const date of dates) {
    const formattedDate = date.toISOString().split("T")[0];
    let dateResult: DateResult;

    // Check cache first
    if (env.TWEET_KV) {
      const cacheKey = `date-v4:${username}:${formattedDate}`;
      const cachedData = await env.TWEET_KV.get(cacheKey, {
        type: "json",
      });

      if (cachedData) {
        dateResults.push(cachedData as DateResult);
        continue;
      }
    }

    // Fetch from API if not cached
    const nextDate = new Date(date);
    nextDate.setDate(date.getDate() + 1);
    const formattedNextDate = nextDate.toISOString().split("T")[0];

    const tweets = await fetchTweets(
      username,
      formattedDate,
      formattedNextDate,
      env.SOCIALDATA_API_KEY,
    );

    dateResult = {
      username,
      date: formattedDate,
      post_count: tweets.length,
      statusIds: tweets.map((x) => x.id_str),
    };

    // Cache the result
    if (env.TWEET_KV) {
      const cacheKey = `date-v4:${username}:${formattedDate}`;
      const isToday = isCurrentDate(date);

      // Cache with different expiration based on if it's today or not
      if (ctx) {
        ctx.waitUntil(
          env.TWEET_KV.put(
            cacheKey,
            JSON.stringify(dateResult),
            isToday ? { expirationTtl: 86400 } : undefined, // 24 hours for today, unlimited for past dates
          ),
        );
      } else {
        await env.TWEET_KV.put(
          cacheKey,
          JSON.stringify(dateResult),
          isToday ? { expirationTtl: 86400 } : undefined,
        );
      }
    }

    dateResults.push(dateResult);
  }

  return {
    start: dates[0].toISOString().split("T")[0],
    end: dates.pop()!.toISOString().split("T")[0],
    username,
    dateResults,
  };
}

/**
 * Fetch tweets from the SocialData API for a specific date range
 */
async function fetchTweets(
  username: string,
  sinceDate: string,
  untilDate: string,
  apiKey: string,
): Promise<Tweet[]> {
  const query = `from:${username} -to:${username} since:${sinceDate} until:${untilDate}`;
  let allTweets: Tweet[] = [];
  let cursor: string | null = null;

  do {
    const searchParams = new URLSearchParams({
      query,
      type: "Latest",
    });

    if (cursor) {
      searchParams.append("cursor", cursor);
    }

    const requestUrl = `https://api.socialdata.tools/twitter/search?${searchParams.toString()}`;

    const response = await fetch(requestUrl, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = (await response.json()) as ErrorResponse;
      throw new Error(
        `SocialData API error: ${errorData.message || response.statusText}`,
      );
    }

    const data = (await response.json()) as TweetsResponse;
    allTweets = allTweets.concat(data.tweets);
    cursor = data.next_cursor || null;

    if (cursor) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  } while (cursor);

  return allTweets;
}

/**
 * Generate an array of dates based on start and end dates
 * If no dates provided, returns last 7 days
 */
function getDateRange(startDate?: string, endDate?: string): Date[] {
  const end = endDate ? new Date(endDate) : new Date();
  end.setHours(0, 0, 0, 0);

  let start: Date;
  if (startDate) {
    start = new Date(startDate);
  } else {
    // Default to last 7 days if no date range is specified
    start = new Date(end);
    start.setDate(end.getDate() - 6); // 7 days including today
  }
  start.setHours(0, 0, 0, 0);

  // Validate dates
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error("Invalid date format. Use YYYY-MM-DD.");
  }

  if (start > end) {
    throw new Error("Start date must be before or equal to end date");
  }

  const dates: Date[] = [];
  const current = new Date(start);

  while (current <= end) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

/**
 * Check if a date is the current date
 */
function isCurrentDate(date: Date): boolean {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}
