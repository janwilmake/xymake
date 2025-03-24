interface Env {
  SOCIALDATA_API_KEY: string;
}

interface SocialDataTweetResponse {
  tweet_created_at: string;
  id_str: string;
  full_text: string;
  source: string;
  truncated: boolean;
  user: {
    id_str: string;
    name: string;
    screen_name: string;
    location: string;
    description: string;
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
  };
  lang: string;
  is_quote_status: boolean;
  is_pinned: boolean;
  quote_count: number;
  reply_count: number;
  retweet_count: number;
  favorite_count: number;
  views_count: number;
  bookmark_count: number;
  entities: {
    urls: Array<{
      url: string;
      expanded_url: string;
      display_url: string;
      indices: number[];
    }>;
    user_mentions: Array<{
      id_str: string;
      name: string;
      screen_name: string;
      indices: number[];
    }>;
    hashtags: Array<{
      text: string;
      indices: number[];
    }>;
    symbols: Array<{
      text: string;
      indices: number[];
    }>;
    media?: Array<{
      id_str: string;
      media_url_https: string;
      url: string;
      display_url: string;
      expanded_url: string;
      type: "photo" | "video" | "animated_gif";
      indices: number[];
    }>;
  };
}

interface ErrorResponse {
  status: string;
  message: string;
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/");

    // Expecting path like /username/status/tweet_id
    if (pathParts.length < 4 || pathParts[2] !== "status") {
      return;
    }

    const tweetId = pathParts[3];

    // Validate tweetId is numeric
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

    console.log({ tweetId });

    try {
      const apiResponse = await fetch(
        `https://api.socialdata.tools/twitter/tweets/${tweetId}`,
        {
          headers: {
            Authorization: `Bearer ${env.SOCIALDATA_API_KEY}`,
            "Content-Type": "application/json",
          },
        },
      );

      const responseData = await apiResponse.json<
        SocialDataTweetResponse | ErrorResponse
      >();

      if (!apiResponse.ok) {
        return new Response(JSON.stringify(responseData, undefined, 2), {
          status: apiResponse.status,
          headers: {
            "Content-Type": "application/json;charset=utf8",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      return new Response(JSON.stringify(responseData, undefined, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json;charset=utf8",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          status: "error",
          message:
            "Internal server error: " +
            (error instanceof Error ? error.message : "Unknown error"),
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }
  },
};
