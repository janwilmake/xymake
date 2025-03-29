import { Env } from "./xLoginMiddleware.js";

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

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const segments = url.pathname.split("/").slice(1);

    const username = segments[0];
    const date = segments[2];
    if (!date) {
      return new Response(
        "Invalid path. For now, posts is only when date is given",
      );
    }

    try {
      if (env.TWEET_KV) {
        const cacheKey = `date-v4:${username}:${date}`;
        const cachedData = await env.TWEET_KV.get(cacheKey, {
          type: "json",
        });

        if (cachedData) {
          return new Response(JSON.stringify(cachedData, undefined, 2), {
            headers: {
              "Content-Type": "application/json;charset=utf8",
              "X-Cache": "HIT",
            },
          });
        }
      }

      const dateObj = new Date(date);
      const nextDateObj = new Date(dateObj);
      nextDateObj.setDate(dateObj.getDate() + 1);

      const formattedDate = dateObj.toISOString().split("T")[0];
      const formattedNextDate = nextDateObj.toISOString().split("T")[0];

      const tweets = await fetchTweets(
        username,
        formattedDate,
        formattedNextDate,
        env.SOCIALDATA_API_KEY,
      );

      const result = {
        username,
        date,
        post_count: tweets.length,
        statusIds: tweets.map((x) => x.id_str),
        //  tweets,
      };

      if (env.TWEET_KV) {
        const cacheKey = `date-v4:${username}:${date}`;
        ctx.waitUntil(
          env.TWEET_KV.put(cacheKey, JSON.stringify(result), {
            expirationTtl: 86400,
          }),
        );
      }

      return new Response(JSON.stringify(result, undefined, 2), {
        headers: {
          "Content-Type": "application/json;charset=utf8",
          "X-Cache": "MISS",
        },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          status: "error",
          message:
            error instanceof Error ? error.message : "Unknown error occurred",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
};

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
